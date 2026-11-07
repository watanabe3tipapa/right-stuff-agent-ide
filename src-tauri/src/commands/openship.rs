use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::Method;
use reqwest::header::{ACCEPT, HeaderValue};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::commands::policy::{self, AuditInput};
use crate::db;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

pub const SETTING_OPENSHIP_CONFIG: &str = "openship_config";
const KEYRING_SERVICE: &str = "com.rightstuff.agentide.openship";
const KEYRING_USER: &str = "token";

const MAX_BASE_URL_CHARS: usize = 2_048;
const MAX_ID_CHARS: usize = 200;
const MAX_BRANCH_CHARS: usize = 200;
const MAX_PATH_CHARS: usize = 4_096;
const MAX_TOKEN_CHARS: usize = 4_096;
const MAX_OUTPUT_CHARS: usize = 200_000;
const MAX_ERROR_CHARS: usize = 500;
const MAX_HTTP_BODY_BYTES: usize = 2_000_000;
const MAX_DEPLOYMENTS: i64 = 50;
const MAX_PROJECTS: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct OpenShipConfig {
    /// Base URL of a self-hosted Openship server (for example
    /// `https://openship.example.com`). Empty means CLI-only.
    pub base_url: String,
    pub organization_id: String,
    pub project_id: String,
    pub branch: String,
    /// Optional explicit path to the `openship` CLI binary.
    pub cli_path: String,
}

fn default_branch() -> String {
    "main".to_string()
}

impl Default for OpenShipConfig {
    fn default() -> Self {
        Self {
            base_url: String::new(),
            organization_id: String::new(),
            project_id: String::new(),
            branch: default_branch(),
            cli_path: String::new(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenShipSettings {
    #[serde(flatten)]
    pub config: OpenShipConfig,
    pub token_configured: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenShipStatus {
    pub cli_available: bool,
    pub cli_path: Option<String>,
    pub cli_version: Option<String>,
    pub server_configured: bool,
    pub server_reachable: bool,
    pub server_message: String,
    pub token_configured: bool,
    pub base_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenShipProject {
    pub id: String,
    pub name: String,
    pub slug: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenShipDeployment {
    pub id: String,
    pub project_id: Option<String>,
    pub status: String,
    pub environment: Option<String>,
    pub branch: Option<String>,
    pub url: Option<String>,
    pub created_at: Option<i64>,
    pub commit: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenShipDeployResult {
    pub ok: bool,
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub command: Vec<String>,
    pub deployment: Option<OpenShipDeployment>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenShipLogs {
    pub deployment_id: String,
    pub ok: bool,
    pub status: Option<u16>,
    pub logs: String,
}

fn lock_db<'a>(
    state: &'a State<'_, AppState>,
) -> AppResult<std::sync::MutexGuard<'a, rusqlite::Connection>> {
    state
        .db
        .lock()
        .map_err(|_| AppError::Other("DB ロックの取得に失敗しました".into()))
}

fn truncate_chars(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        value.to_string()
    } else {
        format!("{}…", value.chars().take(limit).collect::<String>())
    }
}

fn compact_message(value: &str) -> String {
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    truncate_chars(&compact, MAX_ERROR_CHARS)
}

fn compact_message_redacted(value: &str, token: Option<&str>) -> String {
    let redacted = match token {
        Some(token) if !token.is_empty() => value.replace(token, "[REDACTED]"),
        _ => value.to_string(),
    };
    compact_message(&redacted)
}

/// Openship may report a failed operation as JSON on stdout with an empty
/// stderr, so keep the CLI diagnostics visible in the audit log.
fn failure_detail(result: &OpenShipDeployResult) -> String {
    if result.stderr.trim().is_empty() {
        result.stdout.clone()
    } else {
        result.stderr.clone()
    }
}

fn validate_base_url(raw: &str) -> AppResult<String> {
    let trimmed = raw.trim().trim_end_matches('/');
    // The SDK accepts an `/api` suffix, but every request in this module adds
    // `/api` itself. Normalize it away so both forms work.
    let trimmed = trimmed.strip_suffix("/api").unwrap_or(trimmed);
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    if trimmed.chars().count() > MAX_BASE_URL_CHARS {
        return Err(AppError::Other(
            "Openship の Base URL が長すぎます。".into(),
        ));
    }
    if trimmed
        .chars()
        .any(|ch| ch.is_control() || ch.is_whitespace())
    {
        return Err(AppError::Other(
            "Openship の Base URL に空白や制御文字は使用できません。".into(),
        ));
    }

    let url = reqwest::Url::parse(trimmed)
        .map_err(|_| AppError::Other("Openship の Base URL の形式が正しくありません。".into()))?;
    match url.scheme() {
        "https" => {}
        "http" => {
            let host = url.host_str().unwrap_or_default();
            let is_local =
                host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "[::1]";
            if !is_local {
                return Err(AppError::Other(
                    "http:// は localhost / 127.0.0.1 / ::1 でのみ使用できます。外部ホストには https:// を指定してください。".into(),
                ));
            }
        }
        _ => {
            return Err(AppError::Other(
                "Openship の Base URL は https:// またはローカルホストの http:// で指定してください。".into(),
            ));
        }
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(AppError::Other(
            "Openship の Base URL にユーザー名やパスワードを含めないでください。".into(),
        ));
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(AppError::Other(
            "Openship の Base URL にクエリやフラグメントを含めないでください。".into(),
        ));
    }

    Ok(trimmed.to_string())
}

/// Openship IDs end up in REST path segments, so accept only a conservative
/// character set.
fn validate_id(raw: &str, label: &str) -> AppResult<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::Other(format!("{label} を入力してください。")));
    }
    if trimmed.chars().count() > MAX_ID_CHARS {
        return Err(AppError::Other(format!("{label} が長すぎます。")));
    }
    if trimmed == "." || trimmed == ".." {
        return Err(AppError::Other(format!("{label} が不正です。")));
    }
    if !trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err(AppError::Other(format!(
            "{label} には英数字・ハイフン・アンダースコア・ドットのみ使用できます。"
        )));
    }
    Ok(trimmed.to_string())
}

fn validate_optional_id(raw: &str, label: &str) -> AppResult<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    validate_id(trimmed, label)
}

fn validate_branch(raw: &str) -> AppResult<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(default_branch());
    }
    if trimmed.chars().count() > MAX_BRANCH_CHARS {
        return Err(AppError::Other("ブランチ名が長すぎます。".into()));
    }
    if trimmed.starts_with('-')
        || trimmed.starts_with('/')
        || trimmed.ends_with('/')
        || trimmed.contains("..")
        || trimmed.contains("//")
        || trimmed.chars().any(|ch| {
            ch.is_control()
                || ch.is_whitespace()
                || matches!(
                    ch,
                    '\\' | ':' | '?' | '*' | '[' | ']' | '~' | '^' | '@' | '{' | '}'
                )
        })
    {
        return Err(AppError::Other("ブランチ名が不正です。".into()));
    }
    Ok(trimmed.to_string())
}

fn validate_cli_path(raw: &str) -> AppResult<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    if trimmed.chars().count() > MAX_PATH_CHARS {
        return Err(AppError::Other("Openship CLI のパスが長すぎます。".into()));
    }
    if trimmed.chars().any(char::is_control) {
        return Err(AppError::Other(
            "Openship CLI のパスに制御文字は使用できません。".into(),
        ));
    }
    Ok(trimmed.to_string())
}

fn normalize_config(mut config: OpenShipConfig) -> AppResult<OpenShipConfig> {
    config.base_url = validate_base_url(&config.base_url)?;
    config.organization_id = validate_optional_id(&config.organization_id, "Organization ID")?;
    config.project_id = validate_optional_id(&config.project_id, "Project ID")?;
    config.branch = validate_branch(&config.branch)?;
    config.cli_path = validate_cli_path(&config.cli_path)?;
    Ok(config)
}

fn load_config(conn: &rusqlite::Connection) -> AppResult<OpenShipConfig> {
    let Some(raw) = db::get_setting(conn, SETTING_OPENSHIP_CONFIG)? else {
        return Ok(OpenShipConfig::default());
    };
    match serde_json::from_str::<OpenShipConfig>(&raw) {
        Ok(config) => Ok(normalize_config(config).unwrap_or_default()),
        Err(_) => Ok(OpenShipConfig::default()),
    }
}

fn save_config(conn: &rusqlite::Connection, config: &OpenShipConfig) -> AppResult<()> {
    let raw = serde_json::to_string(config)?;
    db::set_setting(conn, SETTING_OPENSHIP_CONFIG, &raw)
}

fn key_entry() -> AppResult<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|_| {
        AppError::Other(
            "OS キーチェーンを利用できませんでした。システムのキーチェーン設定を確認してください。"
                .into(),
        )
    })
}

fn read_token() -> AppResult<Option<String>> {
    let entry = key_entry()?;
    match entry.get_password() {
        Ok(token) => {
            let trimmed = token.trim();
            if trimmed.is_empty() {
                Ok(None)
            } else {
                Ok(Some(trimmed.to_string()))
            }
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(AppError::Other(
            "OS キーチェーンから Openship トークンを取得できませんでした。".into(),
        )),
    }
}

fn validate_token(token: &str) -> AppResult<&str> {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return Err(AppError::Other(
            "Openship トークンを入力してください。".into(),
        ));
    }
    if trimmed.chars().count() > MAX_TOKEN_CHARS {
        return Err(AppError::Other("Openship トークンが長すぎます。".into()));
    }
    if trimmed.chars().any(char::is_control) {
        return Err(AppError::Other(
            "Openship トークンに改行や制御文字は使用できません。".into(),
        ));
    }
    Ok(trimmed)
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

fn detect_cli(config: &OpenShipConfig) -> Option<PathBuf> {
    if !config.cli_path.is_empty() {
        let path = PathBuf::from(&config.cli_path);
        if path.is_file() {
            return Some(path);
        }
    }
    if let Ok(explicit) = std::env::var("OPENSHIP_BIN") {
        let path = PathBuf::from(explicit);
        if path.is_file() {
            return Some(path);
        }
    }
    which("openship")
}

fn run_cli(
    binary: &Path,
    cwd: Option<&Path>,
    args: &[&str],
) -> std::io::Result<std::process::Output> {
    let mut command = Command::new(binary);
    command.args(args);
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    command.output()
}

fn cli_version(binary: &Path) -> Option<String> {
    let output = run_cli(binary, None, &["--version"]).ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let value = if text.trim().is_empty() {
        String::from_utf8_lossy(&output.stderr).to_string()
    } else {
        text.to_string()
    };
    let first = value.lines().next().unwrap_or_default().trim();
    if first.is_empty() {
        None
    } else {
        Some(truncate_chars(first, 200))
    }
}

fn api_request(
    state: &State<'_, AppState>,
    method: Method,
    url: &str,
    token: Option<&str>,
    organization_id: &str,
) -> reqwest::RequestBuilder {
    let mut request = state
        .http
        .request(method, url)
        .header(ACCEPT, "application/json")
        .timeout(Duration::from_secs(60));

    if let Some(token) = token {
        request = request.bearer_auth(token);
    }
    if !organization_id.is_empty()
        && let Ok(value) = HeaderValue::from_str(organization_id)
    {
        request = request.header("X-Organization-Id", value);
    }
    request
}

async fn read_body_limited(response: reqwest::Response, limit: usize) -> Vec<u8> {
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();

    while let Some(chunk) = stream.next().await {
        let Ok(chunk) = chunk else {
            break;
        };
        let remaining = limit.saturating_sub(bytes.len());
        if remaining == 0 {
            break;
        }
        if chunk.len() > remaining {
            bytes.extend_from_slice(&chunk[..remaining]);
            break;
        }
        bytes.extend_from_slice(&chunk);
    }

    bytes
}

fn text_field(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        value
            .get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(str::to_string)
    })
}

fn timestamp_field(value: &Value, keys: &[&str]) -> Option<i64> {
    keys.iter().find_map(|key| {
        let value = value.get(*key)?;
        if let Some(number) = value.as_i64() {
            if number > 0 && number < 10_000_000_000 {
                Some(number * 1_000)
            } else {
                Some(number)
            }
        } else {
            value
                .as_str()
                .and_then(|text| chrono::DateTime::parse_from_rfc3339(text).ok())
                .map(|date| date.timestamp_millis())
        }
    })
}

fn select_array<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a Vec<Value>> {
    if let Some(array) = value.as_array() {
        return Some(array);
    }
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_array))
}

fn parse_project(value: &Value) -> Option<OpenShipProject> {
    let id = text_field(value, &["id", "_id", "projectId", "project_id", "uuid"])
        .or_else(|| text_field(value, &["name", "slug"]))?;
    if !id
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | ':'))
    {
        return None;
    }
    let name = text_field(value, &["name", "title", "slug"]).unwrap_or_else(|| id.clone());
    Some(OpenShipProject {
        id,
        name: truncate_chars(&name, MAX_ID_CHARS),
        slug: text_field(value, &["slug"]),
    })
}

fn parse_deployment(value: &Value) -> Option<OpenShipDeployment> {
    let id = text_field(
        value,
        &["id", "_id", "deploymentId", "deployment_id", "uuid"],
    )?;
    if !id
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | ':'))
    {
        return None;
    }
    Some(OpenShipDeployment {
        id,
        project_id: text_field(value, &["projectId", "project_id", "project"]),
        status: text_field(value, &["status", "state", "phase"])
            .unwrap_or_else(|| "unknown".into()),
        environment: text_field(value, &["environment", "env"]),
        branch: text_field(value, &["branch", "ref"]),
        url: text_field(value, &["url", "deploymentUrl", "domain", "previewUrl"]),
        created_at: timestamp_field(
            value,
            &["createdAt", "created_at", "timestamp", "deployedAt"],
        ),
        commit: text_field(value, &["commit", "sha", "commitSha", "commit_sha"]),
    })
}

fn parse_projects(value: &Value) -> Vec<OpenShipProject> {
    select_array(value, &["projects", "items", "data"])
        .map(|items| {
            items
                .iter()
                .filter_map(parse_project)
                .take(MAX_PROJECTS)
                .collect()
        })
        .unwrap_or_default()
}

fn parse_deployments(value: &Value) -> Vec<OpenShipDeployment> {
    select_array(value, &["deployments", "items", "data"])
        .map(|items| {
            items
                .iter()
                .filter_map(parse_deployment)
                .take(MAX_DEPLOYMENTS as usize)
                .collect()
        })
        .unwrap_or_default()
}

fn extract_logs(value: &Value) -> String {
    if let Some(text) = value.as_str() {
        return truncate_chars(text, MAX_OUTPUT_CHARS);
    }
    for key in ["logs", "output", "text", "content", "data"] {
        if let Some(text) = value.get(key) {
            if let Some(text) = text.as_str() {
                return truncate_chars(text, MAX_OUTPUT_CHARS);
            }
            if let Some(items) = text.as_array() {
                let joined = items
                    .iter()
                    .map(|item| {
                        item.as_str()
                            .map(str::to_string)
                            .unwrap_or_else(|| item.to_string())
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                return truncate_chars(&joined, MAX_OUTPUT_CHARS);
            }
        }
    }
    truncate_chars(&value.to_string(), MAX_OUTPUT_CHARS)
}

fn require_server(config: &OpenShipConfig, token: Option<&str>) -> AppResult<(String, String)> {
    if config.base_url.is_empty() {
        return Err(AppError::Other(
            "Openship の Base URL が設定されていません。設定画面から接続先を登録してください。"
                .into(),
        ));
    }
    let Some(token) = token else {
        return Err(AppError::Other(
            "Openship のトークンが設定されていません。設定画面から PAT を登録してください。".into(),
        ));
    };
    Ok((config.base_url.clone(), token.to_string()))
}

fn audit(state: &State<'_, AppState>, outcome: &str, command: Vec<String>, detail: Option<String>) {
    let kind = match outcome {
        "blocked" => "action_blocked",
        "cancelled" => "action_cancelled",
        _ => "action_run",
    };
    if let Ok(conn) = state.db.lock() {
        let policy = policy::load_policy(&conn).unwrap_or_default();
        let input = AuditInput {
            kind: kind.to_string(),
            mode: None,
            plan_id: None,
            step_id: None,
            skill_id: None,
            action_id: None,
            title: Some("Openship".into()),
            command: Some(command),
            outcome: Some(outcome.to_string()),
            detail,
        };
        let _ = policy::record_audit(&conn, &policy, &input);
    }
}

fn confirm(app: &tauri::AppHandle, title: &str, message: String) -> bool {
    app.dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "実行".to_string(),
            "キャンセル".to_string(),
        ))
        .blocking_show()
}

fn cli_deploy(
    config: &OpenShipConfig,
    root: &Path,
    project_id: &str,
    branch: &str,
) -> AppResult<OpenShipDeployResult> {
    let Some(binary) = detect_cli(config) else {
        return Err(AppError::Other(
            "Openship CLI が見つかりません。CLI をインストールするか、Base URL とトークンを設定してください。".into(),
        ));
    };

    // `--json` is a global flag, so it must precede the subcommand. The
    // configured project and branch are explicit so the CLI does not depend on
    // the active `.openship/project.json` link or the current Git branch.
    let mut owned = vec!["--json".to_string(), "deploy".to_string()];
    if !project_id.trim().is_empty() {
        owned.push("--project".into());
        owned.push(project_id.trim().to_string());
    }
    if !branch.trim().is_empty() {
        owned.push("--branch".into());
        owned.push(branch.trim().to_string());
    }
    let args = owned.iter().map(String::as_str).collect::<Vec<_>>();
    let output = run_cli(&binary, Some(root), &args).map_err(|error| {
        AppError::Other(format!("Openship CLI を起動できませんでした: {error}"))
    })?;

    let stdout = truncate_chars(&String::from_utf8_lossy(&output.stdout), MAX_OUTPUT_CHARS);
    let stderr = truncate_chars(&String::from_utf8_lossy(&output.stderr), MAX_OUTPUT_CHARS);
    let deployment = serde_json::from_str::<Value>(&stdout)
        .ok()
        .and_then(|value| {
            parse_deployment(&value).or_else(|| value.get("deployment").and_then(parse_deployment))
        });

    Ok(OpenShipDeployResult {
        ok: output.status.success(),
        code: output.status.code(),
        stdout,
        stderr,
        command: std::iter::once("openship".to_string())
            .chain(owned.iter().cloned())
            .collect(),
        deployment,
    })
}

async fn rest_deploy(
    state: &State<'_, AppState>,
    config: &OpenShipConfig,
    token: Option<&str>,
    project_id: &str,
    branch: &str,
) -> AppResult<OpenShipDeployResult> {
    let (base_url, token) = require_server(config, token)?;
    let project_id = validate_id(project_id, "Project ID")?;
    let branch = validate_branch(branch)?;
    let url = format!("{base_url}/api/deployments");
    let body = serde_json::json!({
        "projectId": project_id,
        "branch": branch,
        "environment": "production",
    });

    let response = api_request(
        state,
        Method::POST,
        &url,
        Some(&token),
        &config.organization_id,
    )
    .json(&body)
    .send()
    .await
    .map_err(|error| AppError::Other(format!("Openship API に接続できませんでした: {error}")))?;

    let status = response.status();
    let bytes = read_body_limited(response, MAX_HTTP_BODY_BYTES).await;
    let text = String::from_utf8_lossy(&bytes).to_string();
    let deployment = serde_json::from_str::<Value>(&text).ok().and_then(|value| {
        parse_deployment(&value).or_else(|| value.get("deployment").and_then(parse_deployment))
    });

    let ok = status.is_success();
    Ok(OpenShipDeployResult {
        ok,
        code: Some(status.as_u16() as i32),
        stdout: if ok {
            truncate_chars(&text, MAX_OUTPUT_CHARS)
        } else {
            String::new()
        },
        stderr: if ok {
            String::new()
        } else {
            compact_message_redacted(&text, Some(&token))
        },
        command: vec!["POST".into(), "/api/deployments".into()],
        deployment,
    })
}

#[tauri::command]
pub async fn openship_config_get(state: State<'_, AppState>) -> AppResult<OpenShipSettings> {
    let config = {
        let conn = lock_db(&state)?;
        load_config(&conn)?
    };
    let token_configured = read_token().map(|token| token.is_some()).unwrap_or(false);
    Ok(OpenShipSettings {
        config,
        token_configured,
    })
}

#[tauri::command]
pub async fn openship_config_set(
    config: OpenShipConfig,
    state: State<'_, AppState>,
) -> AppResult<OpenShipSettings> {
    let config = normalize_config(config)?;
    {
        let conn = lock_db(&state)?;
        save_config(&conn, &config)?;
    }
    let token_configured = read_token().map(|token| token.is_some()).unwrap_or(false);
    Ok(OpenShipSettings {
        config,
        token_configured,
    })
}

#[tauri::command]
pub async fn openship_token_set(token: String) -> AppResult<()> {
    let token = validate_token(&token)?;
    let entry = key_entry()?;
    entry.set_password(token).map_err(|_| {
        AppError::Other("Openship トークンを OS キーチェーンへ保存できませんでした。".into())
    })?;
    Ok(())
}

#[tauri::command]
pub async fn openship_token_delete() -> AppResult<()> {
    let entry = key_entry()?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err(AppError::Other(
            "OS キーチェーンから Openship トークンを削除できませんでした。".into(),
        )),
    }
}

#[tauri::command]
pub async fn openship_status(state: State<'_, AppState>) -> AppResult<OpenShipStatus> {
    let config = {
        let conn = lock_db(&state)?;
        load_config(&conn)?
    };
    let token = read_token()?;
    let cli = detect_cli(&config);
    let version = cli.as_deref().and_then(cli_version);
    let base_url = config.base_url.clone();
    let server_configured = !base_url.is_empty();

    let mut server_reachable = false;
    let server_message: String;

    if let Some(binary) = cli.as_deref() {
        match run_cli(binary, None, &["status"]) {
            Ok(output) => {
                server_reachable = output.status.success();
                let stdout_text = String::from_utf8_lossy(&output.stdout).to_string();
                let text = if stdout_text.trim().is_empty() {
                    String::from_utf8_lossy(&output.stderr).to_string()
                } else {
                    stdout_text
                };
                server_message = if text.trim().is_empty() {
                    if server_reachable {
                        "openship status は成功しました。".into()
                    } else {
                        "openship status が失敗しました。".into()
                    }
                } else {
                    compact_message(&text)
                };
            }
            Err(error) => {
                server_message = format!("openship status を実行できませんでした: {error}");
            }
        }
    } else if server_configured {
        let url = format!("{base_url}/api/health");
        let token_value = token.as_deref();
        match api_request(
            &state,
            Method::GET,
            &url,
            token_value,
            &config.organization_id,
        )
        .send()
        .await
        {
            Ok(response) => {
                server_reachable = response.status().is_success();
                let status = response.status();
                let bytes = read_body_limited(response, MAX_HTTP_BODY_BYTES).await;
                let body = String::from_utf8_lossy(&bytes);
                server_message = if server_reachable {
                    format!("Openship API は応答しています (HTTP {})。", status.as_u16())
                } else {
                    format!(
                        "Openship API が HTTP {} を返しました: {}",
                        status.as_u16(),
                        compact_message_redacted(&body, token.as_deref())
                    )
                };
            }
            Err(error) => {
                server_message = format!("Openship API に接続できませんでした: {error}");
            }
        }
    } else {
        server_message =
            "Openship CLI が見つかりません。CLI をインストールするか、Base URL とトークンを設定してください。".into();
    }

    Ok(OpenShipStatus {
        cli_available: cli.is_some(),
        cli_path: cli.map(|path| path.to_string_lossy().to_string()),
        cli_version: version,
        server_configured,
        server_reachable,
        server_message,
        token_configured: token.is_some(),
        base_url,
    })
}

#[tauri::command]
pub async fn openship_projects(state: State<'_, AppState>) -> AppResult<Vec<OpenShipProject>> {
    let config = {
        let conn = lock_db(&state)?;
        load_config(&conn)?
    };
    let token = read_token()?;
    let (base_url, token) = require_server(&config, token.as_deref())?;
    let url = format!("{base_url}/api/projects");

    let response = api_request(
        &state,
        Method::GET,
        &url,
        Some(&token),
        &config.organization_id,
    )
    .send()
    .await
    .map_err(|error| AppError::Other(format!("Openship API に接続できませんでした: {error}")))?;

    let status = response.status();
    let bytes = read_body_limited(response, MAX_HTTP_BODY_BYTES).await;
    let text = String::from_utf8_lossy(&bytes);
    if !status.is_success() {
        return Err(AppError::Other(format!(
            "Openship API がエラーを返しました (HTTP {}): {}",
            status.as_u16(),
            compact_message_redacted(&text, Some(&token))
        )));
    }

    let value: Value = serde_json::from_str(&text).map_err(|_| {
        AppError::Other("Openship のプロジェクト一覧を解析できませんでした。".into())
    })?;
    Ok(parse_projects(&value))
}

#[tauri::command]
pub async fn openship_deployments(
    project_id: Option<String>,
    limit: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<Vec<OpenShipDeployment>> {
    let config = {
        let conn = lock_db(&state)?;
        load_config(&conn)?
    };
    let token = read_token()?;
    let (base_url, token) = require_server(&config, token.as_deref())?;
    let url = format!("{base_url}/api/deployments");
    let limit = limit.unwrap_or(20).clamp(1, MAX_DEPLOYMENTS);

    let mut parsed = reqwest::Url::parse(&url)
        .map_err(|_| AppError::Other("Openship API の URL が不正です。".into()))?;
    {
        let mut pairs = parsed.query_pairs_mut();
        pairs.append_pair("limit", &limit.to_string());
        if let Some(project_id) = project_id.filter(|value| !value.trim().is_empty()) {
            let project_id = validate_id(&project_id, "Project ID")?;
            pairs.append_pair("projectId", &project_id);
        }
    }

    let response = api_request(
        &state,
        Method::GET,
        parsed.as_str(),
        Some(&token),
        &config.organization_id,
    )
    .send()
    .await
    .map_err(|error| AppError::Other(format!("Openship API に接続できませんでした: {error}")))?;

    let status = response.status();
    let bytes = read_body_limited(response, MAX_HTTP_BODY_BYTES).await;
    let text = String::from_utf8_lossy(&bytes);
    if !status.is_success() {
        return Err(AppError::Other(format!(
            "Openship API がエラーを返しました (HTTP {}): {}",
            status.as_u16(),
            compact_message_redacted(&text, Some(&token))
        )));
    }

    let value: Value = serde_json::from_str(&text)
        .map_err(|_| AppError::Other("Openship のデプロイ履歴を解析できませんでした。".into()))?;
    Ok(parse_deployments(&value))
}

#[tauri::command]
pub async fn openship_deploy(
    app: tauri::AppHandle,
    project_id: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<OpenShipDeployResult> {
    let config = {
        let conn = lock_db(&state)?;
        load_config(&conn)?
    };
    let token = read_token()?;
    let project_id = project_id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| config.project_id.clone());
    let branch = config.branch.clone();
    let cli = detect_cli(&config);

    let target = if cli.is_some() {
        if project_id.trim().is_empty() {
            format!("Openship CLI (--json deploy) / branch: {branch}")
        } else {
            format!("Openship CLI (--json deploy) / project: {project_id} / branch: {branch}")
        }
    } else {
        format!("Openship API POST /api/deployments / project: {project_id} / branch: {branch}")
    };
    let confirmed = confirm(
        &app,
        "Openship デプロイを承認",
        format!("{target}\n\n本番環境へデプロイします。内容を確認して承認してください。"),
    );
    if !confirmed {
        audit(
            &state,
            "cancelled",
            vec!["openship".into(), "deploy".into()],
            Some("ユーザーが承認をキャンセルしました".into()),
        );
        return Err(AppError::Other("操作はキャンセルされました".into()));
    }

    let result = if cli.is_some() {
        let root = state.root()?;
        cli_deploy(&config, &root, &project_id, &branch)?
    } else {
        if project_id.trim().is_empty() {
            audit(
                &state,
                "blocked",
                vec!["openship".into(), "deploy".into()],
                Some("Project ID が未設定です".into()),
            );
            return Err(AppError::Other(
                "Project ID を入力するか、設定画面で既定のプロジェクトを登録してください。".into(),
            ));
        }
        rest_deploy(&state, &config, token.as_deref(), &project_id, &branch).await?
    };

    let outcome = if result.ok { "ok" } else { "error" };
    let detail = if result.ok {
        result
            .deployment
            .as_ref()
            .map(|deployment| format!("{} ({})", deployment.id, deployment.status))
    } else {
        Some(failure_detail(&result))
    };
    audit(&state, outcome, result.command.clone(), detail);
    Ok(result)
}

#[tauri::command]
pub async fn openship_logs(
    deployment_id: String,
    state: State<'_, AppState>,
) -> AppResult<OpenShipLogs> {
    let config = {
        let conn = lock_db(&state)?;
        load_config(&conn)?
    };
    let token = read_token()?;
    let (base_url, token) = require_server(&config, token.as_deref())?;
    let deployment_id = validate_id(&deployment_id, "Deployment ID")?;
    let url = format!("{base_url}/api/deployments/{deployment_id}/logs");

    let response = api_request(
        &state,
        Method::GET,
        &url,
        Some(&token),
        &config.organization_id,
    )
    .send()
    .await
    .map_err(|error| AppError::Other(format!("Openship API に接続できませんでした: {error}")))?;

    let status = response.status();
    let bytes = read_body_limited(response, MAX_HTTP_BODY_BYTES).await;
    let text = String::from_utf8_lossy(&bytes).to_string();
    let ok = status.is_success();
    let logs = if ok {
        serde_json::from_str::<Value>(&text)
            .map(|value| extract_logs(&value))
            .unwrap_or_else(|_| truncate_chars(&text, MAX_OUTPUT_CHARS))
    } else {
        compact_message_redacted(&text, Some(&token))
    };

    Ok(OpenShipLogs {
        deployment_id,
        ok,
        status: Some(status.as_u16()),
        logs,
    })
}

#[tauri::command]
pub async fn openship_rollback(
    app: tauri::AppHandle,
    deployment_id: String,
    state: State<'_, AppState>,
) -> AppResult<OpenShipDeployResult> {
    let config = {
        let conn = lock_db(&state)?;
        load_config(&conn)?
    };
    let token = read_token()?;
    let deployment_id = validate_id(&deployment_id, "Deployment ID")?;

    let confirmed = confirm(
        &app,
        "Openship ロールバックを承認",
        format!(
            "デプロイ {deployment_id} へロールバックします。\n\n現在の本番環境が置き換わります。内容を確認して承認してください。"
        ),
    );
    if !confirmed {
        audit(
            &state,
            "cancelled",
            vec!["openship".into(), "rollback".into(), deployment_id.clone()],
            Some("ユーザーが承認をキャンセルしました".into()),
        );
        return Err(AppError::Other("操作はキャンセルされました".into()));
    }

    let (base_url, token) = require_server(&config, token.as_deref())?;
    let url = format!("{base_url}/api/deployments/{deployment_id}/rollback");
    let response = api_request(
        &state,
        Method::POST,
        &url,
        Some(&token),
        &config.organization_id,
    )
    .json(&serde_json::json!({}))
    .send()
    .await
    .map_err(|error| AppError::Other(format!("Openship API に接続できませんでした: {error}")))?;

    let status = response.status();
    let bytes = read_body_limited(response, MAX_HTTP_BODY_BYTES).await;
    let text = String::from_utf8_lossy(&bytes).to_string();
    let ok = status.is_success();
    let deployment = serde_json::from_str::<Value>(&text).ok().and_then(|value| {
        parse_deployment(&value).or_else(|| value.get("deployment").and_then(parse_deployment))
    });

    let result = OpenShipDeployResult {
        ok,
        code: Some(status.as_u16() as i32),
        stdout: if ok {
            truncate_chars(&text, MAX_OUTPUT_CHARS)
        } else {
            String::new()
        },
        stderr: if ok {
            String::new()
        } else {
            compact_message_redacted(&text, Some(&token))
        },
        command: vec![
            "POST".into(),
            format!("/api/deployments/{deployment_id}/rollback"),
        ],
        deployment,
    };

    audit(
        &state,
        if ok { "ok" } else { "error" },
        result.command.clone(),
        if ok {
            Some(format!("deployment {deployment_id}"))
        } else {
            Some(failure_detail(&result))
        },
    );
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> OpenShipConfig {
        OpenShipConfig {
            base_url: "https://openship.example.com/".into(),
            organization_id: "org_123".into(),
            project_id: "proj_123".into(),
            branch: "main".into(),
            cli_path: String::new(),
        }
    }

    #[test]
    fn normalizes_base_url_and_ids() {
        let normalized = normalize_config(config()).unwrap();
        assert_eq!(normalized.base_url, "https://openship.example.com");
        assert_eq!(normalized.project_id, "proj_123");
    }

    #[test]
    fn rejects_non_local_http() {
        let mut config = config();
        config.base_url = "http://openship.example.com".into();
        assert!(normalize_config(config).is_err());
    }

    #[test]
    fn allows_local_http() {
        let mut config = config();
        config.base_url = "http://localhost:3000".into();
        assert!(normalize_config(config).is_ok());
    }

    #[test]
    fn rejects_unsafe_ids() {
        assert!(validate_id("../../etc/passwd", "Project ID").is_err());
        assert!(validate_id("a b", "Project ID").is_err());
        assert!(validate_id("proj_123", "Project ID").is_ok());
    }

    #[test]
    fn rejects_unsafe_branches() {
        assert!(validate_branch("main").is_ok());
        assert!(validate_branch("feature/openship").is_ok());
        assert!(validate_branch("-main").is_err());
        assert!(validate_branch("main..next").is_err());
        assert!(validate_branch("main branch").is_err());
    }

    #[test]
    fn parses_project_lists_and_objects() {
        let value = serde_json::json!({
            "projects": [
                { "id": "proj_1", "name": "Web" },
                { "id": "proj_2", "slug": "api" }
            ]
        });
        let projects = parse_projects(&value);
        assert_eq!(projects.len(), 2);
        assert_eq!(projects[0].name, "Web");
        assert_eq!(projects[1].name, "api");
    }

    #[test]
    fn parses_deployments_with_seconds_and_iso_dates() {
        let value = serde_json::json!([
            { "id": "dep_1", "status": "ready", "createdAt": 1_700_000_000 },
            { "id": "dep_2", "state": "building", "created_at": "2026-11-01T12:00:00Z" }
        ]);
        let deployments = parse_deployments(&value);
        assert_eq!(deployments.len(), 2);
        assert_eq!(deployments[0].created_at, Some(1_700_000_000_000));
        assert_eq!(deployments[1].status, "building");
        assert!(deployments[1].created_at.is_some());
    }

    #[test]
    fn extracts_logs_from_common_shapes() {
        assert_eq!(extract_logs(&serde_json::json!("line")), "line");
        assert_eq!(
            extract_logs(&serde_json::json!({ "logs": ["a", "b"] })),
            "a\nb"
        );
    }

    #[test]
    fn defaults_are_valid() {
        assert!(normalize_config(OpenShipConfig::default()).is_ok());
    }

    #[test]
    fn strips_an_api_suffix_from_the_base_url() {
        let mut config = config();
        config.base_url = "https://openship.example.com/api/".into();
        let normalized = normalize_config(config).unwrap();
        assert_eq!(normalized.base_url, "https://openship.example.com");
    }

    fn result(stdout: &str, stderr: &str) -> OpenShipDeployResult {
        OpenShipDeployResult {
            ok: false,
            code: Some(1),
            stdout: stdout.into(),
            stderr: stderr.into(),
            command: Vec::new(),
            deployment: None,
        }
    }

    #[test]
    fn failure_detail_prefers_stderr_and_falls_back_to_stdout() {
        assert_eq!(failure_detail(&result("out", "err")), "err");
        assert_eq!(failure_detail(&result("out", "")), "out");
    }
}
