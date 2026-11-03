use std::collections::BTreeMap;

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::agent::{ALLOWED_ACTIONS, READ_ONLY_ACTIONS, default_decision};
use crate::db;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

pub const SETTING_AGENT_POLICY: &str = "agent_policy";
pub const MAX_AUDIT_LIMIT: i64 = 200;
pub const MAX_AUDIT_ROWS: i64 = 5_000;
pub const MAX_AUDIT_DETAIL_CHARS: usize = 4_000;

const AUDIT_KINDS: &[&str] = &[
    "plan_created",
    "plan_approved",
    "plan_rejected",
    "plan_cancelled",
    "action_run",
    "action_blocked",
    "action_cancelled",
    "policy_updated",
];

const AUDIT_OUTCOMES: &[&str] = &["ok", "error", "blocked", "cancelled"];
const MODES: &[&str] = &["passive", "assistive", "autonomous"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentPolicy {
    pub audit_enabled: bool,
    pub audit_retention_days: i64,
    pub actions: BTreeMap<String, String>,
}

impl Default for AgentPolicy {
    fn default() -> Self {
        let actions = ALLOWED_ACTIONS
            .iter()
            .map(|action| (action.to_string(), default_decision(action).to_string()))
            .collect();
        Self {
            audit_enabled: true,
            audit_retention_days: 30,
            actions,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAuditMeta {
    pub plan_id: Option<String>,
    pub step_id: Option<String>,
    pub title: Option<String>,
    pub mode: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditInput {
    pub kind: String,
    pub mode: Option<String>,
    pub plan_id: Option<String>,
    pub step_id: Option<String>,
    pub title: Option<String>,
    pub command: Option<Vec<String>>,
    pub outcome: Option<String>,
    pub detail: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub id: i64,
    pub created_at: i64,
    pub kind: String,
    pub mode: Option<String>,
    pub plan_id: Option<String>,
    pub step_id: Option<String>,
    pub title: Option<String>,
    pub command: Option<Vec<String>>,
    pub outcome: Option<String>,
    pub detail: Option<String>,
}

/// Normalize a policy coming from the UI. Unknown actions and unsafe values
/// are rejected so a malformed policy cannot silently change behavior.
pub fn normalize_policy(mut policy: AgentPolicy) -> AppResult<AgentPolicy> {
    if !(1..=365).contains(&policy.audit_retention_days) {
        return Err(AppError::Other(
            "監査ログの保持期間は 1〜365 日で指定してください。".into(),
        ));
    }

    for action in policy.actions.keys() {
        if !ALLOWED_ACTIONS.contains(&action.as_str()) {
            return Err(AppError::Other(format!(
                "ポリシーに対象外のアクションが含まれています: {action}"
            )));
        }
    }

    let mut actions = BTreeMap::new();
    for action in ALLOWED_ACTIONS {
        let read_only = READ_ONLY_ACTIONS.contains(action);
        let decision = policy
            .actions
            .get(*action)
            .cloned()
            .unwrap_or_else(|| default_decision(action).to_string());

        let allowed = if read_only {
            matches!(decision.as_str(), "allow" | "ask" | "block")
        } else {
            // Mutating actions always keep the native OS confirmation.
            matches!(decision.as_str(), "ask" | "block")
        };

        if !allowed {
            return Err(AppError::Other(format!(
                "{action} に使用できないポリシーです: {decision}"
            )));
        }

        actions.insert(action.to_string(), decision);
    }

    policy.actions = actions;
    Ok(policy)
}

pub fn load_policy(conn: &Connection) -> AppResult<AgentPolicy> {
    let Some(raw) = db::get_setting(conn, SETTING_AGENT_POLICY)? else {
        return Ok(AgentPolicy::default());
    };

    match serde_json::from_str::<AgentPolicy>(&raw) {
        Ok(policy) => Ok(normalize_policy(policy).unwrap_or_default()),
        Err(_) => Ok(AgentPolicy::default()),
    }
}

pub fn save_policy(conn: &Connection, policy: &AgentPolicy) -> AppResult<()> {
    let raw = serde_json::to_string(policy)?;
    db::set_setting(conn, SETTING_AGENT_POLICY, &raw)
}

pub fn decision<'a>(policy: &'a AgentPolicy, action: &str) -> &'a str {
    policy
        .actions
        .get(action)
        .map(String::as_str)
        .unwrap_or("block")
}

fn truncate(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        value.to_string()
    } else {
        format!("{}…", value.chars().take(limit).collect::<String>())
    }
}

fn validate_optional(value: &Option<String>, limit: usize, field: &str) -> AppResult<()> {
    if let Some(value) = value {
        if value.chars().count() > limit {
            return Err(AppError::Other(format!("{field} が長すぎます。")));
        }
    }
    Ok(())
}

fn validate_audit_input(input: &AuditInput) -> AppResult<()> {
    if !AUDIT_KINDS.contains(&input.kind.as_str()) {
        return Err(AppError::Other("監査ログの種別が不正です。".into()));
    }
    if let Some(outcome) = input.outcome.as_deref() {
        if !AUDIT_OUTCOMES.contains(&outcome) {
            return Err(AppError::Other("監査ログの結果が不正です。".into()));
        }
    }
    if let Some(mode) = input.mode.as_deref() {
        if !MODES.contains(&mode) {
            return Err(AppError::Other("監査ログのモードが不正です。".into()));
        }
    }
    validate_optional(&input.plan_id, 200, "プラン ID")?;
    validate_optional(&input.step_id, 200, "手順 ID")?;
    validate_optional(&input.title, 240, "タイトル")?;
    validate_optional(&input.detail, MAX_AUDIT_DETAIL_CHARS, "詳細")?;

    if let Some(command) = &input.command {
        if command.len() > 12 {
            return Err(AppError::Other("監査ログの引数が多すぎます。".into()));
        }
        let mut total = 0usize;
        for arg in command {
            if arg.contains('\0') {
                return Err(AppError::Other(
                    "監査ログの引数に NUL 文字は指定できません。".into(),
                ));
            }
            let chars = arg.chars().count();
            if chars > 16_384 {
                return Err(AppError::Other("監査ログの引数が長すぎます。".into()));
            }
            total += chars;
        }
        if total > 32_768 {
            return Err(AppError::Other("監査ログの引数の合計が長すぎます。".into()));
        }
    }

    Ok(())
}

fn purge_audit(conn: &Connection, retention_days: i64) -> AppResult<()> {
    let cutoff = chrono::Utc::now().timestamp_millis() - retention_days * 24 * 60 * 60 * 1_000;
    conn.execute(
        "DELETE FROM audit_log WHERE created_at < ?1",
        params![cutoff],
    )?;
    conn.execute(
        "DELETE FROM audit_log WHERE id NOT IN (
             SELECT id FROM audit_log ORDER BY id DESC LIMIT ?1
         )",
        params![MAX_AUDIT_ROWS],
    )?;
    Ok(())
}

pub fn insert_audit(conn: &Connection, input: &AuditInput, retention_days: i64) -> AppResult<()> {
    validate_audit_input(input)?;
    purge_audit(conn, retention_days)?;

    let command = match &input.command {
        Some(command) => Some(serde_json::to_string(command)?),
        None => None,
    };
    let created_at = chrono::Utc::now().timestamp_millis();

    conn.execute(
        "INSERT INTO audit_log (
             created_at, kind, mode, plan_id, step_id, title, command, outcome, detail
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            created_at,
            input.kind,
            input.mode,
            input.plan_id,
            input.step_id,
            input.title,
            command,
            input.outcome,
            input.detail,
        ],
    )?;
    Ok(())
}

pub fn record_audit(conn: &Connection, policy: &AgentPolicy, input: &AuditInput) -> AppResult<()> {
    if !policy.audit_enabled {
        return Ok(());
    }
    insert_audit(conn, input, policy.audit_retention_days)
}

pub fn record_action(
    conn: &Connection,
    policy: &AgentPolicy,
    meta: Option<&AgentAuditMeta>,
    args: &[String],
    outcome: &str,
    detail: Option<&str>,
) -> AppResult<()> {
    if !policy.audit_enabled {
        return Ok(());
    }

    let kind = match outcome {
        "blocked" => "action_blocked",
        "cancelled" => "action_cancelled",
        _ => "action_run",
    };

    let input = AuditInput {
        kind: kind.to_string(),
        mode: meta.and_then(|meta| meta.mode.clone()),
        plan_id: meta.and_then(|meta| meta.plan_id.clone()),
        step_id: meta.and_then(|meta| meta.step_id.clone()),
        title: meta
            .and_then(|meta| meta.title.clone())
            .or_else(|| args.first().cloned()),
        command: Some(args.to_vec()),
        outcome: Some(outcome.to_string()),
        detail: detail.map(|value| truncate(value, MAX_AUDIT_DETAIL_CHARS)),
    };

    insert_audit(conn, &input, policy.audit_retention_days)
}

pub fn list_audit(
    conn: &Connection,
    limit: Option<i64>,
    offset: Option<i64>,
) -> AppResult<Vec<AuditEntry>> {
    let limit = limit.unwrap_or(50).clamp(1, MAX_AUDIT_LIMIT);
    let offset = offset.unwrap_or(0).max(0);

    let mut stmt = conn.prepare(
        "SELECT id, created_at, kind, mode, plan_id, step_id, title, command, outcome, detail
         FROM audit_log
         ORDER BY id DESC
         LIMIT ?1 OFFSET ?2",
    )?;

    let rows = stmt.query_map(params![limit, offset], |row| {
        let command: Option<String> = row.get(7)?;
        Ok(AuditEntry {
            id: row.get(0)?,
            created_at: row.get(1)?,
            kind: row.get(2)?,
            mode: row.get(3)?,
            plan_id: row.get(4)?,
            step_id: row.get(5)?,
            title: row.get(6)?,
            command: command.and_then(|raw| serde_json::from_str(&raw).ok()),
            outcome: row.get(8)?,
            detail: row.get(9)?,
        })
    })?;

    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[tauri::command]
pub async fn agent_policy_get(state: State<'_, AppState>) -> AppResult<AgentPolicy> {
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Other("DB ロックの取得に失敗しました".into()))?;
    load_policy(&conn)
}

#[tauri::command]
pub async fn agent_policy_set(
    policy: AgentPolicy,
    state: State<'_, AppState>,
) -> AppResult<AgentPolicy> {
    let policy = normalize_policy(policy)?;
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Other("DB ロックの取得に失敗しました".into()))?;
    save_policy(&conn, &policy)?;

    let input = AuditInput {
        kind: "policy_updated".into(),
        mode: None,
        plan_id: None,
        step_id: None,
        title: Some("エージェントポリシー".into()),
        command: None,
        outcome: Some("ok".into()),
        detail: Some(format!(
            "監査ログ: {} / 保持: {} 日",
            if policy.audit_enabled {
                "有効"
            } else {
                "無効"
            },
            policy.audit_retention_days
        )),
    };
    let _ = record_audit(&conn, &policy, &input);

    Ok(policy)
}

#[tauri::command]
pub async fn audit_log_add(input: AuditInput, state: State<'_, AppState>) -> AppResult<()> {
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Other("DB ロックの取得に失敗しました".into()))?;
    let policy = load_policy(&conn)?;
    record_audit(&conn, &policy, &input)
}

#[tauri::command]
pub async fn audit_log_list(
    limit: Option<i64>,
    offset: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<Vec<AuditEntry>> {
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Other("DB ロックの取得に失敗しました".into()))?;
    list_audit(&conn, limit, offset)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::agent::ALLOWED_ACTIONS;

    fn policy_with(action: &str, decision: &str) -> AgentPolicy {
        let mut policy = AgentPolicy::default();
        policy
            .actions
            .insert(action.to_string(), decision.to_string());
        policy
    }

    #[test]
    fn defaults_allow_reads_and_ask_for_writes() {
        let policy = AgentPolicy::default();
        assert_eq!(decision(&policy, "snapshot"), "allow");
        assert_eq!(decision(&policy, "launch"), "ask");
        assert_eq!(policy.actions.len(), ALLOWED_ACTIONS.len());
    }

    #[test]
    fn rejects_auto_allowing_mutating_actions() {
        let error = normalize_policy(policy_with("launch", "allow")).unwrap_err();
        assert!(error.to_string().contains("使用できない"));
    }

    #[test]
    fn accepts_blocking_and_asking_for_mutating_actions() {
        assert!(normalize_policy(policy_with("launch", "block")).is_ok());
        assert!(normalize_policy(policy_with("launch", "ask")).is_ok());
    }

    #[test]
    fn allows_forcing_confirmation_for_read_only_actions() {
        let policy = normalize_policy(policy_with("snapshot", "ask")).unwrap();
        assert_eq!(decision(&policy, "snapshot"), "ask");
    }

    #[test]
    fn rejects_unknown_actions() {
        let mut policy = AgentPolicy::default();
        policy.actions.insert("rm".into(), "block".into());
        assert!(normalize_policy(policy).is_err());
    }

    #[test]
    fn rejects_invalid_retention() {
        let mut policy = AgentPolicy::default();
        policy.audit_retention_days = 0;
        assert!(normalize_policy(policy.clone()).is_err());
        policy.audit_retention_days = 366;
        assert!(normalize_policy(policy).is_err());
    }

    #[test]
    fn audit_input_rejects_unknown_kinds_and_outcomes() {
        let mut input = AuditInput {
            kind: "unknown".into(),
            mode: None,
            plan_id: None,
            step_id: None,
            title: None,
            command: None,
            outcome: None,
            detail: None,
        };
        assert!(validate_audit_input(&input).is_err());

        input.kind = "action_run".into();
        input.outcome = Some("weird".into());
        assert!(validate_audit_input(&input).is_err());
    }

    #[test]
    fn disabled_audit_records_nothing() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        let mut policy = AgentPolicy::default();
        policy.audit_enabled = false;

        record_action(&conn, &policy, None, &["snapshot".into()], "ok", None).unwrap();
        assert!(list_audit(&conn, Some(10), Some(0)).unwrap().is_empty());
    }

    #[test]
    fn records_and_lists_action_metadata() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        let policy = AgentPolicy::default();
        let meta = AgentAuditMeta {
            plan_id: Some("plan-1".into()),
            step_id: Some("step-1".into()),
            title: Some("状態確認".into()),
            mode: Some("assistive".into()),
        };

        record_action(
            &conn,
            &policy,
            Some(&meta),
            &["snapshot".into(), "--json".into()],
            "ok",
            Some("success"),
        )
        .unwrap();

        let entries = list_audit(&conn, Some(10), Some(0)).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].kind, "action_run");
        assert_eq!(entries[0].plan_id.as_deref(), Some("plan-1"));
        assert_eq!(entries[0].step_id.as_deref(), Some("step-1"));
        assert_eq!(entries[0].outcome.as_deref(), Some("ok"));
        assert_eq!(
            entries[0].command.as_deref(),
            Some(&["snapshot".to_string(), "--json".to_string()][..])
        );
    }

    #[test]
    fn purge_drops_entries_older_than_retention() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        conn.execute(
            "INSERT INTO audit_log (created_at, kind) VALUES (?1, 'action_run')",
            params![0i64],
        )
        .unwrap();
        let policy = AgentPolicy::default();

        record_action(&conn, &policy, None, &["snapshot".into()], "ok", None).unwrap();

        let entries = list_audit(&conn, Some(10), Some(0)).unwrap();
        assert_eq!(entries.len(), 1);
        assert_ne!(entries[0].created_at, 0);
    }
}
