//! Workflow helpers around the sessions: task board, named workspaces, activity statistics,
//! full-text search over transcripts, review & commit, phone push (ntfy) and file export.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::db::{now_iso, now_ms};
use crate::error::{AppError, AppResult};

// ---------------------------------------------------------------------------
// Task board
// ---------------------------------------------------------------------------

pub const TASK_STATES: &[&str] = &["open", "running", "review", "done"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub text: String,
    pub status: String,
    pub session_id: Option<String>,
    pub result: Option<String>,
    pub sort: i64,
    pub created_at: String,
    pub updated_at: String,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
    pub project_id: Option<String>,
    pub worktree: Option<String>,
    pub branch: Option<String>,
    /// Last automatic test run for this task's agent: "ok" | "fail" | "running".
    pub tests: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInput {
    pub id: Option<String>,
    pub title: String,
    pub text: String,
    pub status: Option<String>,
    pub session_id: Option<String>,
    pub result: Option<String>,
    pub sort: Option<i64>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub worktree: Option<String>,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub tests: Option<String>,
}

fn task_row(r: &rusqlite::Row) -> rusqlite::Result<Task> {
    Ok(Task {
        id: r.get("id")?,
        title: r.get("title")?,
        text: r.get("text")?,
        status: r.get("status")?,
        session_id: r.get("session_id")?,
        result: r.get("result")?,
        sort: r.get("sort")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
        started_at: r.get("started_at")?,
        finished_at: r.get("finished_at")?,
        project_id: r.get("project_id")?,
        worktree: r.get("worktree")?,
        branch: r.get("branch")?,
        tests: r.get("tests")?,
    })
}

pub fn tasks_list(c: &Connection) -> AppResult<Vec<Task>> {
    let mut st = c.prepare("SELECT * FROM tasks ORDER BY sort, created_at")?;
    let rows = st.query_map([], task_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn task_save(c: &Connection, t: TaskInput) -> AppResult<Task> {
    let title = t.title.trim();
    if title.is_empty() || title.chars().count() > 200 {
        return Err(AppError::invalid("A task needs a title (max. 200 characters)"));
    }
    if t.text.len() > 100_000 {
        return Err(AppError::invalid("Task text is too long"));
    }
    let status = t.status.as_deref().unwrap_or("open");
    if !TASK_STATES.contains(&status) {
        return Err(AppError::invalid(format!("Unknown task state {status}")));
    }
    let now = now_iso();
    let id = t.id.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let prev: Option<Task> = c.query_row("SELECT * FROM tasks WHERE id=?1", [&id], task_row).optional()?;
    // Timestamps follow the state: started when it goes to "running", finished at "done".
    let started_at = match (&prev, status) {
        (Some(p), "running") if p.status != "running" => Some(now_ms()),
        (None, "running") => Some(now_ms()),
        (Some(p), _) => p.started_at,
        _ => None,
    };
    let finished_at = match (&prev, status) {
        (_, "done") => prev.as_ref().and_then(|p| p.finished_at).or(Some(now_ms())),
        _ => None,
    };
    let sort = t.sort.or(prev.as_ref().map(|p| p.sort)).unwrap_or_else(|| {
        c.query_row("SELECT COALESCE(MAX(sort),0)+1 FROM tasks", [], |r| r.get(0)).unwrap_or(0)
    });
    c.execute(
        "INSERT INTO tasks(id,title,text,status,session_id,result,sort,created_at,updated_at,started_at,finished_at,project_id,worktree,branch,tests)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?8,?9,?10,?11,?12,?13,?14)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title, text=excluded.text, status=excluded.status,
           session_id=excluded.session_id, result=excluded.result, sort=excluded.sort, updated_at=excluded.updated_at,
           started_at=excluded.started_at, finished_at=excluded.finished_at, project_id=excluded.project_id,
           worktree=excluded.worktree, branch=excluded.branch, tests=excluded.tests",
        params![id, title, t.text, status, t.session_id, t.result, sort, now, started_at, finished_at, t.project_id, t.worktree, t.branch, t.tests],
    )?;
    Ok(c.query_row("SELECT * FROM tasks WHERE id=?1", [&id], task_row)?)
}

pub fn task_get(c: &Connection, id: &str) -> AppResult<Task> {
    Ok(c.query_row("SELECT * FROM tasks WHERE id=?1", [id], task_row)?)
}

pub fn task_delete(c: &Connection, id: &str) -> AppResult<()> {
    c.execute("DELETE FROM tasks WHERE id=?1", [id])?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Named workspaces (saved layouts)
// ---------------------------------------------------------------------------

const WS_PREFIX: &str = "ws:";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedLayout {
    pub name: String,
    pub mode: String,
    pub panes: Value,
    pub updated_at: String,
}

pub fn layouts_named(c: &Connection) -> AppResult<Vec<NamedLayout>> {
    let mut st = c.prepare("SELECT id, mode, panes, updated_at FROM layouts WHERE id LIKE 'ws:%' ORDER BY id")?;
    let rows = st
        .query_map([], |r| {
            let id: String = r.get(0)?;
            let panes: String = r.get(2)?;
            Ok(NamedLayout {
                name: id[WS_PREFIX.len()..].to_string(),
                mode: r.get(1)?,
                panes: serde_json::from_str(&panes).unwrap_or(Value::Null),
                updated_at: r.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn layout_named_save(c: &Connection, name: &str, mode: &str, panes: &Value) -> AppResult<()> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 60 {
        return Err(AppError::invalid("Give the workspace a name (max. 60 characters)"));
    }
    crate::store::save_layout(c, &format!("{WS_PREFIX}{name}"), mode, panes)
}

pub fn layout_named_delete(c: &Connection, name: &str) -> AppResult<()> {
    c.execute("DELETE FROM layouts WHERE id=?1", [format!("{WS_PREFIX}{name}")])?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Activity statistics: turns, working time, time waiting for you
// ---------------------------------------------------------------------------

#[derive(Debug, Default, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionStats {
    pub session_id: String,
    pub session_name: Option<String>,
    pub turns: i64,
    pub working_ms: i64,
    pub waiting_ms: i64,
    pub files: i64,
    pub inputs: i64,
    pub limits: i64,
}

/// A gap longer than this is not "waiting for you" but "nobody was there" (night, weekend).
const MAX_WAIT_MS: i64 = 2 * 3_600_000;
const MAX_TURN_MS: i64 = 6 * 3_600_000;

/// Walk one session's events in time order: prompt → done is working time, done → next
/// prompt is time the agent waited for you.
pub fn stats_from_events(events: &[(i64, String)], now: i64, running_waiting: bool) -> (i64, i64, i64) {
    let (mut turns, mut working, mut waiting) = (0, 0, 0);
    let mut turn_start: Option<i64> = None;
    let mut done_at: Option<i64> = None;
    for (ts, kind) in events {
        match kind.as_str() {
            "prompt" => {
                if let Some(d) = done_at.take() {
                    waiting += (ts - d).clamp(0, MAX_WAIT_MS);
                }
                turn_start.get_or_insert(*ts);
            }
            "done" => {
                if let Some(s) = turn_start.take() {
                    turns += 1;
                    working += (ts - s).clamp(0, MAX_TURN_MS);
                }
                done_at = Some(*ts);
            }
            _ => {}
        }
    }
    if running_waiting {
        if let Some(d) = done_at {
            waiting += (now - d).clamp(0, MAX_WAIT_MS);
        }
    }
    (turns, working, waiting)
}

pub fn activity_stats(c: &Connection, from_ms: i64, waiting_now: &[String]) -> AppResult<Vec<SessionStats>> {
    let mut st = c.prepare(
        "SELECT a.session_id, a.ts, a.kind, s.name FROM activity a LEFT JOIN sessions s ON s.id=a.session_id
         WHERE a.ts >= ?1 AND a.kind IN ('prompt','done','file','input','limit') ORDER BY a.session_id, a.ts, a.id",
    )?;
    let rows = st
        .query_map([from_ms], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?, r.get::<_, Option<String>>(3)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    let now = now_ms();
    let mut out: Vec<SessionStats> = Vec::new();
    let mut i = 0;
    while i < rows.len() {
        let sid = rows[i].0.clone();
        let mut j = i;
        while j < rows.len() && rows[j].0 == sid {
            j += 1;
        }
        let events: Vec<(i64, String)> = rows[i..j].iter().map(|r| (r.1, r.2.clone())).collect();
        let (turns, working_ms, waiting_ms) = stats_from_events(&events, now, waiting_now.contains(&sid));
        let count = |k: &str| events.iter().filter(|e| e.1 == k).count() as i64;
        out.push(SessionStats {
            session_id: sid,
            session_name: rows[i].3.clone(),
            turns,
            working_ms,
            waiting_ms,
            files: count("file"),
            inputs: count("input"),
            limits: count("limit"),
        });
        i = j;
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Full-text search over transcripts
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub session_id: String,
    pub session_name: String,
    pub provider: String,
    pub started_at: Option<String>,
    pub snippet: String,
    pub hits: usize,
}

/// Human-readable excerpt around the first match in a JSON line (escapes decoded).
pub fn snippet(line: &str, needle_lower: &str, width: usize) -> Option<String> {
    let clean = line.replace("\\n", " ").replace("\\t", " ").replace("\\\"", "\"").replace("\\\\", "\\");
    let lower = clean.to_lowercase();
    let pos = lower.find(needle_lower)?;
    // Byte offsets of lowercase and original can differ for some characters; work on chars.
    let char_pos = lower[..pos].chars().count();
    let chars: Vec<char> = clean.chars().collect();
    let start = char_pos.saturating_sub(width);
    let end = (char_pos + needle_lower.chars().count() + width).min(chars.len());
    let mut s: String = chars[start..end].iter().collect();
    s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    Some(format!("{}{}{}", if start > 0 { "…" } else { "" }, s, if end < chars.len() { "…" } else { "" }))
}

/// Lines that are conversation (user / assistant text), not tool plumbing or metadata.
fn is_conversation(line: &str) -> bool {
    line.contains("\"type\":\"user\"")
        || line.contains("\"type\":\"assistant\"")
        || line.contains("\"role\":\"user\"")
        || line.contains("\"role\":\"assistant\"")
        || line.contains("agent_message")
        || line.contains("user_message")
}

pub fn search_file(path: &Path, needle_lower: &str, max_bytes: u64) -> (usize, Option<String>) {
    let Ok(f) = std::fs::File::open(path) else { return (0, None) };
    let reader = BufReader::new(f.take(max_bytes));
    let mut hits = 0;
    let mut first = None;
    for line in reader.lines().map_while(Result::ok) {
        if !is_conversation(&line) || !line.to_lowercase().contains(needle_lower) {
            continue;
        }
        hits += 1;
        if first.is_none() {
            first = snippet(&line, needle_lower, 90);
        }
    }
    (hits, first)
}

/// Transcript of a session: the stored path, else found by conversation id in the profile.
pub fn locate_transcript(stored: Option<&str>, config_dir: Option<&str>, provider: &str, psid: Option<&str>) -> Option<PathBuf> {
    if let Some(p) = stored.map(PathBuf::from).filter(|p| p.is_file()) {
        return Some(p);
    }
    let (dir, id) = (config_dir?, psid?);
    let root = match provider {
        "claude" => Path::new(dir).join("projects"),
        _ => Path::new(dir).join("sessions"),
    };
    walkdir::WalkDir::new(root)
        .max_depth(5)
        .into_iter()
        .filter_map(Result::ok)
        .find(|e| {
            let n = e.file_name().to_string_lossy();
            e.file_type().is_file() && n.ends_with(".jsonl") && n.contains(id)
        })
        .map(|e| e.into_path())
}

pub fn search_transcripts(c: &Connection, query: &str, limit: usize) -> AppResult<Vec<SearchHit>> {
    let q = query.trim().to_lowercase();
    if q.chars().count() < 3 {
        return Err(AppError::invalid("Search for at least 3 characters"));
    }
    let mut st = c.prepare(
        "SELECT s.id, s.name, s.provider, s.started_at, s.transcript_path, s.provider_session_id, a.config_dir
         FROM sessions s LEFT JOIN accounts a ON a.id=s.account_id
         WHERE s.kind='agent' AND s.started_at IS NOT NULL ORDER BY s.started_at DESC LIMIT 400",
    )?;
    let rows = st
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, Option<String>>(6)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (id, name, provider, started, stored, psid, dir) in rows {
        let Some(path) = locate_transcript(stored.as_deref(), dir.as_deref(), &provider, psid.as_deref()) else { continue };
        if !seen.insert(path.clone()) {
            continue; // handoffs/duplicates can share a transcript
        }
        let (hits, first) = search_file(&path, &q, 64 * 1024 * 1024);
        if let (true, Some(snippet)) = (hits > 0, first) {
            out.push(SearchHit { session_id: id, session_name: name, provider, started_at: started, snippet, hits });
            if out.len() >= limit {
                break;
            }
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Review & commit
// ---------------------------------------------------------------------------

fn git(dir: &Path, args: &[&str]) -> AppResult<String> {
    let mut cmd = std::process::Command::new("git");
    cmd.arg("-C").arg(dir).args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let out = cmd.output().map_err(|e| AppError::other(format!("git not available: {e}")))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let msg = if err.is_empty() { String::from_utf8_lossy(&out.stdout).trim().to_string() } else { err };
        return Err(AppError::other(msg));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    pub dir: String,
    pub status: crate::git::GitStatus,
    pub diff: String,
    pub untracked: Vec<(String, String)>,
    pub truncated: bool,
}

const DIFF_CAP: usize = 600_000;

pub fn review(dir: &Path) -> AppResult<Review> {
    let status = crate::git::status(dir)?;
    if !status.is_repo {
        return Err(AppError::invalid("Not a git repository"));
    }
    let mut diff = git(dir, &["diff", "--no-color", "HEAD"]).or_else(|_| git(dir, &["diff", "--no-color"]))?;
    let mut truncated = false;
    if diff.len() > DIFF_CAP {
        let cut = (0..=DIFF_CAP).rev().find(|i| diff.is_char_boundary(*i)).unwrap_or(0);
        diff.truncate(cut);
        truncated = true;
    }
    // New files have no diff: show their beginning.
    let mut untracked = Vec::new();
    for f in status.files.iter().filter(|f| f.code == "??").take(30) {
        let p = dir.join(&f.path);
        if p.is_file() {
            let mut buf = Vec::new();
            if let Ok(fh) = std::fs::File::open(&p) {
                let _ = fh.take(20_000).read_to_end(&mut buf);
            }
            untracked.push((f.path.clone(), String::from_utf8_lossy(&buf).into_owned()));
        }
    }
    Ok(Review { dir: dir.to_string_lossy().into_owned(), status, diff, untracked, truncated })
}

/// `git add -A` + `git commit -m`; returns the new short hash.
pub fn commit_all(dir: &Path, message: &str) -> AppResult<String> {
    let msg = message.trim();
    if msg.is_empty() {
        return Err(AppError::invalid("Enter a commit message"));
    }
    git(dir, &["add", "-A"])?;
    git(dir, &["commit", "-m", msg])?;
    Ok(git(dir, &["rev-parse", "--short", "HEAD"])?.trim().to_string())
}

// ---------------------------------------------------------------------------
// Task worktrees: merge the task branch back into the project
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MergeResult {
    pub merged: bool,
    pub head: Option<String>,
    pub conflicts: Vec<String>,
    pub message: String,
}

fn safe_branch(b: &str) -> bool {
    !b.is_empty() && !b.starts_with('-') && !b.contains("..") && b.chars().all(|c| c.is_ascii_alphanumeric() || "/._-".contains(c))
}

/// Commit what the agent left in the worktree, merge its branch into the project's current
/// branch (--no-ff), then remove the worktree. On conflicts the merge is aborted and the
/// conflicting files are reported — nothing is left half-merged.
pub fn merge_worktree(repo: &Path, worktree: &Path, branch: &str, title: &str) -> AppResult<MergeResult> {
    if !safe_branch(branch) {
        return Err(AppError::invalid("Unexpected branch name"));
    }
    if worktree.is_dir() && !git(worktree, &["status", "--porcelain"])?.trim().is_empty() {
        commit_all(worktree, &format!("Task: {title}"))?;
    }
    let ahead = git(repo, &["rev-list", "--count", &format!("HEAD..{branch}")])?.trim().parse::<i64>().unwrap_or(0);
    if ahead == 0 {
        return Ok(MergeResult { merged: false, head: None, conflicts: vec![], message: "Nothing to merge — the task branch has no new commits".into() });
    }
    match git(repo, &["merge", "--no-ff", "--no-edit", "-m", &format!("Merge task: {title}"), branch]) {
        Ok(_) => {
            let head = git(repo, &["rev-parse", "--short", "HEAD"])?.trim().to_string();
            if worktree.is_dir() {
                let _ = crate::git::remove_worktree(repo, worktree);
            }
            let _ = git(repo, &["branch", "-d", branch]);
            Ok(MergeResult { merged: true, head: Some(head), conflicts: vec![], message: format!("Merged {ahead} commit(s)") })
        }
        Err(e) => {
            let conflicts: Vec<String> = git(repo, &["diff", "--name-only", "--diff-filter=U"])
                .map(|o| o.lines().map(str::to_string).filter(|l| !l.is_empty()).collect())
                .unwrap_or_default();
            let _ = git(repo, &["merge", "--abort"]);
            if conflicts.is_empty() {
                return Err(e);
            }
            Ok(MergeResult { merged: false, head: None, conflicts, message: "Merge conflicts — merge aborted, nothing changed".into() })
        }
    }
}

// ---------------------------------------------------------------------------
// Tests after each turn
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestRun {
    pub ok: bool,
    pub code: Option<i32>,
    pub duration_ms: i64,
    pub tail: String,
    pub timed_out: bool,
}

/// Run the project's test command (through cmd.exe) with a timeout; returns the last lines.
pub fn run_tests(dir: &Path, command: &str, timeout: Duration) -> AppResult<TestRun> {
    let cmdline = command.trim();
    if cmdline.is_empty() {
        return Err(AppError::invalid("No test command configured"));
    }
    let out_path = std::env::temp_dir().join(format!("cockpit-tests-{}.log", uuid::Uuid::new_v4()));
    let out = std::fs::File::create(&out_path)?;
    let err = out.try_clone()?;
    #[cfg(windows)]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        let mut c = std::process::Command::new("cmd");
        c.args(["/d", "/c", cmdline]);
        c.creation_flags(0x0800_0000);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = std::process::Command::new("sh");
        c.args(["-c", cmdline]);
        c
    };
    cmd.current_dir(dir).stdin(std::process::Stdio::null()).stdout(out).stderr(err);
    let started = std::time::Instant::now();
    let mut child = cmd.spawn().map_err(|e| AppError::other(format!("could not start tests: {e}")))?;
    crate::procjob::bind_child(&child);
    let mut timed_out = false;
    let status = loop {
        if let Some(st) = child.try_wait()? {
            break Some(st);
        }
        if started.elapsed() > timeout {
            let _ = child.kill();
            timed_out = true;
            break child.wait().ok();
        }
        std::thread::sleep(Duration::from_millis(200));
    };
    let text = std::fs::read(&out_path).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
    let _ = std::fs::remove_file(&out_path);
    let lines: Vec<&str> = text.lines().collect();
    let tail = lines[lines.len().saturating_sub(40)..].join("\n");
    let code = status.and_then(|s| s.code());
    Ok(TestRun { ok: !timed_out && code == Some(0), code, duration_ms: started.elapsed().as_millis() as i64, tail, timed_out })
}

// ---------------------------------------------------------------------------
// Pins: answers worth keeping, per project
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Pin {
    #[serde(default)]
    pub id: String,
    pub project_id: Option<String>,
    pub session_id: Option<String>,
    pub session_name: Option<String>,
    pub text: String,
    pub note: Option<String>,
    #[serde(default)]
    pub created_at: String,
}

pub fn pins_list(c: &Connection) -> AppResult<Vec<Pin>> {
    let mut st = c.prepare("SELECT id,project_id,session_id,session_name,text,note,created_at FROM pins ORDER BY created_at DESC")?;
    let rows = st
        .query_map([], |r| {
            Ok(Pin { id: r.get(0)?, project_id: r.get(1)?, session_id: r.get(2)?, session_name: r.get(3)?, text: r.get(4)?, note: r.get(5)?, created_at: r.get(6)? })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn pin_save(c: &Connection, p: Pin) -> AppResult<Pin> {
    if p.text.trim().is_empty() || p.text.len() > 200_000 {
        return Err(AppError::invalid("Nothing to pin"));
    }
    let id = if p.id.is_empty() { uuid::Uuid::new_v4().to_string() } else { p.id.clone() };
    let created = if p.created_at.is_empty() { now_iso() } else { p.created_at.clone() };
    c.execute(
        "INSERT INTO pins(id,project_id,session_id,session_name,text,note,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)
         ON CONFLICT(id) DO UPDATE SET note=excluded.note, text=excluded.text, project_id=excluded.project_id",
        params![id, p.project_id, p.session_id, p.session_name, p.text, p.note, created],
    )?;
    Ok(Pin { id, created_at: created, ..p })
}

pub fn pin_delete(c: &Connection, id: &str) -> AppResult<()> {
    c.execute("DELETE FROM pins WHERE id=?1", [id])?;
    Ok(())
}

#[cfg(test)]
mod more_tests {
    use super::*;

    fn repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        git(d, &["init", "-q", "-b", "main"]).unwrap();
        git(d, &["config", "user.email", "t@example.com"]).unwrap();
        git(d, &["config", "user.name", "t"]).unwrap();
        std::fs::write(d.join("a.txt"), "base\n").unwrap();
        commit_all(d, "base").unwrap();
        dir
    }

    #[test]
    fn task_worktree_merges_back_and_is_removed() {
        let r = repo();
        let d = r.path();
        let wt = std::path::PathBuf::from(crate::git::add_worktree(d, "task-x", None).unwrap().path);
        std::fs::write(wt.join("b.txt"), "from task\n").unwrap(); // uncommitted: merge commits it
        let m = merge_worktree(d, &wt, "task-x", "Add b").unwrap();
        assert!(m.merged, "{m:?}");
        assert!(d.join("b.txt").is_file());
        assert!(!wt.exists(), "worktree removed after the merge");
        // Nothing left to merge the second time.
        assert!(!merge_worktree(d, &wt, "main", "again").unwrap().merged);
        assert!(merge_worktree(d, &wt, "--evil", "x").is_err());
    }

    #[test]
    fn merge_conflicts_are_aborted_and_reported() {
        let r = repo();
        let d = r.path();
        let wt = std::path::PathBuf::from(crate::git::add_worktree(d, "task-y", None).unwrap().path);
        std::fs::write(wt.join("a.txt"), "task version\n").unwrap();
        std::fs::write(d.join("a.txt"), "main version\n").unwrap();
        commit_all(d, "main change").unwrap();
        let m = merge_worktree(d, &wt, "task-y", "conflict").unwrap();
        assert!(!m.merged);
        assert_eq!(m.conflicts, vec!["a.txt".to_string()]);
        assert!(git(d, &["status", "--porcelain"]).unwrap().trim().is_empty(), "merge aborted cleanly");
    }

    #[test]
    fn tests_report_exit_code_and_output() {
        let d = tempfile::tempdir().unwrap();
        let ok = run_tests(d.path(), "echo all good", Duration::from_secs(20)).unwrap();
        assert!(ok.ok && ok.tail.contains("all good"), "{ok:?}");
        let bad = run_tests(d.path(), "echo broken && exit 3", Duration::from_secs(20)).unwrap();
        assert!(!bad.ok);
        assert_eq!(bad.code, Some(3));
        assert!(run_tests(d.path(), "  ", Duration::from_secs(1)).is_err());
    }

    #[test]
    fn pins_roundtrip() {
        let c = crate::db::open_in_memory().unwrap();
        let p = pin_save(&c, Pin { id: String::new(), project_id: Some("p".into()), session_id: None, session_name: Some("A".into()), text: "wichtig".into(), note: None, created_at: String::new() }).unwrap();
        pin_save(&c, Pin { note: Some("merken".into()), ..p.clone() }).unwrap();
        let l = pins_list(&c).unwrap();
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].note.as_deref(), Some("merken"));
        pin_delete(&c, &p.id).unwrap();
        assert!(pins_list(&c).unwrap().is_empty());
    }
}

// ---------------------------------------------------------------------------
// Phone push (ntfy or any service that accepts a plain POST)
// ---------------------------------------------------------------------------

pub fn valid_push_url(url: &str) -> bool {
    let u = url.trim();
    u.starts_with("https://") && u.len() > 10 && !u.contains(char::is_whitespace)
}

pub fn push(url: &str, title: &str, message: &str, priority: Option<&str>) -> AppResult<()> {
    if !valid_push_url(url) {
        return Err(AppError::invalid("Push address must start with https:// (e.g. https://ntfy.sh/your-topic)"));
    }
    let agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(10))).http_status_as_error(false).build().new_agent();
    // Header values must be ASCII-safe; ntfy also reads the title from the body otherwise.
    let ascii_title: String = title.chars().map(|c| if c.is_ascii() && !c.is_control() { c } else { '?' }).take(120).collect();
    let mut req = agent.post(url.trim()).header("Title", &ascii_title).header("Tags", "robot");
    if let Some(p) = priority {
        req = req.header("Priority", p);
    }
    let resp = req.send(message.as_bytes()).map_err(|e| AppError::other(format!("push failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::other(format!("push failed: HTTP {}", resp.status().as_u16())));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn working_and_waiting_time_from_events() {
        let ev = |v: &[(i64, &str)]| v.iter().map(|(t, k)| (*t, k.to_string())).collect::<Vec<_>>();
        // prompt 0 → done 60s (work 60s), wait 30s, prompt 90 → done 150 (work 60s)
        let e = ev(&[(0, "prompt"), (60_000, "done"), (90_000, "prompt"), (150_000, "done")]);
        assert_eq!(stats_from_events(&e, 200_000, false), (2, 120_000, 30_000));
        // Still waiting now: counts until now.
        assert_eq!(stats_from_events(&e, 210_000, true), (2, 120_000, 90_000));
        // An overnight gap is capped.
        let e = ev(&[(0, "prompt"), (1000, "done"), (20 * 3_600_000, "prompt")]);
        assert_eq!(stats_from_events(&e, 0, false).2, MAX_WAIT_MS);
        // Queued prompts during a turn don't restart it.
        let e = ev(&[(0, "prompt"), (10_000, "prompt"), (50_000, "done")]);
        assert_eq!(stats_from_events(&e, 0, false), (1, 50_000, 0));
    }

    #[test]
    fn snippets_are_readable() {
        let line = r#"{"type":"user","message":{"content":"Bitte den Excel\nDeadlock beheben und testen"}}"#;
        let s = snippet(line, "deadlock", 12).unwrap();
        assert!(s.contains("Excel Deadlock beheben"), "{s}");
        assert!(s.starts_with('…'));
        assert!(snippet(line, "fehlt", 10).is_none());
    }

    #[test]
    fn search_finds_conversation_lines_only() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("t.jsonl");
        std::fs::write(&p, "{\"type\":\"user\",\"message\":\"fix the Parser bug\"}\n{\"type\":\"tool_result\",\"content\":\"parser.rs\"}\n{\"type\":\"assistant\",\"message\":\"Parser fixed\"}\n").unwrap();
        let (hits, first) = search_file(&p, "parser", 1 << 20);
        assert_eq!(hits, 2);
        assert!(first.unwrap().contains("Parser bug"));
    }

    #[test]
    fn tasks_roundtrip_and_timestamps() {
        let c = crate::db::open_in_memory().unwrap();
        let t = task_save(&c, TaskInput { id: None, title: "Tests".into(), text: "run".into(), status: None, session_id: None, result: None, sort: None, project_id: None, worktree: None, branch: None, tests: None }).unwrap();
        assert_eq!(t.status, "open");
        assert!(t.started_at.is_none());
        let t2 = task_save(&c, TaskInput { id: Some(t.id.clone()), title: "Tests".into(), text: "run".into(), status: Some("running".into()), session_id: Some("s".into()), result: None, sort: None, project_id: None, worktree: None, branch: None, tests: None }).unwrap();
        assert!(t2.started_at.is_some());
        let t3 = task_save(&c, TaskInput { id: Some(t.id.clone()), title: "Tests".into(), text: "run".into(), status: Some("done".into()), session_id: Some("s".into()), result: Some("ok".into()), sort: None, project_id: None, worktree: None, branch: None, tests: None }).unwrap();
        assert_eq!(t3.started_at, t2.started_at);
        assert!(t3.finished_at.is_some());
        assert!(task_save(&c, TaskInput { id: None, title: " ".into(), text: String::new(), status: None, session_id: None, result: None, sort: None, project_id: None, worktree: None, branch: None, tests: None }).is_err());
        assert!(task_save(&c, TaskInput { id: None, title: "x".into(), text: String::new(), status: Some("weird".into()), session_id: None, result: None, sort: None, project_id: None, worktree: None, branch: None, tests: None }).is_err());
        task_delete(&c, &t.id).unwrap();
        assert!(tasks_list(&c).unwrap().is_empty());
    }

    #[test]
    fn named_layouts_do_not_touch_the_main_layout() {
        let c = crate::db::open_in_memory().unwrap();
        crate::store::save_layout(&c, "main", "2", &serde_json::json!(["a", null])).unwrap();
        layout_named_save(&c, "Review", "4", &serde_json::json!(["a", "b", null, null])).unwrap();
        let l = layouts_named(&c).unwrap();
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].name, "Review");
        layout_named_delete(&c, "Review").unwrap();
        assert!(layouts_named(&c).unwrap().is_empty());
        assert!(crate::store::get_layout(&c, "main").unwrap().is_some());
    }

    #[test]
    fn push_urls_must_be_https() {
        assert!(valid_push_url("https://ntfy.sh/my-cockpit"));
        assert!(!valid_push_url("http://ntfy.sh/x"));
        assert!(!valid_push_url("https://ntfy.sh/a b"));
        assert!(!valid_push_url("file:///c:/x"));
    }

    #[test]
    fn commit_all_commits_everything() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        git(d, &["init", "-q"]).unwrap();
        git(d, &["config", "user.email", "t@example.com"]).unwrap();
        git(d, &["config", "user.name", "t"]).unwrap();
        std::fs::write(d.join("a.txt"), "1").unwrap();
        assert!(commit_all(d, "  ").is_err());
        let h = commit_all(d, "first").unwrap();
        assert!(!h.is_empty());
        std::fs::write(d.join("a.txt"), "2").unwrap();
        let r = review(d).unwrap();
        assert!(r.diff.contains("+2"));
        commit_all(d, "second").unwrap();
        assert!(review(d).unwrap().diff.trim().is_empty());
    }
}
