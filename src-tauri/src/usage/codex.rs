//! Read-only parser for Codex rollout logs (`<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-*.jsonl`).
//!
//! `event_msg/token_count` carries cumulative `total_token_usage`; the same total is often
//! re-emitted. We therefore record the *delta* of the cumulative total, tracked per file.
//! OpenAI semantics: `cached_input_tokens` ⊂ `input_tokens` and
//! `reasoning_output_tokens` ⊂ `output_tokens`; we normalise input to the non-cached part so
//! totals are comparable with Claude, and keep reasoning as an "of which" figure.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{parse_ts, UsageRecord};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Totals {
    pub input: i64,
    pub cached: i64,
    pub cache_write: i64,
    pub output: i64,
    pub reasoning: i64,
}

impl Totals {
    fn from(v: &Value) -> Option<Totals> {
        let n = |k: &str| v.get(k).and_then(|x| x.as_i64()).unwrap_or(0).max(0);
        if !v.is_object() {
            return None;
        }
        Some(Totals {
            input: n("input_tokens"),
            cached: n("cached_input_tokens"),
            cache_write: n("cache_write_input_tokens"),
            output: n("output_tokens"),
            reasoning: n("reasoning_output_tokens"),
        })
    }
    fn any_decreased(&self, prev: &Totals) -> bool {
        self.input < prev.input || self.cached < prev.cached || self.output < prev.output
            || self.reasoning < prev.reasoning || self.cache_write < prev.cache_write
    }
    fn minus(&self, p: &Totals) -> Totals {
        Totals {
            input: self.input - p.input,
            cached: self.cached - p.cached,
            cache_write: self.cache_write - p.cache_write,
            output: self.output - p.output,
            reasoning: self.reasoning - p.reasoning,
        }
    }
    fn is_zero(&self) -> bool {
        self.input == 0 && self.output == 0 && self.cached == 0 && self.cache_write == 0
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FileState {
    pub session_id: Option<String>,
    pub cwd: Option<String>,
    pub model: Option<String>,
    pub prev: Option<Totals>,
    pub seq: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RateWindow {
    pub name: String,
    pub used_percent: f64,
    pub window_minutes: Option<i64>,
    pub resets_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    Usage(UsageRecord),
    RateLimits { ts: i64, windows: Vec<RateWindow> },
    TaskStarted(i64),
    TaskComplete(i64),
    Meta,
}

pub fn parse_rate_limits(rl: &Value) -> Vec<RateWindow> {
    let mut out = Vec::new();
    for key in ["primary", "secondary"] {
        if let Some(w) = rl.get(key).filter(|w| w.is_object()) {
            let Some(pct) = w.get("used_percent").and_then(|x| x.as_f64()) else { continue };
            let mins = w.get("window_minutes").and_then(|x| x.as_i64());
            let resets_at = w
                .get("resets_at")
                .and_then(|x| x.as_i64())
                .or_else(|| {
                    // Older builds reported a relative value.
                    w.get("resets_in_seconds").and_then(|x| x.as_i64()).map(|s| chrono::Utc::now().timestamp() + s)
                });
            let name = match mins {
                Some(300) => "five_hour".to_string(),
                Some(10080) => "seven_day".to_string(),
                Some(m) => format!("{m}m"),
                None => key.to_string(),
            };
            out.push(RateWindow { name, used_percent: pct.clamp(0.0, 100.0), window_minutes: mins, resets_at });
        }
    }
    out
}

pub fn parse_line(line: &str, st: &mut FileState) -> Option<Event> {
    let v: Value = serde_json::from_str(line).ok()?;
    let ty = v.get("type")?.as_str()?;
    let payload = v.get("payload")?;
    let ts = v.get("timestamp").and_then(|t| t.as_str()).and_then(parse_ts);
    match ty {
        "session_meta" => {
            st.session_id = payload.get("id").or_else(|| payload.get("session_id")).and_then(|x| x.as_str()).map(str::to_string);
            st.cwd = payload.get("cwd").and_then(|x| x.as_str()).map(str::to_string);
            Some(Event::Meta)
        }
        "turn_context" => {
            if let Some(m) = payload.get("model").and_then(|x| x.as_str()) {
                st.model = Some(m.to_string());
            }
            if let Some(c) = payload.get("cwd").and_then(|x| x.as_str()) {
                st.cwd.get_or_insert_with(|| c.to_string());
            }
            Some(Event::Meta)
        }
        "event_msg" => match payload.get("type")?.as_str()? {
            "task_started" => Some(Event::TaskStarted(ts?)),
            "task_complete" => Some(Event::TaskComplete(ts?)),
            "token_count" => {
                let ts = ts?;
                let info = payload.get("info").filter(|i| i.is_object());
                let total = info.and_then(|i| i.get("total_token_usage")).and_then(Totals::from);
                let usage_ev = total.and_then(|total| {
                    let delta = match &st.prev {
                        Some(prev) if !total.any_decreased(prev) => total.minus(prev),
                        // First event, or a reset (e.g. new thread in same file): use the
                        // per-turn figure rather than re-counting the whole total.
                        Some(_) => info
                            .and_then(|i| i.get("last_token_usage"))
                            .and_then(Totals::from)
                            .unwrap_or_default(),
                        None => total.clone(),
                    };
                    st.prev = Some(total);
                    if delta.is_zero() {
                        return None;
                    }
                    st.seq += 1;
                    let sid = st.session_id.clone().unwrap_or_default();
                    Some(UsageRecord {
                        dedup_key: format!("codex:{sid}:{ts}:{}", st.seq),
                        provider: "codex".into(),
                        account_id: None,
                        provider_session_id: st.session_id.clone(),
                        project_path: st.cwd.clone(),
                        ts,
                        model: st.model.clone(),
                        input_tokens: (delta.input - delta.cached).max(0),
                        output_tokens: delta.output.max(0),
                        cache_read_tokens: delta.cached.max(0),
                        cache_write_tokens: delta.cache_write.max(0),
                        reasoning_tokens: delta.reasoning.max(0),
                        source: "codex-rollout".into(),
                        confidence: "measured".into(),
                    })
                });
                if let Some(u) = usage_ev {
                    // Rate limits are picked up separately via `rate_limits_of`.
                    return Some(Event::Usage(u));
                }
                let windows = payload.get("rate_limits").map(parse_rate_limits).unwrap_or_default();
                if !windows.is_empty() {
                    return Some(Event::RateLimits { ts, windows });
                }
                None
            }
            _ => None,
        },
        _ => None,
    }
}

/// Rate-limit windows carried by a `token_count` line, if any.
pub fn rate_limits_of(line: &str) -> Option<(i64, Vec<RateWindow>)> {
    if !line.contains("\"rate_limits\"") {
        return None;
    }
    let v: Value = serde_json::from_str(line).ok()?;
    let ts = parse_ts(v.get("timestamp")?.as_str()?)?;
    let rl = v.pointer("/payload/rate_limits")?;
    let w = parse_rate_limits(rl);
    (!w.is_empty()).then_some((ts, w))
}

/// Peek at the first line of a rollout file to get (session id, cwd, start ms).
pub fn read_meta(first_line: &str) -> Option<(String, Option<String>, Option<i64>)> {
    let v: Value = serde_json::from_str(first_line).ok()?;
    if v.get("type")?.as_str()? != "session_meta" {
        return None;
    }
    let p = v.get("payload")?;
    let id = p.get("id").or_else(|| p.get("session_id"))?.as_str()?.to_string();
    let cwd = p.get("cwd").and_then(|x| x.as_str()).map(str::to_string);
    let ts = v.get("timestamp").and_then(|t| t.as_str()).and_then(parse_ts);
    Some((id, cwd, ts))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tc(ts: &str, input: i64, cached: i64, output: i64, reasoning: i64) -> String {
        format!(
            r#"{{"timestamp":"{ts}","type":"event_msg","payload":{{"type":"token_count","info":{{"total_token_usage":{{"input_tokens":{input},"cached_input_tokens":{cached},"output_tokens":{output},"reasoning_output_tokens":{reasoning},"total_tokens":0}},"last_token_usage":{{"input_tokens":7,"cached_input_tokens":0,"output_tokens":3,"reasoning_output_tokens":0}}}},"rate_limits":{{"primary":{{"used_percent":12.5,"window_minutes":300,"resets_at":1790000000}},"secondary":{{"used_percent":16.0,"window_minutes":10080,"resets_at":1790500000}}}}}}}}"#
        )
    }

    #[test]
    fn cumulative_totals_become_deltas_and_duplicates_are_ignored() {
        let mut st = FileState::default();
        parse_line(r#"{"timestamp":"2026-09-14T06:21:24.429Z","type":"session_meta","payload":{"id":"sess-1","cwd":"C:\\w"}}"#, &mut st);
        parse_line(r#"{"timestamp":"2026-09-14T06:21:25Z","type":"turn_context","payload":{"model":"gpt-6"}}"#, &mut st);

        let Some(Event::Usage(a)) = parse_line(&tc("2026-09-14T06:22:00Z", 1000, 800, 50, 10), &mut st) else { panic!() };
        assert_eq!((a.input_tokens, a.cache_read_tokens, a.output_tokens, a.reasoning_tokens), (200, 800, 50, 10));
        assert_eq!(a.model.as_deref(), Some("gpt-6"));
        assert_eq!(a.provider_session_id.as_deref(), Some("sess-1"));

        // Same total re-emitted: no usage, but rate limits still surface.
        match parse_line(&tc("2026-09-14T06:22:01Z", 1000, 800, 50, 10), &mut st) {
            Some(Event::RateLimits { windows, .. }) => {
                assert_eq!(windows[0].name, "five_hour");
                assert_eq!(windows[1].name, "seven_day");
                assert_eq!(windows[1].used_percent, 16.0);
            }
            other => panic!("{other:?}"),
        }

        let Some(Event::Usage(b)) = parse_line(&tc("2026-09-14T06:23:00Z", 1500, 1200, 80, 10), &mut st) else { panic!() };
        assert_eq!((b.input_tokens, b.cache_read_tokens, b.output_tokens), (100, 400, 30));
        assert_ne!(a.dedup_key, b.dedup_key);
    }

    #[test]
    fn reset_falls_back_to_last_usage() {
        let mut st = FileState::default();
        parse_line(&tc("2026-09-14T06:22:00Z", 1000, 0, 50, 0), &mut st);
        let Some(Event::Usage(r)) = parse_line(&tc("2026-09-14T06:23:00Z", 10, 0, 5, 0), &mut st) else { panic!() };
        assert_eq!((r.input_tokens, r.output_tokens), (7, 3));
    }

    #[test]
    fn state_survives_serialization_for_incremental_indexing() {
        let mut st = FileState::default();
        parse_line(&tc("2026-09-14T06:22:00Z", 1000, 0, 50, 0), &mut st);
        let json = serde_json::to_string(&st).unwrap();
        let mut st2: FileState = serde_json::from_str(&json).unwrap();
        let Some(Event::Usage(r)) = parse_line(&tc("2026-09-14T06:23:00Z", 1100, 0, 60, 0), &mut st2) else { panic!() };
        assert_eq!((r.input_tokens, r.output_tokens), (100, 10));
    }

    #[test]
    fn malformed_lines_are_ignored() {
        let mut st = FileState::default();
        assert!(parse_line("garbage", &mut st).is_none());
        assert!(parse_line(r#"{"type":"event_msg","payload":{"type":"token_count","info":null}}"#, &mut st).is_none());
        assert!(parse_line(r#"{"timestamp":"x","type":"event_msg","payload":{"type":"token_count","info":{}}}"#, &mut st).is_none());
    }

    #[test]
    fn task_events_and_meta() {
        let mut st = FileState::default();
        assert_eq!(
            parse_line(r#"{"timestamp":"2026-09-14T06:21:24Z","type":"event_msg","payload":{"type":"task_started"}}"#, &mut st),
            Some(Event::TaskStarted(1_789_366_884_000))
        );
        let m = read_meta(r#"{"timestamp":"2026-09-14T06:21:24.429Z","type":"session_meta","payload":{"id":"abc","cwd":"C:\\x"}}"#).unwrap();
        assert_eq!(m.0, "abc");
        assert_eq!(m.1.as_deref(), Some(r"C:\x"));
    }
}
