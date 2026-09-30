//! Heuristic detection of provider states from terminal output.
//!
//! This is deliberately conservative: it only flags phrases the official CLIs print for
//! limits / auth problems. Results are shown to the user as *detected* states, never used to
//! silently switch accounts.

use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;

static ANSI: Lazy<Regex> = Lazy::new(|| {
    // CSI, OSC (BEL or ST terminated), and single-char escapes.
    Regex::new(r"\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]").unwrap()
});

pub fn strip_ansi(s: &str) -> String {
    ANSI.replace_all(s, "").into_owned()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Signal {
    RateLimited,
    ApproachingLimit,
    AuthRequired,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detection {
    pub signal: Signal,
    /// The matched line, trimmed (for display).
    pub text: String,
    /// Reset hint as printed by the CLI, e.g. "9pm (Europe/Berlin)".
    pub reset_hint: Option<String>,
}

static RATE_LIMITED: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)(usage limit reached|you(?:'|’)?ve hit your (?:[\w-]+ ){0,2}limit|you have hit your (?:[\w-]+ ){0,2}limit|limit reached.{0,40}resets|rate[- ]limit(ed)? (exceeded|reached)|out of (extra )?usage|(5-hour|weekly|session) limit reached)",
    )
    .unwrap()
});
static APPROACHING: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(approaching (your )?(usage |weekly |5-hour )?limit|you've used \d{2,3}% of your|close to (your )?(usage |weekly )?limit)").unwrap()
});
static AUTH: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)(please run /login|not logged in|invalid api key|oauth token (has )?expired|authentication_error|please (log|sign) in again|run `?codex login`?)",
    )
    .unwrap()
});
static RESET: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)resets?( at| in)? ([0-9][0-9:apm\s.]*(\([^)]*\))?|[A-Z][a-z]{2,8}\s[0-9]{1,2}(,? [0-9:apm\s]+)?)").unwrap()
});

/// Scan a chunk of (already ANSI-stripped) text. Returns the most severe detection.
pub fn scan(text: &str) -> Option<Detection> {
    let mut best: Option<Detection> = None;
    for line in text.lines() {
        let l = line.trim();
        if l.is_empty() || l.len() > 400 {
            continue;
        }
        let sig = if RATE_LIMITED.is_match(l) {
            Signal::RateLimited
        } else if AUTH.is_match(l) {
            Signal::AuthRequired
        } else if APPROACHING.is_match(l) {
            Signal::ApproachingLimit
        } else {
            continue;
        };
        let reset_hint = RESET
            .captures(l)
            .and_then(|c| c.get(2))
            .map(|m| m.as_str().trim().to_string())
            .filter(|s| !s.is_empty());
        let d = Detection { signal: sig, text: l.chars().take(200).collect(), reset_hint };
        let rank = |s: &Signal| match s {
            Signal::RateLimited => 3,
            Signal::AuthRequired => 2,
            Signal::ApproachingLimit => 1,
        };
        if best.as_ref().map(|b| rank(&d.signal) > rank(&b.signal)).unwrap_or(true) {
            best = Some(d);
        }
    }
    best
}

static RESET_REL: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?:resets?|try again|available again)\s+in\s+(?:(\d+)\s*(?:h|hr|hrs|hours?)\b)?\s*(?:(\d+)\s*(?:m|min|mins|minutes?)\b)?").unwrap()
});
static RESET_DATE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?m?\b").unwrap()
});
static RESET_TIME: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?:resets?|reset at|try again|available again)(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?(m)?\b").unwrap()
});

fn local_at(date: chrono::NaiveDate, h: u32, m: u32) -> Option<chrono::DateTime<chrono::Local>> {
    use chrono::TimeZone;
    let t = chrono::NaiveTime::from_hms_opt(h, m, 0)?;
    chrono::Local.from_local_datetime(&date.and_time(t)).earliest()
}

fn hour24(h: u32, ampm: Option<&str>) -> Option<u32> {
    match ampm.map(|s| s.to_ascii_lowercase()) {
        Some(p) if p == "a" => (1..=12).contains(&h).then_some(h % 12),
        Some(p) if p == "p" => (1..=12).contains(&h).then_some(h % 12 + 12),
        _ => (h < 24).then_some(h),
    }
}

/// Absolute reset time (epoch ms) parsed from a limit message printed by a CLI, e.g.
/// "resets 9pm (Europe/Berlin)", "try again at Sep 27, 9:14 PM", "resets in 2h 13m".
/// Times without a zone are read as local time (the CLIs print the user's zone).
pub fn reset_at_ms(text: &str, now: chrono::DateTime<chrono::Local>) -> Option<i64> {
    use chrono::Datelike;
    if let Some(c) = RESET_REL.captures(text) {
        let h: i64 = c.get(1).and_then(|m| m.as_str().parse().ok()).unwrap_or(0);
        let m: i64 = c.get(2).and_then(|m| m.as_str().parse().ok()).unwrap_or(0);
        if h > 0 || m > 0 {
            return Some(now.timestamp_millis() + (h * 60 + m) * 60_000);
        }
    }
    if let Some(c) = RESET_DATE.captures(text) {
        const MONTHS: [&str; 12] = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
        let month = MONTHS.iter().position(|x| c[1].eq_ignore_ascii_case(x))? as u32 + 1;
        let day: u32 = c[2].parse().ok()?;
        let hour = hour24(c[3].parse().ok()?, c.get(5).map(|m| m.as_str()))?;
        let min: u32 = c.get(4).and_then(|m| m.as_str().parse().ok()).unwrap_or(0);
        let mut at = local_at(chrono::NaiveDate::from_ymd_opt(now.year(), month, day)?, hour, min)?;
        if at < now - chrono::Duration::days(2) {
            at = local_at(chrono::NaiveDate::from_ymd_opt(now.year() + 1, month, day)?, hour, min)?;
        }
        return Some(at.timestamp_millis());
    }
    for c in RESET_TIME.captures_iter(text) {
        let ampm = c.get(3).map(|m| m.as_str());
        // A bare number ("resets 3") is too ambiguous; need minutes or am/pm.
        if c.get(2).is_none() && ampm.is_none() {
            continue;
        }
        let hour = hour24(c[1].parse().ok()?, ampm)?;
        let min: u32 = c.get(2).and_then(|m| m.as_str().parse().ok()).unwrap_or(0);
        let mut at = local_at(now.date_naive(), hour, min)?;
        if at <= now {
            at = local_at(now.date_naive() + chrono::Duration::days(1), hour, min)?;
        }
        return Some(at.timestamp_millis());
    }
    None
}

static URL: Lazy<Regex> = Lazy::new(|| Regex::new(r#"https://[^\s"'<>\x1b]+"#).unwrap());

/// Official login pages a login terminal may print. Used to offer "open in a private window".
pub fn login_url(text: &str) -> Option<String> {
    URL.find_iter(text)
        // A match touching the end of the text may still be arriving in the next read.
        .filter(|m| m.end() < text.len())
        .map(|m| m.as_str().trim_end_matches(['.', ',', ')', ']']).to_string())
        .find(|u| crate::login_browser::allowed_url(u))
}

/// Incremental UTF-8 decoder: PTY reads can split multi-byte sequences.
#[derive(Default)]
pub struct Utf8Stream {
    pending: Vec<u8>,
}

impl Utf8Stream {
    pub fn push(&mut self, bytes: &[u8]) -> String {
        self.pending.extend_from_slice(bytes);
        let valid_up_to = match std::str::from_utf8(&self.pending) {
            Ok(_) => self.pending.len(),
            Err(e) => {
                if e.error_len().is_some() {
                    // Genuinely invalid bytes: decode lossily and reset.
                    let s = String::from_utf8_lossy(&self.pending).into_owned();
                    self.pending.clear();
                    return s;
                }
                e.valid_up_to()
            }
        };
        let rest = self.pending.split_off(valid_up_to);
        let s = String::from_utf8(std::mem::replace(&mut self.pending, rest)).unwrap_or_default();
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_ansi_sequences() {
        let s = "\x1b[1;31mError\x1b[0m done \x1b]0;title\x07ok";
        assert_eq!(strip_ansi(s), "Error done ok");
    }

    #[test]
    fn detects_claude_limit_with_reset() {
        let d = scan("  Claude usage limit reached. Your limit will reset at 9pm (Europe/Berlin).").unwrap();
        assert_eq!(d.signal, Signal::RateLimited);
        assert_eq!(d.reset_hint.as_deref(), Some("9pm (Europe/Berlin)"));
        let d = scan("5-hour limit reached ∙ resets 3am").unwrap();
        assert_eq!(d.signal, Signal::RateLimited);
        assert_eq!(d.reset_hint.as_deref(), Some("3am"));
    }

    #[test]
    fn detects_claude_weekly_limit_and_reset_date() {
        // Claude Code 2.1.28x: "You've hit your weekly limit · resets Oct 2, 11am (Europe/Berlin)".
        for line in ["  L You've hit your weekly limit · resets Oct 2, 11am (Europe/Berlin)", "You’ve hit your Opus limit · resets 3am"] {
            assert_eq!(scan(line).unwrap().signal, Signal::RateLimited, "{line}");
        }
        use chrono::TimeZone;
        let now = chrono::Local.with_ymd_and_hms(2026, 9, 30, 20, 0, 0).unwrap();
        let at = reset_at_ms("You've hit your weekly limit · resets Oct 2, 11am (Europe/Berlin)", now).unwrap();
        assert_eq!(at, chrono::Local.with_ymd_and_hms(2026, 10, 2, 11, 0, 0).unwrap().timestamp_millis());
    }

    #[test]
    fn detects_codex_limit() {
        let d = scan("■ You've hit your usage limit. Upgrade to Pro or try again at Sep 27, 9:14 PM.").unwrap();
        assert_eq!(d.signal, Signal::RateLimited);
    }

    #[test]
    fn detects_auth_and_approaching() {
        assert_eq!(scan("Invalid API key · Please run /login").unwrap().signal, Signal::AuthRequired);
        assert_eq!(scan("Approaching usage limit · resets at 5pm").unwrap().signal, Signal::ApproachingLimit);
    }

    #[test]
    fn ignores_normal_output_and_prefers_severe() {
        assert!(scan("Reading src/rate_limit.rs\nAll 42 tests passed").is_none());
        let d = scan("Approaching usage limit\nClaude usage limit reached").unwrap();
        assert_eq!(d.signal, Signal::RateLimited);
    }

    fn local(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> chrono::DateTime<chrono::Local> {
        use chrono::TimeZone;
        chrono::Local.with_ymd_and_hms(y, mo, d, h, mi, 0).earliest().unwrap()
    }

    #[test]
    fn reset_times_are_parsed() {
        let now = local(2026, 9, 26, 18, 0);
        let at = |s: &str| reset_at_ms(s, now).map(|ms| chrono::DateTime::from_timestamp_millis(ms).unwrap().with_timezone(&chrono::Local));
        assert_eq!(at("You've hit your limit · resets 9pm (Europe/Berlin)"), Some(local(2026, 9, 26, 21, 0)));
        assert_eq!(at("5-hour limit reached ∙ resets 3am"), Some(local(2026, 9, 27, 3, 0)), "earlier time means tomorrow");
        assert_eq!(at("Claude usage limit reached. Your limit will reset at 9:30 pm."), Some(local(2026, 9, 26, 21, 30)));
        assert_eq!(at("■ You've hit your usage limit. Upgrade to Pro or try again at Sep 27, 9:14 PM."), Some(local(2026, 9, 27, 21, 14)));
        assert_eq!(at("limit reached · resets in 2h 13m"), Some(local(2026, 9, 26, 20, 13)));
        assert_eq!(at("try again in 45 minutes"), Some(local(2026, 9, 26, 18, 45)));
        assert_eq!(at("resets 17:05"), Some(local(2026, 9, 27, 17, 5)));
        assert_eq!(at("Usage limit reached, resets 3"), None, "bare hour is ambiguous");
        assert_eq!(at("nothing here"), None);
    }

    #[test]
    fn login_urls_only_for_official_hosts() {
        let out = "If your browser did not open, navigate to this URL to authenticate: https://auth.openai.com/oauth/authorize?client_id=x&state=y\r\n";
        assert_eq!(login_url(out).as_deref(), Some("https://auth.openai.com/oauth/authorize?client_id=x&state=y"));
        assert_eq!(login_url("visit https://claude.com/cai/oauth/authorize?code=true.\n").as_deref(), Some("https://claude.com/cai/oauth/authorize?code=true"));
        assert!(login_url("see https://evil.example/claude.ai and http://claude.ai/x ").is_none());
        assert!(login_url("https://auth.openai.com/oauth/authorize?client_id=partial").is_none(), "incomplete read");
    }

    #[test]
    fn utf8_stream_handles_split_sequences() {
        let bytes = "ä→✓".as_bytes();
        let mut s = Utf8Stream::default();
        let mut out = String::new();
        for b in bytes {
            out.push_str(&s.push(&[*b]));
        }
        assert_eq!(out, "ä→✓");
    }
}
