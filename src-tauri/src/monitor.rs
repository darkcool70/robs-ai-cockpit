//! Per-session runtime tracking: derives status from provider-supplied signals.
//!
//! * Claude: documented hooks + statusLine (via `sink`), written to `run/<id>/`.
//! * Codex: the session's own rollout log (`task_started` / `task_complete`, `token_count`).
//! * Fallback: PTY output activity (clearly heuristic).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;

use parking_lot::Mutex;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::cli::{same_path, Provider};
use crate::db::{now_ms, Db};
use crate::detect::Signal;
use crate::pty::PtyManager;
use crate::store;
use crate::usage::{self, codex};

#[derive(Debug, Clone, Default)]
pub struct StatusInputs {
    pub running: bool,
    pub exited: bool,
    pub exit_code: Option<i64>,
    pub stopped_by_user: bool,
    pub now: i64,
    pub started_ms: i64,
    pub last_output_ms: i64,
    pub last_input_ms: i64,
    /// Whether this session is expected to deliver provider state (hooks / rollout).
    pub provider_signals: bool,
    /// Latest provider state: (working?, timestamp).
    pub provider_state: Option<(bool, i64)>,
    pub detection: Option<(Signal, i64)>,
}

pub fn compute_status(i: &StatusInputs) -> (&'static str, Option<String>) {
    if i.exited {
        let ok = i.stopped_by_user || i.exit_code == Some(0);
        return (if ok { "stopped" } else { "failed" }, None);
    }
    if !i.running {
        return ("stopped", None);
    }
    let mut attention = None;
    if let Some((sig, t)) = &i.detection {
        let fresh = *t >= i.last_input_ms;
        match sig {
            Signal::RateLimited if fresh => return ("rate-limited", Some("Usage limit reached".into())),
            Signal::AuthRequired if fresh => {
                return ("waiting-for-input", Some("Authentication required".into()))
            }
            Signal::ApproachingLimit if i.now - t < 30 * 60_000 => {
                attention = Some("Approaching usage limit".into())
            }
            _ => {}
        }
    }
    let recent_output = i.last_output_ms > 0 && i.now - i.last_output_ms < 2500;
    let status = match i.provider_state {
        Some((true, _)) => "working",
        Some((false, t)) => {
            // User answered after the provider went idle and output is streaming again.
            if i.last_input_ms > t && i.last_output_ms > i.last_input_ms + 300 && recent_output {
                "working"
            } else {
                "waiting-for-input"
            }
        }
        None => {
            if i.last_output_ms == 0 && i.now - i.started_ms < 20_000 {
                "starting"
            } else if i.provider_signals || i.last_input_ms == 0 {
                "idle"
            } else if recent_output && i.last_output_ms > i.last_input_ms + 400 {
                "working"
            } else {
                "waiting-for-input"
            }
        }
    };
    (status, attention)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeView {
    pub id: String,
    pub status: String,
    pub attention: Option<String>,
    pub model: Option<String>,
    pub provider_session_id: Option<String>,
    pub transcript_path: Option<String>,
    pub running: bool,
    pub pid: Option<u32>,
    pub context_percent: Option<f64>,
    /// Continue automatically once the usage limit resets.
    pub auto_continue: bool,
    /// When the next automatic "continue" is due (epoch ms).
    pub auto_continue_at: Option<i64>,
    /// Human readable state of the auto-continue scheduler.
    pub auto_continue_note: Option<String>,
    /// Official login URL printed by a login terminal (open in a private window).
    pub login_url: Option<String>,
    /// Text queued for delivery once the CLI is ready for input.
    pub pending_input: bool,
    /// What the agent is doing right now ("Editing store.ts", "Running npm test").
    pub current_activity: Option<String>,
    /// The agent's last answer (excerpt), shown in notifications and the overview.
    pub last_message: Option<String>,
    /// The last prompt of this session (excerpt).
    pub last_prompt: Option<String>,
    pub turn_started_at: Option<i64>,
    pub turn_ended_at: Option<i64>,
    /// Files changed in the current / last turn.
    pub turn_files: u32,
    /// Permission request or other notice from the CLI ("Claude needs your permission…").
    pub notice: Option<String>,
    /// Loop / prompt queue attached to this session.
    pub automation: Option<AutomationView>,
    pub git_branch: Option<String>,
    /// Uncommitted files in the working directory's repository.
    pub git_changed: Option<usize>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationView {
    pub id: String,
    pub name: String,
    pub mode: String,
    pub state: String,
    pub sent: i64,
    pub total: Option<i64>,
    pub note: Option<String>,
    /// Mode "goal": supervisor's progress estimate, 0–100.
    pub progress: Option<i64>,
}

impl AutomationView {
    pub fn of(a: &crate::automation::Automation) -> Self {
        AutomationView {
            id: a.id.clone(),
            name: a.name.clone(),
            mode: a.mode.clone(),
            state: a.state.clone(),
            sent: a.sent(),
            total: a.total(),
            note: a.note.clone(),
            progress: a.progress,
        }
    }
}

/// Auto-continue scheduler state (one per runtime).
#[derive(Debug, Clone, Default)]
pub struct AutoContinue {
    pub due: Option<i64>,
    pub attempts: u32,
    /// Delivered at; used to verify that the CLI actually started working again.
    pub delivered_at: Option<i64>,
    pub verified_retry: bool,
}

pub const AUTO_CONTINUE_DEFAULT_MESSAGE: &str = "continue";
pub const AUTO_CONTINUE_MAX_ATTEMPTS: u32 = 12;

pub struct Runtime {
    pub id: String,
    pub provider: Provider,
    pub kind: String,
    pub account_id: Option<String>,
    pub config_dir: Option<String>,
    pub cwd: String,
    pub run_dir: PathBuf,
    pub started_ms: i64,
    pub hooks: bool,
    pub stopped_by_user: bool,
    pub known_psid: Option<String>,
    pub pending_input: Option<String>,
    pub ac: AutoContinue,
    /// New activity not yet stored / emitted (drained by the monitor tick).
    pub new_activity: Vec<crate::activity::Activity>,
    pub automation: Option<crate::automation::Automation>,
    /// Claude: SessionStart hook seen (the REPL is past onboarding/trust dialogs).
    session_started: bool,
    hook_offset: u64,
    last_hook: Option<(bool, i64)>,
    statusline_mtime: i64,
    rollout: Option<PathBuf>,
    rollout_offset: u64,
    rollout_state: codex::FileState,
    rollout_last: Option<(bool, i64)>,
    last_search: i64,
    pub view: RuntimeView,
    last_db_touch: i64,
    /// Detection time of the last limit message recorded as a quota snapshot.
    limit_recorded: Option<i64>,
    /// Text typed by the cockpit that still has to be confirmed as submitted.
    submit_check: Option<SubmitCheck>,
    /// A goal supervisor is evaluating the last answer (background CLI call).
    pub supervising: bool,
}

/// Typed text only counts as sent once the CLI starts working on it. If it still sits in the
/// input box a few seconds later (the Enter was taken as part of a paste), press Enter again.
#[derive(Debug, Clone)]
struct SubmitCheck {
    /// When the Enter was pressed (epoch ms).
    at: i64,
    /// Start of the text, whitespace-normalised, to find it on screen.
    probe: String,
    tries: u8,
}

const SUBMIT_GRACE_MS: i64 = 3_000;
const SUBMIT_MAX_TRIES: u8 = 3;
pub const NOT_SUBMITTED_NOTICE: &str = "Your text is in the input box but was not sent: press Enter in the terminal";

impl Runtime {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        id: &str,
        provider: Provider,
        kind: &str,
        account_id: Option<String>,
        config_dir: Option<String>,
        cwd: &str,
        run_dir: PathBuf,
        hooks: bool,
        known_psid: Option<String>,
        model: Option<String>,
    ) -> Self {
        Runtime {
            id: id.into(),
            provider,
            kind: kind.into(),
            account_id,
            config_dir,
            cwd: cwd.into(),
            run_dir,
            started_ms: now_ms(),
            hooks,
            stopped_by_user: false,
            known_psid: known_psid.clone(),
            pending_input: None,
            ac: AutoContinue::default(),
            new_activity: Vec::new(),
            automation: None,
            session_started: false,
            hook_offset: 0,
            last_hook: None,
            statusline_mtime: 0,
            rollout: None,
            rollout_offset: 0,
            rollout_state: codex::FileState::default(),
            rollout_last: None,
            last_search: 0,
            view: RuntimeView {
                id: id.into(),
                status: "starting".into(),
                attention: None,
                model,
                provider_session_id: known_psid,
                transcript_path: None,
                running: true,
                pid: None,
                context_percent: None,
                auto_continue: false,
                auto_continue_at: None,
                auto_continue_note: None,
                login_url: None,
                pending_input: false,
                current_activity: None,
                last_message: None,
                last_prompt: None,
                turn_started_at: None,
                turn_ended_at: None,
                turn_files: 0,
                notice: None,
                automation: None,
                git_branch: None,
                git_changed: None,
            },
            last_db_touch: 0,
            limit_recorded: None,
            submit_check: None,
            supervising: false,
        }
    }
}

pub type Runtimes = Arc<Mutex<HashMap<String, Runtime>>>;

fn file_mtime(p: &Path) -> i64 {
    std::fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Claude: consume new hook events and the latest statusLine snapshot.
fn poll_claude(rt: &mut Runtime, db: &Db) {
    let events = rt.run_dir.join("events.jsonl");
    if let Ok((text, off)) = usage::read_new_lines(&events, rt.hook_offset) {
        rt.hook_offset = off;
        for line in text.lines() {
            let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
            let ts = v.get("ts").and_then(|x| x.as_i64()).unwrap_or_else(now_ms);
            let event = v.get("hook_event_name").and_then(|x| x.as_str()).unwrap_or("");
            match event {
                "UserPromptSubmit" | "PreToolUse" | "PostToolUse" => rt.last_hook = Some((true, ts)),
                "Stop" | "Notification" | "SessionEnd" => rt.last_hook = Some((false, ts)),
                "SessionStart" => rt.session_started = true,
                _ => {}
            }
            if let Some(sid) = v.get("session_id").and_then(|x| x.as_str()) {
                rt.view.provider_session_id = Some(sid.to_string());
            }
            if let Some(tp) = v.get("transcript_path").and_then(|x| x.as_str()) {
                rt.view.transcript_path = Some(tp.to_string());
            }
            claude_activity(rt, &v, event, ts);
        }
    }
    let sl = rt.run_dir.join("statusline.json");
    let m = file_mtime(&sl);
    if m > rt.statusline_mtime {
        rt.statusline_mtime = m;
        if let Some(v) = std::fs::read_to_string(&sl).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()) {
            if let Some(model) = v.pointer("/model/id").and_then(|x| x.as_str()) {
                rt.view.model = Some(model.to_string());
            }
            if let Some(sid) = v.get("session_id").and_then(|x| x.as_str()) {
                rt.view.provider_session_id = Some(sid.to_string());
            }
            if let Some(tp) = v.get("transcript_path").and_then(|x| x.as_str()) {
                rt.view.transcript_path = Some(tp.to_string());
            }
            rt.view.context_percent = v.pointer("/context_window/used_percentage").and_then(|x| x.as_f64());
            if let (Some(acc), Some(rl)) = (&rt.account_id, v.get("rate_limits")) {
                let captured = v.get("ts").and_then(|x| x.as_i64()).unwrap_or(m);
                let conn = db.0.lock();
                for name in ["five_hour", "seven_day"] {
                    if let Some(pct) = rl.pointer(&format!("/{name}/used_percentage")).and_then(|x| x.as_f64()) {
                        let resets_at = rl.pointer(&format!("/{name}/resets_at")).and_then(|x| x.as_i64());
                        let w = codex::RateWindow {
                            name: name.into(),
                            used_percent: pct.clamp(0.0, 100.0),
                            window_minutes: Some(if name == "five_hour" { 300 } else { 10080 }),
                            resets_at,
                        };
                        let _ = usage::insert_quota(&conn, acc, "claude", &w, "claude-statusline", captured);
                    }
                }
            }
        }
    }
}

fn start_turn(rt: &mut Runtime, ts: i64) {
    rt.view.turn_started_at = Some(ts);
    rt.view.turn_ended_at = None;
    rt.view.turn_files = 0;
    rt.view.notice = None;
    if rt.view.current_activity.is_none() {
        rt.view.current_activity = Some("Thinking…".into());
    }
}

/// Fold one activity into the live view and queue it for storage.
fn apply_activity(rt: &mut Runtime, a: crate::activity::Activity) {
    match a.kind.as_str() {
        "prompt" => {
            rt.view.last_prompt = Some(a.text.clone());
            start_turn(rt, a.ts);
            rt.view.current_activity = Some("Thinking…".into());
        }
        "tool" => rt.view.current_activity = Some(a.text.clone()),
        "file" => {
            rt.view.turn_files += 1;
            rt.view.current_activity = Some(a.text.clone());
        }
        "done" => {
            rt.view.current_activity = None;
            rt.view.turn_ended_at = Some(a.ts);
            rt.view.notice = None;
            if !a.text.is_empty() {
                rt.view.last_message = Some(a.text.clone());
            }
        }
        _ => {}
    }
    // Reads and searches would drown the timeline; the live view still shows them.
    let noisy = a.kind == "tool" && (a.text.starts_with("Reading ") || a.text.starts_with("Searching ") || a.text == "Updating the todo list");
    if !noisy {
        rt.new_activity.push(a);
    }
}

fn claude_activity(rt: &mut Runtime, v: &Value, event: &str, ts: i64) {
    use crate::activity::{describe_claude_tool, excerpt, Activity};
    match event {
        "UserPromptSubmit" => {
            let p = v
                .get("prompt")
                .and_then(|x| x.as_str())
                .map(|p| excerpt(&crate::activity::clean_prompt(p), 300))
                .unwrap_or_else(|| "Prompt submitted".into());
            apply_activity(rt, Activity::new(ts, "prompt", p, None));
        }
        "PreToolUse" => {
            let tool = v.get("tool_name").and_then(|x| x.as_str()).unwrap_or("tool");
            let (label, _) = describe_claude_tool(tool, v.get("tool_input").unwrap_or(&Value::Null));
            rt.view.notice = None;
            let is_edit = matches!(tool, "Edit" | "MultiEdit" | "Write" | "NotebookEdit");
            if is_edit {
                rt.view.current_activity = Some(label);
            } else {
                apply_activity(rt, Activity::new(ts, "tool", label, None));
            }
        }
        "PostToolUse" => {
            // The tool ran, so a permission request for it was answered.
            rt.view.notice = None;
            let tool = v.get("tool_name").and_then(|x| x.as_str()).unwrap_or("tool");
            let (label, file) = describe_claude_tool(tool, v.get("tool_input").unwrap_or(&Value::Null));
            if let Some(f) = file {
                apply_activity(rt, Activity::new(ts, "file", label, Some(f)));
            }
        }
        "Notification" => {
            // "Claude is waiting for your input" (idle reminder) repeats the done signal;
            // only permission requests and similar need a separate "needs you" notice.
            let idle = v.get("notification_type").and_then(|x| x.as_str()) == Some("idle_prompt")
                || v.get("message").and_then(|x| x.as_str()).is_some_and(|m| m.to_lowercase().contains("waiting for your input"));
            if idle {
                return;
            }
            if let Some(m) = v.get("message").and_then(|x| x.as_str()) {
                rt.view.notice = Some(excerpt(m, 160));
                rt.new_activity.push(Activity::new(ts, "input", excerpt(m, 160), None));
            }
        }
        "Stop" => {
            let msg = v
                .get("last_assistant_message")
                .and_then(|x| x.as_str())
                .map(str::to_string)
                .or_else(|| rt.view.transcript_path.as_deref().and_then(|t| crate::activity::claude_last_message(Path::new(t))))
                .unwrap_or_default();
            apply_activity(rt, Activity::new(ts, "done", crate::activity::excerpt_lines(&msg, 1200), None));
        }
        _ => {}
    }
}

/// Codex: locate this session's rollout file, then tail it.
fn poll_codex(rt: &mut Runtime, db: &Db, claimed: &[PathBuf]) {
    let now = now_ms();
    if rt.rollout.is_none() {
        if now - rt.last_search < 2000 {
            return;
        }
        rt.last_search = now;
        let home = rt.config_dir.clone().map(PathBuf::from).unwrap_or_else(|| crate::paths::default_config_dir("codex"));
        rt.rollout = find_rollout(&home, &rt.cwd, rt.started_ms, rt.known_psid.as_deref(), claimed);
        if let Some(p) = &rt.rollout {
            // For a resumed session, skip history: only new lines matter for live status.
            if rt.known_psid.is_some() {
                rt.rollout_offset = std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
                if let Ok(first) = std::fs::read_to_string(p).map(|s| s.lines().next().unwrap_or("").to_string()) {
                    if let Some((id, cwd, _)) = codex::read_meta(&first) {
                        rt.rollout_state.session_id = Some(id);
                        rt.rollout_state.cwd = cwd;
                    }
                }
            }
        }
    }
    let Some(path) = rt.rollout.clone() else { return };
    rt.view.transcript_path = Some(path.to_string_lossy().into_owned());
    if let Ok((text, off)) = usage::read_new_lines(&path, rt.rollout_offset) {
        rt.rollout_offset = off;
        let mut latest_rl = None;
        for line in text.lines() {
            if let Some(rl) = codex::rate_limits_of(line) {
                latest_rl = Some(rl);
            }
            match codex::parse_line(line, &mut rt.rollout_state) {
                Some(codex::Event::TaskStarted(t)) => {
                    rt.rollout_last = Some((true, t));
                    start_turn(rt, now_ms());
                }
                Some(codex::Event::TaskComplete(t)) => rt.rollout_last = Some((false, t)),
                _ => {}
            }
            let cwd = rt.rollout_state.cwd.clone().unwrap_or_else(|| rt.cwd.clone());
            for a in crate::activity::codex_activity(line, now_ms(), Some(&cwd)) {
                apply_activity(rt, a);
            }
        }
        if let Some(sid) = &rt.rollout_state.session_id {
            rt.view.provider_session_id = Some(sid.clone());
        }
        if let Some(m) = &rt.rollout_state.model {
            rt.view.model = Some(m.clone());
        }
        if let (Some(acc), Some((ts, windows))) = (&rt.account_id, latest_rl) {
            let conn = db.0.lock();
            for w in &windows {
                let _ = usage::insert_quota(&conn, acc, "codex", w, "codex-rollout", ts);
            }
        }
    }
}

pub fn find_rollout(home: &Path, cwd: &str, started_ms: i64, psid: Option<&str>, claimed: &[PathBuf]) -> Option<PathBuf> {
    let today = chrono::Local::now();
    let mut best: Option<(i64, PathBuf)> = None;
    for d in [today, today - chrono::Duration::days(1)] {
        let dir = home.join("sessions").join(d.format("%Y/%m/%d").to_string());
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
            if !name.starts_with("rollout-") || claimed.contains(&p) {
                continue;
            }
            if let Some(id) = psid {
                if name.contains(id) {
                    return Some(p);
                }
                continue;
            }
            let m = file_mtime(&p);
            if m < started_ms - 5_000 {
                continue;
            }
            let first = std::fs::File::open(&p).ok().and_then(|f| {
                use std::io::BufRead;
                std::io::BufReader::new(f).lines().next()?.ok()
            });
            let Some((_, meta_cwd, meta_ts)) = first.as_deref().and_then(codex::read_meta) else { continue };
            if meta_ts.map(|t| t < started_ms - 10_000).unwrap_or(false) {
                continue;
            }
            if meta_cwd.map(|c| same_path(Path::new(&c), Path::new(cwd))).unwrap_or(false) {
                let t = meta_ts.unwrap_or(m);
                if best.as_ref().map(|(bt, _)| t < *bt).unwrap_or(true) {
                    best = Some((t, p));
                }
            }
        }
    }
    best.map(|b| b.1)
}

static TRUST_PROMPT: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| {
    regex::Regex::new(r"(?i)(trust (the files|this folder|the contents|this directory)|one you trust|allow codex to work|sign in with (chatgpt|device code)|provide your own api key|select login method|choose the text style|press enter to continue|finish signing in|log in to|login method|update now \(runs)").unwrap()
});

pub const DIALOG_NOTICE: &str = "Answer the dialog in the terminal (e.g. trust this folder) — your queued task is sent right after";

/// What the CLIs show once their input box is ready (footer / empty-composer placeholder).
static READY_HINT: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| {
    regex::Regex::new(r"(?i)(for shortcuts|context left|ask codex to do anything|ask a follow-up|shift\+tab to cycle|plan mode on|accept edits on|bypass permissions on|auto mode on)").unwrap()
});

/// Whether the CLI can take typed input now: output settled, and no onboarding / trust /
/// login dialog on the visible screen (typing there would answer the dialog instead).
pub fn ready_for_input(provider: Provider, hooks: bool, session_started: bool, started_ms: i64, last_output_ms: i64, now: i64, screen: &str) -> bool {
    if last_output_ms == 0 || now - last_output_ms < 1500 || now - started_ms < 3000 {
        return false;
    }
    if provider == Provider::Claude && hooks && !session_started {
        return false;
    }
    // Nothing rendered yet (e.g. the terminal has not answered the console's startup query).
    if screen.trim().is_empty() || TRUST_PROMPT.is_match(screen) {
        return false;
    }
    // Claude with hooks already proved readiness via SessionStart; otherwise the input box
    // itself must be visible (Codex may sit silently while it installs its daemon).
    // Custom CLIs have no known footer: settled output without a dialog is the best signal.
    (provider == Provider::Claude && hooks) || provider == Provider::Custom || READY_HINT.is_match(screen)
}

/// When to continue after a usage limit: the reset printed by the CLI, else the latest
/// quota snapshot of an exhausted window, else a retry interval. Adds a small grace period.
pub fn resolve_reset(detected_ms: Option<i64>, quota_resets_ms: Option<i64>, now: i64, retry_min: i64) -> (i64, &'static str) {
    const GRACE: i64 = 90_000;
    match (detected_ms, quota_resets_ms) {
        (Some(t), _) if t > now - 60_000 => (t.max(now) + GRACE, "reset time printed by the CLI"),
        (_, Some(t)) if t > now => (t + GRACE, "reset time from quota data"),
        _ => (now + retry_min.clamp(1, 240) * 60_000, "no reset time known; retrying periodically"),
    }
}

fn exhausted_window_reset(db: &Db, account: &str, now: i64) -> Option<i64> {
    let c = db.0.lock();
    c.query_row(
        "SELECT MAX(q.resets_at) FROM quota_snapshots q
         JOIN (SELECT window, MAX(captured_at) m FROM quota_snapshots WHERE account_id=?1 GROUP BY window) l
           ON l.window=q.window AND l.m=q.captured_at
         WHERE q.account_id=?1 AND q.used_percent >= 98 AND q.resets_at IS NOT NULL",
        [account],
        |r| r.get::<_, Option<i64>>(0),
    )
    .ok()
    .flatten()
    .map(|s| s * 1000)
    .filter(|t| *t > now)
}

fn setting_i64(db: &Db, key: &str, default: i64) -> i64 {
    store::get_setting(&db.0.lock(), key).ok().flatten().and_then(|v| v.as_i64()).unwrap_or(default)
}

fn setting_string(db: &Db, key: &str) -> Option<String> {
    store::get_setting(&db.0.lock(), key).ok().flatten().and_then(|v| v.as_str().map(str::to_string)).filter(|s| !s.trim().is_empty())
}

/// How long to wait between the text and its Enter. The CLIs treat fast input as a paste and
/// ignore (or insert) an Enter that arrives while they are still processing it.
pub fn submit_delay_ms(text: &str) -> u64 {
    (450 + text.chars().count() as u64 / 4).min(1_800)
}

/// Type text into a CLI like a paste followed by Enter. Claude Code and Codex get a bracketed
/// paste (one atomic paste, never mistaken for typed keys); other CLIs get plain keystrokes.
pub fn deliver_input(h: &crate::pty::PtyHandle, text: &str, provider: Provider) -> crate::error::AppResult<()> {
    let text = text.replace("\r\n", "\n");
    if provider != Provider::Custom || text.contains('\n') {
        h.write(format!("\x1b[200~{text}\x1b[201~").as_bytes())?;
    } else {
        h.write(text.as_bytes())?;
    }
    std::thread::sleep(std::time::Duration::from_millis(submit_delay_ms(&text)));
    h.write(b"\r")
}

fn squash(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

/// The first words of a prompt, as they would appear in the CLI's input box.
pub fn submit_probe(text: &str) -> String {
    let first = text.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("");
    squash(first).chars().take(32).collect()
}

/// Whether typed text still sits in the input area (the last lines of the screen).
pub fn still_in_input(screen: &str, probe: &str) -> bool {
    if probe.chars().count() < 6 {
        return false;
    }
    let lines: Vec<&str> = screen.lines().filter(|l| !l.trim().is_empty()).collect();
    let tail = lines[lines.len().saturating_sub(12)..].join(" ");
    squash(&tail).contains(probe)
}

/// File changes for CLIs without per-file events (Codex, Claude without hooks): poll git in
/// each working directory and attribute new changes to the sessions working there.
pub fn spawn_git_watch(app: AppHandle, db: Arc<Db>, runtimes: Runtimes) {
    std::thread::Builder::new()
        .name("activity-git".into())
        .spawn(move || {
            let mut watch = crate::activity::GitWatch::default();
            loop {
                std::thread::sleep(std::time::Duration::from_secs(6));
                // (id, cwd, working?, needs file attribution?) of running agents.
                let all: Vec<(String, String, bool, bool)> = runtimes
                    .lock()
                    .values()
                    .filter(|r| r.kind == "agent" && r.view.running)
                    .map(|r| (r.id.clone(), r.cwd.clone(), r.view.status == "working", r.provider == Provider::Codex || !r.hooks))
                    .collect();
                let targets: Vec<(String, String, bool)> = all.iter().filter(|t| t.3).map(|t| (t.0.clone(), t.1.clone(), t.2)).collect();
                let mut dirs: Vec<String> = all.iter().map(|t| t.1.clone()).collect();
                dirs.sort();
                dirs.dedup();
                let mut found: Vec<(String, crate::activity::Activity)> = Vec::new();
                let mut summary: Vec<(String, Option<String>, Option<usize>)> = Vec::new();
                for dir in &dirs {
                    let dir = dir.as_str();
                    let changes = watch.changes(Path::new(dir));
                    let branch = watch.dirty.contains_key(Path::new(dir)).then(|| crate::activity::git_branch(Path::new(dir))).flatten();
                    summary.push((dir.to_string(), branch, watch.dirty.get(Path::new(dir)).copied()));
                    let changes: Vec<_> = if targets.iter().any(|t| t.1 == dir) { changes } else { vec![] };
                    if changes.is_empty() {
                        continue;
                    }
                    let here: Vec<&(String, String, bool)> = targets.iter().filter(|t| t.1 == dir).collect();
                    let working: Vec<&&(String, String, bool)> = here.iter().filter(|t| t.2).collect();
                    // Only attribute when an agent is working; otherwise it was probably the user.
                    let owners: Vec<String> = if working.is_empty() { vec![] } else { working.iter().map(|t| t.0.clone()).collect() };
                    for (file, ts) in changes {
                        let f = file.to_string_lossy().into_owned();
                        let name = file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                        for id in &owners {
                            found.push((id.clone(), crate::activity::Activity::new(ts, "file", format!("Changed {name}"), Some(f.clone()))));
                        }
                    }
                }
                // Branch + uncommitted count for every running agent (overview cards).
                let mut git_views = Vec::new();
                {
                    let mut rts = runtimes.lock();
                    for rt in rts.values_mut().filter(|r| r.kind == "agent" && r.view.running) {
                        if let Some((_, b, n)) = summary.iter().find(|s| s.0 == rt.cwd) {
                            if rt.view.git_branch != *b || rt.view.git_changed != *n {
                                rt.view.git_branch = b.clone();
                                rt.view.git_changed = *n;
                                git_views.push(rt.view.clone());
                            }
                        }
                    }
                }
                for v in git_views {
                    let _ = app.emit("session-runtime", &v);
                }
                if found.is_empty() {
                    continue;
                }
                let mut stored = Vec::new();
                {
                    let conn = db.0.lock();
                    for (id, a) in found {
                        // Skip what the rollout already reported for this session.
                        let dup = conn
                            .query_row(
                                "SELECT 1 FROM activity WHERE session_id=?1 AND kind='file' AND lower(file)=lower(?2) AND ts > ?3",
                                rusqlite::params![id, a.file, a.ts - 60_000],
                                |_| Ok(()),
                            )
                            .is_ok();
                        if !dup && crate::activity::insert(&conn, &id, &a).is_ok() {
                            stored.push((id, a));
                        }
                    }
                }
                {
                    let mut rts = runtimes.lock();
                    for (id, _) in &stored {
                        if let Some(rt) = rts.get_mut(id) {
                            rt.view.turn_files += 1;
                        }
                    }
                }
                for (id, a) in stored {
                    let _ = app.emit("session-activity", serde_json::json!({ "id": id, "activity": a }));
                }
            }
        })
        .expect("spawn git watch");
}

/// Quota window from a CLI's limit message: which window (weekly vs. 5-hour) and when it
/// resets. None without a readable reset time (a guess would be worse than no data).
pub fn limit_window(text: &str, now: chrono::DateTime<chrono::Local>) -> Option<crate::usage::codex::RateWindow> {
    let resets = crate::detect::reset_at_ms(text, now)?;
    let weekly = text.to_lowercase().contains("week");
    Some(crate::usage::codex::RateWindow {
        name: if weekly { "seven_day" } else { "five_hour" }.into(),
        used_percent: 100.0,
        window_minutes: Some(if weekly { 10_080 } else { 300 }),
        resets_at: Some(resets / 1000),
    })
}

/// Turns for CLIs without hooks/logs (custom tools, Claude without hooks): input starts a turn,
/// output after it followed by 2.5 s of quiet ends it. Quick answers never look "working" to
/// the status heuristic, but still get a turn end the UI can rely on.
pub fn heuristic_turns(view: &mut RuntimeView, in_ms: i64, out_ms: i64, now: i64) {
    if in_ms > 0 && view.turn_started_at.is_none_or(|t| in_ms > t) && view.turn_ended_at.is_none_or(|e| in_ms > e) {
        view.turn_started_at = Some(in_ms);
        view.turn_ended_at = None;
    }
    if let (Some(start), None) = (view.turn_started_at, view.turn_ended_at) {
        if out_ms > start && now - out_ms >= 2500 {
            view.turn_ended_at = Some(out_ms);
        }
    }
}

/// Background loop: one tick per second.
pub fn spawn_monitor(app: AppHandle, db: Arc<Db>, pty: Arc<PtyManager>, runtimes: Runtimes) {
    std::thread::Builder::new()
        .name("session-monitor".into())
        .spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_millis(1000));
            tick(&app, &db, &pty, &runtimes);
        })
        .expect("spawn monitor");
}

pub fn tick(app: &AppHandle, db: &Db, pty: &PtyManager, runtimes: &Runtimes) {
    let mut to_emit: Vec<RuntimeView> = Vec::new();
    let mut deliveries: Vec<(Arc<crate::pty::PtyHandle>, String, Provider)> = Vec::new();
    let mut enters: Vec<Arc<crate::pty::PtyHandle>> = Vec::new();
    let mut resume_requests: Vec<(String, String)> = Vec::new();
    let mut new_activity: Vec<(String, crate::activity::Activity)> = Vec::new();
    let mut automation_saves: Vec<crate::automation::Automation> = Vec::new();
    let mut supervise: Vec<crate::automation::SuperviseJob> = Vec::new();
    let mut rts = runtimes.lock();
    let mut claimed: Vec<PathBuf> = rts.values().filter_map(|r| r.rollout.clone()).collect();
    let now = now_ms();
    // Oldest session first: Codex agents started together in one folder claim their rollout
    // logs in start order, and a log found in this tick is taken before the next one looks.
    let mut order: Vec<&mut Runtime> = rts.values_mut().collect();
    order.sort_by_key(|r| r.started_ms);
    for rt in order {
        let handle = pty.get(&rt.id);
        let (running, exited, code, out_ms, in_ms, detection, pid) = match &handle {
            Some(h) => (
                !h.exited.load(Ordering::SeqCst),
                h.exited.load(Ordering::SeqCst),
                *h.exit_code.lock(),
                h.last_output_ms.load(Ordering::Relaxed),
                h.last_input_ms.load(Ordering::Relaxed),
                h.detection.lock().as_ref().map(|(d, t)| (d.signal.clone(), *t)),
                h.pid,
            ),
            None => (false, false, None, 0, 0, None, None),
        };
        // Snapshot before polling so model / id discoveries count as changes and get persisted.
        let prev = rt.view.clone();
        if running && rt.kind == "agent" {
            match rt.provider {
                Provider::Claude if rt.hooks => poll_claude(rt, db),
                Provider::Codex => {
                    poll_codex(rt, db, &claimed);
                    if let Some(p) = rt.rollout.as_ref().filter(|p| !claimed.contains(p)) {
                        claimed.push(p.clone());
                    }
                }
                _ => {}
            }
        }
        let provider_state = match rt.provider {
            Provider::Claude => rt.last_hook,
            Provider::Codex => rt.rollout_last,
            Provider::Custom => None,
        };
        let inputs = StatusInputs {
            running,
            exited,
            exit_code: code,
            stopped_by_user: rt.stopped_by_user,
            now,
            started_ms: rt.started_ms,
            last_output_ms: out_ms,
            last_input_ms: in_ms,
            provider_signals: rt.kind == "agent" && (rt.hooks || rt.provider == Provider::Codex),
            provider_state,
            detection,
        };
        let (status, attention) = compute_status(&inputs);
        if rt.kind == "agent" && !inputs.provider_signals && running {
            heuristic_turns(&mut rt.view, in_ms, out_ms, now);
        }
        rt.view.status = status.to_string();
        rt.view.attention = attention;
        rt.view.running = running;
        rt.view.pid = pid;

        // --- limit message → quota snapshot ----------------------------------------
        // While an account is limited the CLI sends no quota data (Claude's statusLine only
        // runs with answers), so the overview would show stale numbers. The printed
        // "limit reached · resets 12pm" becomes a 100 % snapshot with that reset time.
        if status == "rate-limited" && rt.kind == "agent" {
            if let (Some(acc), Some((text, t))) = (rt.account_id.clone(), handle.as_ref().and_then(|h| h.detection.lock().as_ref().map(|(d, t)| (d.text.clone(), *t)))) {
                if rt.limit_recorded != Some(t) {
                    rt.limit_recorded = Some(t);
                    if let Some(w) = limit_window(&text, chrono::Local::now()) {
                        let _ = crate::usage::insert_quota(&db.0.lock(), &acc, rt.provider.as_str(), &w, "cli-limit", now);
                    }
                }
            }
        }

        // --- auto-continue after a usage limit -------------------------------------
        if rt.kind == "agent" && rt.view.auto_continue {
            let limited = status == "rate-limited";
            if limited && rt.ac.due.is_none() {
                let text = handle.as_ref().and_then(|h| h.detection.lock().as_ref().map(|(d, _)| d.text.clone()));
                let detected = text.as_deref().and_then(|t| crate::detect::reset_at_ms(t, chrono::Local::now()));
                let quota = rt.account_id.as_deref().and_then(|a| exhausted_window_reset(db, a, now));
                let (due, why) = resolve_reset(detected, quota, now, setting_i64(db, "autoContinueRetryMin", 15));
                if rt.ac.attempts >= AUTO_CONTINUE_MAX_ATTEMPTS {
                    rt.view.auto_continue = false;
                    rt.view.auto_continue_note = Some(format!("Stopped after {} attempts", rt.ac.attempts));
                } else {
                    rt.ac.due = Some(due);
                    rt.ac.delivered_at = None;
                    rt.view.auto_continue_note = Some(why.to_string());
                }
            } else if !limited && running && rt.ac.due.is_some() && rt.ac.delivered_at.is_none() && status != "starting" {
                // Someone answered in the terminal before the scheduled time: they took over.
                if detection_ts(&handle).map(|t| in_ms > t).unwrap_or(false) {
                    rt.ac.due = None;
                    rt.view.auto_continue_note = Some("Cancelled: you continued manually".into());
                }
            }
            if rt.ac.due.is_some_and(|d| now >= d) {
                rt.ac.due = None;
                rt.ac.attempts += 1;
                let msg = setting_string(db, "autoContinueMessage").unwrap_or_else(|| AUTO_CONTINUE_DEFAULT_MESSAGE.into());
                if running {
                    rt.pending_input = Some(msg);
                    rt.ac.delivered_at = Some(now);
                    rt.ac.verified_retry = false;
                    rt.view.auto_continue_note = Some(format!("Continuing (attempt {})", rt.ac.attempts));
                } else {
                    resume_requests.push((rt.id.clone(), msg));
                    rt.view.auto_continue_note = Some("Restarting session to continue".into());
                }
            }
            // Verify: the CLI should start working shortly after the continue message.
            if let Some(at) = rt.ac.delivered_at {
                let worked = matches!(provider_state, Some((true, t)) if t >= at) || status == "working";
                if worked {
                    rt.ac.delivered_at = None;
                    rt.ac.attempts = 0;
                    rt.view.auto_continue_note = Some("Continued automatically".into());
                } else if rt.pending_input.is_none() && now - at > 45_000 && status != "rate-limited" {
                    if !rt.ac.verified_retry && running {
                        // A menu may have taken the first Enter; try once more.
                        rt.ac.verified_retry = true;
                        rt.ac.delivered_at = Some(now);
                        rt.pending_input = Some(setting_string(db, "autoContinueMessage").unwrap_or_else(|| AUTO_CONTINUE_DEFAULT_MESSAGE.into()));
                    } else {
                        rt.ac.delivered_at = None;
                    }
                }
            }
            rt.view.auto_continue_at = rt.ac.due;
        }

        // --- loops / prompt queues -------------------------------------------------------
        if rt.kind == "agent" {
            if let Some(mut a) = rt.automation.take() {
                use crate::automation::{decide, Ctx, Decision};
                let screen = handle.as_ref().map(|h| h.screen_text()).unwrap_or_default();
                let ready = running
                    && rt.pending_input.is_none()
                    && ready_for_input(rt.provider, rt.hooks, rt.session_started, rt.started_ms, out_ms, now, &screen);
                let ctx = Ctx {
                    now,
                    running,
                    status,
                    ready,
                    provider_signals: rt.hooks || rt.provider == Provider::Codex,
                    turn_ended_at: rt.view.turn_ended_at,
                    last_message: rt.view.last_message.as_deref(),
                    supervising: rt.supervising,
                    started_at: rt.started_ms,
                };
                let before = (a.state.clone(), a.step, a.iteration, a.note.clone(), a.pending.clone());
                match decide(&a, &ctx) {
                    Decision::Wait(note) => a.note = note,
                    Decision::Supervise => {
                        rt.supervising = true;
                        a.note = Some("Reviewing the answer…".into());
                        supervise.push(crate::automation::SuperviseJob {
                            session_id: rt.id.clone(),
                            automation: a.clone(),
                            answer: rt.view.last_message.clone().unwrap_or_default(),
                            account_id: rt.account_id.clone(),
                            transcript: (rt.provider == Provider::Claude).then(|| rt.view.transcript_path.clone()).flatten(),
                        });
                    }
                    Decision::Send { text, step, iteration } => {
                        a.pending = None;
                        rt.pending_input = Some(text);
                        a.step = step;
                        a.iteration = iteration;
                        a.last_sent_at = Some(now);
                        let total = a.total().map(|t| format!("/{t}")).unwrap_or_default();
                        a.note = Some(format!("Sent prompt {}{total}", a.sent()));
                        rt.new_activity.push(crate::activity::Activity::new(now, "loop", format!("{}: prompt {}{total}", a.name, a.sent()), None));
                    }
                    Decision::Finish(reason) => {
                        a.state = "done".into();
                        rt.new_activity.push(crate::activity::Activity::new(now, "loop", format!("{}: {reason}", a.name), None));
                        a.note = Some(reason);
                    }
                }
                if before != (a.state.clone(), a.step, a.iteration, a.note.clone(), a.pending.clone()) {
                    automation_saves.push(a.clone());
                }
                rt.view.automation = Some(AutomationView::of(&a));
                if a.state == "running" {
                    rt.automation = Some(a);
                }
            }
        }

        // --- queued input (initial task, auto-continue, broadcast) --------------------
        if running && rt.pending_input.is_some() {
            if let Some(h) = &handle {
                let screen = h.screen_text();
                if ready_for_input(rt.provider, rt.hooks, rt.session_started, rt.started_ms, out_ms, now, &screen) {
                    if let Some(text) = rt.pending_input.take() {
                        rt.submit_check = Some(SubmitCheck { at: now + submit_delay_ms(&text) as i64, probe: submit_probe(&text), tries: 0 });
                        deliveries.push((h.clone(), text, rt.provider));
                    }
                    if rt.view.notice.as_deref() == Some(DIALOG_NOTICE) {
                        rt.view.notice = None;
                    }
                } else if now - rt.started_ms > 4000 && TRUST_PROMPT.is_match(&screen) {
                    // The queued task waits for a dialog only the user should answer.
                    rt.view.notice = Some(DIALOG_NOTICE.into());
                }
            }
        } else if exited {
            // Only a finished process drops queued text. (Between registering the runtime
            // and spawning, there is briefly no process yet — that must not lose the task.)
            rt.pending_input = None;
        }
        // --- confirm that typed text was really submitted -----------------------------
        if let Some(chk) = rt.submit_check.clone() {
            let started = matches!(provider_state, Some((true, t)) if t >= chk.at - 2_000)
                || rt.view.turn_started_at.is_some_and(|t| t >= chk.at - 2_000)
                || status == "working";
            if !running || started || handle.is_none() {
                rt.submit_check = None;
            } else if now - chk.at >= SUBMIT_GRACE_MS {
                let h = handle.as_ref().expect("checked above");
                if !still_in_input(&h.screen_text(), &chk.probe) {
                    rt.submit_check = None;
                } else if chk.tries + 1 >= SUBMIT_MAX_TRIES {
                    rt.submit_check = None;
                    rt.view.notice = Some(NOT_SUBMITTED_NOTICE.into());
                } else {
                    enters.push(h.clone());
                    rt.submit_check = Some(SubmitCheck { at: now, tries: chk.tries + 1, ..chk });
                }
            }
        }
        rt.view.pending_input = rt.pending_input.is_some();
        let changed = prev.status != rt.view.status
            || prev.attention != rt.view.attention
            || prev.model != rt.view.model
            || prev.provider_session_id != rt.view.provider_session_id
            || prev.transcript_path != rt.view.transcript_path
            || prev.running != rt.view.running
            || prev.context_percent != rt.view.context_percent
            || prev.auto_continue != rt.view.auto_continue
            || prev.auto_continue_at != rt.view.auto_continue_at
            || prev.auto_continue_note != rt.view.auto_continue_note
            || prev.login_url != rt.view.login_url
            || prev.pending_input != rt.view.pending_input
            || prev.current_activity != rt.view.current_activity
            || prev.last_message != rt.view.last_message
            || prev.turn_files != rt.view.turn_files
            || prev.notice != rt.view.notice
            || prev.turn_started_at != rt.view.turn_started_at
            || prev.automation != rt.view.automation
            || prev.git_branch != rt.view.git_branch
            || prev.git_changed != rt.view.git_changed;
        let active = out_ms > rt.last_db_touch;
        if changed || (active && now - rt.last_db_touch > 30_000) {
            rt.last_db_touch = now;
            let conn = db.0.lock();
            if running {
                let _ = store::set_session_status(&conn, &rt.id, status);
            }
            if prev.model != rt.view.model {
                let _ = store::set_session_field(&conn, &rt.id, "model", rt.view.model.as_deref());
            }
            if prev.provider_session_id != rt.view.provider_session_id && rt.kind == "agent" {
                let _ = store::set_session_field(&conn, &rt.id, "provider_session_id", rt.view.provider_session_id.as_deref());
            }
            if prev.transcript_path != rt.view.transcript_path {
                let _ = store::set_session_field(&conn, &rt.id, "transcript_path", rt.view.transcript_path.as_deref());
            }
        }
        if changed {
            to_emit.push(rt.view.clone());
        }
        for a in rt.new_activity.drain(..) {
            new_activity.push((rt.id.clone(), a));
        }
    }
    drop(rts);
    // Never emit (or block on PTY writes) while holding the runtimes lock.
    for v in to_emit {
        let _ = app.emit("session-runtime", &v);
    }
    if !automation_saves.is_empty() {
        let conn = db.0.lock();
        let applied: Vec<_> = automation_saves.into_iter().filter(|a| crate::automation::save_progress(&conn, a).unwrap_or(false)).collect();
        drop(conn);
        for a in applied {
            let _ = app.emit("automation-changed", &a);
        }
    }
    if !new_activity.is_empty() {
        let conn = db.0.lock();
        for (id, a) in &new_activity {
            let _ = crate::activity::insert(&conn, id, a);
        }
        drop(conn);
        for (id, a) in new_activity {
            let _ = app.emit("session-activity", serde_json::json!({ "id": id, "activity": a }));
        }
    }
    for (id, message) in resume_requests {
        let _ = app.emit("session-auto-resume", serde_json::json!({ "id": id, "message": message }));
    }
    for (h, text, provider) in deliveries {
        std::thread::spawn(move || {
            let _ = deliver_input(&h, &text, provider);
        });
    }
    for job in supervise {
        crate::supervise(app.clone(), job);
    }
    for h in enters {
        let _ = h.write(b"\r");
    }
}

/// End a running goal or loop with a note (runtime, database and UI), e.g. when its supervisor
/// is not available. Does nothing if the user paused or changed it meanwhile.
pub fn pause_automation(app: &AppHandle, db: &Db, runtimes: &Runtimes, session_id: &str, automation_id: &str, note: &str) {
    let saved = {
        let mut rts = runtimes.lock();
        let Some(rt) = rts.get_mut(session_id) else { return };
        rt.supervising = false;
        let Some(mut a) = rt.automation.take().filter(|a| a.id == automation_id && a.state == "running") else { return };
        a.state = "paused".into();
        a.note = Some(note.to_string());
        rt.view.automation = Some(AutomationView::of(&a));
        (a, rt.view.clone())
    };
    let ok = crate::automation::save_progress(&db.0.lock(), &saved.0).unwrap_or(false);
    if ok {
        let _ = app.emit("automation-changed", &saved.0);
    }
    let _ = app.emit("session-runtime", &saved.1);
}

fn detection_ts(h: &Option<Arc<crate::pty::PtyHandle>>) -> Option<i64> {
    h.as_ref().and_then(|h| h.detection.lock().as_ref().map(|(_, t)| *t))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn statusline_uses_model_id_instead_of_display_name() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::new(crate::db::open_in_memory().unwrap());
        let mut rt = Runtime::new("test", Provider::Claude, "agent", None, None, "/w", dir.path().into(), true, None, None);
        std::fs::write(dir.path().join("statusline.json"), r#"{"model":{"id":"claude-opus-test","display_name":"Opus Test"}}"#).unwrap();
        poll_claude(&mut rt, &db);
        assert_eq!(rt.view.model.as_deref(), Some("claude-opus-test"));
    }

    #[test]
    fn claude_hooks_feed_the_live_activity_view() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::new(crate::db::open_in_memory().unwrap());
        let mut rt = Runtime::new("s", Provider::Claude, "agent", None, None, "/w", dir.path().into(), true, None, None);
        let transcript = dir.path().join("t.jsonl");
        std::fs::write(&transcript, r#"{"type":"assistant","message":{"content":[{"type":"text","text":"All 12 tests pass now."}]}}"#).unwrap();
        let tp = transcript.to_string_lossy().replace('\\', "/");
        let lines = [
            r#"{"hook_event_name":"UserPromptSubmit","prompt":"Fix the failing test","ts":1}"#.to_string(),
            r#"{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"npm test"},"ts":2}"#.to_string(),
            r#"{"hook_event_name":"PostToolUse","tool_name":"Edit","tool_input":{"file_path":"C:/w/src/a.ts"},"ts":3}"#.to_string(),
        ];
        std::fs::write(dir.path().join("events.jsonl"), lines.join("\n") + "\n").unwrap();
        poll_claude(&mut rt, &db);
        assert_eq!(rt.view.last_prompt.as_deref(), Some("Fix the failing test"));
        assert_eq!(rt.view.current_activity.as_deref(), Some("Editing a.ts"));
        assert_eq!(rt.view.turn_files, 1);
        let stop = format!(r#"{{"hook_event_name":"Stop","transcript_path":"{tp}","ts":4}}"#);
        std::fs::write(dir.path().join("events.jsonl"), lines.join("\n") + "\n" + &stop + "\n").unwrap();
        poll_claude(&mut rt, &db);
        assert_eq!(rt.view.current_activity, None);
        assert_eq!(rt.view.last_message.as_deref(), Some("All 12 tests pass now."));
        let kinds: Vec<&str> = rt.new_activity.iter().map(|a| a.kind.as_str()).collect();
        assert_eq!(kinds, vec!["prompt", "tool", "file", "done"]);
        // Idle reminder is not a "needs you" notice; a permission request is.
        claude_activity(&mut rt, &serde_json::json!({"message": "Claude is waiting for your input", "notification_type": "idle_prompt"}), "Notification", 5);
        assert_eq!(rt.view.notice, None);
        claude_activity(&mut rt, &serde_json::json!({"message": "Claude needs your permission to use Bash"}), "Notification", 6);
        assert_eq!(rt.view.notice.as_deref(), Some("Claude needs your permission to use Bash"));
        // Approved: the tool ran, the request is gone.
        claude_activity(&mut rt, &serde_json::json!({"tool_name": "Bash", "tool_input": {"command": "npm test"}}), "PostToolUse", 7);
        assert_eq!(rt.view.notice, None);
        // Pasted prompts are shown without the CLI's paste markers.
        claude_activity(&mut rt, &serde_json::json!({"prompt": "<pasted_content id=\"a1\">GOAL: ship it</pasted_content>"}), "UserPromptSubmit", 8);
        assert_eq!(rt.view.last_prompt.as_deref(), Some("GOAL: ship it"));
    }

    #[test]
    fn limit_messages_become_full_quota_windows() {
        use chrono::TimeZone;
        let now = chrono::Local.with_ymd_and_hms(2026, 9, 28, 9, 30, 0).unwrap();
        let w = limit_window("You've hit your limit · resets 12pm (Europe/Berlin)", now).unwrap();
        assert_eq!((w.name.as_str(), w.used_percent, w.window_minutes), ("five_hour", 100.0, Some(300)));
        assert_eq!(w.resets_at, Some(chrono::Local.with_ymd_and_hms(2026, 9, 28, 12, 0, 0).unwrap().timestamp()));
        assert_eq!(limit_window("Weekly limit reached · resets Oct 2, 11am", now).unwrap().name, "seven_day");
        assert!(limit_window("Usage limit reached", now).is_none(), "no reset time, no guess");
    }

    #[test]
    fn heuristic_turns_start_on_input_and_end_after_quiet_output() {
        let dir = tempfile::tempdir().unwrap();
        let rt = Runtime::new("c", Provider::Custom, "agent", None, None, "/w", dir.path().into(), false, None, None);
        let mut v = rt.view.clone();
        heuristic_turns(&mut v, 10_000, 9_000, 10_500);
        assert_eq!((v.turn_started_at, v.turn_ended_at), (Some(10_000), None));
        heuristic_turns(&mut v, 10_000, 10_200, 11_000); // answered, not quiet yet
        assert_eq!(v.turn_ended_at, None);
        heuristic_turns(&mut v, 10_000, 10_200, 12_800);
        assert_eq!(v.turn_ended_at, Some(10_200));
        heuristic_turns(&mut v, 10_000, 10_200, 20_000); // nothing new: stays ended
        assert_eq!((v.turn_started_at, v.turn_ended_at), (Some(10_000), Some(10_200)));
        heuristic_turns(&mut v, 30_000, 10_200, 30_100); // next input
        assert_eq!((v.turn_started_at, v.turn_ended_at), (Some(30_000), None));
    }

    #[test]
    fn reset_resolution_prefers_cli_then_quota_then_retry() {
        let now = 1_000_000_000;
        assert_eq!(resolve_reset(Some(now + 3_600_000), Some(now + 60_000), now, 15).0, now + 3_600_000 + 90_000);
        assert_eq!(resolve_reset(None, Some(now + 60_000), now, 15).0, now + 60_000 + 90_000);
        assert_eq!(resolve_reset(Some(now - 3_600_000), None, now, 15).0, now + 15 * 60_000, "stale printed time is ignored");
        assert_eq!(resolve_reset(None, Some(now - 1), now, 0).0, now + 60_000, "retry is clamped to >= 1 min");
    }

    #[test]
    fn input_waits_for_quiet_output_and_no_dialogs() {
        let now = 100_000;
        let ok = |p, hooks, started, out: i64, screen: &str| ready_for_input(p, hooks, started, 90_000, out, now, screen);
        assert!(ok(Provider::Codex, false, false, 97_000, "› Ask Codex to do anything"));
        assert!(ok(Provider::Codex, false, false, 97_000, "› fix it\n  100% context left · ? for shortcuts"));
        assert!(!ok(Provider::Codex, false, false, 97_000, "Installing daemon from CLI version 0.157.1 ..."), "silent startup is not ready");
        assert!(ok(Provider::Claude, false, false, 97_000, ">\n  ? for shortcuts"), "Claude without hooks: footer");
        assert!(!ok(Provider::Codex, false, false, 99_500, "› Ask Codex to do anything"), "output still streaming");
        assert!(!ok(Provider::Codex, false, false, 0, ""), "nothing rendered yet");
        assert!(!ok(Provider::Codex, false, false, 97_000, "  \n "), "blank screen");
        assert!(!ok(Provider::Claude, true, false, 97_000, "> "), "Claude: wait for SessionStart hook");
        assert!(ok(Provider::Claude, true, true, 97_000, "> Try \"fix lint errors\""));
        assert!(!ok(Provider::Claude, true, true, 97_000, "Do you trust the files in this folder?\r\n❯ 1. Yes, proceed"));
        assert!(!ok(Provider::Codex, false, false, 97_000, "Do you trust the contents of this directory?"));
        assert!(!ok(Provider::Codex, false, false, 97_000, "> 1. Sign in with ChatGPT\n  2. Sign in with Device Code"));
        // Enter on Codex's update prompt would run `npm install -g`: never type into it.
        assert!(!ok(Provider::Codex, false, false, 97_000, "› Ask Codex to do anything\n  Update available · 0.157.1 → 0.159.2\n› 1. Update now (runs `npm install -g @openai/codex`)\n  2. Skip"));
    }

    #[test]
    fn typed_text_is_found_in_the_input_box_only() {
        let probe = submit_probe("  Review src/server.js for bugs and missing input validation.
Then run npm test.");
        assert_eq!(probe, "review src/server.js for bugs an");
        let codex = "header

› Review src/server.js for bugs and missing input
  validation. Then run npm test.

  gpt-6 medium · C:/demo";
        assert!(still_in_input(codex, &probe), "wrapped text in the composer");
        assert!(!still_in_input("› Ask Codex to do anything", &probe));
        assert!(!still_in_input("anything", "ok"), "too short to be sure");
        assert!(submit_delay_ms("hi") >= 450 && submit_delay_ms(&"x".repeat(50_000)) == 1_800);
    }

    fn base() -> StatusInputs {
        StatusInputs { running: true, now: 100_000, started_ms: 90_000, ..Default::default() }
    }

    #[test]
    fn exit_states() {
        let mut i = base();
        i.exited = true;
        i.exit_code = Some(0);
        assert_eq!(compute_status(&i).0, "stopped");
        i.exit_code = Some(1);
        assert_eq!(compute_status(&i).0, "failed");
        i.stopped_by_user = true;
        assert_eq!(compute_status(&i).0, "stopped");
    }

    #[test]
    fn starting_then_idle() {
        let mut i = base();
        assert_eq!(compute_status(&i).0, "starting");
        i.last_output_ms = 95_000;
        i.provider_signals = true;
        assert_eq!(compute_status(&i).0, "idle");
    }

    #[test]
    fn provider_state_drives_status() {
        let mut i = base();
        i.last_output_ms = 99_000;
        i.provider_signals = true;
        i.provider_state = Some((true, 98_000));
        assert_eq!(compute_status(&i).0, "working");
        i.provider_state = Some((false, 98_000));
        assert_eq!(compute_status(&i).0, "waiting-for-input");
        // User approves a permission prompt and output resumes.
        i.last_input_ms = 98_500;
        i.last_output_ms = 99_500;
        assert_eq!(compute_status(&i).0, "working");
    }

    #[test]
    fn rate_limit_detection_is_cleared_by_new_input() {
        let mut i = base();
        i.last_output_ms = 99_000;
        i.last_input_ms = 97_000;
        i.detection = Some((Signal::RateLimited, 98_000));
        assert_eq!(compute_status(&i), ("rate-limited", Some("Usage limit reached".into())));
        i.last_input_ms = 99_500;
        assert_ne!(compute_status(&i).0, "rate-limited");
    }

    #[test]
    fn heuristic_fallback_without_provider_signals() {
        let mut i = base();
        i.last_input_ms = 97_000;
        i.last_output_ms = 99_000;
        assert_eq!(compute_status(&i).0, "working");
        i.last_output_ms = 97_100; // just the echo of typed input
        assert_eq!(compute_status(&i).0, "waiting-for-input");
    }

    #[test]
    fn find_rollout_matches_cwd_and_start_time() {
        let dir = tempfile::tempdir().unwrap();
        let day = dir.path().join("sessions").join(chrono::Local::now().format("%Y/%m/%d").to_string());
        std::fs::create_dir_all(&day).unwrap();
        let start = now_ms();
        let ts = chrono::Utc::now().to_rfc3339();
        let meta = |cwd: &str| format!(r#"{{"timestamp":"{ts}","type":"session_meta","payload":{{"id":"x","cwd":"{cwd}"}}}}"#);
        std::fs::write(day.join("rollout-a-other.jsonl"), meta("C:/other") + "\n").unwrap();
        std::fs::write(day.join("rollout-b-mine.jsonl"), meta("C:/Work/App") + "\n").unwrap();
        let found = find_rollout(dir.path(), r"c:\work\app", start, None, &[]).unwrap();
        assert!(found.ends_with("rollout-b-mine.jsonl"));
        assert!(find_rollout(dir.path(), r"c:\work\app", start, None, &[found.clone()]).is_none(), "claimed files skipped");
        let by_id = find_rollout(dir.path(), "C:/zzz", start, Some("a-other"), &[]).unwrap();
        assert!(by_id.ends_with("rollout-a-other.jsonl"));
    }
}
