//! Usage analytics: provider adapters, incremental indexer and aggregation.
//!
//! ```text
//! UsageProvider
//!  ├── claude  (transcripts under <CLAUDE_CONFIG_DIR>/projects)
//!  └── codex   (rollouts under <CODEX_HOME>/sessions)
//! ```
//!
//! Files are read strictly read-only and incrementally (byte offsets in `indexed_files`).
//! Only numeric usage + model/session/cwd identifiers are stored — never message content.

pub mod aggregate;
pub mod claude;
pub mod codex;

use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::db::Db;
use crate::error::AppResult;
use crate::store::Account;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageRecord {
    pub dedup_key: String,
    pub provider: String,
    pub account_id: Option<String>,
    pub provider_session_id: Option<String>,
    pub project_path: Option<String>,
    /// Unix epoch milliseconds, UTC.
    pub ts: i64,
    pub model: Option<String>,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
    pub reasoning_tokens: i64,
    pub source: String,
    /// "measured" (read from provider logs) or "estimated".
    pub confidence: String,
}

/// Parse RFC 3339 / ISO 8601 timestamps (any offset) into UTC epoch ms.
pub fn parse_ts(s: &str) -> Option<i64> {
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        return Some(dt.timestamp_millis());
    }
    // Naive timestamps without offset are treated as UTC.
    chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.f")
        .ok()
        .map(|n| n.and_utc().timestamp_millis())
}

pub fn upsert(c: &Connection, r: &UsageRecord) -> AppResult<()> {
    c.execute(
        "INSERT INTO usage_records(dedup_key,provider,account_id,provider_session_id,project_path,ts,model,
            input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,reasoning_tokens,source,confidence)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)
         ON CONFLICT(dedup_key) DO UPDATE SET
            input_tokens=MAX(input_tokens,excluded.input_tokens),
            output_tokens=MAX(output_tokens,excluded.output_tokens),
            cache_read_tokens=MAX(cache_read_tokens,excluded.cache_read_tokens),
            cache_write_tokens=MAX(cache_write_tokens,excluded.cache_write_tokens),
            reasoning_tokens=MAX(reasoning_tokens,excluded.reasoning_tokens),
            model=COALESCE(excluded.model, model)",
        params![
            r.dedup_key, r.provider, r.account_id, r.provider_session_id, r.project_path, r.ts, r.model,
            r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_write_tokens, r.reasoning_tokens,
            r.source, r.confidence
        ],
    )?;
    Ok(())
}

pub fn insert_quota(
    c: &Connection,
    account_id: &str,
    provider: &str,
    w: &codex::RateWindow,
    source: &str,
    captured_at: i64,
) -> AppResult<bool> {
    // Skip if we already have an equal-or-newer snapshot for this window.
    let latest: Option<(i64, f64, Option<i64>)> = c
        .query_row(
            "SELECT captured_at, used_percent, resets_at FROM quota_snapshots
             WHERE account_id=?1 AND window=?2 ORDER BY captured_at DESC LIMIT 1",
            params![account_id, w.name],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    if let Some((ts, pct, resets)) = latest {
        if ts >= captured_at || (pct == w.used_percent && resets == w.resets_at && captured_at - ts < 5 * 60_000) {
            return Ok(false);
        }
    }
    c.execute(
        "INSERT INTO quota_snapshots(account_id,provider,window,used_percent,window_minutes,resets_at,source,captured_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
        params![account_id, provider, w.name, w.used_percent, w.window_minutes, w.resets_at, source, captured_at],
    )?;
    Ok(true)
}

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexReport {
    pub files_seen: usize,
    pub files_read: usize,
    pub records: usize,
    pub bytes_read: u64,
    pub errors: Vec<String>,
}

fn files_for(account: &Account) -> Vec<PathBuf> {
    let base = Path::new(&account.config_dir);
    let roots: Vec<PathBuf> = match account.provider.as_str() {
        "claude" => vec![base.join("projects")],
        _ => vec![base.join("sessions"), base.join("archived_sessions")],
    };
    let mut out = Vec::new();
    for root in roots {
        if !root.is_dir() {
            continue;
        }
        for e in walkdir::WalkDir::new(&root).max_depth(6).into_iter().flatten() {
            let p = e.path();
            if !e.file_type().is_file() || p.extension().and_then(|x| x.to_str()) != Some("jsonl") {
                continue;
            }
            if account.provider == "codex"
                && !p.file_name().and_then(|n| n.to_str()).unwrap_or("").starts_with("rollout-")
            {
                continue;
            }
            out.push(p.to_path_buf());
        }
    }
    out
}

struct FileRow {
    size: i64,
    mtime: i64,
    offset: i64,
    state: String,
}

fn mtime_ms(m: &std::fs::Metadata) -> i64 {
    m.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Read complete lines appended since `offset`. Returns (text, new offset).
pub fn read_new_lines(path: &Path, offset: u64) -> std::io::Result<(String, u64)> {
    let mut f = std::fs::File::open(path)?;
    f.seek(SeekFrom::Start(offset))?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf)?;
    let end = match buf.iter().rposition(|b| *b == b'\n') {
        Some(i) => i + 1,
        None => 0, // no complete line yet
    };
    buf.truncate(end);
    Ok((String::from_utf8_lossy(&buf).into_owned(), offset + end as u64))
}

/// Incrementally index all accounts. DB lock is held only for short write transactions.
pub fn index_accounts(db: &Db, accounts: &[Account]) -> IndexReport {
    let mut rep = IndexReport::default();
    for acc in accounts {
        let mut latest_rl: Option<(i64, Vec<codex::RateWindow>)> = None;
        for path in files_for(acc) {
            rep.files_seen += 1;
            let key = path.to_string_lossy().into_owned();
            let Ok(meta) = std::fs::metadata(&path) else { continue };
            let (size, mtime) = (meta.len() as i64, mtime_ms(&meta));
            let prev: Option<FileRow> = db
                .0
                .lock()
                .query_row(
                    "SELECT size, mtime, offset, state FROM indexed_files WHERE path=?1",
                    [&key],
                    |r| Ok(FileRow { size: r.get(0)?, mtime: r.get(1)?, offset: r.get(2)?, state: r.get(3)? }),
                )
                .optional()
                .ok()
                .flatten();
            if let Some(p) = &prev {
                if p.size == size && p.mtime == mtime {
                    continue;
                }
            }
            // A file that shrank was rewritten: start over (dedup keys prevent double counting).
            let (offset, state) = match prev {
                Some(p) if p.offset <= size => (p.offset as u64, p.state),
                _ => (0, "{}".to_string()),
            };
            let (text, new_offset) = match read_new_lines(&path, offset) {
                Ok(x) => x,
                Err(e) => {
                    rep.errors.push(format!("{key}: {e}"));
                    continue;
                }
            };
            rep.files_read += 1;
            rep.bytes_read += new_offset - offset;

            let mut records = Vec::new();
            let new_state = if acc.provider == "claude" {
                for line in text.lines() {
                    if let Some(mut r) = claude::parse_line(line) {
                        r.account_id = Some(acc.id.clone());
                        records.push(r);
                    }
                }
                "{}".to_string()
            } else {
                let mut st: codex::FileState = serde_json::from_str(&state).unwrap_or_default();
                for line in text.lines() {
                    if let Some((ts, w)) = codex::rate_limits_of(line) {
                        if latest_rl.as_ref().map(|(t, _)| ts > *t).unwrap_or(true) {
                            latest_rl = Some((ts, w));
                        }
                    }
                    if let Some(codex::Event::Usage(mut r)) = codex::parse_line(line, &mut st) {
                        r.account_id = Some(acc.id.clone());
                        records.push(r);
                    }
                }
                serde_json::to_string(&st).unwrap_or_else(|_| "{}".into())
            };

            let mut conn = db.0.lock();
            let res: AppResult<()> = (|| {
                let tx = conn.transaction()?;
                for r in &records {
                    upsert(&tx, r)?;
                }
                tx.execute(
                    "INSERT INTO indexed_files(path,account_id,size,mtime,offset,state) VALUES(?1,?2,?3,?4,?5,?6)
                     ON CONFLICT(path) DO UPDATE SET size=excluded.size, mtime=excluded.mtime,
                        offset=excluded.offset, state=excluded.state, account_id=excluded.account_id",
                    params![key, acc.id, size, mtime, new_offset as i64, new_state],
                )?;
                tx.commit()?;
                Ok(())
            })();
            match res {
                Ok(()) => rep.records += records.len(),
                Err(e) => rep.errors.push(format!("{key}: {e}")),
            }
        }
        if let Some((ts, windows)) = latest_rl {
            let conn = db.0.lock();
            for w in &windows {
                let _ = insert_quota(&conn, &acc.id, &acc.provider, w, "codex-rollout", ts);
            }
        }
    }
    rep
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use std::io::Write;

    #[test]
    fn timestamps_normalize_to_utc() {
        assert_eq!(parse_ts("2026-09-14T06:21:24Z"), Some(1_789_366_884_000));
        assert_eq!(parse_ts("2026-09-14T08:21:24+02:00"), Some(1_789_366_884_000));
        assert_eq!(parse_ts("2026-09-14T06:21:24.500"), Some(1_789_366_884_500));
        assert_eq!(parse_ts("yesterday"), None);
    }

    fn account(provider: &str, dir: &Path) -> Account {
        Account {
            id: format!("acc-{provider}"),
            provider: provider.into(),
            name: provider.into(),
            config_dir: dir.to_string_lossy().into_owned(),
            managed: true,
            color: None,
            auth_status: "unknown".into(),
            auth_detail: None,
            auth_checked_at: None,
            last_used_at: None,
            created_at: "t".into(),
            sort: 0,
            command: None,
        }
    }

    fn claude_line(msg: &str, req: &str, out: i64) -> String {
        format!(
            r#"{{"type":"assistant","sessionId":"s1","cwd":"C:/w","requestId":"{req}","uuid":"u-{msg}-{out}","timestamp":"2026-09-26T10:00:00Z","message":{{"id":"{msg}","model":"claude-x","usage":{{"input_tokens":10,"output_tokens":{out},"cache_read_input_tokens":100,"cache_creation_input_tokens":5}}}}}}"#
        )
    }

    #[test]
    fn incremental_indexing_dedups_and_handles_partial_lines() {
        let dir = tempfile::tempdir().unwrap();
        let proj = dir.path().join("projects").join("C--w");
        std::fs::create_dir_all(&proj).unwrap();
        let file = proj.join("s1.jsonl");
        let mut f = std::fs::File::create(&file).unwrap();
        // Same message written three times (one per content block) + a malformed line.
        writeln!(f, "{}", claude_line("m1", "r1", 7)).unwrap();
        writeln!(f, "{}", claude_line("m1", "r1", 7)).unwrap();
        writeln!(f, "{{broken json").unwrap();
        writeln!(f, "{}", claude_line("m1", "r1", 7)).unwrap();
        // Partial line (writer mid-flush) must not be consumed yet.
        write!(f, "{}", &claude_line("m2", "r2", 20)[..40]).unwrap();
        drop(f);

        let db = Db::new(open_in_memory().unwrap());
        let acc = account("claude", dir.path());
        let rep = index_accounts(&db, &[acc.clone()]);
        assert_eq!(rep.files_read, 1);
        let count = |db: &Db| -> (i64, i64) {
            db.0.lock()
                .query_row("SELECT COUNT(*), COALESCE(SUM(output_tokens),0) FROM usage_records", [], |r| Ok((r.get(0)?, r.get(1)?)))
                .unwrap()
        };
        assert_eq!(count(&db), (1, 7));

        // Unchanged file: skipped entirely.
        let rep = index_accounts(&db, &[acc.clone()]);
        assert_eq!(rep.files_read, 0);

        // Complete the partial line and append another message.
        let mut f = std::fs::OpenOptions::new().append(true).open(&file).unwrap();
        writeln!(f, "{}", &claude_line("m2", "r2", 20)[40..]).unwrap();
        writeln!(f, "{}", claude_line("m3", "r3", 1)).unwrap();
        drop(f);
        index_accounts(&db, &[acc.clone()]);
        assert_eq!(count(&db), (3, 28));

        // Full re-index from scratch (e.g. file rewritten) does not double count.
        db.0.lock().execute("DELETE FROM indexed_files", []).unwrap();
        index_accounts(&db, &[acc]);
        assert_eq!(count(&db), (3, 28));
    }

    #[test]
    fn codex_indexing_records_usage_and_quota() {
        let dir = tempfile::tempdir().unwrap();
        let day = dir.path().join("sessions/2026/09/14");
        std::fs::create_dir_all(&day).unwrap();
        let mut f = std::fs::File::create(day.join("rollout-2026-09-14T08-20-19-abc.jsonl")).unwrap();
        writeln!(f, r#"{{"timestamp":"2026-09-14T06:21:24Z","type":"session_meta","payload":{{"id":"abc","cwd":"C:/w"}}}}"#).unwrap();
        writeln!(f, r#"{{"timestamp":"2026-09-14T06:22:00Z","type":"event_msg","payload":{{"type":"token_count","info":{{"total_token_usage":{{"input_tokens":100,"cached_input_tokens":40,"output_tokens":10}}}},"rate_limits":{{"primary":{{"used_percent":33.0,"window_minutes":300,"resets_at":1789380000}}}}}}}}"#).unwrap();
        // Non-rollout jsonl files are ignored.
        std::fs::write(day.join("other.jsonl"), "{}\n").unwrap();
        drop(f);
        let db = Db::new(open_in_memory().unwrap());
        index_accounts(&db, &[account("codex", dir.path())]);
        let c = db.0.lock();
        let (i, cr): (i64, i64) = c.query_row("SELECT input_tokens, cache_read_tokens FROM usage_records", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((i, cr), (60, 40));
        let pct: f64 = c.query_row("SELECT used_percent FROM quota_snapshots WHERE window='five_hour'", [], |r| r.get(0)).unwrap();
        assert_eq!(pct, 33.0);
    }

    #[test]
    fn quota_snapshots_are_not_duplicated() {
        let c = open_in_memory().unwrap();
        let w = codex::RateWindow { name: "five_hour".into(), used_percent: 10.0, window_minutes: Some(300), resets_at: Some(1) };
        assert!(insert_quota(&c, "a", "codex", &w, "t", 1000).unwrap());
        assert!(!insert_quota(&c, "a", "codex", &w, "t", 1000).unwrap(), "same timestamp");
        assert!(!insert_quota(&c, "a", "codex", &w, "t", 2000).unwrap(), "unchanged value shortly after");
        assert!(!insert_quota(&c, "a", "codex", &w, "t", 500).unwrap(), "older");
        let w2 = codex::RateWindow { used_percent: 11.0, ..w };
        assert!(insert_quota(&c, "a", "codex", &w2, "t", 3000).unwrap());
    }
}
