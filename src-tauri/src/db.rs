use rusqlite::{Connection, OptionalExtension, params};

use crate::error::{AppError, AppResult};

pub const HISTORY_LIMIT_PER_FILE: i64 = 100;

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionSummary {
    pub id: i64,
    pub path: String,
    pub size: i64,
    pub created_at: i64,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionContent {
    pub id: i64,
    pub path: String,
    pub content: String,
    pub created_at: i64,
}

pub fn init(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         CREATE TABLE IF NOT EXISTS file_versions (
             id         INTEGER PRIMARY KEY AUTOINCREMENT,
             path       TEXT    NOT NULL,
             content    TEXT    NOT NULL,
             size       INTEGER NOT NULL,
             created_at INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_file_versions_path
             ON file_versions(path, id DESC);
         CREATE TABLE IF NOT EXISTS settings (
             key   TEXT PRIMARY KEY,
             value TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS audit_log (
             id         INTEGER PRIMARY KEY AUTOINCREMENT,
             created_at INTEGER NOT NULL,
             kind       TEXT    NOT NULL,
             mode       TEXT,
             plan_id    TEXT,
             step_id    TEXT,
             title      TEXT,
             command    TEXT,
             outcome    TEXT,
             detail     TEXT
         );
         CREATE INDEX IF NOT EXISTS idx_audit_log_created
             ON audit_log(id DESC);",
    )?;
    Ok(())
}

pub fn record_version(conn: &Connection, path: &str, content: &str) -> AppResult<i64> {
    let now = chrono::Utc::now().timestamp_millis();
    let size = content.len() as i64;

    conn.execute(
        "INSERT INTO file_versions (path, content, size, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![path, content, size, now],
    )?;
    let id = conn.last_insert_rowid();

    conn.execute(
        "DELETE FROM file_versions
         WHERE path = ?1 AND id NOT IN (
             SELECT id FROM file_versions WHERE path = ?1 ORDER BY id DESC LIMIT ?2
         )",
        params![path, HISTORY_LIMIT_PER_FILE],
    )?;

    Ok(id)
}

pub fn list_versions(conn: &Connection, path: &str, limit: i64) -> AppResult<Vec<VersionSummary>> {
    let mut stmt = conn.prepare(
        "SELECT id, path, size, created_at
         FROM file_versions
         WHERE path = ?1
         ORDER BY id DESC
         LIMIT ?2",
    )?;

    let rows = stmt.query_map(params![path, limit], |row| {
        Ok(VersionSummary {
            id: row.get(0)?,
            path: row.get(1)?,
            size: row.get(2)?,
            created_at: row.get(3)?,
        })
    })?;

    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get_version(conn: &Connection, id: i64) -> AppResult<VersionContent> {
    conn.query_row(
        "SELECT id, path, content, created_at FROM file_versions WHERE id = ?1",
        params![id],
        |row| {
            Ok(VersionContent {
                id: row.get(0)?,
                path: row.get(1)?,
                content: row.get(2)?,
                created_at: row.get(3)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("履歴 ID {id}")))
}

pub fn get_setting(conn: &Connection, key: &str) -> AppResult<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()?)
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}
