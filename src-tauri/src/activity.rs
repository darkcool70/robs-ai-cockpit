//! What each agent is doing: prompts, tool use, touched files, finished turns and the agent's
//! last answer. Sources are local only:
//!
//! * Claude: hook events (tool name + file path / command excerpt) and the session transcript.
//! * Codex: its rollout log (`task_complete.last_agent_message`, tool calls, patches).
//! * Any CLI without precise events: git changes in the working directory.
//!
//! Stored in the cockpit database for the Overview page (recent files, timeline).

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use once_cell::sync::Lazy;
use regex::Regex;
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::Value;

use crate::error::AppResult;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub ts: i64,
    /// prompt | tool | file | done | limit | continue | loop | input | start | exit
    pub kind: String,
    pub text: String,
    pub file: Option<String>,
}

impl Activity {
    pub fn new(ts: i64, kind: &str, text: impl Into<String>, file: Option<String>) -> Self {
        Activity { ts, kind: kind.into(), text: text.into(), file }
    }
}

static PASTE_TAG: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| regex::Regex::new(r"</?pasted_content[^>]*>").unwrap());

/// A prompt as the user wrote it: without the CLI's paste markers.
pub fn clean_prompt(s: &str) -> String {
    PASTE_TAG.replace_all(s, "").into_owned()
}

/// First `n` characters, whitespace collapsed.
pub fn excerpt(s: &str, n: usize) -> String {
    let flat = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= n {
        flat
    } else {
        let mut out: String = flat.chars().take(n.saturating_sub(1)).collect();
        out.push('…');
        out
    }
}

/// First `n` characters with line breaks kept (an answer shown in the chat), blank runs squeezed.
/// How much of an agent's final answer is kept (chat view, task proposals of assistants).
pub const ANSWER_CHARS: usize = 6000;

pub fn excerpt_lines(s: &str, n: usize) -> String {
    let mut out = String::new();
    let mut blank = 0;
    for line in s.trim().lines() {
        let line = line.trim_end();
        blank = if line.trim().is_empty() { blank + 1 } else { 0 };
        if blank > 1 {
            continue;
        }
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(line);
    }
    if out.chars().count() <= n {
        return out;
    }
    let mut cut: String = out.chars().take(n.saturating_sub(1)).collect();
    cut.push('…');
    cut
}

fn base_name(p: &str) -> String {
    Path::new(p).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| p.to_string())
}

/// Human label for a Claude tool call, plus the file it changes (if any).
pub fn describe_claude_tool(tool: &str, input: &Value) -> (String, Option<String>) {
    let s = |k: &str| input.get(k).and_then(|v| v.as_str()).unwrap_or("");
    let file = [s("file_path"), s("notebook_path")].into_iter().find(|p| !p.is_empty()).map(str::to_string);
    match tool {
        "Edit" | "MultiEdit" | "NotebookEdit" => (format!("Editing {}", base_name(file.as_deref().unwrap_or("file"))), file),
        "Write" => (format!("Writing {}", base_name(file.as_deref().unwrap_or("file"))), file),
        "Read" => (format!("Reading {}", base_name(file.as_deref().unwrap_or("file"))), None),
        "Bash" | "PowerShell" => {
            let d = s("description");
            (if d.is_empty() { format!("Running {}", excerpt(s("command"), 70)) } else { excerpt(d, 70) }, None)
        }
        "Grep" | "Glob" => (format!("Searching {}", excerpt(s("pattern"), 50)), None),
        "WebFetch" => (format!("Fetching {}", excerpt(s("url"), 60)), None),
        "WebSearch" => (format!("Web search: {}", excerpt(s("query"), 55)), None),
        "Task" | "Agent" => (format!("Subagent: {}", excerpt(s("description"), 55)), None),
        "TodoWrite" => ("Updating the todo list".into(), None),
        t if t.starts_with("mcp__") => (format!("Tool {}", t.trim_start_matches("mcp__")), None),
        t => (t.to_string(), None),
    }
}

static CODEX_CMD: Lazy<Regex> = Lazy::new(|| Regex::new(r#"cmd\s*:\s*"((?:[^"\\]|\\.)*)""#).unwrap());
static PATCH_FILE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^\*\*\* (?:Update|Add) File: (.+)$").unwrap());

/// Activity found in one Codex rollout line. `cwd` resolves relative patch paths.
pub fn codex_activity(line: &str, ts: i64, cwd: Option<&str>) -> Vec<Activity> {
    let Ok(v) = serde_json::from_str::<Value>(line) else { return vec![] };
    let ty = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
    let p = v.get("payload").cloned().unwrap_or(Value::Null);
    let pty = p.get("type").and_then(|x| x.as_str()).unwrap_or("");
    let abs = |f: &str| -> String {
        let path = Path::new(f.trim());
        if path.is_absolute() {
            f.trim().to_string()
        } else {
            cwd.map(|c| Path::new(c).join(path).to_string_lossy().into_owned()).unwrap_or_else(|| f.trim().to_string())
        }
    };
    let mut out = Vec::new();
    match (ty, pty) {
        ("event_msg", "task_complete") => {
            let msg = p.get("last_agent_message").and_then(|x| x.as_str()).unwrap_or("");
            out.push(Activity::new(ts, "done", excerpt_lines(msg, crate::activity::ANSWER_CHARS), None));
        }
        ("event_msg", "user_message") => {
            if let Some(m) = p.get("message").and_then(|x| x.as_str()) {
                out.push(Activity::new(ts, "prompt", excerpt(&clean_prompt(m), 300), None));
            }
        }
        ("event_msg", "item_completed") => {
            let item = p.get("item").cloned().unwrap_or(Value::Null);
            if item.get("type").and_then(|x| x.as_str()) == Some("UserMessage") {
                let text: String = item
                    .get("content")
                    .and_then(|c| c.as_array())
                    .into_iter()
                    .flatten()
                    .filter_map(|c| c.get("text").and_then(|t| t.as_str()))
                    .collect::<Vec<_>>()
                    .join(" ");
                // Codex also records injected context as user items; keep real prompts only.
                if !text.trim().is_empty() && !text.trim_start().starts_with('<') {
                    out.push(Activity::new(ts, "prompt", excerpt(&text, 300), None));
                }
            }
        }
        ("event_msg", "exec_command_begin") => {
            let cmd = p.get("command").map(|c| match c {
                Value::Array(a) => a.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join(" "),
                other => other.as_str().unwrap_or("").to_string(),
            });
            if let Some(c) = cmd.filter(|c| !c.is_empty()) {
                out.push(Activity::new(ts, "tool", format!("Running {}", excerpt(&c, 70)), None));
            }
        }
        ("event_msg", "patch_apply_begin") => {
            if let Some(ch) = p.get("changes").and_then(|c| c.as_object()) {
                for f in ch.keys() {
                    let f = abs(f);
                    out.push(Activity::new(ts, "file", format!("Editing {}", base_name(&f)), Some(f)));
                }
            }
        }
        ("response_item", "custom_tool_call") | ("response_item", "function_call") => {
            let name = p.get("name").and_then(|x| x.as_str()).unwrap_or("");
            let input = p.get("input").or_else(|| p.get("arguments")).and_then(|x| x.as_str()).unwrap_or("");
            let files: Vec<String> = PATCH_FILE.captures_iter(input).map(|c| abs(&c[1])).collect();
            if !files.is_empty() {
                for f in files {
                    out.push(Activity::new(ts, "file", format!("Editing {}", base_name(&f)), Some(f)));
                }
            } else if let Some(c) = CODEX_CMD.captures(input) {
                let cmd = c[1].replace("\\\"", "\"").replace("\\\\", "\\");
                out.push(Activity::new(ts, "tool", format!("Running {}", excerpt(&cmd, 70)), None));
            } else if let Ok(args) = serde_json::from_str::<Value>(input) {
                let cmd = args.get("command").or_else(|| args.get("cmd")).map(|c| match c {
                    Value::Array(a) => a.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join(" "),
                    other => other.as_str().unwrap_or("").to_string(),
                });
                match cmd.filter(|c| !c.is_empty()) {
                    Some(c) => out.push(Activity::new(ts, "tool", format!("Running {}", excerpt(&c, 70)), None)),
                    None if !name.is_empty() && name != "wait" => out.push(Activity::new(ts, "tool", name.to_string(), None)),
                    None => {}
                }
            } else if !name.is_empty() && name != "wait" {
                out.push(Activity::new(ts, "tool", name.to_string(), None));
            }
        }
        _ => {}
    }
    out
}

/// Last assistant text in a Claude transcript (reads only the tail of the file).
pub fn claude_last_message(transcript: &Path) -> Option<String> {
    let mut f = std::fs::File::open(transcript).ok()?;
    let len = f.metadata().ok()?.len();
    let start = len.saturating_sub(512 * 1024);
    f.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf);
    for line in text.lines().rev() {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        if v.get("type").and_then(|x| x.as_str()) != Some("assistant") {
            continue;
        }
        let parts: Vec<&str> = v
            .pointer("/message/content")
            .and_then(|c| c.as_array())
            .into_iter()
            .flatten()
            .filter(|c| c.get("type").and_then(|t| t.as_str()) == Some("text"))
            .filter_map(|c| c.get("text").and_then(|t| t.as_str()))
            .collect();
        let joined = parts.join("\n");
        if !joined.trim().is_empty() {
            return Some(joined);
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Git-based change detection (for CLIs without per-file events)
// ---------------------------------------------------------------------------

fn git_out(dir: &Path, args: &[&str]) -> Option<String> {
    let mut cmd = std::process::Command::new("git");
    cmd.arg("-C").arg(dir).args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let out = cmd.output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Absolute paths of changed/untracked files in the repository containing `dir`.
pub fn git_changed_files(dir: &Path) -> Option<Vec<PathBuf>> {
    let top = git_out(dir, &["rev-parse", "--show-toplevel"])?;
    let top = PathBuf::from(top.trim());
    let out = git_out(dir, &["status", "--porcelain=v1", "-z", "--untracked-files=all"])?;
    Some(parse_porcelain_z(&out).into_iter().map(|p| top.join(p)).take(2000).collect())
}

pub fn parse_porcelain_z(out: &str) -> Vec<String> {
    let mut files = Vec::new();
    let mut it = out.split('\0');
    while let Some(entry) = it.next() {
        if entry.len() < 4 {
            continue;
        }
        let (code, path) = entry.split_at(3);
        if code.starts_with('D') || code[1..2].contains('D') {
            continue;
        }
        files.push(path.to_string());
        if code.starts_with('R') || code.starts_with('C') {
            it.next(); // original path of a rename/copy
        }
    }
    files
}

fn mtime_ms(p: &Path) -> i64 {
    std::fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Current branch of the repository containing `dir`.
pub fn git_branch(dir: &Path) -> Option<String> {
    git_out(dir, &["rev-parse", "--abbrev-ref", "HEAD"]).map(|b| b.trim().to_string()).filter(|b| !b.is_empty())
}

/// Remembers file modification times per working directory and reports what changed since.
#[derive(Default)]
pub struct GitWatch {
    seen: HashMap<PathBuf, HashMap<PathBuf, i64>>,
    /// Number of uncommitted files per directory after the last call (None: not a repo).
    pub dirty: HashMap<PathBuf, usize>,
}

impl GitWatch {
    /// Files changed since the previous call for this directory (first call: none).
    pub fn changes(&mut self, dir: &Path) -> Vec<(PathBuf, i64)> {
        let Some(files) = git_changed_files(dir) else {
            self.dirty.remove(dir);
            return vec![];
        };
        self.dirty.insert(dir.to_path_buf(), files.len());
        let now: HashMap<PathBuf, i64> = files.into_iter().map(|f| {
            let m = mtime_ms(&f);
            (f, m)
        }).collect();
        let first = !self.seen.contains_key(dir);
        let prev = self.seen.entry(dir.to_path_buf()).or_default();
        let mut out: Vec<(PathBuf, i64)> = if first {
            vec![]
        } else {
            now.iter().filter(|(f, m)| prev.get(*f).map(|pm| *m > pm).unwrap_or(true) && **m > 0).map(|(f, m)| (f.clone(), *m)).collect()
        };
        *prev = now;
        out.sort_by_key(|x| x.1);
        out
    }
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

pub fn insert(c: &Connection, session_id: &str, a: &Activity) -> AppResult<()> {
    c.execute(
        "INSERT INTO activity(session_id, ts, kind, text, file) VALUES(?1,?2,?3,?4,?5)",
        params![session_id, a.ts, a.kind, a.text, a.file],
    )?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentFile {
    pub file: String,
    pub ts: i64,
    pub edits: i64,
    pub session_id: String,
    pub session_name: Option<String>,
    pub provider: Option<String>,
    pub exists: bool,
}

pub fn recent_files(c: &Connection, limit: i64, session: Option<&str>) -> AppResult<Vec<RecentFile>> {
    let mut st = c.prepare(
        "SELECT a.file, MAX(a.ts) t, COUNT(*) n,
                (SELECT session_id FROM activity b WHERE b.file=a.file AND b.kind='file' ORDER BY b.ts DESC LIMIT 1) sid
         FROM activity a WHERE a.kind='file' AND a.file IS NOT NULL AND (?2 IS NULL OR a.session_id=?2)
         GROUP BY lower(a.file) ORDER BY t DESC LIMIT ?1",
    )?;
    let rows = st
        .query_map(params![limit.clamp(1, 500), session], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, r.get::<_, String>(3)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    let mut out = Vec::new();
    for (file, ts, edits, sid) in rows {
        let (name, provider): (Option<String>, Option<String>) =
            c.query_row("SELECT name, provider FROM sessions WHERE id=?1", [&sid], |r| Ok((r.get(0)?, r.get(1)?))).unwrap_or((None, None));
        let exists = Path::new(&file).is_file();
        out.push(RecentFile { file, ts, edits, session_id: sid, session_name: name, provider, exists });
    }
    Ok(out)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineItem {
    pub session_id: String,
    pub session_name: Option<String>,
    #[serde(flatten)]
    pub activity: Activity,
}

pub fn timeline(c: &Connection, session: Option<&str>, limit: i64) -> AppResult<Vec<TimelineItem>> {
    let mut st = c.prepare(
        "SELECT a.session_id, a.ts, a.kind, a.text, a.file, s.name FROM activity a LEFT JOIN sessions s ON s.id=a.session_id
         WHERE (?1 IS NULL OR a.session_id=?1) ORDER BY a.ts DESC, a.id DESC LIMIT ?2",
    )?;
    let rows = st
        .query_map(params![session, limit.clamp(1, 1000)], |r| {
            Ok(TimelineItem {
                session_id: r.get(0)?,
                session_name: r.get(5)?,
                activity: Activity { ts: r.get(1)?, kind: r.get(2)?, text: r.get(3)?, file: r.get(4)? },
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Is `path` a file some session touched? (Gate for "open in editor" / "show diff".)
pub fn is_known_file(c: &Connection, path: &str) -> bool {
    c.query_row("SELECT 1 FROM activity WHERE kind='file' AND lower(file)=lower(?1) LIMIT 1", [path], |_| Ok(())).is_ok()
}

/// Keep the table bounded (older than 30 days goes).
pub fn prune(c: &Connection, now_ms: i64) {
    let _ = c.execute("DELETE FROM activity WHERE ts < ?1", [now_ms - 30 * 86_400_000]);
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn claude_tools_are_described() {
        assert_eq!(describe_claude_tool("Edit", &json!({"file_path": "C:/w/src/store.ts"})), ("Editing store.ts".into(), Some("C:/w/src/store.ts".into())));
        assert_eq!(describe_claude_tool("Bash", &json!({"command": "npm test", "description": "Run the tests"})).0, "Run the tests");
        assert_eq!(describe_claude_tool("Bash", &json!({"command": "npm test"})).0, "Running npm test");
        assert_eq!(describe_claude_tool("Read", &json!({"file_path": "a/b.rs"})), ("Reading b.rs".into(), None));
        assert_eq!(describe_claude_tool("mcp__github__create_pr", &json!({})).0, "Tool github__create_pr");
    }

    #[test]
    fn codex_rollout_activity() {
        let done = r#"{"timestamp":"t","type":"event_msg","payload":{"type":"task_complete","last_agent_message":"Fixed the test.\nAll green."}}"#;
        assert_eq!(codex_activity(done, 5, None), vec![Activity::new(5, "done", "Fixed the test.\nAll green.", None)]);
        assert_eq!(excerpt_lines("  **Done**\n\n\n\n- a  \n- b\n", 100), "**Done**\n\n- a\n- b");
        assert_eq!(excerpt_lines("abcdef", 4), "abc…");
        let exec = r#"{"type":"response_item","payload":{"type":"custom_tool_call","name":"exec","input":"text(await tools.exec_command({cmd:\"npm test -- --run\"}))"}}"#;
        assert_eq!(codex_activity(exec, 1, None)[0].text, "Running npm test -- --run");
        let patch = r#"{"type":"response_item","payload":{"type":"custom_tool_call","name":"apply_patch","input":"*** Begin Patch\n*** Update File: src/app.ts\n@@\n*** Add File: docs/x.md\n*** End Patch"}}"#;
        let acts = codex_activity(patch, 1, Some("C:/w"));
        assert_eq!(acts.len(), 2);
        assert_eq!(acts[0].kind, "file");
        assert!(acts[0].file.as_deref().unwrap().replace('\\', "/").ends_with("C:/w/src/app.ts"));
        let user = r#"{"type":"event_msg","payload":{"type":"item_completed","item":{"type":"UserMessage","content":[{"type":"text","text":"Please fix the build"}]}}}"#;
        assert_eq!(codex_activity(user, 1, None)[0].kind, "prompt");
        let ctx = r#"{"type":"event_msg","payload":{"type":"item_completed","item":{"type":"UserMessage","content":[{"type":"text","text":"<environment_context>x</environment_context>"}]}}}"#;
        assert!(codex_activity(ctx, 1, None).is_empty(), "injected context is not a prompt");
        let fc = r#"{"type":"response_item","payload":{"type":"function_call","name":"shell","arguments":"{\"command\":[\"git\",\"status\"]}"}}"#;
        assert_eq!(codex_activity(fc, 1, None)[0].text, "Running git status");
    }

    #[test]
    fn claude_transcript_last_message() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("t.jsonl");
        std::fs::write(&p, [
            r#"{"type":"user","message":{"content":"hi"}}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"First answer"}]}}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash"}]}}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Done: tests pass."}]}}"#,
            r#"{"type":"system","subtype":"x"}"#,
        ].join("\n")).unwrap();
        assert_eq!(claude_last_message(&p).as_deref(), Some("Done: tests pass."));
    }

    #[test]
    fn porcelain_z_parsing() {
        let out = " M src/a.ts\0?? new.md\0R  new_name.rs\0old_name.rs\0 D gone.txt\0";
        assert_eq!(parse_porcelain_z(out), vec!["src/a.ts", "new.md", "new_name.rs"]);
    }

    #[test]
    fn git_watch_reports_new_changes_only() {
        let dir = tempfile::tempdir().unwrap();
        let run = |args: &[&str]| std::process::Command::new("git").arg("-C").arg(dir.path()).args(args).output().unwrap();
        if run(&["init", "-q"]).status.code() != Some(0) {
            return; // git missing
        }
        std::fs::write(dir.path().join("a.txt"), "1").unwrap();
        let mut w = GitWatch::default();
        assert!(w.changes(dir.path()).is_empty(), "first snapshot is the baseline");
        std::thread::sleep(std::time::Duration::from_millis(30));
        std::fs::write(dir.path().join("b.txt"), "2").unwrap();
        let ch = w.changes(dir.path());
        assert_eq!(ch.len(), 1);
        assert!(ch[0].0.ends_with("b.txt"));
        assert!(w.changes(dir.path()).is_empty(), "unchanged files are not reported again");
        assert_eq!(w.dirty.get(dir.path()), Some(&2));
    }

    #[test]
    fn storage_and_queries() {
        let c = crate::db::open_in_memory().unwrap();
        c.execute("INSERT INTO sessions(id,name,provider,cwd,created_at) VALUES('s1','Claude A #1','claude','/w','t')", []).unwrap();
        insert(&c, "s1", &Activity::new(1, "file", "Editing a.ts", Some("C:/w/a.ts".into()))).unwrap();
        insert(&c, "s1", &Activity::new(3, "file", "Editing a.ts", Some("C:/w/A.ts".into()))).unwrap();
        insert(&c, "s1", &Activity::new(2, "file", "Editing b.ts", Some("C:/w/b.ts".into()))).unwrap();
        insert(&c, "s1", &Activity::new(4, "done", "ok", None)).unwrap();
        let files = recent_files(&c, 10, None).unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].edits, 2);
        assert_eq!(files[0].session_name.as_deref(), Some("Claude A #1"));
        assert_eq!(timeline(&c, Some("s1"), 10).unwrap()[0].activity.kind, "done");
        assert!(is_known_file(&c, "c:/w/b.ts"));
        assert!(!is_known_file(&c, "C:/Windows/system32/x.dll"));
    }
}
