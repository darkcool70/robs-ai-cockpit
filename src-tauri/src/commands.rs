//! Tauri command surface. Every command validates inputs; paths the frontend may open are
//! resolved server-side from known ids instead of being accepted verbatim.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_opener::OpenerExt;

use crate::cli::{self, AccountEnv, AgentLaunch, CliInfo, Provider, SessionMode, SessionOptions};
use crate::db::{now_iso, Db};
use crate::error::{AppError, AppResult};
use crate::monitor::{Runtime, RuntimeView, Runtimes};
use crate::pty::{OutputSink, PtyManager};
use crate::store::{self, Account, HistoryFilter, HistoryRow, Project, Session};
use crate::usage::{self, aggregate};
use crate::{git, paths, sink};

pub struct AppState {
    pub db: Arc<Db>,
    pub pty: Arc<PtyManager>,
    pub runtimes: Runtimes,
    pub clis: parking_lot::Mutex<Vec<CliInfo>>,
    pub output_tx: OutputTx,
    pub lifecycle: parking_lot::Mutex<()>,
    pub stt: Arc<crate::stt::Stt>,
    pub remote: Arc<crate::remote::Remote>,
}

/// PTY reader threads must never block on the UI (a blocked reader stalls ConPTY, which in
/// turn blocks writes). They push into this channel; one emitter thread batches to the webview.
pub type OutputTx = std::sync::mpsc::Sender<(String, u64, String)>;

pub fn spawn_output_emitter(app: AppHandle) -> OutputTx {
    let (tx, rx) = std::sync::mpsc::channel::<(String, u64, String)>();
    std::thread::Builder::new()
        .name("pty-emitter".into())
        .spawn(move || {
            while let Ok(first) = rx.recv() {
                // Coalesce whatever arrived in the next few ms, per session, preserving order.
                let mut batch: Vec<(String, u64, String)> = vec![first];
                let deadline = std::time::Instant::now() + std::time::Duration::from_millis(6);
                while let Some(left) = deadline.checked_duration_since(std::time::Instant::now()) {
                    match rx.recv_timeout(left) {
                        Ok((id, seq, data)) => match batch.iter_mut().rev().find(|b| b.0 == id) {
                            Some(b) if b.2.len() < 256 * 1024 => {
                                b.1 = seq;
                                b.2.push_str(&data);
                            }
                            _ => batch.push((id, seq, data)),
                        },
                        Err(_) => break,
                    }
                }
                for (id, seq, data) in batch {
                    let _ = app.emit("pty-output", OutputEvent { id: &id, seq, data: &data });
                }
            }
        })
        .expect("spawn emitter");
    tx
}

// ---------------------------------------------------------------------------
// Event sink bridging PTY output to the webview
// ---------------------------------------------------------------------------

pub struct TauriSink {
    pub app: AppHandle,
    pub db: Arc<Db>,
    pub runtimes: Runtimes,
    pub tx: parking_lot::Mutex<OutputTx>,
}

impl TauriSink {
    pub fn new(app: &AppHandle, state: &AppState) -> Arc<Self> {
        Arc::new(TauriSink {
            app: app.clone(),
            db: state.db.clone(),
            runtimes: state.runtimes.clone(),
            tx: parking_lot::Mutex::new(state.output_tx.clone()),
        })
    }
}

#[derive(Serialize, Clone)]
struct OutputEvent<'a> {
    id: &'a str,
    seq: u64,
    data: &'a str,
}

impl OutputSink for TauriSink {
    fn output(&self, id: &str, seq: u64, data: &str) {
        let _ = self.tx.lock().send((id.to_string(), seq, data.to_string()));
    }
    fn exit(&self, id: &str, code: Option<i64>) {
        let stopped_by_user = self.runtimes.lock().get(id).map(|r| r.stopped_by_user).unwrap_or(false);
        let status = if stopped_by_user || code == Some(0) { "stopped" } else { "failed" };
        let _ = store::mark_ended(&self.db.0.lock(), id, code, status);
        let view = self.runtimes.lock().get_mut(id).map(|rt| {
            rt.view.status = status.into();
            rt.view.running = false;
            rt.view.clone()
        });
        if let Some(v) = view {
            let _ = self.app.emit("session-runtime", &v);
        }
        let _ = self.app.emit("pty-exit", json!({ "id": id, "code": code, "status": status }));
        // Refresh usage soon after a session ends.
        let _ = self.app.emit("usage-dirty", json!({}));
    }
    fn detection(&self, id: &str, d: &crate::detect::Detection) {
        // `auth status` only checks that credentials exist; an auth error printed by the CLI
        // is the stronger signal, so surface it on the account until the next check.
        if d.signal == crate::detect::Signal::AuthRequired {
            let acc = self.runtimes.lock().get(id).and_then(|r| r.account_id.clone());
            if let Some(acc) = acc {
                let _ = store::set_auth(&self.db.0.lock(), &acc, "expired", Some(&format!("CLI reported: {}", d.text)));
                let _ = self.app.emit("accounts-changed", json!({}));
            }
        }
        let _ = self.app.emit("session-detection", json!({ "id": id, "detection": d }));
    }
    fn login_url(&self, id: &str, url: &str) {
        let view = self.runtimes.lock().get_mut(id).map(|rt| {
            rt.view.login_url = Some(url.to_string());
            rt.view.clone()
        });
        if let Some(v) = view {
            let _ = self.app.emit("session-runtime", &v);
        }
    }
}

// ---------------------------------------------------------------------------
// App / CLI info
// ---------------------------------------------------------------------------

fn setting_str(db: &Db, key: &str) -> Option<String> {
    store::get_setting(&db.0.lock(), key).ok().flatten().and_then(|v| v.as_str().map(str::to_string))
}

fn setting_bool(db: &Db, key: &str, default: bool) -> bool {
    store::get_setting(&db.0.lock(), key).ok().flatten().and_then(|v| v.as_bool()).unwrap_or(default)
}

pub fn detect_all(db: &Db) -> Vec<CliInfo> {
    vec![
        cli::detect(Provider::Claude, setting_str(db, "claudePath").as_deref()),
        cli::detect(Provider::Codex, setting_str(db, "codexPath").as_deref()),
    ]
}

#[tauri::command(async)]
pub fn detect_clis(state: State<AppState>) -> Vec<CliInfo> {
    let found = detect_all(&state.db);
    *state.clis.lock() = found.clone();
    found
}

/// Program + leading arguments for an account: the detected official CLI, or for a custom
/// profile the first word of its command line (resolved through PATH) and the rest.
fn program_for(state: &AppState, p: Provider, acc: &Account) -> AppResult<(String, Vec<String>)> {
    if p != Provider::Custom {
        return Ok((binary_for(state, p)?, Vec::new()));
    }
    let parts = cli::split_command(acc.command.as_deref().unwrap_or(""));
    let (first, rest) = parts.split_first().ok_or_else(|| AppError::invalid("This profile has no command line"))?;
    let bin = which::which(first).map(|p| p.to_string_lossy().into_owned()).map_err(|_| {
        AppError::invalid(format!("`{first}` was not found. Install it or use its full path in the profile's command line."))
    })?;
    Ok((bin, rest.to_vec()))
}

pub(crate) fn binary_for(state: &AppState, p: Provider) -> AppResult<String> {
    let cached = state.clis.lock().iter().find(|c| c.provider == p.as_str()).and_then(|c| c.path.clone());
    let path = match cached {
        Some(p) => Some(p),
        None => {
            let found = detect_all(&state.db);
            let r = found.iter().find(|c| c.provider == p.as_str()).and_then(|c| c.path.clone());
            *state.clis.lock() = found;
            r
        }
    };
    path.ok_or_else(|| AppError::invalid(format!("The official `{}` CLI was not found. Install it or set its path in Settings.", p.as_str())))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    data_dir: String,
    db_path: String,
    profiles_root: String,
    run_root: String,
    exe_path: String,
    telemetry: bool,
}

#[tauri::command(async)]
pub fn app_info() -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").into(),
        data_dir: paths::root().to_string_lossy().into(),
        db_path: paths::db_path().to_string_lossy().into(),
        profiles_root: paths::profiles_root().to_string_lossy().into(),
        run_root: paths::run_root().to_string_lossy().into(),
        exe_path: std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(),
        telemetry: false,
    }
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

#[tauri::command(async)]
pub fn projects_list(state: State<AppState>) -> AppResult<Vec<Project>> {
    store::list_projects(&state.db.0.lock())
}

#[tauri::command(async)]
pub fn project_add(state: State<AppState>, path: String, name: Option<String>) -> AppResult<Project> {
    let p = paths::normalize(Path::new(path.trim()));
    if !p.is_absolute() || !p.is_dir() {
        return Err(AppError::invalid("Project path must be an existing directory"));
    }
    let name = name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| {
        p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| p.to_string_lossy().into_owned())
    });
    let proj = Project {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        path: p.to_string_lossy().into_owned(),
        created_at: now_iso(),
        last_opened_at: Some(now_iso()),
        defaults: json!({}),
    };
    if let Some(existing) = store::list_projects(&state.db.0.lock())?.into_iter().find(|old| cli::same_path(Path::new(&old.path), &p)) {
        return Ok(existing);
    }
    store::insert_project(&state.db.0.lock(), &proj)
}

#[tauri::command(async)]
pub fn project_open(state: State<AppState>, id: String) -> AppResult<()> {
    store::touch_project(&state.db.0.lock(), &id)
}

#[tauri::command(async)]
pub fn project_rename(state: State<AppState>, id: String, name: String) -> AppResult<()> {
    if name.trim().is_empty() {
        return Err(AppError::invalid("Name must not be empty"));
    }
    store::rename_project(&state.db.0.lock(), &id, name.trim())
}

/// New-session defaults for a project (account, model, options, auto-continue). Free-form
/// JSON owned by the UI; validated again when a session is actually created.
#[tauri::command(async)]
pub fn project_set_defaults(state: State<AppState>, id: String, defaults: Value) -> AppResult<()> {
    if !defaults.is_object() {
        return Err(AppError::invalid("Defaults must be an object"));
    }
    if defaults.to_string().len() > 16 * 1024 {
        return Err(AppError::invalid("Defaults are too large"));
    }
    store::set_project_defaults(&state.db.0.lock(), &id, &defaults)
}

/// Removes the project from the cockpit only. Files on disk are never touched.
#[tauri::command(async)]
pub fn project_remove(state: State<AppState>, id: String) -> AppResult<()> {
    store::delete_project(&state.db.0.lock(), &id)
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[tauri::command(async)]
pub fn accounts_list(state: State<AppState>) -> AppResult<Vec<Account>> {
    store::list_accounts(&state.db.0.lock())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewAccount {
    provider: String,
    name: String,
    /// Provider "custom": command line of the tool.
    #[serde(default)]
    command: Option<String>,
    /// "managed" (new isolated dir under ~/.ai-cockpit/profiles) or "existing" (use a dir as-is).
    mode: String,
    config_dir: Option<String>,
    color: Option<String>,
}

#[tauri::command(async)]
pub fn account_add(state: State<AppState>, input: NewAccount) -> AppResult<Account> {
    let provider = Provider::parse(&input.provider).ok_or_else(|| AppError::invalid("Unknown provider"))?;
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::invalid("Nickname must not be empty"));
    }
    let command = input.command.as_deref().map(str::trim).filter(|c| !c.is_empty()).map(str::to_string);
    if provider == Provider::Custom {
        let c = command.as_deref().ok_or_else(|| AppError::invalid("Enter the command that starts the tool, e.g. gemini"))?;
        if c.len() > 500 || c.contains(['\n', '\r']) {
            return Err(AppError::invalid("The command line is too long or has line breaks"));
        }
    }
    let mode = if provider == Provider::Custom { "managed".to_string() } else { input.mode.clone() };
    let (dir, managed) = match mode.as_str() {
        "managed" => {
            let base = paths::profiles_root().join(provider.as_str());
            let slug = paths::slugify(name);
            let mut dir = base.join(&slug);
            let mut n = 2;
            while dir.exists() {
                dir = base.join(format!("{slug}-{n}"));
                n += 1;
            }
            paths::ensure_dir(&dir)?;
            (dir, true)
        }
        "existing" => {
            let d = input
                .config_dir
                .filter(|s| !s.trim().is_empty())
                .map(PathBuf::from)
                .unwrap_or_else(|| paths::default_config_dir(provider.as_str()));
            if !d.is_dir() {
                return Err(AppError::invalid(format!("Directory {} does not exist", d.display())));
            }
            let managed = paths::is_managed_profile_dir(&d);
            (d, managed)
        }
        _ => return Err(AppError::invalid("mode must be 'managed' or 'existing'")),
    };
    let acc = Account {
        id: uuid::Uuid::new_v4().to_string(),
        provider: provider.as_str().into(),
        name: name.into(),
        config_dir: dir.to_string_lossy().into_owned(),
        managed,
        color: input.color,
        auth_status: "unknown".into(),
        auth_detail: None,
        auth_checked_at: None,
        last_used_at: None,
        created_at: now_iso(),
        sort: 0,
        command: if provider == Provider::Custom { command } else { None },
        auth_email: None,
        auth_org: None,
    };
    if provider == Provider::Codex && paths::codex_home_too_long(&dir) {
        if input.mode == "managed" {
            let _ = std::fs::remove_dir(&dir);
        }
        return Err(AppError::invalid(format!(
            "Codex cannot use {} — the path is too long for its local socket (Windows limit: 108 characters). Use a shorter nickname or directory.",
            dir.display()
        )));
    }
    if store::list_accounts(&state.db.0.lock())?.iter().any(|old| old.provider == acc.provider && cli::same_path(Path::new(&old.config_dir), &dir)) {
        return Err(AppError::invalid("A profile for this provider already uses that config directory"));
    }
    store::insert_account(&state.db.0.lock(), &acc)?;
    Ok(acc)
}

#[tauri::command(async)]
pub fn account_update(state: State<AppState>, id: String, name: String, color: Option<String>) -> AppResult<()> {
    if name.trim().is_empty() {
        return Err(AppError::invalid("Nickname must not be empty"));
    }
    store::update_account_meta(&state.db.0.lock(), &id, name.trim(), color.as_deref())
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    label: String,
    efforts: Vec<String>,
}

/// Parse Codex's own `models_cache.json` (listed models only).
pub fn parse_codex_models(text: &str) -> Vec<ModelInfo> {
    let Ok(v) = serde_json::from_str::<Value>(text) else { return vec![] };
    v.get("models")
        .and_then(|m| m.as_array())
        .into_iter()
        .flatten()
        .filter(|m| m.get("visibility").and_then(|x| x.as_str()).unwrap_or("list") == "list")
        .filter_map(|m| {
            let id = m.get("slug").and_then(|x| x.as_str())?.to_string();
            let label = m.get("display_name").and_then(|x| x.as_str()).unwrap_or(&id).to_string();
            let efforts = m
                .get("supported_reasoning_levels")
                .and_then(|x| x.as_array())
                .into_iter()
                .flatten()
                .filter_map(|l| l.get("effort").and_then(|x| x.as_str()).map(str::to_string))
                .collect();
            Some(ModelInfo { id, label, efforts })
        })
        .collect()
}

/// Models and effort levels the new-session dialog can offer for an account. Claude's
/// aliases are fixed CLI names; Codex's list comes from the catalog Codex caches locally.
#[tauri::command(async)]
pub fn model_catalog(state: State<AppState>, account_id: String) -> AppResult<Vec<ModelInfo>> {
    let acc = store::get_account(&state.db.0.lock(), &account_id)?;
    let claude_efforts: Vec<String> = cli::CLAUDE_EFFORTS.iter().map(|s| s.to_string()).collect();
    Ok(match Provider::parse(&acc.provider) {
        Some(Provider::Claude) => [
            ("fable", "Fable (latest)"),
            ("opus", "Opus (latest)"),
            ("sonnet", "Sonnet (latest)"),
            ("haiku", "Haiku (latest)"),
        ]
        .into_iter()
        .map(|(id, label)| ModelInfo { id: id.into(), label: label.into(), efforts: claude_efforts.clone() })
        .collect(),
        _ => {
            let own = Path::new(&acc.config_dir).join("models_cache.json");
            let fallback = paths::default_config_dir("codex").join("models_cache.json");
            std::fs::read_to_string(&own).or_else(|_| std::fs::read_to_string(&fallback)).map(|t| parse_codex_models(&t)).unwrap_or_default()
        }
    })
}

/// Login email and organisation from `claude auth status --json` (only when logged in). Shown
/// on the Accounts page so profiles with different logins can be told apart; stored locally only.
pub fn claude_identity(stdout: &str) -> Option<(String, Option<String>)> {
    let v: Value = serde_json::from_str(stdout.trim()).ok()?;
    if !v.get("loggedIn").and_then(|x| x.as_bool()).unwrap_or(false) {
        return None;
    }
    let email = v.get("email").and_then(|x| x.as_str()).map(str::trim).filter(|e| e.contains('@'))?;
    // Personal plans get a default organisation named after the email; that adds nothing.
    let org = v
        .get("orgName")
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|o| !o.is_empty() && !o.to_lowercase().starts_with(&email.to_lowercase()))
        .map(str::to_string);
    Some((email.chars().take(200).collect(), org))
}

/// Interpret the official CLI's own status output. The status line keeps only non-identifying
/// fields; the login identity is read separately by `claude_identity`.
pub fn interpret_auth(provider: Provider, code: Option<i32>, stdout: &str, stderr: &str) -> (String, Option<String>) {
    match provider {
        Provider::Claude => match serde_json::from_str::<Value>(stdout.trim()) {
            Ok(v) => {
                let logged = v.get("loggedIn").and_then(|x| x.as_bool()).unwrap_or(false);
                let method = v.get("authMethod").and_then(|x| x.as_str()).unwrap_or("");
                let sub = v.get("subscriptionType").and_then(|x| x.as_str());
                if !logged {
                    ("logged-out".into(), Some("Not logged in".into()))
                } else if method == "claude.ai" {
                    ("connected".into(), Some(format!("Claude subscription{}", sub.map(|s| format!(" ({s})")).unwrap_or_default())))
                } else {
                    // Logged in, but not via the subscription (e.g. Console API key billing).
                    ("connected-api".into(), Some(format!("Auth method: {method} — not a subscription login")))
                }
            }
            Err(_) => ("error".into(), Some(first_line(stderr, stdout))),
        },
        Provider::Codex => {
            let text = format!("{stdout}\n{stderr}");
            let lower = text.to_lowercase();
            if lower.contains("not logged in") {
                ("logged-out".into(), Some("Not logged in".into()))
            } else if lower.contains("logged in using chatgpt") {
                ("connected".into(), Some("ChatGPT subscription".into()))
            } else if lower.contains("logged in using an api key") || lower.contains("api key") {
                ("connected-api".into(), Some("API key — not a subscription login".into()))
            } else if code == Some(0) && lower.contains("logged in") {
                ("connected".into(), Some(first_line(stdout, stderr)))
            } else {
                ("error".into(), Some(first_line(stderr, stdout)))
            }
        }
        // A custom tool counts as ready when it starts (`--version` succeeds); its own login
        // happens inside the tool.
        Provider::Custom => {
            if code == Some(0) {
                ("connected".into(), Some(format!("Installed {}", first_line(stdout, stderr)).trim().to_string()))
            } else {
                ("error".into(), Some(first_line(stderr, stdout)))
            }
        }
    }
}

fn first_line(a: &str, b: &str) -> String {
    a.lines().chain(b.lines()).map(str::trim).find(|l| !l.is_empty() && !l.starts_with("WARNING")).unwrap_or("").chars().take(200).collect()
}

#[tauri::command]
pub async fn account_check_auth(state: State<'_, AppState>, id: String, force: Option<bool>) -> AppResult<Account> {
    let acc = store::get_account(&state.db.0.lock(), &id)?;
    let provider = Provider::parse(&acc.provider).ok_or_else(|| AppError::invalid("bad provider"))?;
    let (bin, _) = program_for(&state, provider, &acc)?;
    let spec = cli::build_status_command(&bin, &AccountEnv { provider, config_dir: &acc.config_dir });
    let res = tauri::async_runtime::spawn_blocking(move || cli::run_spec(&spec, 20))
        .await
        .map_err(|e| AppError::other(e.to_string()))?;
    let (status, detail, identity) = match res {
        Ok(c) => {
            let (s, d) = interpret_auth(provider, c.code, &c.stdout, &c.stderr);
            let id = if provider == Provider::Claude { claude_identity(&c.stdout) } else { None };
            (s, d, id)
        }
        Err(e) => ("error".into(), Some(e.to_string()), None),
    };
    let conn = state.db.0.lock();
    // A CLI-reported expiry beats "credentials present"; it is cleared by a login flow or an
    // explicit re-check (force).
    if !(acc.auth_status == "expired" && status == "connected" && !force.unwrap_or(false)) {
        store::set_auth(&conn, &id, &status, detail.as_deref())?;
    }
    // Keep the last known identity through transient errors; forget it on logout.
    if let Some((email, org)) = &identity {
        store::set_identity(&conn, &id, Some(email), org.as_deref())?;
    } else if status == "logged-out" {
        store::set_identity(&conn, &id, None, None)?;
    }
    store::get_account(&conn, &id)
}

/// Remove a profile. `delete_files` is only honoured for directories the app created itself
/// under `~/.ai-cockpit/profiles`; anything else is left untouched.
#[tauri::command(async)]
pub fn account_remove(state: State<AppState>, id: String, delete_files: bool) -> AppResult<Value> {
    let acc = store::get_account(&state.db.0.lock(), &id)?;
    let running: Vec<String> = state
        .runtimes
        .lock()
        .values()
        .filter(|r| r.account_id.as_deref() == Some(id.as_str()) && r.view.running)
        .map(|r| r.id.clone())
        .collect();
    if !running.is_empty() {
        return Err(AppError::invalid("Stop this account's running sessions first"));
    }
    let dir = PathBuf::from(&acc.config_dir);
    let mut deleted = false;
    if delete_files {
        if !paths::is_managed_profile_dir(&dir) {
            return Err(AppError::invalid("Refusing to delete a directory outside ~/.ai-cockpit/profiles"));
        }
        if dir.exists() {
            std::fs::remove_dir_all(&dir)?;
            deleted = true;
        }
    }
    store::delete_account(&state.db.0.lock(), &id)?;
    Ok(json!({ "deletedFiles": deleted, "configDir": acc.config_dir }))
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSession {
    pub(crate) account_id: String,
    pub(crate) project_id: Option<String>,
    pub(crate) cwd: Option<String>,
    pub(crate) name: Option<String>,
    pub(crate) model: Option<String>,
    pub(crate) extra_args: Option<Vec<String>>,
    pub(crate) resume_provider_session_id: Option<String>,
    pub(crate) options: Option<SessionOptions>,
    pub(crate) auto_continue: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    #[serde(flatten)]
    pub(crate) session: Session,
    runtime: Option<RuntimeView>,
}

pub(crate) fn view(state: &AppState, s: Session) -> SessionView {
    let runtime = state.runtimes.lock().get(&s.id).map(|r| r.view.clone());
    SessionView { session: s, runtime }
}

#[tauri::command(async)]
pub fn session_create(state: State<AppState>, input: NewSession) -> AppResult<SessionView> {
    let conn = state.db.0.lock();
    let acc = store::get_account(&conn, &input.account_id)?;
    let project = match &input.project_id {
        Some(p) if !p.is_empty() => Some(store::get_project(&conn, p)?),
        _ => None,
    };
    let cwd = input
        .cwd
        .filter(|c| !c.trim().is_empty())
        .or_else(|| project.as_ref().map(|p| p.path.clone()))
        .unwrap_or_else(|| paths::home().to_string_lossy().into_owned());
    if !Path::new(&cwd).is_dir() {
        return Err(AppError::invalid(format!("Working directory {cwd} does not exist")));
    }
    let provider = Provider::parse(&acc.provider).ok_or_else(|| AppError::invalid("bad provider"))?;
    let options = input.options.unwrap_or_default();
    options.validate(provider).map_err(AppError::invalid)?;
    if let Some(m) = input.model.as_deref().map(str::trim).filter(|m| !m.is_empty()) {
        if m.contains(char::is_whitespace) {
            return Err(AppError::invalid(format!("\"{m}\" is not a model id. Use an alias like opus / sonnet or a full model name without spaces.")));
        }
    }
    let auto_continue = input.auto_continue.unwrap_or_else(|| {
        store::get_setting(&conn, "autoContinueDefault").ok().flatten().and_then(|v| v.as_bool()).unwrap_or(true)
    });
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM sessions WHERE account_id=?1", [&acc.id], |r| r.get(0))?;
    let name = input.name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| {
        format!("{} #{}", acc.name, count + 1)
    });
    // Claude lets us choose the conversation id up-front, so the transcript is known.
    let psid = input.resume_provider_session_id.clone().or_else(|| {
        (provider == Provider::Claude).then(|| uuid::Uuid::new_v4().to_string())
    });
    let s = Session {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        provider: acc.provider.clone(),
        kind: "agent".into(),
        account_id: Some(acc.id.clone()),
        project_id: project.as_ref().map(|p| p.id.clone()),
        cwd,
        extra_args: input.extra_args.unwrap_or_default(),
        options,
        auto_continue,
        voice_hotkey: None,
        status: "idle".into(),
        exit_code: None,
        model: input.model.clone().filter(|m| !m.trim().is_empty()),
        requested_model: input.model.filter(|m| !m.trim().is_empty()),
        provider_session_id: psid,
        transcript_path: None,
        worktree_path: None,
        created_at: now_iso(),
        started_at: None,
        ended_at: None,
        last_activity_at: None,
        closed: false,
    };
    store::insert_session(&conn, &s)?;
    if let Some(p) = &project {
        store::touch_project(&conn, &p.id)?;
    }
    drop(conn);
    Ok(view(&state, s))
}

/// Does a Claude transcript for this conversation already exist (→ must resume, not re-create)?
fn claude_transcript_exists(config_dir: &str, psid: &str) -> bool {
    let root = Path::new(config_dir).join("projects");
    let Ok(rd) = std::fs::read_dir(&root) else { return false };
    rd.flatten().any(|d| d.path().join(format!("{psid}.jsonl")).is_file())
}

fn start_inner(app: &AppHandle, state: &AppState, id: &str, cols: u16, rows: u16) -> AppResult<SessionView> {
    if state.pty.get(id).is_some_and(|h| !h.exited.load(std::sync::atomic::Ordering::SeqCst)) {
        return Err(AppError::invalid("Session is already running"));
    }
    let s = store::get_session(&state.db.0.lock(), id)?;
    if s.kind != "agent" {
        return Err(AppError::invalid("Only agent sessions can be (re)started"));
    }
    let acc_id = s.account_id.clone().ok_or_else(|| AppError::invalid("Session has no account (profile was removed)"))?;
    let acc = store::get_account(&state.db.0.lock(), &acc_id)?;
    let provider = Provider::parse(&acc.provider).ok_or_else(|| AppError::invalid("bad provider"))?;
    let (bin, lead_args) = program_for(state, provider, &acc)?;
    if !Path::new(&s.cwd).is_dir() {
        return Err(AppError::invalid(format!("Working directory {} no longer exists", s.cwd)));
    }
    let run_dir = paths::session_run_dir(id);
    paths::ensure_dir(&run_dir)?;

    let hooks = provider == Provider::Claude && setting_bool(&state.db, "claudeHooks", true);
    let statusline = hooks && setting_bool(&state.db, "claudeStatusLine", true);
    let settings_file = if hooks {
        let exe = std::env::current_exe()?;
        let settings = sink::claude_session_settings(&exe, &run_dir, statusline, setting_bool(&state.db, "activityDetails", true));
        let f = run_dir.join("settings.json");
        std::fs::write(&f, serde_json::to_vec_pretty(&settings)?)?;
        // Fresh event log for this run.
        let _ = std::fs::remove_file(run_dir.join("events.jsonl"));
        let _ = std::fs::remove_file(run_dir.join("statusline.json"));
        Some(f.to_string_lossy().into_owned())
    } else {
        None
    };

    let mode = match (provider, &s.provider_session_id) {
        (Provider::Claude, Some(psid)) if claude_transcript_exists(&acc.config_dir, psid) => {
            SessionMode::Resume { session_id: psid.clone() }
        }
        (Provider::Claude, psid) => SessionMode::New { session_id: psid.clone() },
        (Provider::Codex, Some(psid)) => SessionMode::Resume { session_id: psid.clone() },
        (Provider::Codex, None) => SessionMode::New { session_id: None },
        (Provider::Custom, _) => SessionMode::New { session_id: None },
    };
    let extra_args: Vec<String> = lead_args.into_iter().chain(s.extra_args.iter().cloned()).collect();
    let resumed_psid = match &mode {
        SessionMode::Resume { session_id } => Some(session_id.clone()),
        _ => None,
    };
    let spec = cli::build_agent_command(&AgentLaunch {
        binary: &bin,
        account: AccountEnv { provider, config_dir: &acc.config_dir },
        cwd: &s.cwd,
        mode,
        model: s.requested_model.as_deref(),
        display_name: Some(&s.name),
        settings_file: settings_file.as_deref(),
        options: &s.options,
        extra_args: &extra_args,
    });

    // Register runtime before spawning so early output is attributed.
    let mut rt = Runtime::new(
        id,
        provider,
        "agent",
        Some(acc.id.clone()),
        Some(acc.config_dir.clone()),
        &s.cwd,
        run_dir,
        hooks,
        if provider == Provider::Codex { resumed_psid } else { s.provider_session_id.clone() },
        s.model.clone(),
    );
    rt.view.provider_session_id = s.provider_session_id.clone();
    rt.view.auto_continue = s.auto_continue;
    if let Ok(Some(a)) = crate::automation::running_for(&state.db.0.lock(), id) {
        rt.view.automation = Some(crate::monitor::AutomationView::of(&a));
        rt.automation = Some(a);
    }
    if s.started_at.is_none() {
        rt.pending_input = s.options.initial_prompt.clone().filter(|p| !p.trim().is_empty());
    }
    state.runtimes.lock().insert(id.to_string(), rt);

    let sink = TauriSink::new(app, state);
    match state.pty.spawn(id, &spec, cols, rows, sink) {
        Ok(h) => {
            if let Some(rt) = state.runtimes.lock().get_mut(id) {
                rt.view.pid = h.pid;
            }
            let conn = state.db.0.lock();
            store::mark_started(&conn, id)?;
            store::touch_account(&conn, &acc.id)?;
            store::audit(&conn, "user", "session.start", &json!({ "session": id, "program": spec.program, "args": spec.args, "cwd": spec.cwd }))?;
        }
        Err(e) => {
            state.runtimes.lock().remove(id);
            store::mark_ended(&state.db.0.lock(), id, None, "failed")?;
            return Err(e);
        }
    }
    let s = store::get_session(&state.db.0.lock(), id)?;
    Ok(view(state, s))
}

#[tauri::command(async)]
pub fn session_start(app: AppHandle, state: State<AppState>, id: String, cols: u16, rows: u16) -> AppResult<SessionView> {
    let _operation = state.lifecycle.lock();
    start_inner(&app, &state, &id, cols, rows)
}

fn stop_inner(state: &AppState, id: &str) {
    if let Some(rt) = state.runtimes.lock().get_mut(id) {
        rt.stopped_by_user = true;
    }
    if let Some(h) = state.pty.get(id) {
        h.kill();
    }
}

#[tauri::command(async)]
pub fn session_stop(state: State<AppState>, id: String) -> AppResult<()> {
    let _operation = state.lifecycle.lock();
    stop_inner(&state, &id);
    Ok(())
}

#[tauri::command(async)]
pub fn session_restart(app: AppHandle, state: State<AppState>, id: String, cols: u16, rows: u16) -> AppResult<SessionView> {
    let _operation = state.lifecycle.lock();
    stop_inner(&state, &id);
    // Wait for the old process to exit (bounded).
    for _ in 0..50 {
        let done = state.pty.get(&id).map(|h| h.exited.load(std::sync::atomic::Ordering::SeqCst)).unwrap_or(true);
        if done {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    if state.pty.get(&id).is_some_and(|h| !h.exited.load(std::sync::atomic::Ordering::SeqCst)) {
        return Err(AppError::invalid("Previous process has not stopped yet. Wait a moment and retry."));
    }
    state.pty.remove(&id);
    start_inner(&app, &state, &id, cols, rows)
}

#[tauri::command(async)]
pub fn session_duplicate(state: State<AppState>, id: String) -> AppResult<SessionView> {
    let s = store::get_session(&state.db.0.lock(), &id)?;
    let acc = s.account_id.clone().ok_or_else(|| AppError::invalid("Session has no account"))?;
    session_create(
        state,
        NewSession {
            account_id: acc,
            project_id: s.project_id.clone(),
            cwd: Some(s.cwd.clone()),
            name: Some(format!("{} (copy)", s.name)),
            model: s.requested_model.clone(),
            extra_args: Some(s.extra_args.clone()),
            resume_provider_session_id: None,
            options: Some(SessionOptions { initial_prompt: None, ..s.options.clone() }),
            auto_continue: Some(s.auto_continue),
        },
    )
}

/// Turn auto-continue on/off for a session (takes effect immediately when running).
#[tauri::command(async)]
pub fn session_set_auto_continue(app: AppHandle, state: State<AppState>, id: String, on: bool) -> AppResult<()> {
    store::set_auto_continue(&state.db.0.lock(), &id, on)?;
    let view = state.runtimes.lock().get_mut(&id).map(|rt| {
        rt.view.auto_continue = on;
        if !on {
            rt.ac = Default::default();
            rt.view.auto_continue_at = None;
            rt.view.auto_continue_note = None;
        } else {
            rt.ac.attempts = 0;
        }
        rt.view.clone()
    });
    if let Some(v) = view {
        let _ = app.emit("session-runtime", &v);
    }
    Ok(())
}

/// Queue text for a running session. It is typed (as a paste + Enter) as soon as the CLI is
/// ready for input, so it never lands in a trust/login dialog or in the middle of output.
#[tauri::command(async)]
pub fn session_queue_input(state: State<AppState>, id: String, text: String) -> AppResult<()> {
    let text = text.trim_end().to_string();
    if text.trim().is_empty() {
        return Err(AppError::invalid("Nothing to send"));
    }
    if text.len() > 100_000 {
        return Err(AppError::invalid("Text is too long"));
    }
    let mut rts = state.runtimes.lock();
    let rt = rts.get_mut(&id).filter(|r| r.view.running && r.kind == "agent").ok_or_else(|| AppError::invalid("Session is not running"))?;
    rt.pending_input = Some(match rt.pending_input.take() {
        Some(prev) => format!("{prev}\n\n{text}"),
        None => text,
    });
    rt.view.pending_input = true;
    Ok(())
}

/// Locate a conversation transcript in one profile and copy it into another, so the other
/// account can `--resume` it. Only files of the provider's own documented layout are copied.
fn copy_conversation(provider: Provider, psid: &str, from: &Path, to: &Path) -> AppResult<()> {
    if psid.is_empty() || psid.contains(['/', '\\']) || psid.contains("..") {
        return Err(AppError::invalid("Invalid conversation id"));
    }
    let mut copied = 0;
    let mut copy = |src: &Path, dst: &Path| -> AppResult<()> {
        if let Some(parent) = dst.parent() {
            paths::ensure_dir(parent)?;
        }
        std::fs::copy(src, dst)?;
        copied += 1;
        Ok(())
    };
    match provider {
        Provider::Claude => {
            let root = from.join("projects");
            for d in std::fs::read_dir(&root).into_iter().flatten().flatten() {
                let file = d.path().join(format!("{psid}.jsonl"));
                if !file.is_file() {
                    continue;
                }
                let dest_dir = to.join("projects").join(d.file_name());
                copy(&file, &dest_dir.join(format!("{psid}.jsonl")))?;
                // Subagent transcripts etc. live next to it in a folder named after the id.
                let extra = d.path().join(psid);
                if extra.is_dir() {
                    for e in walkdir::WalkDir::new(&extra).into_iter().flatten().filter(|e| e.file_type().is_file()) {
                        if let Ok(rel) = e.path().strip_prefix(d.path()) {
                            copy(e.path(), &dest_dir.join(rel))?;
                        }
                    }
                }
            }
        }
        Provider::Codex => {
            for sub in ["sessions", "archived_sessions"] {
                for e in walkdir::WalkDir::new(from.join(sub)).into_iter().flatten().filter(|e| e.file_type().is_file()) {
                    let name = e.file_name().to_string_lossy();
                    if name.starts_with("rollout-") && name.ends_with(".jsonl") && name.contains(psid) {
                        if let Ok(rel) = e.path().strip_prefix(from) {
                            // Archived rollouts are restored into the live tree so `resume` finds them.
                            let rel = rel.strip_prefix("archived_sessions").map(|r| Path::new("sessions").join(r)).unwrap_or_else(|_| rel.to_path_buf());
                            copy(e.path(), &to.join(rel))?;
                        }
                    }
                }
            }
        }
        Provider::Custom => return Err(AppError::invalid("Custom CLIs cannot move a conversation to another profile")),
    }
    if copied == 0 {
        return Err(AppError::invalid("The conversation transcript was not found in this profile yet (send at least one message first)."));
    }
    Ok(())
}

/// Continue a conversation on another account of the same provider (e.g. when one account
/// hit its usage limit). The transcript is copied into the target profile and the new
/// session resumes it; the old pane is closed. Nothing is sent anywhere else.
#[tauri::command(async)]
pub fn session_handoff(state: State<AppState>, id: String, account_id: String, message: Option<String>) -> AppResult<SessionView> {
    let _operation = state.lifecycle.lock();
    let s = store::get_session(&state.db.0.lock(), &id)?;
    if s.kind != "agent" {
        return Err(AppError::invalid("Only agent sessions can move to another account"));
    }
    let src_id = s.account_id.clone().ok_or_else(|| AppError::invalid("Session has no account"))?;
    if src_id == account_id {
        return Err(AppError::invalid("Choose a different account"));
    }
    let (src, dst) = {
        let c = state.db.0.lock();
        (store::get_account(&c, &src_id)?, store::get_account(&c, &account_id)?)
    };
    if src.provider != dst.provider {
        return Err(AppError::invalid("A conversation can only move between accounts of the same provider"));
    }
    let provider = Provider::parse(&src.provider).ok_or_else(|| AppError::invalid("bad provider"))?;
    let psid = state
        .runtimes
        .lock()
        .get(&id)
        .and_then(|r| r.view.provider_session_id.clone())
        .or(s.provider_session_id.clone())
        .ok_or_else(|| AppError::invalid("This session has no conversation yet"))?;

    // Stop the old process first so the transcript is complete.
    stop_inner(&state, &id);
    for _ in 0..50 {
        if state.pty.get(&id).is_none_or(|h| h.exited.load(std::sync::atomic::Ordering::SeqCst)) {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    if state.pty.get(&id).is_some_and(|h| !h.exited.load(std::sync::atomic::Ordering::SeqCst)) {
        return Err(AppError::invalid("The session is still stopping. Try again in a moment."));
    }
    copy_conversation(provider, &psid, Path::new(&src.config_dir), Path::new(&dst.config_dir))?;

    let base = s.name.split(" → ").next().unwrap_or(&s.name).to_string();
    let follow_up = message.filter(|m| !m.trim().is_empty());
    let new = Session {
        id: uuid::Uuid::new_v4().to_string(),
        name: format!("{base} → {}", dst.name),
        provider: s.provider.clone(),
        kind: "agent".into(),
        account_id: Some(dst.id.clone()),
        project_id: s.project_id.clone(),
        cwd: s.cwd.clone(),
        extra_args: s.extra_args.clone(),
        options: SessionOptions { initial_prompt: follow_up, ..s.options.clone() },
        auto_continue: s.auto_continue,
        voice_hotkey: s.voice_hotkey.clone(),
        status: "idle".into(),
        exit_code: None,
        model: s.model.clone(),
        requested_model: s.requested_model.clone(),
        provider_session_id: Some(psid.clone()),
        transcript_path: None,
        worktree_path: s.worktree_path.clone(),
        created_at: now_iso(),
        started_at: None,
        ended_at: None,
        last_activity_at: None,
        closed: false,
    };
    state.pty.remove(&id);
    state.runtimes.lock().remove(&id);
    {
        let c = state.db.0.lock();
        store::insert_session(&c, &new)?;
        store::set_closed(&c, &id, true)?;
        store::mark_ended(&c, &id, s.exit_code, "stopped")?;
        // Loops follow the conversation to the new account.
        c.execute("UPDATE automations SET session_id=?2 WHERE session_id=?1", rusqlite::params![id, new.id])?;
        store::audit(&c, "user", "session.handoff", &json!({ "from": id, "to": new.id, "fromAccount": src.id, "toAccount": dst.id }))?;
    }
    Ok(view(&state, new))
}

#[tauri::command(async)]
pub fn session_rename(state: State<AppState>, id: String, name: String) -> AppResult<()> {
    if name.trim().is_empty() {
        return Err(AppError::invalid("Name must not be empty"));
    }
    store::set_session_field(&state.db.0.lock(), &id, "name", Some(name.trim()))
}

/// Close a pane: stops the process (if running) and hides the session from the workspace.
/// Metadata stays in history.
#[tauri::command(async)]
pub fn session_close(state: State<AppState>, id: String) -> AppResult<()> {
    let _operation = state.lifecycle.lock();
    stop_inner(&state, &id);
    for _ in 0..50 {
        if state.pty.get(&id).is_none_or(|h| h.exited.load(std::sync::atomic::Ordering::SeqCst)) { break; }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    if state.pty.get(&id).is_some_and(|h| !h.exited.load(std::sync::atomic::Ordering::SeqCst)) {
        return Err(AppError::invalid("Session is still stopping. Wait a moment and close it again."));
    }
    state.pty.remove(&id);
    state.runtimes.lock().remove(&id);
    let conn = state.db.0.lock();
    let s = store::get_session(&conn, &id)?;
    if s.kind != "agent" {
        conn.execute("DELETE FROM sessions WHERE id=?1", [&id])?;
    } else {
        conn.execute(
            "UPDATE automations SET state='paused', note='Paused: session closed', updated_at=?2 WHERE session_id=?1 AND state='running'",
            rusqlite::params![id, now_iso()],
        )?;
        store::set_closed(&conn, &id, true)?;
        if matches!(s.status.as_str(), "starting" | "working" | "waiting-for-input" | "idle" | "rate-limited") {
            store::mark_ended(&conn, &id, s.exit_code, "stopped")?;
        }
    }
    Ok(())
}

#[tauri::command(async)]
pub fn session_reopen(state: State<AppState>, id: String) -> AppResult<SessionView> {
    let conn = state.db.0.lock();
    store::set_closed(&conn, &id, false)?;
    let s = store::get_session(&conn, &id)?;
    drop(conn);
    Ok(view(&state, s))
}

#[tauri::command(async)]
pub fn sessions_open(state: State<AppState>) -> AppResult<Vec<SessionView>> {
    let list = store::open_sessions(&state.db.0.lock())?;
    Ok(list.into_iter().map(|s| view(&state, s)).collect())
}

#[tauri::command(async)]
pub fn history_query(state: State<AppState>, filter: HistoryFilter) -> AppResult<Value> {
    let (rows, total): (Vec<HistoryRow>, i64) = store::history(&state.db.0.lock(), &filter)?;
    Ok(json!({ "rows": rows, "total": total }))
}

// ---------------------------------------------------------------------------
// Utility terminals (login / status) — not recorded as agent sessions
// ---------------------------------------------------------------------------

#[tauri::command(async)]
pub fn account_login(app: AppHandle, state: State<AppState>, id: String, device_auth: Option<bool>, separate_browser: Option<bool>, cols: u16, rows: u16) -> AppResult<SessionView> {
    let _operation = state.lifecycle.lock();
    let acc = store::get_account(&state.db.0.lock(), &id)?;
    if state.runtimes.lock().values().any(|r| r.account_id.as_deref() == Some(&id) && r.view.running) {
        return Err(AppError::invalid("Stop this account's sessions before changing its login. Other accounts can keep running."));
    }
    let provider = Provider::parse(&acc.provider).ok_or_else(|| AppError::invalid("bad provider"))?;
    if provider == Provider::Codex && !device_auth.unwrap_or(false) {
        // The browser flow listens on a fixed local port; two at once would collide.
        let busy = state.runtimes.lock().values().any(|r| r.kind == "login" && r.provider == Provider::Codex && r.view.running);
        if busy {
            return Err(AppError::invalid("Another Codex login is still open. Finish or close it first (or use the device-code login)."));
        }
    }
    let bin = binary_for(&state, provider)?;
    let home = paths::home().to_string_lossy().into_owned();
    let mut spec = cli::build_login_command(&bin, &AccountEnv { provider, config_dir: &acc.config_dir }, &home, device_auth.unwrap_or(false));
    if provider == Provider::Claude && separate_browser.unwrap_or(true) {
        crate::login_browser::configure(&mut spec)?;
    }
    utility_session(&app, &state, &acc, "login", &format!("Login · {}", acc.name), &spec, cols, rows)
}

/// Open the login URL printed by a login terminal in a fresh private browser window, so the
/// intended account can be chosen (not whatever the default browser is signed in to).
#[tauri::command(async)]
pub fn login_open_private(state: State<AppState>, id: String) -> AppResult<()> {
    let url = state
        .runtimes
        .lock()
        .get(&id)
        .filter(|r| r.kind == "login")
        .and_then(|r| r.view.login_url.clone())
        .ok_or_else(|| AppError::invalid("No login link has been printed yet"))?;
    if !crate::login_browser::available() {
        return Err(AppError::invalid("A private login window needs Microsoft Edge or Google Chrome."));
    }
    crate::login_browser::open(&url, crate::login_browser::new_profile())
}

/// Opens the provider's interactive UI in a utility pane so the user can run `/status`
/// (or `/usage`) — the official place for quota details when no machine-readable source exists.
#[tauri::command(async)]
pub fn account_status_terminal(app: AppHandle, state: State<AppState>, id: String, cols: u16, rows: u16) -> AppResult<SessionView> {
    let acc = store::get_account(&state.db.0.lock(), &id)?;
    let provider = Provider::parse(&acc.provider).ok_or_else(|| AppError::invalid("bad provider"))?;
    let bin = binary_for(&state, provider)?;
    let spec = cli::build_agent_command(&AgentLaunch {
        binary: &bin,
        account: AccountEnv { provider, config_dir: &acc.config_dir },
        cwd: &paths::home().to_string_lossy(),
        mode: SessionMode::New { session_id: None },
        model: None,
        display_name: None,
        settings_file: None,
        options: &SessionOptions::default(),
        extra_args: &[],
    });
    utility_session(&app, &state, &acc, "status", &format!("Status · {}", acc.name), &spec, cols, rows)
}

#[allow(clippy::too_many_arguments)]
fn utility_session(app: &AppHandle, state: &AppState, acc: &Account, kind: &str, name: &str, spec: &cli::LaunchSpec, cols: u16, rows: u16) -> AppResult<SessionView> {
    let provider = Provider::parse(&acc.provider).unwrap_or(Provider::Claude);
    let s = Session {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.into(),
        provider: acc.provider.clone(),
        kind: kind.into(),
        account_id: Some(acc.id.clone()),
        project_id: None,
        cwd: spec.cwd.clone(),
        extra_args: vec![],
        options: SessionOptions::default(),
        auto_continue: false,
        voice_hotkey: None,
        status: "starting".into(),
        exit_code: None,
        model: None,
        provider_session_id: None,
        requested_model: None,
        transcript_path: None,
        worktree_path: None,
        created_at: now_iso(),
        started_at: Some(now_iso()),
        ended_at: None,
        last_activity_at: None,
        closed: false,
    };
    store::insert_session(&state.db.0.lock(), &s)?;
    let rt = Runtime::new(&s.id, provider, kind, Some(acc.id.clone()), Some(acc.config_dir.clone()), &s.cwd, paths::session_run_dir(&s.id), false, None, None);
    state.runtimes.lock().insert(s.id.clone(), rt);
    let sink = TauriSink::new(app, state);
    if let Err(e) = state.pty.spawn(&s.id, spec, cols, rows, sink) {
        state.runtimes.lock().remove(&s.id);
        state.db.0.lock().execute("DELETE FROM sessions WHERE id=?1", [&s.id])?;
        return Err(e);
    }
    Ok(view(state, s))
}

// ---------------------------------------------------------------------------
// PTY I/O
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attach {
    seq: u64,
    data: String,
    running: bool,
}

#[tauri::command(async)]
pub fn pty_attach(state: State<AppState>, id: String) -> Attach {
    state.pty.mark_frontend(&id);
    match state.pty.get(&id) {
        Some(h) => {
            let (seq, data) = h.snapshot();
            Attach { seq, data, running: !h.exited.load(std::sync::atomic::Ordering::SeqCst) }
        }
        None => Attach { seq: 0, data: String::new(), running: false },
    }
}

/// Plain text currently visible in a session's terminal (diagnostics / integration checks).
#[tauri::command(async)]
pub fn pty_screen(state: State<AppState>, id: String) -> AppResult<String> {
    let h = state.pty.get(&id).ok_or_else(|| AppError::invalid("session has no terminal"))?;
    Ok(h.screen_text())
}

#[tauri::command(async)]
pub fn pty_write(state: State<AppState>, id: String, data: String) -> AppResult<()> {
    let h = state.pty.get(&id).ok_or_else(|| AppError::invalid("session is not running"))?;
    h.write(data.as_bytes())
}

#[tauri::command(async)]
pub fn pty_resize(state: State<AppState>, id: String, cols: u16, rows: u16) -> AppResult<()> {
    if let Some(h) = state.pty.get(&id) {
        h.resize(cols, rows)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Usage, quota, prices
// ---------------------------------------------------------------------------

#[tauri::command(async)]
pub fn usage_summary(state: State<AppState>, range: String, filter: Option<aggregate::Filter>) -> AppResult<aggregate::Summary> {
    aggregate::summary(&state.db.0.lock(), &range, &filter.unwrap_or_default())
}

#[tauri::command(async)]
pub fn usage_heatmap(state: State<AppState>, days: i64, filter: Option<aggregate::Filter>) -> AppResult<Vec<aggregate::Point>> {
    aggregate::heatmap(&state.db.0.lock(), days.clamp(7, 400), &filter.unwrap_or_default())
}

#[tauri::command]
pub async fn usage_reindex(app: AppHandle, state: State<'_, AppState>, full: Option<bool>) -> AppResult<usage::IndexReport> {
    let db = state.db.clone();
    let rep = tauri::async_runtime::spawn_blocking(move || {
        if full.unwrap_or(false) {
            let c = db.0.lock();
            c.execute("DELETE FROM indexed_files", [])?;
            c.execute("DELETE FROM usage_records", [])?;
        }
        let accounts = store::list_accounts(&db.0.lock())?;
        Ok::<_, AppError>(usage::index_accounts(&db, &accounts))
    })
    .await
    .map_err(|e| AppError::other(e.to_string()))??;
    let _ = app.emit("usage-updated", &rep);
    Ok(rep)
}

#[tauri::command(async)]
pub fn prices_get(state: State<AppState>) -> AppResult<Vec<aggregate::Price>> {
    aggregate::list_prices(&state.db.0.lock())
}

#[tauri::command(async)]
pub fn prices_save(state: State<AppState>, prices: Vec<aggregate::Price>) -> AppResult<()> {
    aggregate::save_prices(&mut state.db.0.lock(), &prices)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaWindow {
    window: String,
    used_percent: f64,
    window_minutes: Option<i64>,
    resets_at: Option<i64>,
    source: String,
    captured_at: i64,
}

#[tauri::command(async)]
pub fn quota_overview(state: State<AppState>) -> AppResult<Value> {
    let c = state.db.0.lock();
    let mut st = c.prepare(
        "SELECT q.account_id, q.window, q.used_percent, q.window_minutes, q.resets_at, q.source, q.captured_at
         FROM quota_snapshots q
         JOIN (SELECT account_id, window, MAX(captured_at) m FROM quota_snapshots GROUP BY account_id, window) l
           ON l.account_id=q.account_id AND l.window=q.window AND l.m=q.captured_at
         ORDER BY q.account_id, q.window_minutes",
    )?;
    let mut map = serde_json::Map::new();
    let rows = st.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            QuotaWindow {
                window: r.get(1)?,
                used_percent: r.get(2)?,
                window_minutes: r.get(3)?,
                resets_at: r.get(4)?,
                source: r.get(5)?,
                captured_at: r.get(6)?,
            },
        ))
    })?;
    for row in rows {
        let (acc, w) = row?;
        let entry = map.entry(acc).or_insert_with(|| json!([]));
        if let Some(arr) = entry.as_array_mut() {
            arr.push(serde_json::to_value(w)?);
        }
    }
    Ok(Value::Object(map))
}

// ---------------------------------------------------------------------------
// Tasks, workspaces, stats, search, review, push, export (see extras.rs)
// ---------------------------------------------------------------------------

#[tauri::command(async)]
pub fn tasks_list(state: State<AppState>) -> AppResult<Vec<crate::extras::Task>> {
    crate::extras::tasks_list(&state.db.0.lock())
}

#[tauri::command(async)]
pub fn task_save(state: State<AppState>, input: crate::extras::TaskInput) -> AppResult<crate::extras::Task> {
    crate::extras::task_save(&state.db.0.lock(), input)
}

#[tauri::command(async)]
pub fn task_delete(state: State<AppState>, id: String) -> AppResult<()> {
    crate::extras::task_delete(&state.db.0.lock(), &id)
}

#[tauri::command(async)]
pub fn layouts_named(state: State<AppState>) -> AppResult<Vec<crate::extras::NamedLayout>> {
    crate::extras::layouts_named(&state.db.0.lock())
}

#[tauri::command(async)]
pub fn layout_named_save(state: State<AppState>, name: String, mode: String, panes: Value) -> AppResult<()> {
    crate::extras::layout_named_save(&state.db.0.lock(), &name, &mode, &panes)
}

#[tauri::command(async)]
pub fn layout_named_delete(state: State<AppState>, name: String) -> AppResult<()> {
    crate::extras::layout_named_delete(&state.db.0.lock(), &name)
}

#[tauri::command(async)]
pub fn activity_stats(state: State<AppState>, from_ms: i64) -> AppResult<Vec<crate::extras::SessionStats>> {
    let waiting: Vec<String> = state
        .runtimes
        .lock()
        .iter()
        .filter(|(_, r)| r.view.running && r.view.status == "waiting-for-input")
        .map(|(id, _)| id.clone())
        .collect();
    crate::extras::activity_stats(&state.db.0.lock(), from_ms, &waiting)
}

#[tauri::command]
pub async fn transcript_search(state: State<'_, AppState>, query: String, limit: Option<usize>) -> AppResult<Vec<crate::extras::SearchHit>> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Own read connection: scanning large files must not hold the shared lock.
        let c = rusqlite::Connection::open_with_flags(paths::db_path(), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        drop(db);
        crate::extras::search_transcripts(&c, &query, limit.unwrap_or(40).clamp(1, 200))
    })
    .await
    .map_err(|e| AppError::other(e.to_string()))?
}

/// Only project folders and session working directories can be reviewed / committed.
fn review_dir(state: &AppState, dir: &str) -> AppResult<PathBuf> {
    let norm = |s: &str| s.replace('\\', "/").trim_end_matches('/').to_lowercase();
    let want = norm(dir);
    let c = state.db.0.lock();
    let mut allowed: Vec<String> = store::list_projects(&c)?.into_iter().map(|p| p.path).collect();
    for s in store::open_sessions(&c)? {
        allowed.push(s.cwd.clone());
        if let Some(w) = s.worktree_path {
            allowed.push(w);
        }
    }
    allowed
        .iter()
        .find(|a| norm(a) == want)
        .map(PathBuf::from)
        .ok_or_else(|| AppError::invalid("Only project folders and session directories can be reviewed here"))
}

#[tauri::command(async)]
pub fn review_get(state: State<AppState>, dir: String) -> AppResult<crate::extras::Review> {
    let d = review_dir(&state, &dir)?;
    crate::extras::review(&d)
}

#[tauri::command(async)]
pub fn review_commit(state: State<AppState>, dir: String, message: String) -> AppResult<String> {
    let d = review_dir(&state, &dir)?;
    let hash = crate::extras::commit_all(&d, &message)?;
    let _ = store::audit(&state.db.0.lock(), "user", "git_commit", &json!({ "dir": d, "hash": hash }));
    Ok(hash)
}

#[tauri::command(async)]
pub fn push_send(url: String, title: String, message: String, priority: Option<String>) -> AppResult<()> {
    crate::extras::push(&url, &title, &message, priority.as_deref())
}

/// Write a report the user picked a location for (save dialog in the UI).
#[tauri::command(async)]
pub fn save_text_file(path: String, content: String) -> AppResult<()> {
    let p = PathBuf::from(&path);
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if !["md", "txt", "csv", "json"].contains(&ext.as_str()) {
        return Err(AppError::invalid("Only .md, .txt, .csv or .json files"));
    }
    std::fs::write(&p, content)?;
    Ok(())
}

/// Merge a task's worktree branch back into its project.
#[tauri::command(async)]
pub fn task_merge(state: State<AppState>, id: String) -> AppResult<crate::extras::MergeResult> {
    let (task, repo) = {
        let c = state.db.0.lock();
        let t = crate::extras::task_get(&c, &id)?;
        let pid = t.project_id.clone().ok_or_else(|| AppError::invalid("This task has no project"))?;
        let p = store::list_projects(&c)?.into_iter().find(|p| p.id == pid).ok_or_else(|| AppError::invalid("Project not found"))?;
        (t, PathBuf::from(p.path))
    };
    let (wt, branch) = (task.worktree.clone().unwrap_or_default(), task.branch.clone().unwrap_or_default());
    if wt.is_empty() || branch.is_empty() {
        return Err(AppError::invalid("This task has no own worktree"));
    }
    // The agent must not keep writing while we commit and merge.
    let running = state.runtimes.lock().values().any(|r| r.view.running && crate::cli::same_path(Path::new(&r.cwd), Path::new(&wt)));
    if running {
        return Err(AppError::invalid("Stop the agent working in this worktree first"));
    }
    let r = crate::extras::merge_worktree(&repo, Path::new(&wt), &branch, &task.title)?;
    let _ = store::audit(&state.db.0.lock(), "user", "task_merge", &json!({ "task": id, "merged": r.merged, "conflicts": r.conflicts }));
    Ok(r)
}

#[tauri::command]
pub async fn tests_run(state: State<'_, AppState>, dir: String, command: String, timeout_sec: Option<u64>) -> AppResult<crate::extras::TestRun> {
    let d = review_dir(&state, &dir)?;
    let t = std::time::Duration::from_secs(timeout_sec.unwrap_or(600).clamp(10, 3600));
    tauri::async_runtime::spawn_blocking(move || crate::extras::run_tests(&d, &command, t))
        .await
        .map_err(|e| AppError::other(e.to_string()))?
}

#[tauri::command(async)]
pub fn pins_list(state: State<AppState>) -> AppResult<Vec<crate::extras::Pin>> {
    crate::extras::pins_list(&state.db.0.lock())
}

#[tauri::command(async)]
pub fn pin_save(state: State<AppState>, pin: crate::extras::Pin) -> AppResult<crate::extras::Pin> {
    crate::extras::pin_save(&state.db.0.lock(), pin)
}

#[tauri::command(async)]
pub fn pin_delete(state: State<AppState>, id: String) -> AppResult<()> {
    crate::extras::pin_delete(&state.db.0.lock(), &id)
}

/// Night-shift reports etc. go to <data dir>/reports/<name>.md; returns the full path.
#[tauri::command(async)]
pub fn report_save(name: String, content: String) -> AppResult<String> {
    let safe: String = name.chars().map(|c| if c.is_ascii_alphanumeric() || "-_.".contains(c) { c } else { '-' }).take(80).collect();
    let dir = paths::root().join("reports");
    paths::ensure_dir(&dir)?;
    let p = dir.join(format!("{}.md", safe.trim_end_matches(".md")));
    std::fs::write(&p, content)?;
    Ok(p.to_string_lossy().into_owned())
}

#[tauri::command(async)]
pub fn remote_start(state: State<AppState>, port: u16, key: String) -> AppResult<crate::remote::RemoteInfo> {
    let port = if port < 1024 { 8765 } else { port };
    let info = state.remote.start(state.db.clone(), state.runtimes.clone(), port, key)?;
    let _ = store::audit(&state.db.0.lock(), "user", "remote_start", &json!({ "port": port }));
    Ok(info)
}

#[tauri::command(async)]
pub fn remote_stop(state: State<AppState>) {
    state.remote.stop();
}

#[tauri::command(async)]
pub fn remote_status(state: State<AppState>) -> Option<crate::remote::RemoteInfo> {
    state.remote.info.lock().clone()
}

#[tauri::command(async)]
pub fn update_info(fetch: Option<bool>) -> crate::update::UpdateInfo {
    crate::update::info(fetch.unwrap_or(false))
}

#[tauri::command(async)]
pub fn update_start(app: AppHandle, pull: bool) -> AppResult<()> {
    crate::update::start(app, pull)
}

/// Swap in the new build and restart: running agents are stopped by the exit (they resume
/// from their conversations after the restart).
#[tauri::command(async)]
pub fn update_apply(app: AppHandle, exe: String) -> AppResult<()> {
    crate::update::apply(Path::new(&exe))?;
    let h = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        h.exit(0);
    });
    Ok(())
}

/// Quota snapshots of the last `hours` per account (oldest first), for pace and forecasts.
#[tauri::command(async)]
pub fn quota_history(state: State<AppState>, hours: Option<i64>) -> AppResult<Value> {
    let c = state.db.0.lock();
    let since = chrono::Utc::now().timestamp_millis() - hours.unwrap_or(6).clamp(1, 24 * 8) * 3_600_000;
    let mut st = c.prepare(
        "SELECT account_id, window, used_percent, window_minutes, resets_at, source, captured_at
         FROM quota_snapshots WHERE captured_at >= ?1 ORDER BY account_id, captured_at",
    )?;
    let rows = st.query_map([since], |r| {
        Ok((
            r.get::<_, String>(0)?,
            QuotaWindow {
                window: r.get(1)?,
                used_percent: r.get(2)?,
                window_minutes: r.get(3)?,
                resets_at: r.get(4)?,
                source: r.get(5)?,
                captured_at: r.get(6)?,
            },
        ))
    })?;
    let mut map = serde_json::Map::new();
    for row in rows {
        let (acc, w) = row?;
        if let Some(arr) = map.entry(acc).or_insert_with(|| json!([])).as_array_mut() {
            arr.push(serde_json::to_value(w)?);
        }
    }
    Ok(Value::Object(map))
}

// ---------------------------------------------------------------------------
// Settings / layout
// ---------------------------------------------------------------------------

const SETTING_KEYS: &[&str] = &[
    "claudePath", "codexPath", "claudeHooks", "claudeStatusLine", "terminalFontSize",
    "terminalFontFamily", "indexIntervalSec", "defaultLayout", "orchestration",
    "autoContinueDefault", "autoContinueMessage", "autoContinueRetryMin", "autoFailover",
    "notifyOnWaiting", "defaultAutonomy", "defaultProjectId",
    "voiceEnabled", "voiceModel", "voiceLanguage", "voiceMode", "voiceHotkeyFocused", "voiceAutoSend", "voiceStopOnSilence", "voiceSilenceMs",
    "voiceVocabulary", "voiceDevice", "activityDetails", "editorCommand", "notifyPopup", "notifySound",
    "notifyWhen", "voiceSounds", "notifyTimeoutSec", "maxPanes", "whenFull", "voicePaneModifier",
    "voicePickWhileRecording", "voiceTargetDefault", "contextWarnPercent", "conflictWarn", "pushUrl",
    "pushAfterMin", "pushOnLimit", "pushOnFailed", "rolePresets", "voiceCommands", "autoDispatch",
    "dispatchAgents", "nightShift", "testCommands", "autoTests", "hangMinutes", "budgets", "ttsEnabled", "ttsWhen",
    "ttsVoice", "ttsRate", "remotePort", "remoteKey", "remoteEnabled", "customClis", "theme", "paneFonts", "tourSeen",
];

#[tauri::command(async)]
pub fn settings_get(state: State<AppState>) -> AppResult<serde_json::Map<String, Value>> {
    store::all_settings(&state.db.0.lock())
}

#[tauri::command(async)]
pub fn settings_set(state: State<AppState>, key: String, value: Value) -> AppResult<()> {
    if !SETTING_KEYS.contains(&key.as_str()) {
        return Err(AppError::invalid(format!("Unknown setting {key}")));
    }
    store::set_setting(&state.db.0.lock(), &key, &value)?;
    if key.ends_with("Path") {
        *state.clis.lock() = detect_all(&state.db);
    }
    Ok(())
}

#[tauri::command(async)]
pub fn layout_get(state: State<AppState>) -> AppResult<Option<Value>> {
    store::get_layout(&state.db.0.lock(), "main")
}

#[tauri::command(async)]
pub fn layout_save(state: State<AppState>, mode: String, panes: Value) -> AppResult<()> {
    store::save_layout(&state.db.0.lock(), "main", &mode, &panes)
}

// ---------------------------------------------------------------------------
// Security page
// ---------------------------------------------------------------------------

#[tauri::command(async)]
pub fn security_overview(state: State<AppState>) -> AppResult<Value> {
    let accounts = store::list_accounts(&state.db.0.lock())?;
    let procs: Vec<Value> = state
        .runtimes
        .lock()
        .values()
        .filter(|r| r.view.running)
        .map(|r| json!({ "sessionId": r.id, "kind": r.kind, "provider": r.provider.as_str(), "pid": r.view.pid, "cwd": r.cwd }))
        .collect();
    let reads: Vec<Value> = accounts
        .iter()
        .map(|a| {
            let sub = if a.provider == "claude" { vec!["projects/**/*.jsonl"] } else { vec!["sessions/**/rollout-*.jsonl", "archived_sessions/**/rollout-*.jsonl"] };
            json!({ "account": a.name, "provider": a.provider, "configDir": a.config_dir, "managed": a.managed, "reads": sub })
        })
        .collect();
    Ok(json!({
        "dataDir": paths::root(),
        "dbPath": paths::db_path(),
        "profilesRoot": paths::profiles_root(),
        "runRoot": paths::run_root(),
        "accounts": reads,
        "processes": procs,
        "telemetry": false,
        "network": "Model traffic originates only from the official claude/codex processes. The cockpit itself only connects to the internet when you download the speech engine or a speech model (github.com, huggingface.co; verified by SHA-256). Voice recognition runs on 127.0.0.1; audio never leaves this computer.",
    }))
}

#[tauri::command(async)]
pub fn open_known_dir(app: AppHandle, state: State<AppState>, which: String, account_id: Option<String>, session_id: Option<String>) -> AppResult<()> {
    let path: PathBuf = match which.as_str() {
        "data" => paths::root(),
        "profiles" => paths::profiles_root(),
        "account" => {
            let id = account_id.ok_or_else(|| AppError::invalid("account id required"))?;
            PathBuf::from(store::get_account(&state.db.0.lock(), &id)?.config_dir)
        }
        "project" | "cwd" => {
            let id = session_id.ok_or_else(|| AppError::invalid("id required"))?;
            let c = state.db.0.lock();
            if which == "project" {
                PathBuf::from(store::get_project(&c, &id)?.path)
            } else {
                PathBuf::from(store::get_session(&c, &id)?.cwd)
            }
        }
        _ => return Err(AppError::invalid("unknown directory")),
    };
    paths::ensure_dir(&path).ok();
    app.opener().open_path(path.to_string_lossy(), None::<&str>).map_err(|e| AppError::other(e.to_string()))
}

/// Export non-sensitive local settings (never credentials) to a JSON file chosen by the user.
#[tauri::command(async)]
pub fn export_settings(state: State<AppState>, dest: String) -> AppResult<()> {
    let c = state.db.0.lock();
    let accounts: Vec<Value> = store::list_accounts(&c)?
        .into_iter()
        .map(|a| json!({ "provider": a.provider, "name": a.name, "configDir": a.config_dir, "managed": a.managed, "color": a.color }))
        .collect();
    let out = json!({
        "exportedAt": now_iso(),
        "app": "ai-cockpit",
        "note": "Contains metadata only. No credentials, tokens or transcripts.",
        "accounts": accounts,
        "projects": store::list_projects(&c)?,
        "settings": store::all_settings(&c)?,
        "prices": aggregate::list_prices(&c)?,
        "layout": store::get_layout(&c, "main")?,
    });
    std::fs::write(dest, serde_json::to_vec_pretty(&out)?)?;
    Ok(())
}

/// Wipe the cockpit's own metadata. Managed profile directories (which contain CLI logins)
/// are only deleted if explicitly requested.
#[tauri::command(async)]
pub fn delete_app_data(state: State<AppState>, confirm: String, include_profiles: bool) -> AppResult<()> {
    if confirm != "DELETE" {
        return Err(AppError::invalid("Type DELETE to confirm"));
    }
    for id in state.pty.running_ids() {
        stop_inner(&state, &id);
        state.pty.remove(&id);
    }
    state.runtimes.lock().clear();
    {
        let c = state.db.0.lock();
        c.execute_batch(
            "DELETE FROM usage_records; DELETE FROM indexed_files; DELETE FROM quota_snapshots;
             DELETE FROM sessions; DELETE FROM layouts; DELETE FROM settings; DELETE FROM prices;
             DELETE FROM audit_log; DELETE FROM projects; DELETE FROM accounts; VACUUM;",
        )?;
    }
    let _ = std::fs::remove_dir_all(paths::run_root());
    if include_profiles {
        let _ = std::fs::remove_dir_all(paths::profiles_root());
    }
    Ok(())
}

#[tauri::command(async)]
pub fn hud_layout(app: AppHandle, height: f64) -> AppResult<()> {
    crate::hud::layout(&app, height)
}

#[tauri::command(async)]
pub fn focus_main(app: AppHandle) -> AppResult<()> {
    crate::hud::focus_main(&app)
}

// ---------------------------------------------------------------------------
// Activity, loops, templates
// ---------------------------------------------------------------------------

#[tauri::command(async)]
pub fn activity_recent_files(state: State<AppState>, limit: Option<i64>, session_id: Option<String>) -> AppResult<Vec<crate::activity::RecentFile>> {
    crate::activity::recent_files(&state.db.0.lock(), limit.unwrap_or(100), session_id.as_deref())
}

#[tauri::command(async)]
pub fn activity_timeline(state: State<AppState>, session_id: Option<String>, limit: Option<i64>) -> AppResult<Vec<crate::activity::TimelineItem>> {
    crate::activity::timeline(&state.db.0.lock(), session_id.as_deref(), limit.unwrap_or(200))
}

fn known_file(state: &AppState, path: &str) -> AppResult<PathBuf> {
    if !crate::activity::is_known_file(&state.db.0.lock(), path) {
        return Err(AppError::invalid("Only files touched by a session can be opened here"));
    }
    let p = PathBuf::from(path);
    if !p.is_file() {
        return Err(AppError::invalid("The file no longer exists"));
    }
    Ok(p)
}

/// Open a touched file in the editor (setting `editorCommand`, else Cursor / VS Code, else the
/// system default app).
#[tauri::command(async)]
pub fn file_open(app: AppHandle, state: State<AppState>, path: String) -> AppResult<()> {
    let p = known_file(&state, &path)?;
    let preferred = setting_str(&state.db, "editorCommand").filter(|c| !c.trim().is_empty());
    let candidates: Vec<String> = match preferred {
        Some(c) => vec![c],
        None => vec!["cursor".into(), "code".into()],
    };
    for c in candidates {
        if let Ok(bin) = which::which(&c) {
            let mut cmd = std::process::Command::new(bin);
            cmd.arg("-g").arg(&p);
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x0800_0000);
            }
            if cmd.spawn().is_ok() {
                return Ok(());
            }
        }
    }
    app.opener().open_path(p.to_string_lossy(), None::<&str>).map_err(|e| AppError::other(e.to_string()))
}

/// Uncommitted changes of a touched file (git diff), or the start of a new untracked file.
#[tauri::command(async)]
pub fn file_diff(state: State<AppState>, path: String) -> AppResult<Value> {
    let p = known_file(&state, &path)?;
    let dir = p.parent().map(Path::to_path_buf).unwrap_or_default();
    let run = |args: &[&str]| -> Option<String> {
        let mut cmd = std::process::Command::new("git");
        cmd.arg("-C").arg(&dir).args(args).arg("--").arg(&p);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000);
        }
        let out = cmd.output().ok()?;
        out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
    };
    let diff = run(&["diff", "--no-color", "HEAD"]).filter(|d| !d.trim().is_empty());
    let (kind, text) = match diff {
        Some(d) => ("diff", d),
        None => {
            let tracked = run(&["ls-files"]).map(|o| !o.trim().is_empty()).unwrap_or(false);
            let content = std::fs::read(&p).map(|b| String::from_utf8_lossy(&b[..b.len().min(200_000)]).into_owned()).unwrap_or_default();
            (if tracked { "unchanged" } else { "new" }, content)
        }
    };
    let text: String = text.chars().take(200_000).collect();
    Ok(json!({ "kind": kind, "text": text }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationInput {
    id: Option<String>,
    session_id: String,
    name: String,
    mode: String,
    prompts: Vec<String>,
    repeat: i64,
    delay_sec: i64,
    stop_phrase: Option<String>,
    start: bool,
    #[serde(default)]
    goal: Option<crate::automation::GoalConfig>,
}

pub(crate) fn attach_automation(state: &AppState, a: &crate::automation::Automation) {
    if let Some(rt) = state.runtimes.lock().get_mut(&a.session_id) {
        rt.view.automation = Some(crate::monitor::AutomationView::of(a));
        if a.state == "running" {
            rt.automation = Some(a.clone());
        } else if rt.automation.as_ref().is_some_and(|x| x.id == a.id) {
            rt.automation = None;
        }
    }
}

#[tauri::command(async)]
pub fn automation_list(state: State<AppState>, session_id: Option<String>) -> AppResult<Vec<crate::automation::Automation>> {
    crate::automation::list(&state.db.0.lock(), session_id.as_deref())
}

#[tauri::command(async)]
pub fn automation_save(app: AppHandle, state: State<AppState>, input: AutomationInput) -> AppResult<crate::automation::Automation> {
    let c = state.db.0.lock();
    let session = store::get_session(&c, &input.session_id)?;
    if session.kind != "agent" {
        return Err(AppError::invalid("Loops run in agent sessions only"));
    }
    let existing = input.id.as_deref().and_then(|id| crate::automation::get(&c, id).ok());
    let now = now_iso();
    let mut a = crate::automation::Automation {
        id: existing.as_ref().map(|e| e.id.clone()).unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
        session_id: input.session_id,
        name: input.name.trim().to_string(),
        mode: input.mode,
        prompts: input.prompts.into_iter().map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect(),
        repeat: input.repeat,
        delay_sec: input.delay_sec,
        stop_phrase: input.stop_phrase.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
        state: existing.as_ref().map(|e| e.state.clone()).unwrap_or_else(|| "paused".into()),
        step: 0,
        iteration: 0,
        last_sent_at: None,
        note: None,
        created_at: existing.as_ref().map(|e| e.created_at.clone()).unwrap_or_else(|| now.clone()),
        updated_at: now,
        goal: input.goal.map(|mut g| {
            g.goal = g.goal.trim().to_string();
            g.criteria = g.criteria.map(|c| c.trim().to_string()).filter(|c| !c.is_empty());
            g.supervisor_model = g.supervisor_model.map(|m| m.trim().to_string()).filter(|m| !m.is_empty());
            g.supervisor_account_id = g.supervisor_account_id.filter(|m| !m.is_empty());
            g
        }),
        progress: None,
        log: vec![],
        pending: None,
    };
    a.validate().map_err(AppError::invalid)?;
    if a.mode == "goal" {
        #[cfg(not(feature = "pro"))]
        return Err(AppError::invalid(crate::PRO_NOTE));
        #[cfg(feature = "pro")]
        crate::pro::license::require(&c)?;
    }
    if let Some(e) = existing.as_ref().filter(|e| e.mode == "goal" && a.mode == "goal") {
        // Editing a goal keeps its history; the supervisor uses the new text from now on.
        a.step = e.step;
        a.last_sent_at = e.last_sent_at;
        a.progress = e.progress;
        a.log = e.log.clone();
        a.pending = e.pending.clone();
    }
    if let Some(e) = existing.as_ref().filter(|e| e.mode != "goal" && a.mode != "goal") {
        // Editing keeps progress as long as the position still exists.
        if (e.step as usize) < a.prompts.len() {
            a.step = e.step;
            a.iteration = e.iteration;
            a.last_sent_at = e.last_sent_at;
        }
        if e.state == "done" || e.state == "stopped" {
            a.state = "paused".into();
        }
    }
    if input.start {
        a.state = "running".into();
        a.note = Some("Starting…".into());
        crate::automation::pause_others(&c, &a.session_id, &a.id)?;
    }
    crate::automation::save(&c, &a)?;
    drop(c);
    attach_automation(&state, &a);
    let _ = app.emit("automation-changed", &a);
    Ok(a)
}

#[tauri::command(async)]
pub fn automation_control(app: AppHandle, state: State<AppState>, id: String, action: String) -> AppResult<crate::automation::Automation> {
    let c = state.db.0.lock();
    let mut a = crate::automation::get(&c, &id)?;
    match action.as_str() {
        "start" => {
            if a.state == "done" || a.state == "stopped" {
                a.rewind();
            }
            a.state = "running".into();
            a.note = Some("Starting…".into());
            crate::automation::pause_others(&c, &a.session_id, &a.id)?;
        }
        "pause" => {
            a.state = "paused".into();
            a.note = Some("Paused".into());
        }
        "stop" => {
            a.state = "stopped".into();
            a.note = Some("Stopped".into());
        }
        "reset" => {
            a.rewind();
            a.note = None;
            if a.state != "running" {
                a.state = "paused".into();
            }
        }
        _ => return Err(AppError::invalid("Unknown action")),
    }
    crate::automation::save(&c, &a)?;
    drop(c);
    attach_automation(&state, &a);
    let _ = app.emit("automation-changed", &a);
    Ok(a)
}

#[tauri::command(async)]
pub fn automation_delete(app: AppHandle, state: State<AppState>, id: String) -> AppResult<()> {
    let a = crate::automation::get(&state.db.0.lock(), &id)?;
    crate::automation::delete(&state.db.0.lock(), &id)?;
    if let Some(rt) = state.runtimes.lock().get_mut(&a.session_id) {
        if rt.automation.as_ref().is_some_and(|x| x.id == id) {
            rt.automation = None;
        }
        if rt.view.automation.as_ref().is_some_and(|x| x.id == id) {
            rt.view.automation = None;
        }
    }
    let _ = app.emit("automation-changed", json!({ "id": id, "deleted": true }));
    Ok(())
}

/// Open one of the project's own pages in the browser (fixed list, never an arbitrary URL).
#[tauri::command(async)]
pub fn open_project_page(app: AppHandle, page: String) -> AppResult<()> {
    const REPO: &str = "https://github.com/darkcool70/robs-ai-cockpit";
    let url = match page.as_str() {
        "download" => format!("{REPO}/releases/latest"),
        "pro" => format!("{REPO}#robs-ai-cockpit-pro"),
        _ => REPO.to_string(),
    };
    app.opener().open_url(url, None::<&str>).map_err(|e| AppError::other(e.to_string()))
}

#[tauri::command(async)]
pub fn templates_list(state: State<AppState>) -> AppResult<Vec<crate::automation::Template>> {
    crate::automation::templates(&state.db.0.lock())
}

#[tauri::command(async)]
pub fn template_save(state: State<AppState>, template: crate::automation::Template) -> AppResult<crate::automation::Template> {
    let t = crate::automation::Template {
        id: if template.id.is_empty() { uuid::Uuid::new_v4().to_string() } else { template.id },
        ..template
    };
    crate::automation::save_template(&state.db.0.lock(), &t)?;
    Ok(t)
}

#[tauri::command(async)]
pub fn template_delete(state: State<AppState>, id: String) -> AppResult<()> {
    crate::automation::delete_template(&state.db.0.lock(), &id)
}

// ---------------------------------------------------------------------------
// Voice (speech to text)
// ---------------------------------------------------------------------------

pub const DEFAULT_VOCABULARY: &str = "Claude, Codex, Git, GitHub, commit, push, pull request, npm, pnpm, TypeScript, React, Rust, Tauri, README, TODO";

fn stt_config(db: &Db) -> crate::stt::Config {
    let lang = setting_str(db, "voiceLanguage").filter(|l| ["de", "en", "auto"].contains(&l.as_str())).unwrap_or_else(|| "de".into());
    crate::stt::Config {
        model: setting_str(db, "voiceModel").filter(|m| crate::stt::model(m).is_some()).unwrap_or_else(|| "small".into()),
        language: lang,
        vocabulary: setting_str(db, "voiceVocabulary").unwrap_or_else(|| DEFAULT_VOCABULARY.into()),
        device: setting_str(db, "voiceDevice").filter(|d| !d.is_empty()),
    }
}

#[tauri::command(async)]
pub fn stt_status(state: State<AppState>) -> crate::stt::Status {
    state.stt.status()
}

#[tauri::command]
pub async fn stt_install(app: AppHandle, state: State<'_, AppState>, model: String) -> AppResult<()> {
    let stt = state.stt.clone();
    tauri::async_runtime::spawn_blocking(move || stt.install(&app, &model)).await.map_err(|e| AppError::other(e.to_string()))?
}

/// Load the model in the background so the first dictation is fast.
#[tauri::command]
pub async fn stt_warmup(state: State<'_, AppState>) -> AppResult<()> {
    let stt = state.stt.clone();
    let cfg = stt_config(&state.db);
    tauri::async_runtime::spawn_blocking(move || stt.ensure_server(&cfg.model, &cfg.language))
        .await
        .map_err(|e| AppError::other(e.to_string()))?
        .map(|_| ())
        .map_err(AppError::invalid)
}

#[tauri::command(async)]
pub fn stt_start(app: AppHandle, state: State<AppState>, target: String) -> AppResult<()> {
    state.stt.start(&app, &target, stt_config(&state.db))?;
    let _ = app.emit("stt-state", json!({ "state": "recording", "target": target }));
    Ok(())
}

#[tauri::command]
pub async fn stt_stop(app: AppHandle, state: State<'_, AppState>) -> AppResult<Value> {
    let stt = state.stt.clone();
    let cfg = stt_config(&state.db);
    let _ = app.emit("stt-state", json!({ "state": "transcribing" }));
    let res = tauri::async_runtime::spawn_blocking(move || stt.stop(&cfg)).await.map_err(|e| AppError::other(e.to_string()))?;
    let _ = app.emit("stt-state", json!({ "state": "idle" }));
    let (target, t) = res?;
    Ok(json!({ "target": target, "text": t.text, "send": t.send }))
}

#[tauri::command(async)]
pub fn stt_cancel(app: AppHandle, state: State<AppState>) {
    state.stt.cancel();
    let _ = app.emit("stt-state", json!({ "state": "idle" }));
}

/// Normalise a shortcut like "ctrl + alt + digit1" to "Control+Alt+Digit1".
pub fn normalize_hotkey(h: &str) -> Option<String> {
    let mut mods = Vec::new();
    let mut key = None;
    for part in h.split('+').map(str::trim).filter(|p| !p.is_empty()) {
        match part.to_ascii_lowercase().as_str() {
            "ctrl" | "control" | "commandorcontrol" => mods.push("Control"),
            "alt" | "option" => mods.push("Alt"),
            "shift" => mods.push("Shift"),
            "super" | "meta" | "win" | "cmd" | "command" => mods.push("Super"),
            _ if key.is_none() && part.len() <= 16 && part.chars().all(|c| c.is_ascii_alphanumeric()) => key = Some(part.to_string()),
            _ => return None,
        }
    }
    let key = key?;
    // Ctrl+Alt+<key> is AltGr+<key> on German layouts ({ [ ] } @ € µ \ ~ |): would break typing.
    const ALTGR: &[&str] = &["Digit2", "Digit3", "Digit7", "Digit8", "Digit9", "Digit0", "KeyQ", "KeyE", "KeyM", "Minus", "BracketRight", "IntlBackslash"];
    if mods.contains(&"Control") && mods.contains(&"Alt") && !mods.contains(&"Shift") && ALTGR.iter().any(|k| k.eq_ignore_ascii_case(&key)) {
        return None;
    }
    let fkey = key.len() >= 2 && key.starts_with(['F', 'f']) && key[1..].chars().all(|c| c.is_ascii_digit());
    if mods.is_empty() && !fkey {
        return None; // a bare letter would block normal typing everywhere
    }
    let mut parts: Vec<&str> = ["Control", "Alt", "Shift", "Super"].into_iter().filter(|m| mods.contains(m)).collect();
    parts.push(&key);
    Some(parts.join("+"))
}

/// Assign (or clear) the push-to-talk shortcut of a session. Must be unique.
#[tauri::command(async)]
pub fn session_set_voice_hotkey(state: State<AppState>, id: String, hotkey: Option<String>) -> AppResult<Option<String>> {
    let norm = match hotkey.as_deref().map(str::trim).filter(|h| !h.is_empty()) {
        None => None,
        Some(h) => Some(normalize_hotkey(h).ok_or_else(|| AppError::invalid("Use a combination with Ctrl, Alt, Shift or Win (or an F-key); Ctrl+Alt with 2 3 7 8 9 0 Q E M ß + < is AltGr on German keyboards."))?),
    };
    let c = state.db.0.lock();
    if let Some(h) = &norm {
        let focused = store::get_setting(&c, "voiceHotkeyFocused").ok().flatten().and_then(|v| v.as_str().map(str::to_string));
        if focused.as_deref().map(|f| f.eq_ignore_ascii_case(h)).unwrap_or(false) {
            return Err(AppError::invalid("This shortcut is already used for \"dictate into focused pane\"."));
        }
        let taken: Option<String> = c
            .query_row("SELECT name FROM sessions WHERE closed=0 AND id!=?1 AND lower(voice_hotkey)=lower(?2)", rusqlite::params![id, h], |r| r.get(0))
            .ok();
        if let Some(name) = taken {
            return Err(AppError::invalid(format!("{h} is already used by \"{name}\".")));
        }
    }
    store::set_session_field(&c, &id, "voice_hotkey", norm.as_deref())?;
    Ok(norm)
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn git_status(path: String) -> AppResult<git::GitStatus> {
    tauri::async_runtime::spawn_blocking(move || git::status(Path::new(&path)))
        .await
        .map_err(|e| AppError::other(e.to_string()))?
}

#[tauri::command]
pub async fn git_worktrees(path: String) -> AppResult<Vec<git::Worktree>> {
    tauri::async_runtime::spawn_blocking(move || git::worktrees(Path::new(&path)))
        .await
        .map_err(|e| AppError::other(e.to_string()))?
}

#[tauri::command]
pub async fn git_worktree_add(state: State<'_, AppState>, project_id: String, name: String, base: Option<String>) -> AppResult<git::Worktree> {
    let project = store::get_project(&state.db.0.lock(), &project_id)?;
    let r = tauri::async_runtime::spawn_blocking(move || git::add_worktree(Path::new(&project.path), &name, base.as_deref()))
        .await
        .map_err(|e| AppError::other(e.to_string()))??;
    store::audit(&state.db.0.lock(), "user", "git.worktree.add", &json!({ "path": r.path, "branch": r.branch }))?;
    Ok(r)
}

#[tauri::command]
pub async fn git_worktree_remove(state: State<'_, AppState>, project_id: String, worktree_path: String) -> AppResult<()> {
    let project = store::get_project(&state.db.0.lock(), &project_id)?;
    let in_use = state.runtimes.lock().values().any(|r| r.view.running && cli::same_path(Path::new(&r.cwd), Path::new(&worktree_path)));
    if in_use {
        return Err(AppError::invalid("A running session uses this worktree. Stop it first."));
    }
    let wp = worktree_path.clone();
    tauri::async_runtime::spawn_blocking(move || git::remove_worktree(Path::new(&project.path), Path::new(&wp)))
        .await
        .map_err(|e| AppError::other(e.to_string()))??;
    store::audit(&state.db.0.lock(), "user", "git.worktree.remove", &json!({ "path": worktree_path }))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hotkeys_are_normalised_and_validated() {
        assert_eq!(normalize_hotkey("ctrl + alt + Digit1").as_deref(), Some("Control+Alt+Digit1"));
        assert!(normalize_hotkey("Control+Alt+Digit9").is_none(), "AltGr+9 is ] on German keyboards");
        assert_eq!(normalize_hotkey("Control+Shift+Alt+Digit9").as_deref(), Some("Control+Alt+Shift+Digit9"));
        assert_eq!(normalize_hotkey("Shift+Control+KeyM").as_deref(), Some("Control+Shift+KeyM"));
        assert_eq!(normalize_hotkey("F13").as_deref(), Some("F13"));
        assert!(normalize_hotkey("KeyA").is_none(), "bare keys would block typing");
        assert!(normalize_hotkey("Control+").is_none());
        assert!(normalize_hotkey("Control+Alt+rm -rf").is_none());
    }

    #[test]
    fn codex_model_catalog_lists_visible_models() {
        let t = r#"{"models":[{"slug":"gpt-a","display_name":"GPT-A","visibility":"list","supported_reasoning_levels":[{"effort":"low"},{"effort":"ultra"}]},
                              {"slug":"hidden","visibility":"hide"},{"slug":"gpt-b"}]}"#;
        let m = parse_codex_models(t);
        assert_eq!(m.len(), 2);
        assert_eq!(m[0], ModelInfo { id: "gpt-a".into(), label: "GPT-A".into(), efforts: vec!["low".into(), "ultra".into()] });
        assert_eq!(m[1].label, "gpt-b");
        assert!(parse_codex_models("not json").is_empty());
    }

    #[test]
    fn conversation_copy_between_profiles() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        // Claude: projects/<slug>/<id>.jsonl plus the per-conversation folder.
        let slug = a.path().join("projects").join("C--work-app");
        std::fs::create_dir_all(slug.join("abc").join("subagents")).unwrap();
        std::fs::write(slug.join("abc.jsonl"), "{}\n").unwrap();
        std::fs::write(slug.join("abc").join("subagents").join("agent-1.jsonl"), "{}\n").unwrap();
        std::fs::write(slug.join("other.jsonl"), "{}\n").unwrap();
        copy_conversation(Provider::Claude, "abc", a.path(), b.path()).unwrap();
        let dst = b.path().join("projects").join("C--work-app");
        assert!(dst.join("abc.jsonl").is_file());
        assert!(dst.join("abc").join("subagents").join("agent-1.jsonl").is_file());
        assert!(!dst.join("other.jsonl").exists(), "only this conversation");
        assert!(copy_conversation(Provider::Claude, "missing", a.path(), b.path()).is_err());
        assert!(copy_conversation(Provider::Claude, "../x", a.path(), b.path()).is_err());

        // Codex: sessions/YYYY/MM/DD/rollout-*-<id>.jsonl, archived ones come back live.
        let day = a.path().join("archived_sessions").join("2026").join("09").join("26");
        std::fs::create_dir_all(&day).unwrap();
        std::fs::write(day.join("rollout-2026-09-26T10-00-00-019a-uuid.jsonl"), "{}\n").unwrap();
        copy_conversation(Provider::Codex, "019a-uuid", a.path(), b.path()).unwrap();
        assert!(b.path().join("sessions/2026/09/26/rollout-2026-09-26T10-00-00-019a-uuid.jsonl").is_file());
    }

    #[test]
    fn auth_interpretation() {
        let (s, d) = interpret_auth(Provider::Claude, Some(0), r#"{"loggedIn":true,"authMethod":"claude.ai","email":"x@y","subscriptionType":"pro"}"#, "");
        assert_eq!(s, "connected");
        assert_eq!(d.as_deref(), Some("Claude subscription (pro)"));
        assert!(!d.unwrap().contains("x@y"), "no identifying data");
        assert_eq!(interpret_auth(Provider::Claude, Some(1), r#"{"loggedIn":false,"authMethod":"none"}"#, "").0, "logged-out");
        assert_eq!(interpret_auth(Provider::Claude, Some(0), r#"{"loggedIn":true,"authMethod":"console"}"#, "").0, "connected-api");
        assert_eq!(interpret_auth(Provider::Claude, Some(1), "boom", "error: x").0, "error");

        assert_eq!(interpret_auth(Provider::Codex, Some(0), "Logged in using ChatGPT", "").0, "connected");
        assert_eq!(interpret_auth(Provider::Codex, Some(1), "Not logged in", "WARNING: x").0, "logged-out");
        assert_eq!(interpret_auth(Provider::Codex, Some(0), "Logged in using an API key - sk-***", "").0, "connected-api");
    }

    #[test]
    fn claude_identity_only_when_logged_in() {
        let out = r#"{"loggedIn":true,"authMethod":"claude.ai","email":"a@example.com","orgId":"o1","orgName":"A's Org","subscriptionType":"max"}"#;
        assert_eq!(claude_identity(out), Some(("a@example.com".into(), Some("A's Org".into()))));
        let personal = r#"{"loggedIn":true,"email":"a@example.com","orgName":"a@example.com's Organization"}"#;
        assert_eq!(claude_identity(personal), Some(("a@example.com".into(), None)), "default org is noise");
        assert_eq!(claude_identity(r#"{"loggedIn":false,"email":"a@example.com"}"#), None);
        assert_eq!(claude_identity(r#"{"loggedIn":true,"email":""}"#), None);
        assert_eq!(claude_identity("not json"), None);
    }
}
