//! Failed turns: an API or CLI error ended an agent's turn (model not available, usage limit,
//! login expired, provider overloaded, network down). Such a turn is not "done" — nothing was
//! worked on — so the session gets status "error" with what went wrong instead of looking idle.
//!
//! Sources, most reliable first:
//! * Codex: the rollout's `task_complete` carries an `error` object (older CLIs: an `error` event).
//! * Claude Code: the `StopFailure` hook (fires instead of `Stop` when an API error ended the turn).
//! * Fallback for CLIs without those signals (also Claude Code below 2.1.295, which has hooks but
//!   no `StopFailure`): the error line on screen (`detect::Signal::TurnFailed`).

use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnError {
    /// "model" | "limit" | "auth" | "server" | "network" | "request" | "unknown"
    pub kind: String,
    /// What the CLI said, readable (the inner message of a JSON error body).
    pub message: String,
    /// When it was seen (epoch ms).
    pub at: i64,
}

impl TurnError {
    pub fn new(raw: &str, kind: Option<&str>, at: i64) -> Self {
        let message = readable(raw);
        let kind = kind.unwrap_or_else(|| classify(&format!("{raw} {message}"))).to_string();
        TurnError { kind, message, at }
    }
}

static MODEL: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(model\b.{0,80}\b(is not supported|not supported|not found|does not exist|not available|is unavailable|no access|do not have access|is not enabled)|\b(unknown|invalid|unsupported) model\b|model_not_found)").unwrap()
});
static LIMIT: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(usage limit|rate[ _-]?limit|\b429\b|too many requests|quota|spend limit|billing|credit balance|hit your (?:[\w-]+ ){0,2}limit|usage_limit)").unwrap()
});
static AUTH: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(\b401\b|\b403\b|unauthori[sz]ed|forbidden|authenticat|oauth|/login|log in again|sign in again|not logged in|token (?:has )?expired|access token|invalid api key|api key)").unwrap()
});
static SERVER: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(overloaded|\b5(?:00|02|03|04|29)\b|server[ _]error|internal error|temporarily unavailable|service unavailable|bad gateway|stopped arriving)").unwrap()
});
static NETWORK: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(enotfound|econnrefused|econnreset|etimedout|timed out|timeout|connection|network|can't reach|cannot reach|could not reach|dns|stream disconnected|socket)").unwrap()
});
static REQUEST: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(\b400\b|invalid_request|invalid request|bad request|context window|too long|max_output_tokens)").unwrap()
});

/// What kind of failure an error text describes (decides the suggested fix).
pub fn classify(text: &str) -> &'static str {
    if MODEL.is_match(text) {
        "model"
    } else if LIMIT.is_match(text) {
        "limit"
    } else if AUTH.is_match(text) {
        "auth"
    } else if SERVER.is_match(text) {
        "server"
    } else if NETWORK.is_match(text) {
        "network"
    } else if REQUEST.is_match(text) {
        "request"
    } else {
        "unknown"
    }
}

/// Claude Code's `StopFailure` error type → our kind (the text decides when the type is vague).
pub fn claude_kind(error: &str, text: &str) -> &'static str {
    match error {
        "rate_limit" | "billing_error" => "limit",
        "overloaded" | "server_error" => "server",
        "authentication_failed" | "oauth_org_not_allowed" | "account_on_hold" | "verification_required" | "cloud_credential_error" => "auth",
        "model_not_found" => "model",
        "max_output_tokens" => "request",
        _ => match classify(text) {
            "unknown" if error == "invalid_request" => "request",
            k => k,
        },
    }
}

/// Short label for the session's attention line.
pub fn label(kind: &str) -> &'static str {
    match kind {
        "model" => "Model not available",
        "limit" => "Usage limit reached",
        "auth" => "Login required",
        "server" => "Provider overloaded or down",
        "network" => "Network error",
        "request" => "Request rejected",
        _ => "Turn failed",
    }
}

/// The message inside an error text: `■ {"type":"error","status":400,"error":{"message":"…"}}`
/// becomes "… (400)"; plain text loses its screen prefix ("■", "⎿").
pub fn readable(raw: &str) -> String {
    let t = raw.trim().trim_start_matches(['■', '⎿', '●', '✗', '×']).trim();
    let body = t.find('{').map(|i| &t[i..]).unwrap_or(t);
    if let Ok(v) = serde_json::from_str::<Value>(body) {
        let msg = v
            .pointer("/error/message")
            .or_else(|| v.get("message"))
            .or_else(|| v.get("detail"))
            .and_then(|x| x.as_str())
            .map(str::to_string)
            // the body may itself be a JSON string inside a message field
            .map(|m| if m.trim_start().starts_with('{') { readable(&m) } else { m });
        let status = v.get("status").and_then(|x| x.as_i64());
        if let Some(m) = msg.filter(|m| !m.trim().is_empty()) {
            let lead = t[..t.len() - body.len()].trim().trim_end_matches(':').trim();
            let m = if lead.is_empty() || lead.eq_ignore_ascii_case("error") { m } else { format!("{lead}: {m}") };
            return cut(&match status {
                Some(s) if !m.contains(&s.to_string()) => format!("{m} ({s})"),
                _ => m,
            });
        }
    }
    cut(t)
}

fn cut(s: &str) -> String {
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if s.chars().count() > 300 {
        s.chars().take(299).collect::<String>() + "…"
    } else {
        s
    }
}

/// The whole error message on screen: the detected line plus the rows the CLI wrapped it into
/// (up to a blank row or the input box).
pub fn block_on_screen(screen: &str, first: &str) -> Option<String> {
    let probe: String = first.trim().chars().take(40).collect();
    if probe.is_empty() {
        return None;
    }
    let lines: Vec<&str> = screen.lines().collect();
    let at = lines.iter().rposition(|l| l.trim().starts_with(&probe))?;
    let mut out = vec![lines[at].trim()];
    for l in &lines[at + 1..] {
        let l = l.trim();
        if l.is_empty() || l.starts_with(['›', '>', '■', '⎿', '─', '╭', '│']) || out.len() >= 8 {
            break;
        }
        out.push(l);
    }
    Some(out.join(" "))
}

/// Codex rollout line → the error that ended the turn, if this line reports one.
pub fn codex_turn_error(line: &str) -> Option<String> {
    if !line.contains("error") {
        return None;
    }
    let v: Value = serde_json::from_str(line).ok()?;
    if v.get("type")?.as_str()? != "event_msg" {
        return None;
    }
    let p = v.get("payload")?;
    match p.get("type")?.as_str()? {
        "task_complete" => {
            let e = p.get("error").filter(|e| !e.is_null())?;
            let msg = e.get("message").and_then(|x| x.as_str()).map(str::to_string).unwrap_or_else(|| e.to_string());
            (!msg.trim().is_empty()).then_some(msg)
        }
        "error" => p.get("message").and_then(|x| x.as_str()).filter(|m| !m.trim().is_empty()).map(str::to_string),
        _ => None,
    }
}

/// Claude Code `StopFailure` hook payload → the failed turn. `fallback_text` (the transcript's
/// last assistant message) is used only when it is the API error itself — otherwise it is the
/// previous, successful answer and the error type speaks instead.
pub fn claude_stop_failure(v: &Value, fallback_text: Option<String>, at: i64) -> TurnError {
    let fallback_text = fallback_text.filter(|t| {
        let t = t.trim_start().trim_start_matches(['⎿', '■']).trim_start();
        t.starts_with("API Error") || t.starts_with("Failed to authenticate")
    });
    let error = v.get("error").and_then(|x| x.as_str()).unwrap_or("unknown");
    let details = match v.get("error_details") {
        Some(Value::String(s)) => Some(s.clone()),
        Some(Value::Null) | None => None,
        Some(other) => Some(other.to_string()),
    };
    let text = v
        .get("last_assistant_message")
        .and_then(|x| x.as_str())
        .map(str::to_string)
        .filter(|s| !s.trim().is_empty())
        .or(details)
        .or(fallback_text)
        .unwrap_or_else(|| format!("API error ({error})"));
    let kind = claude_kind(error, &text);
    TurnError { kind: kind.into(), message: readable(&text), at }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CODEX_LINE: &str = r#"■ {"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account."}}"#;

    #[test]
    fn codex_model_error_from_screen_and_rollout() {
        let e = TurnError::new(CODEX_LINE, None, 1);
        assert_eq!(e.kind, "model");
        assert_eq!(e.message, "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account. (400)");
        // a narrow terminal wraps the line: the rows on screen are joined again
        let wrapped = "› Erstelle hallo.txt\n\n■ {\"type\":\"error\",\"status\":400,\"error\":{\"type\":\"invalid_request_error\",\"message\":\"The\n'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT\naccount.\"}}\n\n› Ask Codex to do anything\n";
        let first = "■ {\"type\":\"error\",\"status\":400,\"error\":{\"type\":\"invalid_request_error\",\"message\":\"The";
        let block = block_on_screen(wrapped, first).unwrap();
        assert_eq!(TurnError::new(&block, None, 1), e);
        // the same failure as the rollout records it (real line, trimmed)
        let rollout = r#"{"timestamp":"2026-10-06T08:10:49.547Z","ordinal":8,"type":"event_msg","payload":{"type":"task_complete","turn_id":"t","last_agent_message":null,"error":{"message":"{\"type\":\"error\",\"status\":400,\"error\":{\"type\":\"invalid_request_error\",\"message\":\"The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.\"}}","codex_error_info":"other"},"duration_ms":1651}}"#;
        let raw = codex_turn_error(rollout).unwrap();
        let e = TurnError::new(&raw, None, 2);
        assert_eq!((e.kind.as_str(), e.message.as_str()), ("model", "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account. (400)"));
        // a normal turn end is no error
        assert!(codex_turn_error(r#"{"type":"event_msg","payload":{"type":"task_complete","last_agent_message":"Fixed the error handling.","error":null}}"#).is_none());
        assert!(codex_turn_error(r#"{"type":"event_msg","payload":{"type":"task_complete","last_agent_message":"Done"}}"#).is_none());
        assert_eq!(codex_turn_error(r#"{"type":"event_msg","payload":{"type":"error","message":"stream disconnected before completion"}}"#).as_deref(), Some("stream disconnected before completion"));
    }

    #[test]
    fn kinds_of_real_cli_errors() {
        for (text, kind) in [
            ("API Error: 529 Overloaded. This is a server-side issue, usually temporary — try again in a moment.", "server"),
            ("API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)", "network"),
            ("API Error: Connection lost mid-response. The response above may be incomplete.", "network"),
            ("API Error: The response stopped arriving. The response above may be incomplete.", "server"),
            ("Failed to authenticate. API Error: 401 OAuth access token has expired. Re-authenticate to continue.", "auth"),
            ("API Error: This request would exceed your account's rate limit. Please try again later.", "limit"),
            ("You've hit your monthly spend limit · raise it at claude.ai/settings/usage", "limit"),
            (r#"■ {"type":"error","status":429,"error":{"message":"Too Many Requests"}}"#, "limit"),
            ("■ unexpected status 401 Unauthorized: Missing bearer authentication", "auth"),
            ("API Error: 404 model: claude-opus-9 not found", "model"),
            ("API Error: 400 prompt is too long: 210000 tokens > 200000 maximum", "request"),
            ("something odd happened", "unknown"),
        ] {
            assert_eq!(TurnError::new(text, None, 0).kind, kind, "{text}");
        }
    }

    #[test]
    fn claude_stop_failure_payload() {
        let v = serde_json::json!({"hook_event_name":"StopFailure","error":"overloaded","last_assistant_message":"API Error: 529 Overloaded."});
        let e = claude_stop_failure(&v, None, 5);
        assert_eq!((e.kind.as_str(), e.message.as_str(), e.at), ("server", "API Error: 529 Overloaded.", 5));
        // without details: the transcript's last message, else the error type
        let v = serde_json::json!({"hook_event_name":"StopFailure","error":"model_not_found"});
        assert_eq!(claude_stop_failure(&v, None, 1).kind, "model");
        assert_eq!(claude_stop_failure(&v, None, 1).message, "API error (model_not_found)");
        let v = serde_json::json!({"error":"invalid_request"});
        assert_eq!(claude_stop_failure(&v, Some("API Error: 400 something".into()), 1).kind, "request");
        // the transcript's last message is the previous answer, not this error: the type speaks
        let v = serde_json::json!({"error":"rate_limit"});
        let e = claude_stop_failure(&v, Some("Fertig: hallo.txt angelegt, alle Tests grün.".into()), 1);
        assert_eq!((e.kind.as_str(), e.message.as_str()), ("limit", "API error (rate_limit)"));
        assert_eq!(claude_kind("unknown", "OAuth token has expired"), "auth");
        assert_eq!(label("model"), "Model not available");
    }
}
