//! Typed data access for accounts, projects, sessions, layouts and settings.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::cli::SessionOptions;
use crate::db::now_iso;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub provider: String,
    pub name: String,
    pub config_dir: String,
    pub managed: bool,
    pub color: Option<String>,
    pub auth_status: String,
    pub auth_detail: Option<String>,
    pub auth_checked_at: Option<String>,
    pub last_used_at: Option<String>,
    pub created_at: String,
    pub sort: i64,
    /// Provider "custom": the command line that starts the tool (e.g. `gemini`, `ollama run qwen3`).
    #[serde(default)]
    pub command: Option<String>,
}

fn account_from(r: &Row) -> rusqlite::Result<Account> {
    Ok(Account {
        id: r.get("id")?,
        provider: r.get("provider")?,
        name: r.get("name")?,
        config_dir: r.get("config_dir")?,
        managed: r.get::<_, i64>("managed")? != 0,
        color: r.get("color")?,
        auth_status: r.get("auth_status")?,
        auth_detail: r.get("auth_detail")?,
        auth_checked_at: r.get("auth_checked_at")?,
        last_used_at: r.get("last_used_at")?,
        created_at: r.get("created_at")?,
        sort: r.get("sort")?,
        command: r.get("command")?,
    })
}

pub fn list_accounts(c: &Connection) -> AppResult<Vec<Account>> {
    let mut st = c.prepare("SELECT * FROM accounts ORDER BY sort, created_at")?;
    let rows = st.query_map([], account_from)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn get_account(c: &Connection, id: &str) -> AppResult<Account> {
    c.query_row("SELECT * FROM accounts WHERE id=?1", [id], account_from)
        .optional()?
        .ok_or_else(|| AppError::not_found(format!("account {id} not found")))
}

pub fn insert_account(c: &Connection, a: &Account) -> AppResult<()> {
    c.execute(
        "INSERT INTO accounts(id,provider,name,config_dir,managed,color,auth_status,created_at,sort,command)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,(SELECT COALESCE(MAX(sort),0)+1 FROM accounts),?9)",
        params![a.id, a.provider, a.name, a.config_dir, a.managed as i64, a.color, a.auth_status, a.created_at, a.command],
    )
    .map_err(|e| match e {
        rusqlite::Error::SqliteFailure(f, _) if f.code == rusqlite::ErrorCode::ConstraintViolation => {
            AppError::invalid("A profile for this provider already uses that config directory")
        }
        e => e.into(),
    })?;
    Ok(())
}

pub fn update_account_meta(c: &Connection, id: &str, name: &str, color: Option<&str>) -> AppResult<()> {
    c.execute("UPDATE accounts SET name=?2, color=?3 WHERE id=?1", params![id, name, color])?;
    Ok(())
}

pub fn set_auth(c: &Connection, id: &str, status: &str, detail: Option<&str>) -> AppResult<()> {
    c.execute(
        "UPDATE accounts SET auth_status=?2, auth_detail=?3, auth_checked_at=?4 WHERE id=?1",
        params![id, status, detail, now_iso()],
    )?;
    Ok(())
}

pub fn touch_account(c: &Connection, id: &str) -> AppResult<()> {
    c.execute("UPDATE accounts SET last_used_at=?2 WHERE id=?1", params![id, now_iso()])?;
    Ok(())
}

pub fn delete_account(c: &Connection, id: &str) -> AppResult<()> {
    c.execute("DELETE FROM accounts WHERE id=?1", [id])?;
    Ok(())
}

// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at: String,
    pub last_opened_at: Option<String>,
    /// New-session defaults for this project (account, model, options, auto-continue).
    #[serde(default)]
    pub defaults: serde_json::Value,
}

fn project_from(r: &Row) -> rusqlite::Result<Project> {
    let defaults: String = r.get("defaults")?;
    Ok(Project {
        id: r.get("id")?,
        name: r.get("name")?,
        path: r.get("path")?,
        created_at: r.get("created_at")?,
        last_opened_at: r.get("last_opened_at")?,
        defaults: serde_json::from_str(&defaults).unwrap_or_else(|_| serde_json::json!({})),
    })
}

pub fn list_projects(c: &Connection) -> AppResult<Vec<Project>> {
    let mut st = c.prepare(
        "SELECT * FROM projects ORDER BY COALESCE(last_opened_at, created_at) DESC",
    )?;
    let rows = st.query_map([], project_from)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn get_project(c: &Connection, id: &str) -> AppResult<Project> {
    c.query_row("SELECT * FROM projects WHERE id=?1", [id], project_from)
        .optional()?
        .ok_or_else(|| AppError::not_found(format!("project {id} not found")))
}

pub fn insert_project(c: &Connection, p: &Project) -> AppResult<Project> {
    if let Some(existing) = c
        .query_row("SELECT * FROM projects WHERE lower(path)=lower(?1)", [&p.path], project_from)
        .optional()?
    {
        return Ok(existing);
    }
    c.execute(
        "INSERT INTO projects(id,name,path,created_at,last_opened_at) VALUES(?1,?2,?3,?4,?5)",
        params![p.id, p.name, p.path, p.created_at, p.last_opened_at],
    )?;
    Ok(p.clone())
}

pub fn touch_project(c: &Connection, id: &str) -> AppResult<()> {
    c.execute("UPDATE projects SET last_opened_at=?2 WHERE id=?1", params![id, now_iso()])?;
    Ok(())
}

pub fn set_project_defaults(c: &Connection, id: &str, defaults: &serde_json::Value) -> AppResult<()> {
    c.execute("UPDATE projects SET defaults=?2 WHERE id=?1", params![id, defaults.to_string()])?;
    Ok(())
}

pub fn rename_project(c: &Connection, id: &str, name: &str) -> AppResult<()> {
    c.execute("UPDATE projects SET name=?2 WHERE id=?1", params![id, name])?;
    Ok(())
}

pub fn delete_project(c: &Connection, id: &str) -> AppResult<()> {
    c.execute("DELETE FROM projects WHERE id=?1", [id])?;
    Ok(())
}

// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub kind: String,
    pub account_id: Option<String>,
    pub project_id: Option<String>,
    pub cwd: String,
    pub extra_args: Vec<String>,
    pub options: SessionOptions,
    pub auto_continue: bool,
    /// Global shortcut that dictates into this session (e.g. "Control+Alt+Digit1").
    pub voice_hotkey: Option<String>,
    pub status: String,
    pub exit_code: Option<i64>,
    pub model: Option<String>,
    pub requested_model: Option<String>,
    pub provider_session_id: Option<String>,
    pub transcript_path: Option<String>,
    pub worktree_path: Option<String>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub last_activity_at: Option<String>,
    pub closed: bool,
}

fn session_from(r: &Row) -> rusqlite::Result<Session> {
    let extra: String = r.get("extra_args")?;
    let options: String = r.get("options")?;
    Ok(Session {
        id: r.get("id")?,
        name: r.get("name")?,
        provider: r.get("provider")?,
        kind: r.get("kind")?,
        account_id: r.get("account_id")?,
        project_id: r.get("project_id")?,
        cwd: r.get("cwd")?,
        extra_args: serde_json::from_str(&extra).unwrap_or_default(),
        options: serde_json::from_str(&options).unwrap_or_default(),
        auto_continue: r.get::<_, i64>("auto_continue")? != 0,
        voice_hotkey: r.get("voice_hotkey")?,
        status: r.get("status")?,
        exit_code: r.get("exit_code")?,
        model: r.get("model")?,
        requested_model: r.get("requested_model")?,
        provider_session_id: r.get("provider_session_id")?,
        transcript_path: r.get("transcript_path")?,
        worktree_path: r.get("worktree_path")?,
        created_at: r.get("created_at")?,
        started_at: r.get("started_at")?,
        ended_at: r.get("ended_at")?,
        last_activity_at: r.get("last_activity_at")?,
        closed: r.get::<_, i64>("closed")? != 0,
    })
}

pub fn insert_session(c: &Connection, s: &Session) -> AppResult<()> {
    c.execute(
        "INSERT INTO sessions(id,name,provider,kind,account_id,project_id,cwd,extra_args,status,model,
            provider_session_id,transcript_path,worktree_path,created_at,requested_model,options,auto_continue)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)",
        params![
            s.id, s.name, s.provider, s.kind, s.account_id, s.project_id, s.cwd,
            serde_json::to_string(&s.extra_args)?, s.status, s.model, s.provider_session_id,
            s.transcript_path, s.worktree_path, s.created_at, s.requested_model,
            serde_json::to_string(&s.options)?, s.auto_continue as i64
        ],
    )?;
    Ok(())
}

pub fn get_session(c: &Connection, id: &str) -> AppResult<Session> {
    c.query_row("SELECT * FROM sessions WHERE id=?1", [id], session_from)
        .optional()?
        .ok_or_else(|| AppError::not_found(format!("session {id} not found")))
}

pub fn open_sessions(c: &Connection) -> AppResult<Vec<Session>> {
    let mut st = c.prepare("SELECT * FROM sessions WHERE closed=0 ORDER BY created_at")?;
    let rows = st.query_map([], session_from)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn set_session_status(c: &Connection, id: &str, status: &str) -> AppResult<()> {
    c.execute(
        "UPDATE sessions SET status=?2, last_activity_at=?3 WHERE id=?1",
        params![id, status, now_iso()],
    )?;
    Ok(())
}

pub fn mark_started(c: &Connection, id: &str) -> AppResult<()> {
    let now = now_iso();
    c.execute(
        "UPDATE sessions SET status='starting', started_at=COALESCE(started_at, ?2), ended_at=NULL,
            exit_code=NULL, last_activity_at=?2, closed=0 WHERE id=?1",
        params![id, now],
    )?;
    Ok(())
}

pub fn mark_ended(c: &Connection, id: &str, code: Option<i64>, status: &str) -> AppResult<()> {
    let now = now_iso();
    c.execute(
        "UPDATE sessions SET status=?3, exit_code=?2, ended_at=?4, last_activity_at=?4 WHERE id=?1",
        params![id, code, status, now],
    )?;
    Ok(())
}

pub fn set_session_field(c: &Connection, id: &str, field: &str, value: Option<&str>) -> AppResult<()> {
    // Whitelist to keep the dynamic SQL safe.
    const ALLOWED: &[&str] = &["name", "model", "provider_session_id", "transcript_path", "worktree_path", "voice_hotkey"];
    if !ALLOWED.contains(&field) {
        return Err(AppError::invalid(format!("field {field} not updatable")));
    }
    c.execute(&format!("UPDATE sessions SET {field}=?2 WHERE id=?1"), params![id, value])?;
    Ok(())
}

pub fn set_auto_continue(c: &Connection, id: &str, on: bool) -> AppResult<()> {
    c.execute("UPDATE sessions SET auto_continue=?2 WHERE id=?1", params![id, on as i64])?;
    Ok(())
}

pub fn set_closed(c: &Connection, id: &str, closed: bool) -> AppResult<()> {
    c.execute("UPDATE sessions SET closed=?2 WHERE id=?1", params![id, closed as i64])?;
    Ok(())
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryFilter {
    pub project_id: Option<String>,
    pub account_id: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub search: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRow {
    #[serde(flatten)]
    pub session: Session,
    pub project_name: Option<String>,
    pub account_name: Option<String>,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
    pub reasoning_tokens: i64,
    pub usage_model: Option<String>,
}

pub fn history(c: &Connection, f: &HistoryFilter) -> AppResult<(Vec<HistoryRow>, i64)> {
    // Each condition uses bare `?` markers; they are numbered sequentially below.
    let mut conds: Vec<(&str, Vec<String>)> = vec![("s.kind='agent'", vec![])];
    let nonempty = |o: &Option<String>| o.clone().filter(|s| !s.is_empty());
    if let Some(v) = nonempty(&f.project_id) {
        conds.push(("s.project_id = ?", vec![v]));
    }
    if let Some(v) = nonempty(&f.account_id) {
        conds.push(("s.account_id = ?", vec![v]));
    }
    if let Some(v) = nonempty(&f.provider) {
        conds.push(("s.provider = ?", vec![v]));
    }
    if let Some(v) = nonempty(&f.model) {
        let like = format!("%{v}%");
        conds.push(("(s.model LIKE ? OR u.model LIKE ?)", vec![like.clone(), like]));
    }
    if let Some(v) = nonempty(&f.from) {
        conds.push(("s.created_at >= ?", vec![v]));
    }
    if let Some(v) = nonempty(&f.to) {
        conds.push(("s.created_at <= ?", vec![v]));
    }
    if let Some(v) = nonempty(&f.search) {
        let like = format!("%{v}%");
        conds.push(("(s.name LIKE ? OR s.cwd LIKE ?)", vec![like.clone(), like]));
    }
    let mut args: Vec<String> = Vec::new();
    let mut parts = Vec::new();
    for (sql, vals) in conds {
        let mut out = String::new();
        let mut vals = vals.into_iter();
        for ch in sql.chars() {
            if ch == '?' {
                args.push(vals.next().expect("placeholder/value mismatch"));
                out.push_str(&format!("?{}", args.len()));
            } else {
                out.push(ch);
            }
        }
        parts.push(out);
    }
    let where_sql = parts.join(" AND ");

    let base = format!(
        "FROM sessions s
         LEFT JOIN projects p ON p.id = s.project_id
         LEFT JOIN accounts a ON a.id = s.account_id
         LEFT JOIN (
            SELECT provider_session_id psid, SUM(input_tokens) i, SUM(output_tokens) o,
                   SUM(cache_read_tokens) cr, SUM(cache_write_tokens) cw, SUM(reasoning_tokens) r,
                   MAX(model) model
            FROM usage_records GROUP BY provider_session_id
         ) u ON u.psid = s.provider_session_id
         WHERE {where_sql}"
    );
    let total: i64 = c.query_row(
        &format!("SELECT COUNT(*) {base}"),
        rusqlite::params_from_iter(args.iter()),
        |r| r.get(0),
    )?;
    let sql = format!(
        "SELECT s.*, p.name project_name, a.name account_name,
                COALESCE(u.i,0) ui, COALESCE(u.o,0) uo, COALESCE(u.cr,0) ucr, COALESCE(u.cw,0) ucw,
                COALESCE(u.r,0) ur, u.model umodel
         {base} ORDER BY s.created_at DESC LIMIT {} OFFSET {}",
        f.limit.unwrap_or(200).clamp(1, 1000),
        f.offset.unwrap_or(0).max(0)
    );
    let mut st = c.prepare(&sql)?;
    let rows = st
        .query_map(rusqlite::params_from_iter(args.iter()), |r| {
            Ok(HistoryRow {
                session: session_from(r)?,
                project_name: r.get("project_name")?,
                account_name: r.get("account_name")?,
                input_tokens: r.get("ui")?,
                output_tokens: r.get("uo")?,
                cache_read_tokens: r.get("ucr")?,
                cache_write_tokens: r.get("ucw")?,
                reasoning_tokens: r.get("ur")?,
                usage_model: r.get("umodel")?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok((rows, total))
}

// ---------------------------------------------------------------------------

pub fn get_setting(c: &Connection, key: &str) -> AppResult<Option<serde_json::Value>> {
    let v: Option<String> = c
        .query_row("SELECT value FROM settings WHERE key=?1", [key], |r| r.get(0))
        .optional()?;
    Ok(v.and_then(|s| serde_json::from_str(&s).ok()))
}

pub fn set_setting(c: &Connection, key: &str, value: &serde_json::Value) -> AppResult<()> {
    c.execute(
        "INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![key, value.to_string()],
    )?;
    Ok(())
}

pub fn all_settings(c: &Connection) -> AppResult<serde_json::Map<String, serde_json::Value>> {
    let mut st = c.prepare("SELECT key, value FROM settings")?;
    let mut map = serde_json::Map::new();
    for row in st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
        let (k, v) = row?;
        map.insert(k, serde_json::from_str(&v).unwrap_or(serde_json::Value::Null));
    }
    Ok(map)
}

pub fn get_layout(c: &Connection, id: &str) -> AppResult<Option<serde_json::Value>> {
    let v: Option<(String, String)> = c
        .query_row("SELECT mode, panes FROM layouts WHERE id=?1", [id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?;
    Ok(v.map(|(mode, panes)| {
        serde_json::json!({ "mode": mode, "panes": serde_json::from_str::<serde_json::Value>(&panes).unwrap_or_default() })
    }))
}

pub fn save_layout(c: &Connection, id: &str, mode: &str, panes: &serde_json::Value) -> AppResult<()> {
    c.execute(
        "INSERT INTO layouts(id,mode,panes,updated_at) VALUES(?1,?2,?3,?4)
         ON CONFLICT(id) DO UPDATE SET mode=excluded.mode, panes=excluded.panes, updated_at=excluded.updated_at",
        params![id, mode, panes.to_string(), now_iso()],
    )?;
    Ok(())
}

pub fn audit(c: &Connection, actor: &str, action: &str, detail: &serde_json::Value) -> AppResult<()> {
    c.execute(
        "INSERT INTO audit_log(ts,actor,action,detail) VALUES(?1,?2,?3,?4)",
        params![crate::db::now_ms(), actor, action, detail.to_string()],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    fn sess(id: &str, provider: &str, project: Option<&str>) -> Session {
        Session {
            id: id.into(),
            name: format!("s-{id}"),
            provider: provider.into(),
            kind: "agent".into(),
            account_id: None,
            project_id: project.map(Into::into),
            cwd: r"C:\work\proj".into(),
            extra_args: vec![],
            options: SessionOptions::default(),
            auto_continue: false,
            voice_hotkey: None,
            status: "idle".into(),
            exit_code: None,
            model: Some("opus".into()),
            requested_model: Some("opus".into()),
            provider_session_id: Some(format!("p-{id}")),
            transcript_path: None,
            worktree_path: None,
            created_at: format!("2026-09-0{id}T10:00:00.000Z"),
            started_at: None,
            ended_at: None,
            last_activity_at: None,
            closed: false,
        }
    }

    #[test]
    fn history_filters() {
        let c = open_in_memory().unwrap();
        insert_project(&c, &Project { id: "P".into(), name: "proj".into(), path: "C:/p".into(), created_at: now_iso(), last_opened_at: None, defaults: serde_json::json!({}) }).unwrap();
        insert_session(&c, &sess("1", "claude", Some("P"))).unwrap();
        insert_session(&c, &sess("2", "codex", None)).unwrap();
        insert_session(&c, &sess("3", "claude", None)).unwrap();

        let (rows, total) = history(&c, &HistoryFilter::default()).unwrap();
        assert_eq!(total, 3);
        assert_eq!(rows[0].session.id, "3", "newest first");

        let (rows, _) = history(&c, &HistoryFilter { provider: Some("claude".into()), ..Default::default() }).unwrap();
        assert_eq!(rows.len(), 2);
        let (rows, _) = history(&c, &HistoryFilter { project_id: Some("P".into()), ..Default::default() }).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].project_name.as_deref(), Some("proj"));
        let (rows, _) = history(&c, &HistoryFilter { model: Some("op".into()), provider: Some("codex".into()), ..Default::default() }).unwrap();
        assert_eq!(rows.len(), 1);
        let (rows, _) = history(&c, &HistoryFilter { from: Some("2026-09-02".into()), ..Default::default() }).unwrap();
        assert_eq!(rows.len(), 2);
        let (rows, _) = history(&c, &HistoryFilter { search: Some("s-2".into()), ..Default::default() }).unwrap();
        assert_eq!(rows.len(), 1);
    }

    #[test]
    fn project_insert_is_case_insensitive_unique() {
        let c = open_in_memory().unwrap();
        let a = insert_project(&c, &Project { id: "A".into(), name: "a".into(), path: r"C:\Work\App".into(), created_at: now_iso(), last_opened_at: None, defaults: serde_json::json!({}) }).unwrap();
        let b = insert_project(&c, &Project { id: "B".into(), name: "b".into(), path: r"c:\work\app".into(), created_at: now_iso(), last_opened_at: None, defaults: serde_json::json!({}) }).unwrap();
        assert_eq!(a.id, b.id);
    }

    #[test]
    fn session_field_whitelist() {
        let c = open_in_memory().unwrap();
        insert_session(&c, &sess("1", "claude", None)).unwrap();
        assert!(set_session_field(&c, "1", "status; DROP TABLE sessions", Some("x")).is_err());
        set_session_field(&c, "1", "name", Some("renamed")).unwrap();
        assert_eq!(get_session(&c, "1").unwrap().name, "renamed");
    }
}
