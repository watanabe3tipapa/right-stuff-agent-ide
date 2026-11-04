use std::path::PathBuf;
use std::process::Command;

use serde::Serialize;
use tauri::State;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::commands::policy::{self, AgentAuditMeta};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

const MAX_OUTPUT_CHARS: usize = 200_000;
const MAX_ARG_COUNT: usize = 12;
const MAX_ARG_CHARS: usize = 16_384;
const MAX_TOTAL_ARG_CHARS: usize = 32_768;
const DIALOG_ARG_PREVIEW_CHARS: usize = 240;

pub(crate) const ALLOWED_ACTIONS: &[&str] = &[
    "snapshot",
    "click",
    "type",
    "set-value",
    "press",
    "scroll",
    "list-apps",
    "list-windows",
    "focus-window",
    "launch",
    "close-app",
    "clipboard-get",
    "clipboard-set",
    "list-notifications",
    "dismiss-notification",
    "session",
    "trace",
    "--version",
    "--help",
];

/// Actions that only read state and never mutate the desktop. Everything else
/// must be approved by the user through a native dialog before it runs.
pub(crate) const READ_ONLY_ACTIONS: &[&str] = &[
    "snapshot",
    "list-apps",
    "list-windows",
    "list-notifications",
    "--version",
    "--help",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    pub available: bool,
    pub binary: Option<String>,
    pub version: Option<String>,
    pub platform: String,
    pub arch: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunResult {
    pub ok: bool,
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub command: Vec<String>,
}

fn which(binary: &str) -> Option<PathBuf> {
    let candidate = PathBuf::from(binary);
    if candidate.components().count() > 1 {
        return candidate.is_file().then_some(candidate);
    }

    let paths = std::env::var_os("PATH")?;
    std::env::split_paths(&paths)
        .map(|dir| dir.join(binary))
        .find(|path| path.is_file())
}

fn find_binary() -> Option<PathBuf> {
    if let Ok(explicit) = std::env::var("AGENT_DESKTOP_BIN") {
        let path = PathBuf::from(explicit);
        if path.is_file() {
            return Some(path);
        }
    }

    ["agent-desktop", "agent-desktop-cli", "agent"]
        .iter()
        .find_map(|name| which(name))
}

fn truncate(value: String) -> String {
    if value.chars().count() <= MAX_OUTPUT_CHARS {
        value
    } else {
        let mut truncated: String = value.chars().take(MAX_OUTPUT_CHARS).collect();
        truncated.push_str("\n… (出力が長いため省略されました)");
        truncated
    }
}

/// Validate the action and its arguments before anything is executed.
///
/// The CLI is invoked without a shell, so quoting is not an issue. This layer
/// still bounds the input size and rejects argument shapes that are known to be
/// dangerous for the action (for example launching an arbitrary path).
fn validate_args(args: &[String]) -> AppResult<()> {
    let Some(action) = args.first() else {
        return Err(AppError::Other(
            "実行するアクションを指定してください".into(),
        ));
    };

    if !ALLOWED_ACTIONS.contains(&action.as_str()) {
        return Err(AppError::Other(format!(
            "許可されていないアクションです: {action}"
        )));
    }

    if args.len() > MAX_ARG_COUNT {
        return Err(AppError::Other(format!(
            "引数が多すぎます (上限 {MAX_ARG_COUNT} 個)"
        )));
    }

    let mut total_chars = 0usize;
    for arg in args {
        if arg.contains('\0') {
            return Err(AppError::Other("引数に NUL 文字は指定できません".into()));
        }
        let chars = arg.chars().count();
        if chars > MAX_ARG_CHARS {
            return Err(AppError::Other(format!(
                "引数が長すぎます (1 個あたり上限 {MAX_ARG_CHARS} 文字)"
            )));
        }
        total_chars += chars;
    }
    if total_chars > MAX_TOTAL_ARG_CHARS {
        return Err(AppError::Other(format!(
            "引数の合計が長すぎます (上限 {MAX_TOTAL_ARG_CHARS} 文字)"
        )));
    }

    match action.as_str() {
        "launch" | "close-app" if args.len() != 2 => {
            return Err(AppError::Other(format!(
                "{action} にはアプリ名を 1 つ指定してください"
            )));
        }
        "launch" | "close-app" => {
            validate_app_name(&args[1])?;
        }
        "type" | "set-value" | "clipboard-set" if args.len() < 2 || args[1].trim().is_empty() => {
            return Err(AppError::Other(format!(
                "{action} には書き込む内容を指定してください"
            )));
        }
        "click" | "press" | "scroll" | "focus-window" | "dismiss-notification"
            if args.len() < 2 =>
        {
            return Err(AppError::Other(format!(
                "{action} には対象を指定してください"
            )));
        }
        _ => {}
    }

    Ok(())
}

fn validate_app_name(name: &str) -> AppResult<()> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::Other("アプリ名が空です".into()));
    }
    if trimmed.starts_with('-') {
        return Err(AppError::Other(
            "アプリ名をオプションとして指定することはできません".into(),
        ));
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains("..") {
        return Err(AppError::Other(
            "アプリ名にはパス区切りや '..' を指定できません".into(),
        ));
    }
    Ok(())
}

pub(crate) fn default_decision(action: &str) -> &'static str {
    if READ_ONLY_ACTIONS.contains(&action) {
        "allow"
    } else {
        "ask"
    }
}

fn approval_message(args: &[String]) -> String {
    let command = args
        .iter()
        .map(|arg| {
            if arg.chars().count() > DIALOG_ARG_PREVIEW_CHARS {
                format!(
                    "{}…",
                    arg.chars()
                        .take(DIALOG_ARG_PREVIEW_CHARS)
                        .collect::<String>()
                )
            } else {
                arg.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(" ");

    format!(
        "Agent Desktop で次の操作を実行します。\n\n{command}\n\n内容を確認して承認してください。"
    )
}

fn confirm_action(app: &tauri::AppHandle, args: &[String]) -> bool {
    app.dialog()
        .message(approval_message(args))
        .title("Agent Desktop の操作を承認")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "実行".to_string(),
            "キャンセル".to_string(),
        ))
        .blocking_show()
}

fn log_action(
    state: &State<'_, AppState>,
    policy: &policy::AgentPolicy,
    meta: Option<&AgentAuditMeta>,
    args: &[String],
    outcome: &str,
    detail: Option<&str>,
) {
    if let Ok(conn) = state.db.lock() {
        let _ = policy::record_action(&conn, policy, meta, args, outcome, detail);
    }
}

fn execute(binary: &PathBuf, args: &[String]) -> AppResult<AgentRunResult> {
    let output = Command::new(binary).args(args).output().map_err(|error| {
        AppError::Other(format!("Agent Desktop を起動できませんでした: {error}"))
    })?;

    Ok(AgentRunResult {
        ok: output.status.success(),
        code: output.status.code(),
        stdout: truncate(String::from_utf8_lossy(&output.stdout).to_string()),
        stderr: truncate(String::from_utf8_lossy(&output.stderr).to_string()),
        command: std::iter::once("agent-desktop".to_string())
            .chain(args.iter().cloned())
            .collect(),
    })
}

#[tauri::command]
pub async fn agent_status() -> AgentStatus {
    let platform = std::env::consts::OS.to_string();
    let arch = std::env::consts::ARCH.to_string();

    let Some(binary) = find_binary() else {
        return AgentStatus {
            available: false,
            binary: None,
            version: None,
            platform,
            arch,
            message: "Agent Desktop CLI が見つかりません。AGENT_DESKTOP_BIN 環境変数でパスを指定できます。"
                .into(),
        };
    };

    let version = Command::new(&binary)
        .arg("--version")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if stdout.is_empty() {
                String::from_utf8_lossy(&output.stderr).trim().to_string()
            } else {
                stdout
            }
        })
        .filter(|value| !value.is_empty());

    AgentStatus {
        available: true,
        binary: Some(binary.to_string_lossy().to_string()),
        version,
        platform,
        arch,
        message: "Agent Desktop CLI を利用できます。".into(),
    }
}

#[tauri::command]
pub async fn agent_run(
    app: tauri::AppHandle,
    args: Vec<String>,
    audit: Option<AgentAuditMeta>,
    state: State<'_, AppState>,
) -> AppResult<AgentRunResult> {
    validate_args(&args)?;

    let action = args[0].clone();
    let policy = {
        let conn = state
            .db
            .lock()
            .map_err(|_| AppError::Other("DB ロックの取得に失敗しました".into()))?;
        policy::load_policy(&conn)?
    };

    match policy::decision(&policy, &action) {
        "block" => {
            log_action(
                &state,
                &policy,
                audit.as_ref(),
                &args,
                "blocked",
                Some("ポリシーによりブロックされました"),
            );
            return Err(AppError::Other(format!(
                "ポリシーにより {action} の実行はブロックされています"
            )));
        }
        "ask" if !confirm_action(&app, &args) => {
            log_action(
                &state,
                &policy,
                audit.as_ref(),
                &args,
                "cancelled",
                Some("ユーザーが承認をキャンセルしました"),
            );
            return Err(AppError::Other("操作はキャンセルされました".into()));
        }
        _ => {}
    }

    let binary = find_binary().ok_or_else(|| {
        AppError::Other(
            "Agent Desktop CLI が見つかりません。AGENT_DESKTOP_BIN 環境変数でパスを指定できます。"
                .into(),
        )
    })?;

    let result = execute(&binary, &args);
    match &result {
        Ok(output) => {
            let outcome = if output.ok { "ok" } else { "error" };
            let detail = if output.ok {
                None
            } else {
                Some(output.stderr.trim())
            };
            log_action(
                &state,
                &policy,
                audit.as_ref(),
                &args,
                outcome,
                detail.filter(|value| !value.is_empty()),
            );
        }
        Err(error) => {
            log_action(
                &state,
                &policy,
                audit.as_ref(),
                &args,
                "error",
                Some(&error.to_string()),
            );
        }
    }

    result
}

#[tauri::command]
pub async fn agent_snapshot(
    app_handle: tauri::AppHandle,
    app: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<AgentRunResult> {
    let policy = {
        let conn = state
            .db
            .lock()
            .map_err(|_| AppError::Other("DB ロックの取得に失敗しました".into()))?;
        policy::load_policy(&conn)?
    };

    let mut args = vec!["snapshot".to_string(), "--json".to_string()];
    if let Some(app) = app.filter(|value| !value.trim().is_empty()) {
        args.push("--app".into());
        args.push(app);
    }

    match policy::decision(&policy, "snapshot") {
        "block" => {
            log_action(
                &state,
                &policy,
                None,
                &args,
                "blocked",
                Some("ポリシーによりブロックされました"),
            );
            return Err(AppError::Other(
                "ポリシーにより snapshot の実行はブロックされています".into(),
            ));
        }
        "ask" if !confirm_action(&app_handle, &args) => {
            log_action(
                &state,
                &policy,
                None,
                &args,
                "cancelled",
                Some("ユーザーが承認をキャンセルしました"),
            );
            return Err(AppError::Other("操作はキャンセルされました".into()));
        }
        _ => {}
    }

    let binary = find_binary().ok_or_else(|| {
        AppError::Other(
            "Agent Desktop CLI が見つかりません。AGENT_DESKTOP_BIN 環境変数でパスを指定できます。"
                .into(),
        )
    })?;

    let result = execute(&binary, &args);
    match &result {
        Ok(output) => {
            let outcome = if output.ok { "ok" } else { "error" };
            let detail = if output.ok {
                None
            } else {
                Some(output.stderr.trim())
            };
            log_action(
                &state,
                &policy,
                None,
                &args,
                outcome,
                detail.filter(|value| !value.is_empty()),
            );
        }
        Err(error) => {
            log_action(
                &state,
                &policy,
                None,
                &args,
                "error",
                Some(&error.to_string()),
            );
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| item.to_string()).collect()
    }

    #[test]
    fn rejects_empty_arguments() {
        assert!(validate_args(&[]).is_err());
    }

    #[test]
    fn rejects_unknown_actions() {
        assert!(validate_args(&args(&["rm", "-rf", "/"])).is_err());
    }

    #[test]
    fn rejects_nul_bytes() {
        assert!(validate_args(&args(&["type", "hello\0world"])).is_err());
    }

    #[test]
    fn rejects_excessive_argument_count() {
        let mut values = vec!["type".to_string()];
        values.extend((0..MAX_ARG_COUNT).map(|index| format!("arg-{index}")));
        assert!(validate_args(&values).is_err());
    }

    #[test]
    fn rejects_oversized_arguments() {
        let value = "a".repeat(MAX_ARG_CHARS + 1);
        assert!(validate_args(&args(&["type", &value])).is_err());
    }

    #[test]
    fn launch_requires_exactly_one_app_name() {
        assert!(validate_args(&args(&["launch"])).is_err());
        assert!(validate_args(&args(&["launch", "Safari", "extra"])).is_err());
        assert!(validate_args(&args(&["launch", "Safari"])).is_ok());
    }

    #[test]
    fn launch_rejects_paths() {
        assert!(validate_args(&args(&["launch", "/Applications/Safari.app"])).is_err());
        assert!(validate_args(&args(&["launch", "../Safari"])).is_err());
        assert!(validate_args(&args(&["launch", "-a"])).is_err());
    }

    #[test]
    fn typing_requires_content() {
        assert!(validate_args(&args(&["type"])).is_err());
        assert!(validate_args(&args(&["type", "   "])).is_err());
        assert!(validate_args(&args(&["type", "hello"])).is_ok());
    }

    #[test]
    fn default_policy_allows_reads_and_asks_for_writes() {
        for action in READ_ONLY_ACTIONS {
            assert_eq!(
                default_decision(action),
                "allow",
                "{action} should be read-only"
            );
        }
        for action in ["click", "type", "launch", "close-app", "clipboard-set"] {
            assert_eq!(
                default_decision(action),
                "ask",
                "{action} should require approval"
            );
        }
    }
}
