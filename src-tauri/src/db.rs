//! SQLite persistence. Migrations are an append-only list tracked via `PRAGMA user_version`.
//! Never edit a released migration — add a new one.

use std::path::Path;

use parking_lot::Mutex;
use rusqlite::Connection;

use crate::error::AppResult;

pub const MIGRATIONS: &[&str] = &[
    // 1 — core schema
    r#"
    CREATE TABLE accounts (
        id              TEXT PRIMARY KEY,
        provider        TEXT NOT NULL CHECK (provider IN ('claude','codex')),
        name            TEXT NOT NULL,
        config_dir      TEXT NOT NULL,
        managed         INTEGER NOT NULL DEFAULT 1,
        color           TEXT,
        auth_status     TEXT NOT NULL DEFAULT 'unknown',
        auth_detail     TEXT,
        auth_checked_at TEXT,
        last_used_at    TEXT,
        created_at      TEXT NOT NULL,
        sort            INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX idx_accounts_dir ON accounts(provider, config_dir);

    CREATE TABLE projects (
        id             TEXT PRIMARY KEY,
        name           TEXT NOT NULL,
        path           TEXT NOT NULL UNIQUE,
        created_at     TEXT NOT NULL,
        last_opened_at TEXT
    );

    CREATE TABLE sessions (
        id                  TEXT PRIMARY KEY,
        name                TEXT NOT NULL,
        provider            TEXT NOT NULL,
        kind                TEXT NOT NULL DEFAULT 'agent',
        account_id          TEXT REFERENCES accounts(id) ON DELETE SET NULL,
        project_id          TEXT REFERENCES projects(id) ON DELETE SET NULL,
        cwd                 TEXT NOT NULL,
        extra_args          TEXT NOT NULL DEFAULT '[]',
        status              TEXT NOT NULL DEFAULT 'idle',
        exit_code           INTEGER,
        model               TEXT,
        provider_session_id TEXT,
        transcript_path     TEXT,
        worktree_path       TEXT,
        created_at          TEXT NOT NULL,
        started_at          TEXT,
        ended_at            TEXT,
        last_activity_at    TEXT,
        closed              INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_sessions_created ON sessions(created_at);
    CREATE INDEX idx_sessions_project ON sessions(project_id);
    CREATE INDEX idx_sessions_account ON sessions(account_id);
    CREATE INDEX idx_sessions_psid ON sessions(provider_session_id);

    CREATE TABLE layouts (
        id         TEXT PRIMARY KEY,
        mode       TEXT NOT NULL,
        panes      TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    "#,
    // 2 — usage analytics + quota
    r#"
    CREATE TABLE usage_records (
        id                  INTEGER PRIMARY KEY,
        dedup_key           TEXT NOT NULL UNIQUE,
        provider            TEXT NOT NULL,
        account_id          TEXT,
        provider_session_id TEXT,
        project_path        TEXT,
        ts                  INTEGER NOT NULL,
        model               TEXT,
        input_tokens        INTEGER NOT NULL DEFAULT 0,
        output_tokens       INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens  INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens    INTEGER NOT NULL DEFAULT 0,
        source              TEXT NOT NULL,
        confidence          TEXT NOT NULL
    );
    CREATE INDEX idx_usage_ts ON usage_records(ts);
    CREATE INDEX idx_usage_account_ts ON usage_records(account_id, ts);
    CREATE INDEX idx_usage_session ON usage_records(provider_session_id);

    CREATE TABLE indexed_files (
        path       TEXT PRIMARY KEY,
        account_id TEXT,
        size       INTEGER NOT NULL,
        mtime      INTEGER NOT NULL,
        offset     INTEGER NOT NULL,
        state      TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE quota_snapshots (
        id             INTEGER PRIMARY KEY,
        account_id     TEXT NOT NULL,
        provider       TEXT NOT NULL,
        window         TEXT NOT NULL,
        used_percent   REAL NOT NULL,
        window_minutes INTEGER,
        resets_at      INTEGER,
        source         TEXT NOT NULL,
        captured_at    INTEGER NOT NULL
    );
    CREATE INDEX idx_quota_account ON quota_snapshots(account_id, window, captured_at);

    CREATE TABLE prices (
        model_pattern   TEXT PRIMARY KEY,
        input_per_mtok  REAL NOT NULL DEFAULT 0,
        output_per_mtok REAL NOT NULL DEFAULT 0,
        cache_read_per_mtok  REAL NOT NULL DEFAULT 0,
        cache_write_per_mtok REAL NOT NULL DEFAULT 0
    );
    "#,
    // 3 — orchestration audit log
    r#"
    CREATE TABLE audit_log (
        id     INTEGER PRIMARY KEY,
        ts     INTEGER NOT NULL,
        actor  TEXT NOT NULL,
        action TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX idx_audit_ts ON audit_log(ts);
    "#,
    // 4 — keep the user's model choice separate from runtime observations.
    // Legacy started sessions may contain display names; let the CLI resume its
    // saved model instead of turning an observation into a command-line override.
    r#"
    ALTER TABLE sessions ADD COLUMN requested_model TEXT;
    UPDATE sessions SET requested_model=model WHERE started_at IS NULL AND instr(model, ' ')=0;
    "#,
    // 5 — structured launch options, auto-continue and per-project defaults.
    r#"
    ALTER TABLE sessions ADD COLUMN options TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE sessions ADD COLUMN auto_continue INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE projects ADD COLUMN defaults TEXT NOT NULL DEFAULT '{}';
    "#,
    // 6 — per-session push-to-talk hotkey.
    r#"
    ALTER TABLE sessions ADD COLUMN voice_hotkey TEXT;
    "#,
    // 7 — activity timeline, loops / prompt queues, prompt templates.
    r#"
    CREATE TABLE activity (
        id         INTEGER PRIMARY KEY,
        session_id TEXT NOT NULL,
        ts         INTEGER NOT NULL,
        kind       TEXT NOT NULL,
        text       TEXT NOT NULL DEFAULT '',
        file       TEXT
    );
    CREATE INDEX idx_activity_ts ON activity(ts);
    CREATE INDEX idx_activity_session ON activity(session_id, ts);
    CREATE INDEX idx_activity_file ON activity(kind, file);

    CREATE TABLE automations (
        id           TEXT PRIMARY KEY,
        session_id   TEXT NOT NULL,
        name         TEXT NOT NULL,
        mode         TEXT NOT NULL CHECK (mode IN ('queue','loop')),
        prompts      TEXT NOT NULL DEFAULT '[]',
        repeat       INTEGER NOT NULL DEFAULT 1,
        delay_sec    INTEGER NOT NULL DEFAULT 5,
        stop_phrase  TEXT,
        state        TEXT NOT NULL DEFAULT 'paused',
        step         INTEGER NOT NULL DEFAULT 0,
        iteration    INTEGER NOT NULL DEFAULT 0,
        last_sent_at INTEGER,
        note         TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
    );
    CREATE INDEX idx_automations_session ON automations(session_id);

    CREATE TABLE templates (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        text       TEXT NOT NULL,
        sort       INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
    );
    INSERT INTO templates(id,name,text,sort,created_at) VALUES
      ('tpl-tests','Tests grün machen','Führe die Tests aus. Wenn etwas fehlschlägt: finde die Ursache, behebe sie und führe die Tests erneut aus, bis alles grün ist. Fasse am Ende kurz zusammen, was du geändert hast.',1,'2026-09-27T00:00:00Z'),
      ('tpl-review','Diff reviewen','Reviewe die aktuellen, noch nicht committeten Änderungen (git diff). Suche nach Bugs, Randfällen und unnötiger Komplexität. Liste die wichtigsten Punkte nach Schwere und behebe die eindeutigen Fehler direkt.',2,'2026-09-27T00:00:00Z'),
      ('tpl-next','Nächster TODO-Punkt','Nimm den nächsten offenen Punkt aus der TODO-Liste des Projekts, setze ihn vollständig um, teste ihn und hake ihn ab. Wenn nichts mehr offen ist, antworte nur mit ALLE PUNKTE ERLEDIGT.',3,'2026-09-27T00:00:00Z'),
      ('tpl-commit','Committen','Prüfe mit git status und git diff, was sich geändert hat, und committe es in sinnvollen Schritten mit aussagekräftigen Commit-Nachrichten.',4,'2026-09-27T00:00:00Z'),
      ('tpl-summary','Stand zusammenfassen','Fasse in 5 Stichpunkten zusammen: was ist erledigt, was ist offen, welche Risiken siehst du, was schlägst du als Nächstes vor?',5,'2026-09-27T00:00:00Z');
    "#,
    // task board
    r#"
    CREATE TABLE tasks (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        text        TEXT NOT NULL DEFAULT '',
        status      TEXT NOT NULL DEFAULT 'open',
        session_id  TEXT,
        result      TEXT,
        sort        INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        started_at  INTEGER,
        finished_at INTEGER
    );
    CREATE INDEX idx_tasks_status ON tasks(status, sort);
    "#,
    // tasks in their own worktree, pinned answers, custom CLI profiles
    r#"
    ALTER TABLE tasks ADD COLUMN project_id TEXT;
    ALTER TABLE tasks ADD COLUMN worktree TEXT;
    ALTER TABLE tasks ADD COLUMN branch TEXT;
    ALTER TABLE tasks ADD COLUMN tests TEXT;
    CREATE TABLE pins (
        id           TEXT PRIMARY KEY,
        project_id   TEXT,
        session_id   TEXT,
        session_name TEXT,
        text         TEXT NOT NULL,
        note         TEXT,
        created_at   TEXT NOT NULL
    );
    CREATE INDEX idx_pins_project ON pins(project_id, created_at);
    ALTER TABLE accounts ADD COLUMN command TEXT;
    "#,
    // allow provider 'custom' in accounts (CHECK constraint, see widen_provider_check)
    WIDEN_PROVIDER_CHECK,
    // Anthropic API list prices (USD per 1M tokens, June 2026) for the "API-equivalent value",
    // only when no prices were entered yet. Cache write = 5-minute cache. Editable in Settings.
    r#"
    INSERT INTO prices(model_pattern,input_per_mtok,output_per_mtok,cache_read_per_mtok,cache_write_per_mtok)
    SELECT * FROM (
      SELECT 'claude-fable-5' , 10.0, 50.0, 0.25, 12.5 UNION ALL
      SELECT 'claude-opus-5-5',  4.0, 20.0, 0.20,  5.0 UNION ALL
      SELECT 'claude-opus-5'  ,  5.0, 25.0, 0.50,  6.25 UNION ALL
      SELECT 'claude-opus-4'  ,  5.0, 25.0, 0.50,  6.25 UNION ALL
      SELECT 'claude-sonnet-5',  2.0, 10.0, 0.20,  2.5 UNION ALL
      SELECT 'claude-sonnet-4',  3.0, 15.0, 0.30,  3.75 UNION ALL
      SELECT 'claude-haiku-4' ,  1.0,  5.0, 0.10,  1.25
    ) WHERE NOT EXISTS (SELECT 1 FROM prices);
    "#,
];

const WIDEN_PROVIDER_CHECK: &str = "@@widen_provider_check";

/// SQLite cannot ALTER a CHECK constraint. The documented way for a change that keeps all
/// existing rows valid is to edit the stored CREATE statement (writable_schema) and bump
/// schema_version — no table rebuild, so foreign keys from sessions stay untouched.
/// https://sqlite.org/lang_altertable.html#otheralter
fn widen_provider_check(tx: &rusqlite::Transaction) -> AppResult<()> {
    let sql: String = tx.query_row("SELECT sql FROM sqlite_master WHERE type='table' AND name='accounts'", [], |r| r.get(0))?;
    let old = "CHECK (provider IN ('claude','codex'))";
    if !sql.contains(old) {
        return Ok(()); // already widened (or created without the check)
    }
    let new_sql = sql.replace(old, "CHECK (provider IN ('claude','codex','custom'))");
    let version: i64 = tx.query_row("PRAGMA schema_version", [], |r| r.get(0))?;
    tx.execute_batch("PRAGMA writable_schema = ON")?;
    tx.execute("UPDATE sqlite_master SET sql=?1 WHERE type='table' AND name='accounts'", [&new_sql])?;
    tx.execute_batch(&format!("PRAGMA schema_version = {}", version + 1))?;
    tx.execute_batch("PRAGMA writable_schema = OFF")?;
    Ok(())
}

pub fn migrate(conn: &mut Connection) -> AppResult<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate() {
        let version = i as i64 + 1;
        if version <= current {
            continue;
        }
        let tx = conn.transaction()?;
        if *sql == WIDEN_PROVIDER_CHECK {
            widen_provider_check(&tx)?;
        } else {
            tx.execute_batch(sql)?;
        }
        tx.execute_batch(&format!("PRAGMA user_version = {version}"))?;
        tx.commit()?;
    }
    Ok(())
}

pub fn open(path: &Path) -> AppResult<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut conn = Connection::open(path)?;
    configure(&conn)?;
    migrate(&mut conn)?;
    Ok(conn)
}

pub fn open_in_memory() -> AppResult<Connection> {
    let mut conn = Connection::open_in_memory()?;
    configure(&conn)?;
    migrate(&mut conn)?;
    Ok(conn)
}

fn configure(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;",
    )?;
    Ok(())
}

/// Shared connection. SQLite work here is small and fast; a single mutex keeps it simple.
pub struct Db(pub Mutex<Connection>);

impl Db {
    pub fn new(conn: Connection) -> Self {
        Db(Mutex::new(conn))
    }
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_apply_and_are_idempotent() {
        let mut conn = open_in_memory().unwrap();
        let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, MIGRATIONS.len() as i64);
        // Running again is a no-op.
        migrate(&mut conn).unwrap();
        let v2: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, v2);
    }

    #[test]
    fn migrations_upgrade_from_partial_state() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("t.db");
        {
            let mut conn = Connection::open(&p).unwrap();
            let tx = conn.transaction().unwrap();
            tx.execute_batch(MIGRATIONS[0]).unwrap();
            tx.execute_batch("PRAGMA user_version = 1").unwrap();
            tx.commit().unwrap();
            conn.execute(
                "INSERT INTO projects(id,name,path,created_at) VALUES('p','n','C:/x','t')",
                [],
            )
            .unwrap();
        }
        let conn = open(&p).unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1, "existing data survives upgrade");
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM usage_records", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn custom_provider_allowed_after_widening_and_data_survives() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("t.db");
        {
            // A database from before the widening, with an account and a session using it.
            let mut conn = Connection::open(&p).unwrap();
            configure(&conn).unwrap();
            let before = MIGRATIONS.iter().position(|m| *m == WIDEN_PROVIDER_CHECK).unwrap();
            for (i, sql) in MIGRATIONS[..before].iter().enumerate() {
                let tx = conn.transaction().unwrap();
                tx.execute_batch(sql).unwrap();
                tx.execute_batch(&format!("PRAGMA user_version = {}", i + 1)).unwrap();
                tx.commit().unwrap();
            }
            conn.execute("INSERT INTO accounts(id,provider,name,config_dir,created_at) VALUES('a','claude','A','d','t')", []).unwrap();
            conn.execute("INSERT INTO sessions(id,name,provider,account_id,cwd,created_at) VALUES('s','S','claude','a','/w','t')", []).unwrap();
            assert!(conn.execute("INSERT INTO accounts(id,provider,name,config_dir,created_at) VALUES('x','custom','X','d2','t')", []).is_err());
        }
        let conn = open(&p).unwrap();
        conn.execute("INSERT INTO accounts(id,provider,name,config_dir,created_at,command) VALUES('x','custom','X','d2','t','gemini')", []).unwrap();
        let acc: String = conn.query_row("SELECT account_id FROM sessions WHERE id='s'", [], |r| r.get(0)).unwrap();
        assert_eq!(acc, "a", "foreign keys untouched");
        let ok: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0)).unwrap();
        assert_eq!(ok, "ok");
        assert!(conn.execute("INSERT INTO accounts(id,provider,name,config_dir,created_at) VALUES('y','gemini','Y','d3','t')", []).is_err());
    }

    #[test]
    fn provider_check_constraint() {
        let conn = open_in_memory().unwrap();
        let r = conn.execute(
            "INSERT INTO accounts(id,provider,name,config_dir,created_at) VALUES('a','gemini','x','d','t')",
            [],
        );
        assert!(r.is_err());
    }

    #[test]
    fn model_migration_does_not_pin_observed_display_names() {
        let mut conn = Connection::open_in_memory().unwrap();
        for sql in &MIGRATIONS[..3] { conn.execute_batch(sql).unwrap(); }
        conn.execute_batch("PRAGMA user_version=3;
            INSERT INTO sessions(id,name,provider,cwd,created_at,model,started_at)
            VALUES('old','Old','claude','/w','t','Opus 5.5','t'),
                  ('new','New','claude','/w','t','opus',NULL);").unwrap();
        migrate(&mut conn).unwrap();
        let observed: Option<String> = conn.query_row("SELECT requested_model FROM sessions WHERE id='old'", [], |r| r.get(0)).unwrap();
        let requested: String = conn.query_row("SELECT requested_model FROM sessions WHERE id='new'", [], |r| r.get(0)).unwrap();
        assert_eq!(observed, None);
        assert_eq!(requested, "opus");
    }
}
