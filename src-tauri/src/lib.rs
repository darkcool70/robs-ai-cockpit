pub mod activity;
pub mod automation;
pub mod cli;
pub mod login_browser;
pub mod commands;
pub mod db;
pub mod detect;
pub mod error;
pub mod extras;
pub mod git;
pub mod hud;
pub mod monitor;
pub mod paths;
pub mod procjob;
pub mod remote;
pub mod pty;
pub mod sink;
pub mod store;
pub mod stt;
pub mod update;
pub mod usage;

use std::collections::HashMap;
use std::sync::Arc;

use tauri::{Emitter, Manager};

use commands::AppState;

fn spawn_indexer(app: tauri::AppHandle, db: Arc<db::Db>) {
    std::thread::Builder::new()
        .name("usage-indexer".into())
        .spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(3));
            loop {
                // Bind first: a guard inside an `if let` scrutinee lives for the whole block
                // and index_accounts() locks the DB again (parking_lot is not re-entrant).
                let accounts = store::list_accounts(&db.0.lock());
                if let Ok(accounts) = accounts {
                    let rep = usage::index_accounts(&db, &accounts);
                    if rep.records > 0 || !rep.errors.is_empty() {
                        let _ = app.emit("usage-updated", &rep);
                    }
                }
                activity::prune(&db.0.lock(), db::now_ms());
                // Keep the write-ahead log small while the app runs for days.
                let _ = db.0.lock().execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
                let secs = store::get_setting(&db.0.lock(), "indexIntervalSec")
                    .ok()
                    .flatten()
                    .and_then(|v| v.as_u64())
                    .unwrap_or(60)
                    .clamp(15, 3600);
                std::thread::sleep(std::time::Duration::from_secs(secs));
            }
        })
        .expect("spawn indexer");
}

/// Remove per-run directories of sessions that are no longer open, and throw-away login
/// browser profiles, once they are older than a day. Never touches account profiles.
fn cleanup_run_dirs(conn: &rusqlite::Connection) {
    let open: std::collections::HashSet<String> = conn
        .prepare("SELECT id FROM sessions WHERE closed=0")
        .and_then(|mut st| st.query_map([], |r| r.get::<_, String>(0))?.collect())
        .unwrap_or_default();
    let day = std::time::Duration::from_secs(24 * 3600);
    let old = |p: &std::path::Path| {
        p.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|age| age > day)
    };
    for root in [paths::run_root(), paths::root().join("login-browser")] {
        let Ok(rd) = std::fs::read_dir(&root) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().into_owned();
            if p.is_dir() && !open.contains(&name) && old(&p) && paths::is_within(&p, &paths::root()) {
                let _ = std::fs::remove_dir_all(&p);
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let conn = db::open(&paths::db_path()).expect("failed to open cockpit database");
    // Processes do not survive an app restart: anything recorded as live is now stopped.
    conn.execute(
        "UPDATE sessions SET status='stopped', ended_at=COALESCE(ended_at, last_activity_at)
         WHERE status IN ('starting','working','waiting-for-input','idle','rate-limited')",
        [],
    )
    .ok();
    conn.execute("DELETE FROM sessions WHERE kind != 'agent'", []).ok();
    cleanup_run_dirs(&conn);
    let db = Arc::new(db::Db::new(conn));
    let pty = Arc::new(pty::PtyManager::default());
    let runtimes: monitor::Runtimes = Arc::new(parking_lot::Mutex::new(HashMap::new()));
    let clis = commands::detect_all(&db);
    let stt = Arc::new(stt::Stt::default());
    let stt_exit = stt.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(move |app| {
            let output_tx = commands::spawn_output_emitter(app.handle().clone());
            app.manage(AppState { db: db.clone(), pty: pty.clone(), runtimes: runtimes.clone(), clis: parking_lot::Mutex::new(clis), output_tx, lifecycle: parking_lot::Mutex::new(()), stt: stt.clone(), remote: Arc::new(remote::Remote::default()) });
            monitor::spawn_monitor(app.handle().clone(), db.clone(), pty.clone(), runtimes.clone());
            monitor::spawn_git_watch(app.handle().clone(), db.clone(), runtimes.clone());
            if let Err(e) = hud::create(app.handle()) {
                eprintln!("{e}");
            }
            spawn_indexer(app.handle().clone(), db.clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::detect_clis,
            commands::projects_list,
            commands::project_add,
            commands::project_open,
            commands::project_rename,
            commands::project_remove,
            commands::project_set_defaults,
            commands::model_catalog,
            commands::accounts_list,
            commands::account_add,
            commands::account_update,
            commands::account_check_auth,
            commands::account_remove,
            commands::account_login,
            commands::account_status_terminal,
            commands::session_create,
            commands::session_start,
            commands::session_stop,
            commands::session_restart,
            commands::session_duplicate,
            commands::session_rename,
            commands::session_close,
            commands::session_reopen,
            commands::session_set_auto_continue,
            commands::session_queue_input,
            commands::session_handoff,
            commands::login_open_private,
            commands::sessions_open,
            commands::history_query,
            commands::pty_attach,
            commands::pty_screen,
            commands::pty_write,
            commands::pty_resize,
            commands::usage_summary,
            commands::usage_heatmap,
            commands::usage_reindex,
            commands::prices_get,
            commands::prices_save,
            commands::quota_overview,
            commands::quota_history,
            commands::tasks_list,
            commands::task_save,
            commands::task_delete,
            commands::layouts_named,
            commands::layout_named_save,
            commands::layout_named_delete,
            commands::activity_stats,
            commands::transcript_search,
            commands::review_get,
            commands::review_commit,
            commands::push_send,
            commands::save_text_file,
            commands::task_merge,
            commands::tests_run,
            commands::pins_list,
            commands::pin_save,
            commands::pin_delete,
            commands::report_save,
            commands::remote_start,
            commands::remote_stop,
            commands::remote_status,
            commands::update_info,
            commands::update_start,
            commands::update_apply,
            commands::settings_get,
            commands::settings_set,
            commands::layout_get,
            commands::layout_save,
            commands::security_overview,
            commands::open_known_dir,
            commands::export_settings,
            commands::delete_app_data,
            commands::hud_layout,
            commands::focus_main,
            commands::activity_recent_files,
            commands::activity_timeline,
            commands::file_open,
            commands::file_diff,
            commands::automation_list,
            commands::automation_save,
            commands::automation_control,
            commands::automation_delete,
            commands::templates_list,
            commands::template_save,
            commands::template_delete,
            commands::stt_status,
            commands::stt_install,
            commands::stt_warmup,
            commands::stt_start,
            commands::stt_stop,
            commands::stt_cancel,
            commands::session_set_voice_hotkey,
            commands::git_status,
            commands::git_worktrees,
            commands::git_worktree_add,
            commands::git_worktree_remove,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |app, event| {
            if let tauri::RunEvent::Exit = event {
                // Terminate every child CLI when the cockpit exits.
                let state = app.state::<AppState>();
                for h in state.pty.all() {
                    h.kill();
                }
                stt_exit.shutdown();
            }
        });
}
