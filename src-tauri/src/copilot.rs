//! GitHub Copilot CLI: the session's own event log, `<COPILOT_HOME>/session-state/<id>/events.jsonl`
//! (docs.github.com "Copilot CLI configuration directory" + Copilot SDK "Streaming session events").
//!
//! Every line is `{"type": "...", "data": {...}, "id": "...", "timestamp": "ISO 8601", ...}`.
//! Used here: `user.message` (prompt → turn starts), `assistant.turn_start`, `tool.execution_start`
//! (what it does), `assistant.message` (`content`, `toolRequests`), `assistant.turn_end`,
//! `session.idle` (the loop ended), `session.error` (`errorType`, `message`, `statusCode`) and
//! `session.usage_info` (`tokenLimit`, `currentTokens` → context %). Unknown types are ignored, so
//! a newer CLI with more events keeps working.
//!
//! Parsing is pure (unit tested); `monitor.rs` tails the file and folds the events into the view.

use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::cli::same_path;

#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    /// The user's prompt: a new turn starts.
    Prompt(String),
    /// One model call starts (the turn goes on).
    Working,
    /// A tool runs: label for the live view, file it touches (edits only).
    Tool { label: String, file: Option<String> },
    /// An answer; `final_answer` when it requests no tools (the turn's last words).
    Message { text: String, final_answer: bool },
    /// One model call ended.
    TurnEnd,
    /// The agent loop ended: waiting for the user.
    Idle,
    /// An error ended the turn.
    Error { message: String, status: Option<i64> },
    /// Context window use, percent.
    Context(f64),
}

/// Epoch ms of the line's ISO timestamp.
pub fn ts_of(v: &Value) -> Option<i64> {
    let t = v.get("timestamp")?.as_str()?;
    chrono::DateTime::parse_from_rfc3339(t).ok().map(|d| d.timestamp_millis())
}

fn s<'a>(v: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|k| v.get(*k).and_then(|x| x.as_str())).map(str::trim).filter(|x| !x.is_empty())
}

fn file_name(p: &str) -> String {
    p.rsplit(['/', '\\']).next().unwrap_or(p).to_string()
}

/// What a tool call does, in the cockpit's words ("Running npm test", "Editing a.ts").
pub fn describe_tool(name: &str, args: &Value) -> (String, Option<String>) {
    let n = name.to_lowercase();
    let path = s(args, &["path", "file_path", "filePath", "file"]);
    if n.contains("shell") || n.contains("bash") || n.contains("powershell") || n == "run" {
        let cmd = s(args, &["command", "cmd"]).unwrap_or("a command");
        return (format!("Running {}", crate::activity::excerpt(cmd, 80)), None);
    }
    if n.contains("edit") || n.contains("create") || n.contains("write") || n.contains("str_replace") {
        if let Some(p) = path {
            return (format!("Editing {}", file_name(p)), Some(p.to_string()));
        }
        return ("Editing a file".into(), None);
    }
    if n.contains("view") || n.contains("read") {
        return (format!("Reading {}", path.map(file_name).unwrap_or_else(|| "a file".into())), None);
    }
    if n.contains("grep") || n.contains("glob") || n.contains("search") {
        return ("Searching the code".into(), None);
    }
    if n.contains("fetch") || n.contains("web") {
        return ("Reading the web".into(), None);
    }
    (format!("Using {name}"), None)
}

/// One event-log line → what it means for the live view (with its timestamp, if any).
pub fn parse_line(line: &str) -> Option<(Event, Option<i64>)> {
    let v: Value = serde_json::from_str(line.trim()).ok()?;
    let ty = v.get("type")?.as_str()?;
    let data = v.get("data").cloned().unwrap_or(Value::Null);
    let ev = match ty {
        "user.message" => Event::Prompt(s(&data, &["content", "transformedContent"]).unwrap_or("Prompt submitted").to_string()),
        "assistant.turn_start" => Event::Working,
        "tool.execution_start" => {
            let name = s(&data, &["toolName", "name", "tool"]).unwrap_or("tool");
            let args = data.get("arguments").or_else(|| data.get("args")).cloned().unwrap_or(Value::Null);
            let (label, file) = describe_tool(name, &args);
            Event::Tool { label, file }
        }
        "assistant.message" => {
            let text = s(&data, &["content"]).unwrap_or("").to_string();
            let tools = data.get("toolRequests").and_then(|x| x.as_array()).is_some_and(|a| !a.is_empty());
            Event::Message { text, final_answer: !tools }
        }
        "assistant.turn_end" => Event::TurnEnd,
        "session.idle" | "session.task_complete" => Event::Idle,
        "session.error" => Event::Error {
            message: s(&data, &["message", "errorType"]).unwrap_or("Copilot error").to_string(),
            status: data.get("statusCode").and_then(|x| x.as_i64()),
        },
        "session.usage_info" => {
            let limit = data.get("tokenLimit").and_then(|x| x.as_f64()).filter(|l| *l > 0.0)?;
            let cur = data.get("currentTokens").and_then(|x| x.as_f64())?;
            Event::Context((cur / limit * 100.0).clamp(0.0, 100.0))
        }
        _ => return None,
    };
    Some((ev, ts_of(&v)))
}

/// The working directory a session's first event names, if any (searched in `data` and `data.context`).
fn cwd_of(first_line: &str) -> Option<String> {
    let v: Value = serde_json::from_str(first_line.trim()).ok()?;
    let d = v.get("data")?;
    [d, d.get("context").unwrap_or(&Value::Null)]
        .iter()
        .find_map(|x| s(x, &["cwd", "workingDirectory", "workspacePath", "gitRoot"]).map(str::to_string))
}

fn mtime_ms(p: &Path) -> i64 {
    std::fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// The event log of a session in `<home>/session-state`: by id when it is known (resume), else
/// the earliest one written since the start whose recorded folder is this one (or names none).
/// `session-state/<id>/events.jsonl`; older CLIs wrote `session-state/<id>.jsonl`.
pub fn find_session(home: &Path, cwd: &str, started_ms: i64, psid: Option<&str>, claimed: &[PathBuf]) -> Option<(String, PathBuf)> {
    let root = home.join("session-state");
    let mut best: Option<(i64, String, PathBuf)> = None;
    for e in std::fs::read_dir(&root).ok()?.flatten() {
        let p = e.path();
        let (id, log) = if p.is_dir() {
            (e.file_name().to_string_lossy().into_owned(), p.join("events.jsonl"))
        } else if p.extension().is_some_and(|x| x == "jsonl") {
            (p.file_stem().map(|x| x.to_string_lossy().into_owned()).unwrap_or_default(), p.clone())
        } else {
            continue;
        };
        if !log.is_file() || claimed.contains(&log) {
            continue;
        }
        if let Some(want) = psid {
            if id == want {
                return Some((id, log));
            }
            continue;
        }
        let m = mtime_ms(&log);
        if m < started_ms - 5_000 {
            continue;
        }
        let first = std::fs::File::open(&log).ok().and_then(|f| {
            use std::io::BufRead;
            std::io::BufReader::new(f).lines().next()?.ok()
        });
        let first = first.unwrap_or_default();
        if cwd_of(&first).is_some_and(|c| !same_path(Path::new(&c), Path::new(cwd))) {
            continue;
        }
        let born = serde_json::from_str::<Value>(first.trim()).ok().as_ref().and_then(ts_of).unwrap_or(m);
        if born < started_ms - 10_000 {
            continue;
        }
        if best.as_ref().is_none_or(|b| born < b.0) {
            best = Some((born, id, log));
        }
    }
    best.map(|b| (b.1, b.2))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_become_turns_tools_and_answers() {
        let p = |l: &str| parse_line(l).map(|x| x.0);
        assert_eq!(
            p(r#"{"type":"user.message","data":{"content":"Fix the failing test"},"id":"1","timestamp":"2026-10-10T08:00:00.000Z"}"#),
            Some(Event::Prompt("Fix the failing test".into()))
        );
        assert_eq!(parse_line(r#"{"type":"assistant.turn_start","data":{},"timestamp":"2026-10-10T08:00:01.000Z"}"#).unwrap().1, Some(1_791_619_201_000));
        assert_eq!(
            p(r#"{"type":"tool.execution_start","data":{"toolName":"bash","arguments":{"command":"npm test"}}}"#),
            Some(Event::Tool { label: "Running npm test".into(), file: None })
        );
        assert_eq!(
            p(r#"{"type":"tool.execution_start","data":{"toolName":"edit","arguments":{"path":"C:\\w\\src\\a.ts"}}}"#),
            Some(Event::Tool { label: "Editing a.ts".into(), file: Some(r"C:\w\src\a.ts".into()) })
        );
        assert_eq!(
            p(r#"{"type":"assistant.message","data":{"messageId":"m","content":"Let me run the tests.","toolRequests":[{"name":"bash"}]}}"#),
            Some(Event::Message { text: "Let me run the tests.".into(), final_answer: false })
        );
        assert_eq!(
            p(r#"{"type":"assistant.message","data":{"messageId":"m2","content":"All 12 tests pass.","toolRequests":[]}}"#),
            Some(Event::Message { text: "All 12 tests pass.".into(), final_answer: true })
        );
        assert_eq!(p(r#"{"type":"session.idle","data":{}}"#), Some(Event::Idle));
        assert_eq!(
            p(r#"{"type":"session.error","data":{"errorType":"rate_limit","message":"You've reached your rate limit","statusCode":429}}"#),
            Some(Event::Error { message: "You've reached your rate limit".into(), status: Some(429) })
        );
        assert_eq!(p(r#"{"type":"session.usage_info","data":{"tokenLimit":200000,"currentTokens":50000,"messagesLength":4}}"#), Some(Event::Context(25.0)));
        assert_eq!(p(r#"{"type":"assistant.message_delta","data":{"deltaContent":"x"}}"#), None, "streaming deltas are ignored");
        assert_eq!(p("not json"), None);
    }

    #[test]
    fn finds_the_session_log_by_id_or_folder_and_start() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("session-state");
        let start = chrono::Utc::now().timestamp_millis();
        let ts = chrono::Utc::now().to_rfc3339();
        let mk = |id: &str, cwd: &str| {
            std::fs::create_dir_all(root.join(id)).unwrap();
            let first = format!(r#"{{"type":"session.start","data":{{"sessionId":"{id}","context":{{"cwd":"{cwd}"}}}},"timestamp":"{ts}"}}"#);
            std::fs::write(root.join(id).join("events.jsonl"), first + "\n").unwrap();
            root.join(id).join("events.jsonl")
        };
        mk("aaa-other", "C:/other");
        let mine = mk("bbb-mine", "C:/Work/App");
        let (id, log) = find_session(dir.path(), r"c:\work\app", start, None, &[]).unwrap();
        assert_eq!((id.as_str(), log.clone()), ("bbb-mine", mine.clone()));
        assert!(find_session(dir.path(), r"c:\work\app", start, None, &[mine]).is_none(), "claimed logs are skipped");
        assert_eq!(find_session(dir.path(), "C:/zzz", start, Some("aaa-other"), &[]).unwrap().0, "aaa-other");
        assert!(find_session(&dir.path().join("missing"), "C:/w", start, None, &[]).is_none());
    }
}
