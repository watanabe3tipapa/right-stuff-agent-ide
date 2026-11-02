use std::path::PathBuf;
use std::process::Command;

use serde::Serialize;

use crate::error::{AppError, AppResult};

const MAX_OUTPUT_CHARS: usize = 200_000;

const ALLOWED_ACTIONS: &[&str] = &[
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
pub async fn agent_run(args: Vec<String>) -> AppResult<AgentRunResult> {
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

    let binary = find_binary().ok_or_else(|| {
        AppError::Other(
            "Agent Desktop CLI が見つかりません。AGENT_DESKTOP_BIN 環境変数でパスを指定できます。"
                .into(),
        )
    })?;

    execute(&binary, &args)
}

#[tauri::command]
pub async fn agent_snapshot(app: Option<String>) -> AppResult<AgentRunResult> {
    let binary = find_binary().ok_or_else(|| {
        AppError::Other(
            "Agent Desktop CLI が見つかりません。AGENT_DESKTOP_BIN 環境変数でパスを指定できます。"
                .into(),
        )
    })?;

    let mut args = vec!["snapshot".to_string(), "--json".to_string()];
    if let Some(app) = app.filter(|value| !value.trim().is_empty()) {
        args.push("--app".into());
        args.push(app);
    }

    execute(&binary, &args)
}
