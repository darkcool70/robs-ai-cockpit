//! Read-only parser for Claude Code transcripts (`<config>/projects/<cwd>/<session>.jsonl`).
//!
//! The format is internal to Claude Code and may change; unknown lines are skipped, never
//! fatal. Claude writes one line per content block with the *same* `message.usage`, so records
//! are keyed by `message.id` + `requestId` and upserted.

use serde_json::Value;

use super::{parse_ts, UsageRecord};

pub fn parse_line(line: &str) -> Option<UsageRecord> {
    let v: Value = serde_json::from_str(line).ok()?;
    if v.get("type")?.as_str()? != "assistant" {
        return None;
    }
    let msg = v.get("message")?;
    let usage = msg.get("usage")?;
    let n = |k: &str| usage.get(k).and_then(|x| x.as_i64()).unwrap_or(0).max(0);
    let input = n("input_tokens");
    let output = n("output_tokens");
    let cache_read = n("cache_read_input_tokens");
    let cache_write = n("cache_creation_input_tokens");
    let reasoning = usage
        .pointer("/output_tokens_details/thinking_tokens")
        .and_then(|x| x.as_i64())
        .unwrap_or(0)
        .max(0);
    if input + output + cache_read + cache_write == 0 {
        return None;
    }
    let model = msg.get("model").and_then(|m| m.as_str()).map(str::to_string);
    // Claude Code writes placeholder entries for locally generated messages.
    if model.as_deref() == Some("<synthetic>") {
        return None;
    }
    let ts = parse_ts(v.get("timestamp")?.as_str()?)?;
    let session = v.get("sessionId").and_then(|s| s.as_str()).map(str::to_string);
    let msg_id = msg.get("id").and_then(|s| s.as_str());
    let req_id = v.get("requestId").and_then(|s| s.as_str());
    let dedup = match (msg_id, req_id) {
        (Some(m), Some(r)) => format!("claude:{m}:{r}"),
        (Some(m), None) => format!("claude:{m}"),
        // Fall back to the line uuid (unique per line, so no cross-line dedup possible).
        _ => format!("claude:uuid:{}", v.get("uuid")?.as_str()?),
    };
    Some(UsageRecord {
        dedup_key: dedup,
        provider: "claude".into(),
        account_id: None,
        provider_session_id: session,
        project_path: v.get("cwd").and_then(|s| s.as_str()).map(str::to_string),
        ts,
        model,
        input_tokens: input,
        output_tokens: output,
        cache_read_tokens: cache_read,
        cache_write_tokens: cache_write,
        reasoning_tokens: reasoning,
        source: "claude-transcript".into(),
        confidence: "measured".into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const LINE: &str = r#"{"type":"assistant","sessionId":"s1","cwd":"C:\\work\\app","requestId":"req_1","uuid":"u1","timestamp":"2026-09-26T17:54:24.483Z","message":{"id":"msg_1","model":"claude-opus-5-5","usage":{"input_tokens":2,"cache_creation_input_tokens":21329,"cache_read_input_tokens":39591,"output_tokens":306,"output_tokens_details":{"thinking_tokens":55}}}}"#;

    #[test]
    fn parses_usage_line() {
        let r = parse_line(LINE).unwrap();
        assert_eq!(r.dedup_key, "claude:msg_1:req_1");
        assert_eq!(r.input_tokens, 2);
        assert_eq!(r.cache_write_tokens, 21329);
        assert_eq!(r.cache_read_tokens, 39591);
        assert_eq!(r.output_tokens, 306);
        assert_eq!(r.reasoning_tokens, 55);
        assert_eq!(r.model.as_deref(), Some("claude-opus-5-5"));
        assert_eq!(r.project_path.as_deref(), Some(r"C:\work\app"));
        assert_eq!(r.ts, 1_790_445_264_483);
        assert_eq!(r.confidence, "measured");
    }

    #[test]
    fn skips_non_usage_and_malformed_lines() {
        assert!(parse_line(r#"{"type":"user","message":{"content":"hi"}}"#).is_none());
        assert!(parse_line("{not json").is_none());
        assert!(parse_line("").is_none());
        assert!(parse_line(r#"{"type":"assistant","message":{"usage":{"input_tokens":1}}}"#).is_none(), "no timestamp");
        assert!(parse_line(r#"{"type":"assistant","timestamp":"2026-01-01T00:00:00Z","uuid":"x","message":{"model":"<synthetic>","usage":{"input_tokens":5}}}"#).is_none());
        assert!(parse_line(r#"{"type":"assistant","timestamp":"2026-01-01T00:00:00Z","uuid":"x","message":{"usage":{"input_tokens":0,"output_tokens":0}}}"#).is_none());
    }

    #[test]
    fn negative_values_are_clamped() {
        let l = r#"{"type":"assistant","timestamp":"2026-01-01T00:00:00Z","uuid":"x","message":{"usage":{"input_tokens":-5,"output_tokens":3}}}"#;
        let r = parse_line(l).unwrap();
        assert_eq!(r.input_tokens, 0);
        assert_eq!(r.dedup_key, "claude:uuid:x");
    }
}
