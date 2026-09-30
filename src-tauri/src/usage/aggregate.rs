//! Aggregations over `usage_records`. All grouping by day/hour uses local time.

use chrono::{Datelike, Local, TimeZone};
use rusqlite::{params_from_iter, Connection};
use serde::{Deserialize, Serialize};

use crate::error::AppResult;

#[derive(Debug, Default, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    pub input: i64,
    pub output: i64,
    pub cache_read: i64,
    pub cache_write: i64,
    pub reasoning: i64,
    pub total: i64,
    pub records: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub key: String,
    pub label: String,
    pub provider: Option<String>,
    pub totals: Totals,
    pub api_value_usd: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    pub key: String,
    pub total: i64,
    pub input: i64,
    pub output: i64,
    pub cache_read: i64,
    pub cache_write: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiValue {
    pub value_usd: f64,
    pub priced_tokens: i64,
    pub unpriced_models: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub range: String,
    pub from_ms: Option<i64>,
    pub totals: Totals,
    pub cache_hit_ratio: Option<f64>,
    pub by_account: Vec<Group>,
    pub by_provider: Vec<Group>,
    pub by_model: Vec<Group>,
    pub by_project: Vec<Group>,
    pub by_session: Vec<Group>,
    pub by_day: Vec<Point>,
    pub by_week: Vec<Point>,
    pub by_hour: Vec<Point>,
    pub api_value: ApiValue,
}

#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Filter {
    pub account_id: Option<String>,
    pub provider: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Price {
    pub model_pattern: String,
    pub input_per_mtok: f64,
    pub output_per_mtok: f64,
    pub cache_read_per_mtok: f64,
    pub cache_write_per_mtok: f64,
}

pub fn range_start(range: &str, now: chrono::DateTime<Local>) -> Option<i64> {
    let midnight = Local
        .with_ymd_and_hms(now.year(), now.month(), now.day(), 0, 0, 0)
        .earliest()
        .unwrap_or(now);
    match range {
        "today" => Some(midnight.timestamp_millis()),
        "7d" => Some((midnight - chrono::Duration::days(6)).timestamp_millis()),
        "30d" => Some((midnight - chrono::Duration::days(29)).timestamp_millis()),
        _ => None,
    }
}

const SUMS: &str = "COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0),
    COALESCE(SUM(cache_read_tokens),0), COALESCE(SUM(cache_write_tokens),0),
    COALESCE(SUM(reasoning_tokens),0), COUNT(*)";

fn totals_at(r: &rusqlite::Row, i: usize) -> rusqlite::Result<Totals> {
    let (input, output, cr, cw, rs, n): (i64, i64, i64, i64, i64, i64) =
        (r.get(i)?, r.get(i + 1)?, r.get(i + 2)?, r.get(i + 3)?, r.get(i + 4)?, r.get(i + 5)?);
    Ok(Totals { input, output, cache_read: cr, cache_write: cw, reasoning: rs, total: input + output + cr + cw, records: n })
}

struct Where {
    sql: String,
    args: Vec<rusqlite::types::Value>,
}

fn where_clause(from: Option<i64>, f: &Filter) -> Where {
    let mut parts = vec!["1=1".to_string()];
    let mut args: Vec<rusqlite::types::Value> = Vec::new();
    if let Some(ms) = from {
        args.push(ms.into());
        parts.push(format!("u.ts >= ?{}", args.len()));
    }
    if let Some(a) = f.account_id.clone().filter(|s| !s.is_empty()) {
        args.push(a.into());
        parts.push(format!("u.account_id = ?{}", args.len()));
    }
    if let Some(p) = f.provider.clone().filter(|s| !s.is_empty()) {
        args.push(p.into());
        parts.push(format!("u.provider = ?{}", args.len()));
    }
    Where { sql: parts.join(" AND "), args }
}

fn groups(c: &Connection, w: &Where, key: &str, label: &str, provider: &str, join: &str, limit: i64) -> AppResult<Vec<Group>> {
    let sql = format!(
        "SELECT {key} k, {label} l, {provider} p, {SUMS} FROM usage_records u {join}
         WHERE {} GROUP BY k ORDER BY (SUM(input_tokens)+SUM(output_tokens)+SUM(cache_read_tokens)+SUM(cache_write_tokens)) DESC
         LIMIT {limit}",
        w.sql
    );
    let mut st = c.prepare(&sql)?;
    let rows = st
        .query_map(params_from_iter(w.args.iter()), |r| {
            let k: Option<String> = r.get(0)?;
            let l: Option<String> = r.get(1)?;
            Ok(Group {
                key: k.clone().unwrap_or_else(|| "(unknown)".into()),
                label: l.or(k).unwrap_or_else(|| "(unknown)".into()),
                provider: r.get(2)?,
                totals: totals_at(r, 3)?,
                api_value_usd: None,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn series(c: &Connection, w: &Where, key: &str) -> AppResult<Vec<Point>> {
    let sql = format!("SELECT {key} k, {SUMS} FROM usage_records u WHERE {} GROUP BY k ORDER BY k", w.sql);
    let mut st = c.prepare(&sql)?;
    let rows = st
        .query_map(params_from_iter(w.args.iter()), |r| {
            let t = totals_at(r, 1)?;
            Ok(Point { key: r.get::<_, Option<String>>(0)?.unwrap_or_default(), total: t.total, input: t.input, output: t.output, cache_read: t.cache_read, cache_write: t.cache_write })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn list_prices(c: &Connection) -> AppResult<Vec<Price>> {
    let mut st = c.prepare("SELECT model_pattern,input_per_mtok,output_per_mtok,cache_read_per_mtok,cache_write_per_mtok FROM prices ORDER BY model_pattern")?;
    let rows = st
        .query_map([], |r| {
            Ok(Price { model_pattern: r.get(0)?, input_per_mtok: r.get(1)?, output_per_mtok: r.get(2)?, cache_read_per_mtok: r.get(3)?, cache_write_per_mtok: r.get(4)? })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn save_prices(c: &mut Connection, prices: &[Price]) -> AppResult<()> {
    let tx = c.transaction()?;
    tx.execute("DELETE FROM prices", [])?;
    for p in prices {
        let pat = p.model_pattern.trim().to_lowercase();
        if pat.is_empty() {
            continue;
        }
        tx.execute(
            "INSERT OR REPLACE INTO prices VALUES(?1,?2,?3,?4,?5)",
            rusqlite::params![pat, p.input_per_mtok.max(0.0), p.output_per_mtok.max(0.0), p.cache_read_per_mtok.max(0.0), p.cache_write_per_mtok.max(0.0)],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Longest matching pattern (case-insensitive substring) wins.
pub fn price_for<'a>(prices: &'a [Price], model: &str) -> Option<&'a Price> {
    let m = model.to_lowercase();
    prices
        .iter()
        .filter(|p| !p.model_pattern.is_empty() && m.contains(&p.model_pattern.to_lowercase()))
        .max_by_key(|p| p.model_pattern.len())
}

pub fn value_of(p: &Price, t: &Totals) -> f64 {
    (t.input as f64 * p.input_per_mtok
        + t.output as f64 * p.output_per_mtok
        + t.cache_read as f64 * p.cache_read_per_mtok
        + t.cache_write as f64 * p.cache_write_per_mtok)
        / 1_000_000.0
}

pub fn summary(c: &Connection, range: &str, f: &Filter) -> AppResult<Summary> {
    let from = range_start(range, Local::now());
    let w = where_clause(from, f);
    let totals = c.query_row(
        &format!("SELECT {SUMS} FROM usage_records u WHERE {}", w.sql),
        params_from_iter(w.args.iter()),
        |r| totals_at(r, 0),
    )?;
    let denom = totals.input + totals.cache_read + totals.cache_write;
    let cache_hit_ratio = (denom > 0).then(|| totals.cache_read as f64 / denom as f64);

    let by_account = groups(c, &w, "u.account_id", "a.name", "MAX(u.provider)", "LEFT JOIN accounts a ON a.id=u.account_id", 50)?;
    let by_provider = groups(c, &w, "u.provider", "u.provider", "MAX(u.provider)", "", 10)?;
    let mut by_model = groups(c, &w, "u.model", "u.model", "MAX(u.provider)", "", 50)?;
    let by_project = groups(c, &w, "u.project_path", "u.project_path", "MAX(u.provider)", "", 30)?;
    let by_session = groups(
        c, &w, "u.provider_session_id",
        "(SELECT s.name FROM sessions s WHERE s.provider_session_id=u.provider_session_id LIMIT 1)",
        "MAX(u.provider)", "", 25,
    )?;
    let by_day = series(c, &w, "date(u.ts/1000,'unixepoch','localtime')")?;
    let by_week = series(c, &w, "strftime('%Y-W%W', u.ts/1000,'unixepoch','localtime')")?;
    let mut by_hour = series(c, &w, "strftime('%H', u.ts/1000,'unixepoch','localtime')")?;
    // Fill all 24 hours so the chart has a stable x-axis.
    let mut hours: Vec<Point> = (0..24)
        .map(|h| Point { key: format!("{h:02}"), total: 0, input: 0, output: 0, cache_read: 0, cache_write: 0 })
        .collect();
    for p in by_hour.drain(..) {
        if let Ok(h) = p.key.parse::<usize>() {
            if h < 24 {
                hours[h] = p;
            }
        }
    }

    let prices = list_prices(c)?;
    let mut value = 0.0;
    let mut priced = 0;
    let mut unpriced = Vec::new();
    for g in by_model.iter_mut() {
        match price_for(&prices, &g.key) {
            Some(p) => {
                let v = value_of(p, &g.totals);
                g.api_value_usd = Some(v);
                value += v;
                priced += g.totals.total;
            }
            None => unpriced.push(g.key.clone()),
        }
    }

    Ok(Summary {
        range: range.into(),
        from_ms: from,
        totals,
        cache_hit_ratio,
        by_account,
        by_provider,
        by_model,
        by_project,
        by_session,
        by_day,
        by_week,
        by_hour: hours,
        api_value: ApiValue { value_usd: value, priced_tokens: priced, unpriced_models: unpriced },
    })
}

/// Daily totals for the last `days` days (GitHub-style heatmap), independent of the range.
pub fn heatmap(c: &Connection, days: i64, f: &Filter) -> AppResult<Vec<Point>> {
    let from = range_start("today", Local::now()).map(|t| t - (days - 1) * 86_400_000);
    let w = where_clause(from, f);
    series(c, &w, "date(u.ts/1000,'unixepoch','localtime')")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::usage::{upsert, UsageRecord};

    fn rec(key: &str, acc: &str, model: &str, ts: i64, input: i64, output: i64, cr: i64) -> UsageRecord {
        UsageRecord {
            dedup_key: key.into(),
            provider: if model.starts_with("gpt") { "codex".into() } else { "claude".into() },
            account_id: Some(acc.into()),
            provider_session_id: Some(format!("s-{acc}")),
            project_path: Some("C:/w".into()),
            ts,
            model: Some(model.into()),
            input_tokens: input,
            output_tokens: output,
            cache_read_tokens: cr,
            cache_write_tokens: 0,
            reasoning_tokens: 0,
            source: "t".into(),
            confidence: "measured".into(),
        }
    }

    #[test]
    fn summary_totals_groups_and_ranges() {
        let mut c = open_in_memory().unwrap();
        let now = Local::now().timestamp_millis();
        let old = now - 40 * 86_400_000;
        upsert(&c, &rec("1", "A", "claude-opus-5", now, 100, 50, 850)).unwrap();
        upsert(&c, &rec("2", "B", "claude-sonnet-5", now, 10, 5, 0)).unwrap();
        upsert(&c, &rec("3", "C", "gpt-6", old, 2000, 0, 0)).unwrap();

        let all = summary(&c, "all", &Filter::default()).unwrap();
        assert_eq!(all.totals.total, 100 + 50 + 850 + 15 + 2000);
        assert_eq!(all.by_account.len(), 3);
        assert_eq!(all.by_account[0].key, "C", "ordered by total");
        assert_eq!(all.by_hour.len(), 24);

        let month = summary(&c, "30d", &Filter::default()).unwrap();
        assert_eq!(month.totals.records, 2);
        let only_a = summary(&c, "all", &Filter { account_id: Some("A".into()), ..Default::default() }).unwrap();
        assert_eq!(only_a.totals.total, 1000);
        assert!((only_a.cache_hit_ratio.unwrap() - 850.0 / 950.0).abs() < 1e-9);

        // Default Anthropic list prices are preset; models without a price are listed.
        let opus = (100.0 * 5.0 + 50.0 * 25.0 + 850.0 * 0.5) / 1e6;
        let sonnet = (10.0 * 2.0 + 5.0 * 10.0) / 1e6;
        assert!((all.api_value.value_usd - (opus + sonnet)).abs() < 1e-12, "{}", all.api_value.value_usd);
        assert_eq!(all.api_value.unpriced_models, vec!["gpt-6".to_string()]);
        save_prices(&mut c, &[]).unwrap();
        let none = summary(&c, "all", &Filter::default()).unwrap();
        assert_eq!(none.api_value.value_usd, 0.0);
        assert_eq!(none.api_value.unpriced_models.len(), 3);

        save_prices(&mut c, &[
            Price { model_pattern: "claude".into(), input_per_mtok: 1.0, output_per_mtok: 1.0, cache_read_per_mtok: 1.0, cache_write_per_mtok: 1.0 },
            Price { model_pattern: "Claude-OPUS".into(), input_per_mtok: 10.0, output_per_mtok: 20.0, cache_read_per_mtok: 1.0, cache_write_per_mtok: 0.0 },
        ]).unwrap();
        let s = summary(&c, "all", &Filter::default()).unwrap();
        let expected = (100.0 * 10.0 + 50.0 * 20.0 + 850.0 * 1.0) / 1e6 + 15.0 / 1e6;
        assert!((s.api_value.value_usd - expected).abs() < 1e-12, "{}", s.api_value.value_usd);
        assert_eq!(s.api_value.unpriced_models, vec!["gpt-6".to_string()]);
    }

    #[test]
    fn longest_price_pattern_wins() {
        let p = vec![
            Price { model_pattern: "claude".into(), input_per_mtok: 1.0, output_per_mtok: 0.0, cache_read_per_mtok: 0.0, cache_write_per_mtok: 0.0 },
            Price { model_pattern: "claude-opus".into(), input_per_mtok: 5.0, output_per_mtok: 0.0, cache_read_per_mtok: 0.0, cache_write_per_mtok: 0.0 },
        ];
        assert_eq!(price_for(&p, "Claude-Opus-5-5").unwrap().input_per_mtok, 5.0);
        assert!(price_for(&p, "gpt-6").is_none());
    }

    #[test]
    fn range_starts_at_local_midnight() {
        let now = Local.with_ymd_and_hms(2026, 3, 29, 15, 0, 0).unwrap();
        let today = range_start("today", now).unwrap();
        let dt = Local.timestamp_millis_opt(today).unwrap();
        assert_eq!((dt.day(), dt.hour_of_day()), (29, 0));
        assert!(range_start("all", now).is_none());
        assert!(range_start("7d", now).unwrap() < today);
    }

    trait HourOfDay {
        fn hour_of_day(&self) -> u32;
    }
    impl HourOfDay for chrono::DateTime<Local> {
        fn hour_of_day(&self) -> u32 {
            use chrono::Timelike;
            self.hour()
        }
    }
}
