//! Local event sink for Claude Code hooks and statusLine.
//!
//! The cockpit launches Claude with `--settings <run>/settings.json`, which registers
//! documented hooks and a statusLine command pointing back at this executable:
//!
//! ```text
//! RobsAICockpit.exe sink hook <run-dir>        (stdin: hook JSON)
//! RobsAICockpit.exe sink statusline <run-dir>  (stdin: statusLine JSON, stdout: status text)
//! ```
//!
//! Privacy: only a fixed allow-list of fields is persisted. Prompt text, tool inputs and
//! tool outputs are dropped. Nothing leaves the machine.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};

pub const HOOK_EVENTS: &[&str] = &[
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "Notification",
    "Stop",
    "SessionEnd",
];

/// Settings JSON passed to `claude --settings`. Settings sources are merged by Claude Code,
/// so the user's own hooks keep working; our statusLine takes precedence for this session.
pub fn claude_session_settings(exe: &Path, run_dir: &Path, statusline: bool, details: bool) -> Value {
    // Forward slashes survive both cmd.exe and Git Bash quoting on Windows.
    let q = |p: &Path| format!("\"{}\"", p.to_string_lossy().replace('\\', "/"));
    let hook_cmd = format!("{} sink hook {}{}", q(exe), q(run_dir), if details { " --details" } else { "" });
    let mut hooks = Map::new();
    for ev in HOOK_EVENTS {
        hooks.insert(
            ev.to_string(),
            json!([{ "hooks": [{ "type": "command", "command": hook_cmd, "timeout": 10 }] }]),
        );
    }
    let mut v = json!({ "hooks": hooks });
    if statusline {
        v["statusLine"] = json!({
            "type": "command",
            "command": format!("{} sink statusline {}", q(exe), q(run_dir)),
            "padding": 0
        });
    }
    v
}

fn pick(src: &Value, keys: &[&str]) -> Map<String, Value> {
    let mut m = Map::new();
    for k in keys {
        if let Some(v) = src.get(*k) {
            m.insert((*k).to_string(), v.clone());
        }
    }
    m
}

fn cut(s: &str, n: usize) -> Value {
    Value::String(s.chars().take(n).collect())
}

/// Reduce a hook payload to the fields the cockpit shows. Without `details` only event names
/// and ids are kept; with it also file paths, short command/prompt excerpts and the last
/// answer (still local only — used for the activity view and notifications).
pub fn sanitize_hook(v: &Value, details: bool) -> Value {
    let mut m = pick(v, &["hook_event_name", "session_id", "transcript_path", "tool_name", "notification_type", "source", "reason"]);
    if let Some(msg) = v.get("message").and_then(|m| m.as_str()) {
        // Notification messages are short system strings ("Claude needs your permission…").
        m.insert("message".into(), cut(msg, 160));
    }
    if details {
        if let Some(input) = v.get("tool_input") {
            let mut t = Map::new();
            for k in ["file_path", "notebook_path", "path", "url"] {
                if let Some(s) = input.get(k).and_then(|x| x.as_str()) {
                    t.insert(k.into(), cut(s, 400));
                }
            }
            for (k, n) in [("command", 200), ("description", 120), ("pattern", 120), ("query", 120)] {
                if let Some(s) = input.get(k).and_then(|x| x.as_str()) {
                    t.insert(k.into(), cut(s, n));
                }
            }
            m.insert("tool_input".into(), Value::Object(t));
        }
        if let Some(p) = v.get("prompt").and_then(|x| x.as_str()) {
            m.insert("prompt".into(), cut(p, 300));
        }
        if let Some(p) = v.get("last_assistant_message").and_then(|x| x.as_str()) {
            m.insert("last_assistant_message".into(), cut(p, 1500));
        }
    }
    m.insert("ts".into(), json!(chrono::Utc::now().timestamp_millis()));
    Value::Object(m)
}

/// Reduce a statusLine payload to what the cockpit needs.
pub fn sanitize_statusline(v: &Value) -> Value {
    let mut m = pick(v, &["session_id", "transcript_path", "version", "rate_limits", "context_window"]);
    if let Some(model) = v.get("model") {
        m.insert("model".into(), pick(model, &["id", "display_name"]).into());
    }
    if let Some(cost) = v.get("cost") {
        m.insert("cost".into(), pick(cost, &["total_cost_usd", "total_duration_ms", "total_api_duration_ms"]).into());
    }
    m.insert("ts".into(), json!(chrono::Utc::now().timestamp_millis()));
    Value::Object(m)
}

pub fn statusline_text(v: &Value) -> String {
    let model = v.pointer("/model/display_name").and_then(|x| x.as_str()).unwrap_or("");
    let mut parts = vec![format!("◆ cockpit {model}").trim().to_string()];
    let pct = |p: &str| v.pointer(p).and_then(|x| x.as_f64());
    if let Some(p) = pct("/rate_limits/five_hour/used_percentage") {
        parts.push(format!("5h {p:.0}%"));
    }
    if let Some(p) = pct("/rate_limits/seven_day/used_percentage") {
        parts.push(format!("7d {p:.0}%"));
    }
    if let Some(p) = pct("/context_window/used_percentage") {
        parts.push(format!("ctx {p:.0}%"));
    }
    parts.join(" · ")
}

fn read_stdin() -> Value {
    let mut s = String::new();
    let _ = std::io::stdin().read_to_string(&mut s);
    serde_json::from_str(&s).unwrap_or(Value::Null)
}

fn write_atomic(path: &Path, data: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, data)?;
    std::fs::rename(&tmp, path)
}

/// Entry point for `ai-cockpit sink ...`. Returns the process exit code.
/// Never fails loudly: a broken sink must not disturb the Claude session.
pub fn run(args: &[String]) -> i32 {
    let kind = args.first().map(String::as_str).unwrap_or("");
    let Some(dir) = args.get(1).map(PathBuf::from) else { return 0 };
    // Only ever write inside the cockpit's own run directory.
    if !crate::paths::is_within(&dir, &crate::paths::run_root()) {
        return 0;
    }
    let _ = std::fs::create_dir_all(&dir);
    let input = read_stdin();
    match kind {
        "hook" => {
            let details = args.iter().any(|a| a == "--details");
            let line = sanitize_hook(&input, details).to_string();
            if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("events.jsonl")) {
                let _ = writeln!(f, "{line}");
            }
        }
        "statusline" => {
            let clean = sanitize_statusline(&input);
            let _ = write_atomic(&dir.join("statusline.json"), clean.to_string().as_bytes());
            print!("{}", statusline_text(&input));
            let _ = std::io::stdout().flush();
        }
        _ => {}
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hook_sanitizer_drops_prompt_and_tool_io() {
        let v = json!({
            "hook_event_name": "UserPromptSubmit", "session_id": "s", "transcript_path": "t",
            "prompt": "my secret prompt", "tool_input": {"command": "rm -rf"}, "tool_response": "x",
            "cwd": "C:/x"
        });
        let s = sanitize_hook(&v, false);
        let txt = s.to_string();
        assert!(!txt.contains("secret"));
        assert!(!txt.contains("rm -rf"));
        // With details: paths and short excerpts, never tool output.
        let d = sanitize_hook(&json!({"hook_event_name":"PostToolUse","tool_name":"Edit","tool_input":{"file_path":"C:/w/a.ts","old_string":"SECRET","new_string":"x"},"tool_response":"out"}), true);
        assert_eq!(d["tool_input"]["file_path"], "C:/w/a.ts");
        assert!(!d.to_string().contains("SECRET") && !d.to_string().contains("\"out\""));
        assert_eq!(s["hook_event_name"], "UserPromptSubmit");
        assert!(s["ts"].is_i64());
    }

    #[test]
    fn statusline_keeps_rate_limits_and_formats_text() {
        let v = json!({
            "session_id": "abc", "model": {"id": "claude-opus", "display_name": "Opus"},
            "workspace": {"current_dir": "C:/secret/path"},
            "rate_limits": {"five_hour": {"used_percentage": 68.4, "resets_at": 1790000000},
                            "seven_day": {"used_percentage": 39.0, "resets_at": 1790500000}},
            "cost": {"total_cost_usd": 1.2, "total_lines_added": 5}
        });
        let s = sanitize_statusline(&v);
        assert_eq!(s["rate_limits"]["five_hour"]["used_percentage"], 68.4);
        assert!(s.get("workspace").is_none());
        assert!(s["cost"].get("total_lines_added").is_none());
        assert_eq!(statusline_text(&v), "◆ cockpit Opus · 5h 68% · 7d 39%");
    }

    #[test]
    fn settings_json_registers_hooks_with_forward_slashes() {
        let v = claude_session_settings(Path::new(r"C:\Program Files\Cockpit\ai-cockpit.exe"), Path::new(r"C:\Users\me\.ai-cockpit\run\s1"), true, false);
        let cmd = v["hooks"]["Stop"][0]["hooks"][0]["command"].as_str().unwrap();
        assert_eq!(cmd, r#""C:/Program Files/Cockpit/ai-cockpit.exe" sink hook "C:/Users/me/.ai-cockpit/run/s1""#);
        assert!(v["statusLine"]["command"].as_str().unwrap().contains("sink statusline"));
        for ev in HOOK_EVENTS {
            assert!(v["hooks"].get(*ev).is_some());
        }
        let v2 = claude_session_settings(Path::new("a"), Path::new("b"), false, true);
        assert!(v2.get("statusLine").is_none());
        assert!(v2["hooks"]["Stop"][0]["hooks"][0]["command"].as_str().unwrap().ends_with("--details"));
    }
}
