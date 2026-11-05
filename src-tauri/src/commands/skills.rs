use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::commands::policy::{self as audit_policy, AgentPolicy, AuditInput};
use crate::error::{AppError, AppResult};
use crate::fsutil::now_millis;
use crate::skills::editor::{self, SkillPreview};
use crate::skills::policy::{self as skill_policy, SkillPolicy};
use crate::skills::verify::{self, CheckStatus, VerificationResult};
use crate::skills::{
    self, Decision, Risk, SkillAction, SkillCatalog, SkillManifest, VerificationCheck, params,
};
use crate::state::AppState;

static RUN_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDecision {
    pub skill_id: String,
    pub action_id: String,
    pub decision: Decision,
    pub risk: Risk,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillRequest {
    pub skill_id: String,
    pub action_id: String,
    pub params: Value,
    #[serde(default)]
    pub plan_id: Option<String>,
    #[serde(default)]
    pub step_id: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub mode: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SkillRunStatus {
    Ok,
    Blocked,
    Cancelled,
    Failed,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillRunResult {
    pub run_id: String,
    pub status: SkillRunStatus,
    pub decision: Decision,
    pub changed_files: Vec<String>,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub duration_ms: u64,
    pub audit_id: i64,
    pub error_code: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillPreviewResult {
    pub skill_id: String,
    pub action_id: String,
    pub decision: Decision,
    pub risk: Risk,
    pub path: Option<String>,
    pub added_lines: usize,
    pub removed_lines: usize,
    pub diff: String,
    pub warnings: Vec<String>,
}

/// List the skill manifests in the current workspace. Broken manifests are
/// returned as warnings so one bad file cannot hide the rest of the catalog.
#[tauri::command]
pub fn skills_list(state: State<'_, AppState>) -> AppResult<SkillCatalog> {
    let root = state.root()?;
    skills::load_catalog(&root)
}

#[tauri::command]
pub fn skill_policy_get(state: State<'_, AppState>) -> AppResult<SkillPolicy> {
    let root = state.root()?;
    let catalog = skills::load_catalog(&root)?;
    let conn = lock_db(&state)?;
    skill_policy::load_policy(&conn, Some(&catalog))
}

#[tauri::command]
pub fn skill_policy_set(policy: SkillPolicy, state: State<'_, AppState>) -> AppResult<SkillPolicy> {
    let root = state.root()?;
    let catalog = skills::load_catalog(&root)?;
    let conn = lock_db(&state)?;
    let saved = skill_policy::save_policy(&conn, policy, Some(&catalog))?;

    let agent_policy = audit_policy::load_policy(&conn)?;
    let input = AuditInput {
        kind: "skill_policy_updated".into(),
        mode: None,
        plan_id: None,
        step_id: None,
        skill_id: None,
        action_id: None,
        title: Some("スキルポリシー".into()),
        command: None,
        outcome: Some("ok".into()),
        detail: Some("スキルポリシーを更新しました".into()),
    };
    let _ = audit_policy::record_audit(&conn, &agent_policy, &input);
    Ok(saved)
}

/// Resolve the effective allow/ask/block decision for one action. The UI uses
/// this instead of duplicating the policy priority rules in TypeScript.
#[tauri::command]
pub fn skill_decision(
    skill_id: String,
    action_id: String,
    state: State<'_, AppState>,
) -> AppResult<SkillDecision> {
    let root = state.root()?;
    let catalog = skills::load_catalog(&root)?;
    let (manifest, action) = find_action(&catalog, &skill_id, &action_id)?;
    let conn = lock_db(&state)?;
    let policy = skill_policy::load_policy(&conn, Some(&catalog))?;
    Ok(SkillDecision {
        skill_id,
        action_id,
        decision: skill_policy::decision_for(&policy, manifest, action),
        risk: action.risk,
    })
}

#[tauri::command]
pub fn skill_preview(
    skill_id: String,
    action_id: String,
    params: Value,
    mode: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<SkillPreviewResult> {
    let root = state.root()?;
    let catalog = skills::load_catalog(&root)?;
    let (manifest, action) = find_action(&catalog, &skill_id, &action_id)?;
    params::validate_params(action, &params)?;

    let mode = normalize_mode(mode.as_deref())?;
    let policy = {
        let conn = lock_db(&state)?;
        skill_policy::load_policy(&conn, Some(&catalog))?
    };
    let mut decision = skill_policy::decision_for(&policy, manifest, action);
    let mut warnings = Vec::new();
    if mode == "passive" && action.risk != Risk::Read {
        decision = Decision::Block;
        warnings.push("受動モードでは書き込み・破壊的操作を実行できません".into());
    }
    if decision == Decision::Block {
        warnings.push("ポリシーによりブロックされています".into());
    }

    let preview = preview_for(&root, action, &params, manifest.limits.max_bytes)?;
    let path = params
        .get("path")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let (added_lines, removed_lines, diff) = match preview {
        Some(preview) => (preview.added_lines, preview.removed_lines, preview.diff),
        None => (0, 0, String::new()),
    };

    Ok(SkillPreviewResult {
        skill_id,
        action_id,
        decision,
        risk: action.risk,
        path,
        added_lines,
        removed_lines,
        diff,
        warnings,
    })
}

#[tauri::command]
pub async fn skill_run(
    app: AppHandle,
    request: SkillRequest,
    state: State<'_, AppState>,
) -> AppResult<SkillRunResult> {
    let started = Instant::now();
    let root = state.root()?;
    let catalog = skills::load_catalog(&root)?;
    let (manifest, action) = find_action(&catalog, &request.skill_id, &request.action_id)?;
    params::validate_params(action, &request.params)?;

    let mode = normalize_mode(request.mode.as_deref())?;
    let (skill_policy, agent_policy) = {
        let conn = lock_db(&state)?;
        (
            skill_policy::load_policy(&conn, Some(&catalog))?,
            audit_policy::load_policy(&conn)?,
        )
    };

    let mut decision = skill_policy::decision_for(&skill_policy, manifest, action);
    if mode == "passive" && action.risk != Risk::Read {
        decision = Decision::Block;
    }

    let run_id = format!(
        "skill-{}-{}",
        now_millis(),
        RUN_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );

    if decision == Decision::Block {
        let audit_id = record_skill_audit(
            &state,
            &agent_policy,
            &request,
            "skill_blocked",
            "blocked",
            Some("ポリシーまたは受動モードによりブロックされました"),
        );
        return Ok(SkillRunResult {
            run_id,
            status: SkillRunStatus::Blocked,
            decision,
            changed_files: Vec::new(),
            stdout: String::new(),
            stderr: "ポリシーによりブロックされました".into(),
            exit_code: None,
            duration_ms: started.elapsed().as_millis() as u64,
            audit_id,
            error_code: Some("policy_blocked".into()),
        });
    }

    let preview = preview_for(&root, action, &request.params, manifest.limits.max_bytes)?;
    if decision == Decision::Ask && !confirm_skill(&app, manifest, action, preview.as_ref()) {
        let audit_id = record_skill_audit(
            &state,
            &agent_policy,
            &request,
            "skill_cancelled",
            "cancelled",
            Some("ユーザーが承認をキャンセルしました"),
        );
        return Ok(SkillRunResult {
            run_id,
            status: SkillRunStatus::Cancelled,
            decision,
            changed_files: Vec::new(),
            stdout: String::new(),
            stderr: "操作はキャンセルされました".into(),
            exit_code: None,
            duration_ms: started.elapsed().as_millis() as u64,
            audit_id,
            error_code: Some("user_cancelled".into()),
        });
    }

    let conn = lock_db(&state)?;
    let result = execute_handler(&root, &conn, action, &request.params, manifest);
    let duration_ms = started.elapsed().as_millis() as u64;

    match result {
        Ok(outcome) => {
            let detail = outcome.detail.clone();
            drop(conn);
            let audit_id = record_skill_audit(
                &state,
                &agent_policy,
                &request,
                "skill_run",
                "ok",
                Some(&detail),
            );
            Ok(SkillRunResult {
                run_id,
                status: SkillRunStatus::Ok,
                decision,
                changed_files: outcome.changed_files,
                stdout: truncate_chars(&outcome.stdout, manifest.limits.max_output_chars),
                stderr: String::new(),
                exit_code: None,
                duration_ms,
                audit_id,
                error_code: None,
            })
        }
        Err(error) => {
            drop(conn);
            let message = error.to_string();
            let audit_id = record_skill_audit(
                &state,
                &agent_policy,
                &request,
                "skill_run",
                "error",
                Some(&message),
            );
            Ok(SkillRunResult {
                run_id,
                status: SkillRunStatus::Failed,
                decision,
                changed_files: Vec::new(),
                stdout: String::new(),
                stderr: message,
                exit_code: None,
                duration_ms,
                audit_id,
                error_code: Some("handler_failed".into()),
            })
        }
    }
}

/// Run the verification checks declared by the manifest. The commands come
/// from the workspace layout (package manager / Cargo), never from the
/// manifest, and every check runs in its own process group with a timeout.
#[tauri::command]
pub async fn skill_verify(
    app: AppHandle,
    skill_id: String,
    action_id: String,
    checks: Option<Vec<VerificationCheck>>,
    state: State<'_, AppState>,
) -> AppResult<VerificationResult> {
    let root = state.root()?;
    let catalog = skills::load_catalog(&root)?;
    let (manifest, _action) = find_action(&catalog, &skill_id, &action_id)?;
    let verification = manifest.verification.clone();

    if verification.mode == skills::VerificationMode::None {
        return Ok(VerificationResult {
            status: CheckStatus::Skipped,
            checks: Vec::new(),
        });
    }

    let requested = checks
        .filter(|list| !list.is_empty())
        .unwrap_or_else(|| verification.checks.clone());
    let requested: Vec<VerificationCheck> = requested
        .into_iter()
        .filter(|check| verification.checks.contains(check))
        .collect();
    if requested.is_empty() {
        return Ok(VerificationResult {
            status: CheckStatus::Skipped,
            checks: Vec::new(),
        });
    }

    let (skill_policy, agent_policy) = {
        let conn = lock_db(&state)?;
        (
            skill_policy::load_policy(&conn, Some(&catalog))?,
            audit_policy::load_policy(&conn)?,
        )
    };

    let planned = verify::plan_checks(&root, &requested, verification.mode)?;
    let needs_approval = planned.iter().any(|check| {
        check.skip_reason.is_none()
            && !(skill_policy.verification.auto_run
                && skill_policy.verification.allow_checks.contains(&check.name))
    });

    let audit_request = SkillRequest {
        skill_id: skill_id.clone(),
        action_id: action_id.clone(),
        params: Value::Null,
        plan_id: None,
        step_id: None,
        title: Some("検証".into()),
        mode: None,
    };

    if needs_approval && !confirm_verification(&app, &planned, verification.timeout_ms) {
        record_skill_audit(
            &state,
            &agent_policy,
            &audit_request,
            "verification_run",
            "cancelled",
            Some("ユーザーが検証をキャンセルしました"),
        );
        return Ok(VerificationResult {
            status: CheckStatus::Skipped,
            checks: Vec::new(),
        });
    }

    let run_root = root.clone();
    let max_output = manifest.limits.max_output_chars;
    let timeout = Duration::from_millis(verification.timeout_ms);
    let stop_on_failure = verification.stop_on_failure;
    let result = tauri::async_runtime::spawn_blocking(move || {
        verify::run_planned(&run_root, planned, timeout, stop_on_failure, max_output)
    })
    .await
    .map_err(|error| AppError::Other(format!("検証の実行に失敗しました: {error}")))?;

    let outcome = match result.status {
        CheckStatus::Failed | CheckStatus::Timeout => "error",
        _ => "ok",
    };
    record_skill_audit(
        &state,
        &agent_policy,
        &audit_request,
        "verification_run",
        outcome,
        Some(&summarize_verification(&result)),
    );

    Ok(result)
}

fn summarize_verification(result: &VerificationResult) -> String {
    if result.checks.is_empty() {
        return "検証項目はありません".into();
    }
    result
        .checks
        .iter()
        .map(|check| {
            format!(
                "{} / {}: {} ({} ms)",
                verification_check_label(check.name),
                check.ecosystem,
                verification_status_label(check.status),
                check.duration_ms
            )
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn verification_check_label(check: VerificationCheck) -> &'static str {
    match check {
        VerificationCheck::Typecheck => "typecheck",
        VerificationCheck::Lint => "lint",
        VerificationCheck::Test => "test",
    }
}

fn verification_status_label(status: CheckStatus) -> &'static str {
    match status {
        CheckStatus::Passed => "passed",
        CheckStatus::Failed => "failed",
        CheckStatus::Skipped => "skipped",
        CheckStatus::Timeout => "timeout",
    }
}

fn confirm_verification(
    app: &AppHandle,
    planned: &[verify::PlannedCheck],
    timeout_ms: u64,
) -> bool {
    app.dialog()
        .message(verification_message(planned, timeout_ms))
        .title("検証の実行を承認")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "実行".to_string(),
            "キャンセル".to_string(),
        ))
        .blocking_show()
}

fn verification_message(planned: &[verify::PlannedCheck], timeout_ms: u64) -> String {
    let mut message = String::from("操作の後に次の検証を実行します。\n\n");
    for check in planned.iter().filter(|check| check.skip_reason.is_none()) {
        message.push_str(&format!(
            "- {} ({}): {}\n",
            verification_check_label(check.name),
            check.ecosystem,
            check.command().join(" ")
        ));
    }
    message.push_str(&format!(
        "\nタイムアウト: {} 秒\nこの操作はプロジェクトのコードを実行します。承認しますか？",
        timeout_ms / 1_000
    ));
    truncate_chars(&message, 4_000)
}

#[derive(Debug)]
struct HandlerOutcome {
    changed_files: Vec<String>,
    stdout: String,
    detail: String,
}

fn execute_handler(
    root: &Path,
    conn: &rusqlite::Connection,
    action: &SkillAction,
    params: &Value,
    manifest: &SkillManifest,
) -> AppResult<HandlerOutcome> {
    match action.handler.as_str() {
        "editor.readFile" => {
            let path = params::string_param(params, "path")?;
            let file = editor::read_file(root, path, manifest.limits.max_bytes)?;
            Ok(HandlerOutcome {
                changed_files: Vec::new(),
                stdout: file.content,
                detail: format!("{path} を読み取りました ({} bytes)", file.size),
            })
        }
        "editor.replaceText" => {
            let path = params::string_param(params, "path")?;
            let old_text = params::string_param(params, "oldText")?;
            let new_text = params::string_param(params, "newText")?;
            let change = editor::replace_text(
                root,
                conn,
                path,
                old_text,
                new_text,
                manifest.limits.max_bytes,
            )?;
            Ok(HandlerOutcome {
                changed_files: vec![path.to_string()],
                stdout: format!(
                    "{path} を更新しました (+{} / -{} 行)",
                    change.added_lines, change.removed_lines
                ),
                detail: format!(
                    "{path} を置換 (+{} / -{} 行, version {})",
                    change.added_lines, change.removed_lines, change.version_id
                ),
            })
        }
        "editor.createFile" => {
            let path = params::string_param(params, "path")?;
            let content = params::string_param_or(params, "content", "")?;
            let change = editor::create_file(root, conn, path, content, manifest.limits.max_bytes)?;
            Ok(HandlerOutcome {
                changed_files: vec![path.to_string()],
                stdout: format!("{path} を作成しました"),
                detail: format!("{path} を作成 (version {})", change.version_id),
            })
        }
        handler => Err(AppError::Other(format!("未実装のハンドラです: {handler}"))),
    }
}

fn preview_for(
    root: &Path,
    action: &SkillAction,
    params: &Value,
    max_bytes: u64,
) -> AppResult<Option<SkillPreview>> {
    match action.handler.as_str() {
        "editor.readFile" => {
            let path = params::string_param(params, "path")?;
            let _ = editor::read_file(root, path, max_bytes)?;
            Ok(None)
        }
        "editor.replaceText" => {
            let path = params::string_param(params, "path")?;
            let old_text = params::string_param(params, "oldText")?;
            let new_text = params::string_param(params, "newText")?;
            Ok(Some(editor::preview_replace(
                root, path, old_text, new_text, max_bytes,
            )?))
        }
        "editor.createFile" => {
            let path = params::string_param(params, "path")?;
            let content = params::string_param_or(params, "content", "")?;
            Ok(Some(editor::preview_create(
                root, path, content, max_bytes,
            )?))
        }
        handler => Err(AppError::Other(format!("未実装のハンドラです: {handler}"))),
    }
}

fn find_action<'a>(
    catalog: &'a SkillCatalog,
    skill_id: &str,
    action_id: &str,
) -> AppResult<(&'a SkillManifest, &'a SkillAction)> {
    let manifest = catalog
        .skills
        .iter()
        .find(|manifest| manifest.id == skill_id)
        .ok_or_else(|| AppError::NotFound(format!("スキル: {skill_id}")))?;
    let action = manifest
        .action(action_id)
        .ok_or_else(|| AppError::NotFound(format!("アクション: {action_id}")))?;
    Ok((manifest, action))
}

fn normalize_mode(mode: Option<&str>) -> AppResult<&'static str> {
    match mode {
        None | Some("assistive") => Ok("assistive"),
        Some("passive") => Ok("passive"),
        Some("autonomous") => Ok("autonomous"),
        Some(other) => Err(AppError::Other(format!("不明なモードです: {other}"))),
    }
}

fn lock_db<'a>(
    state: &'a State<'_, AppState>,
) -> AppResult<std::sync::MutexGuard<'a, rusqlite::Connection>> {
    state
        .db
        .lock()
        .map_err(|_| AppError::Other("DB ロックの取得に失敗しました".into()))
}

fn record_skill_audit(
    state: &State<'_, AppState>,
    agent_policy: &AgentPolicy,
    request: &SkillRequest,
    kind: &str,
    outcome: &str,
    detail: Option<&str>,
) -> i64 {
    let Ok(conn) = state.db.lock() else {
        return 0;
    };
    let input = AuditInput {
        kind: kind.to_string(),
        mode: request.mode.clone(),
        plan_id: request.plan_id.clone(),
        step_id: request.step_id.clone(),
        skill_id: Some(request.skill_id.clone()),
        action_id: Some(request.action_id.clone()),
        title: request
            .title
            .clone()
            .or_else(|| Some(format!("{} / {}", request.skill_id, request.action_id))),
        command: None,
        outcome: Some(outcome.to_string()),
        detail: detail.map(|value| truncate_chars(value, 4_000)),
    };
    audit_policy::record_audit(&conn, agent_policy, &input).unwrap_or(0)
}

fn confirm_skill(
    app: &AppHandle,
    manifest: &SkillManifest,
    action: &SkillAction,
    preview: Option<&SkillPreview>,
) -> bool {
    app.dialog()
        .message(approval_message(manifest, action, preview))
        .title("スキルの実行を承認")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "実行".to_string(),
            "キャンセル".to_string(),
        ))
        .blocking_show()
}

fn approval_message(
    manifest: &SkillManifest,
    action: &SkillAction,
    preview: Option<&SkillPreview>,
) -> String {
    let mut message = format!(
        "スキル「{}」で次の操作を実行します。\n\n操作: {}\nリスク: {}\n",
        manifest.name,
        action.description,
        action.risk.as_str()
    );
    if let Some(preview) = preview {
        message.push_str(&format!(
            "対象: {}\n差分: +{} / -{} 行\n\n{}\n",
            preview.path,
            preview.added_lines,
            preview.removed_lines,
            truncate_chars(&preview.diff, 2_000)
        ));
    }
    message.push_str("\nこの手順のみ許可します。承認しますか？");
    truncate_chars(&message, 4_000)
}

fn truncate_chars(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        value.to_string()
    } else {
        format!("{}…", value.chars().take(limit).collect::<String>())
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use rusqlite::Connection;
    use serde_json::json;

    use super::*;

    fn workspace(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock before epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "right-stuff-skill-command-{tag}-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create workspace");
        fs::canonicalize(&root).expect("canonicalize workspace")
    }

    fn connection() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        crate::db::init(&conn).expect("init db");
        conn
    }

    fn manifest() -> SkillManifest {
        crate::skills::parse_manifest(
            include_str!("../../tests/fixtures/skills/valid/code-edit.json"),
            "code-edit",
        )
        .expect("valid fixture")
    }

    fn action(manifest: &SkillManifest, id: &str) -> SkillAction {
        manifest.action(id).expect("fixture action").clone()
    }

    #[test]
    fn normalizes_modes_and_rejects_unknown_values() {
        assert_eq!(normalize_mode(None).unwrap(), "assistive");
        assert_eq!(normalize_mode(Some("assistive")).unwrap(), "assistive");
        assert_eq!(normalize_mode(Some("passive")).unwrap(), "passive");
        assert_eq!(normalize_mode(Some("autonomous")).unwrap(), "autonomous");
        let error = normalize_mode(Some("turbo")).expect_err("unknown mode");
        assert!(error.to_string().contains("turbo"));
    }

    #[test]
    fn approval_message_includes_the_preview_and_truncates() {
        let manifest = manifest();
        let action = action(&manifest, "editor.replaceText");
        let preview = SkillPreview {
            path: "src/App.tsx".into(),
            added_lines: 1,
            removed_lines: 1,
            diff: "+const value = 2;\n-const value = 1;\n".into(),
        };

        let message = approval_message(&manifest, &action, Some(&preview));
        assert!(message.contains("Code Edit"));
        assert!(message.contains("src/App.tsx"));
        assert!(message.contains("+1 / -1"));
        assert!(message.contains("+const value = 2;"));

        let preview = SkillPreview {
            diff: "x".repeat(10_000),
            ..preview
        };
        let message = approval_message(&manifest, &action, Some(&preview));
        assert!(message.chars().count() <= 4_000);
        assert!(message.contains('…'));
        assert!(message.contains("この手順のみ許可します"));
    }

    #[test]
    fn truncates_to_the_character_limit() {
        assert_eq!(truncate_chars("abc", 5), "abc");
        assert_eq!(truncate_chars("abcdef", 3), "abc…");
        assert_eq!(truncate_chars("あいうえお", 2), "あい…");
        assert_eq!(truncate_chars("", 1), "");
    }

    #[test]
    fn executes_the_read_handler() {
        let root = workspace("read");
        fs::write(root.join("app.ts"), "export const value = 1;\n").expect("seed");
        let conn = connection();
        let manifest = manifest();
        let action = action(&manifest, "editor.readFile");

        let outcome = execute_handler(
            &root,
            &conn,
            &action,
            &json!({ "path": "app.ts" }),
            &manifest,
        )
        .expect("read");
        assert!(outcome.stdout.contains("export const value"));
        assert!(outcome.changed_files.is_empty());

        fs::remove_dir_all(root).expect("clean workspace");
    }

    #[test]
    fn executes_write_handlers_and_records_versions() {
        let root = workspace("write");
        fs::write(root.join("app.ts"), "let a = 1;\n").expect("seed");
        let conn = connection();
        let manifest = manifest();

        let replace = action(&manifest, "editor.replaceText");
        let outcome = execute_handler(
            &root,
            &conn,
            &replace,
            &json!({
                "path": "app.ts",
                "oldText": "let a = 1;",
                "newText": "let a = 2;"
            }),
            &manifest,
        )
        .expect("replace");
        assert_eq!(outcome.changed_files, vec!["app.ts".to_string()]);
        assert!(
            fs::read_to_string(root.join("app.ts"))
                .expect("read back")
                .contains("let a = 2;")
        );

        let create = action(&manifest, "editor.createFile");
        let outcome = execute_handler(
            &root,
            &conn,
            &create,
            &json!({ "path": "src/new.ts", "content": "export {};" }),
            &manifest,
        )
        .expect("create");
        assert_eq!(outcome.changed_files, vec!["src/new.ts".to_string()]);
        assert!(root.join("src/new.ts").is_file());

        let versions: i64 = conn
            .query_row("SELECT COUNT(*) FROM file_versions", [], |row| row.get(0))
            .expect("count versions");
        assert_eq!(versions, 2);

        fs::remove_dir_all(root).expect("clean workspace");
    }

    #[test]
    fn reports_handler_failures_without_writing() {
        let root = workspace("fail");
        fs::write(root.join("app.ts"), "let a = 1;\n").expect("seed");
        let conn = connection();
        let manifest = manifest();
        let action = action(&manifest, "editor.replaceText");

        let error = execute_handler(
            &root,
            &conn,
            &action,
            &json!({
                "path": "app.ts",
                "oldText": "missing",
                "newText": "x"
            }),
            &manifest,
        )
        .expect_err("missing match");
        assert!(error.to_string().contains("ありません"));
        assert_eq!(
            fs::read_to_string(root.join("app.ts")).expect("read back"),
            "let a = 1;\n"
        );

        fs::remove_dir_all(root).expect("clean workspace");
    }

    #[test]
    fn rejects_unregistered_handlers() {
        let root = workspace("handler");
        let conn = connection();
        let manifest = manifest();
        let mut action = action(&manifest, "editor.readFile");
        action.handler = "editor.unknown".into();

        let error = execute_handler(&root, &conn, &action, &json!({}), &manifest)
            .expect_err("unknown handler");
        assert!(error.to_string().contains("未実装"));

        fs::remove_dir_all(root).expect("clean workspace");
    }
}
