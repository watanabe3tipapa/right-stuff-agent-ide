use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::oneshot;

use crate::commands::policy::{self, AuditInput};
use crate::db;
use crate::error::{AppError, AppResult};
use crate::mcp_server;
use crate::paths;
use crate::state::AppState;

pub const MIN_VERSION: &str = "1.2.0";
pub const OPENCODE_EVENT: &str = "opencode://event";
pub const PATH_SETTING: &str = "opencode_path";
const MAX_LINE_BYTES: usize = 4 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const PROMPT_TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeStatus {
    pub available: bool,
    pub binary: Option<String>,
    pub version: Option<String>,
    pub running: bool,
    pub session_id: Option<String>,
    pub mode: String,
    pub min_version: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodePromptResult {
    pub stop_reason: Option<String>,
    pub text: String,
}

struct AcpSession {
    child: tokio::sync::Mutex<Child>,
    stdin: Arc<tokio::sync::Mutex<ChildStdin>>,
    pending: Arc<Mutex<HashMap<i64, oneshot::Sender<Value>>>>,
    next_id: AtomicI64,
    session_id: Mutex<String>,
    transcript: Arc<Mutex<String>>,
    shutdown: Mutex<Option<oneshot::Sender<()>>>,
}

#[derive(Default)]
pub struct OpencodeManager {
    session: tokio::sync::Mutex<Option<Arc<AcpSession>>>,
    mode: Mutex<String>,
    binary: Mutex<Option<String>>,
    version: Mutex<Option<String>>,
    last_error: Mutex<Option<String>>,
}

impl OpencodeManager {
    pub fn mode(&self) -> String {
        self.mode
            .lock()
            .map(|value| value.clone())
            .unwrap_or_else(|_| "assistive".into())
    }

    pub fn set_mode(&self, mode: &str) -> AppResult<()> {
        if !matches!(mode, "passive" | "assistive" | "autonomous") {
            return Err(AppError::Other("不明なエージェントモードです。".into()));
        }
        let mut value = self
            .mode
            .lock()
            .map_err(|_| AppError::Other("エージェントモードを更新できませんでした。".into()))?;
        *value = mode.to_string();
        Ok(())
    }

    fn record_error(&self, message: &str) {
        if let Ok(mut value) = self.last_error.lock() {
            *value = Some(truncate_chars(message, 2000));
        }
    }

    pub fn status_snapshot(&self) -> (bool, Option<String>, Option<String>, String) {
        let binary = self.binary.lock().ok().and_then(|value| value.clone());
        let version = self.version.lock().ok().and_then(|value| value.clone());
        let error = self
            .last_error
            .lock()
            .ok()
            .and_then(|value| value.clone())
            .unwrap_or_default();
        let available =
            binary.is_some() && version.as_deref().map(version_supported).unwrap_or(false);
        (available, binary, version, error)
    }
}

fn truncate_chars(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        value.to_string()
    } else {
        format!("{}…", value.chars().take(limit).collect::<String>())
    }
}

fn parse_version(text: &str) -> Option<(u64, u64, u64)> {
    text.split_whitespace().find_map(|token| {
        let token = token.trim_start_matches('v');
        let mut parts = token.split('.');
        let major = parts.next()?.parse::<u64>().ok()?;
        let minor = parts.next()?.parse::<u64>().ok()?;
        let patch = parts
            .next()
            .unwrap_or("0")
            .chars()
            .take_while(char::is_ascii_digit)
            .collect::<String>()
            .parse::<u64>()
            .ok()?;
        Some((major, minor, patch))
    })
}

fn version_supported(version: &str) -> bool {
    let Some(parsed) = parse_version(version) else {
        return false;
    };
    parsed >= parse_version(MIN_VERSION).unwrap_or((1, 2, 0))
}

async fn probe_version(binary: &Path, timeout: Duration) -> Result<(u64, u64, u64), String> {
    let output = tokio::time::timeout(timeout, Command::new(binary).arg("--version").output())
        .await
        .map_err(|_| "OpenCode のバージョン確認がタイムアウトしました。".to_string())?
        .map_err(|error| format!("OpenCode のバージョンを確認できませんでした: {error}"))?;
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    parse_version(&text).ok_or_else(|| "OpenCode のバージョンを解析できませんでした。".to_string())
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

fn detect_binary(explicit: Option<String>, stored: Option<String>) -> Option<PathBuf> {
    for value in [explicit, stored].into_iter().flatten() {
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        let path = PathBuf::from(value);
        if path.is_file() {
            return Some(path);
        }
    }
    if let Ok(explicit) = std::env::var("RIGHT_STUFF_OPENCODE") {
        let path = PathBuf::from(explicit);
        if path.is_file() {
            return Some(path);
        }
    }
    which("opencode")
}

pub fn configured_path(state: &AppState) -> AppResult<Option<String>> {
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Other("DB ロックの取得に失敗しました".into()))?;
    Ok(db::get_setting(&conn, PATH_SETTING)?
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty()))
}

pub fn set_configured_path(state: &AppState, path: &str) -> AppResult<()> {
    let trimmed = path.trim();
    if !trimmed.is_empty() {
        let candidate = Path::new(trimmed);
        if !candidate.is_absolute() {
            return Err(AppError::Other(
                "OpenCode のパスは絶対パスで指定してください。".into(),
            ));
        }
        if !candidate.is_file() {
            return Err(AppError::Other(
                "指定した OpenCode の実行ファイルが見つかりません。".into(),
            ));
        }
    }
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Other("DB ロックの取得に失敗しました".into()))?;
    db::set_setting(&conn, PATH_SETTING, trimmed)?;
    Ok(())
}

fn random_token() -> AppResult<String> {
    use std::io::Read;

    let mut file = std::fs::File::open("/dev/urandom")
        .map_err(|error| AppError::Other(format!("乱数を取得できませんでした: {error}")))?;
    let mut bytes = [0u8; 32];
    file.read_exact(&mut bytes)
        .map_err(|error| AppError::Other(format!("乱数を取得できませんでした: {error}")))?;
    let mut token = String::with_capacity(64);
    for byte in bytes {
        token.push_str(&format!("{byte:02x}"));
    }
    Ok(token)
}

fn injected_config(major: u64, _minor: u64) -> AppResult<(String, Option<String>)> {
    // OpenCode 2.x (V2) uses the `permissions` array and rejects the older
    // `permission` object as an unknown key. OpenCode 1.x does the opposite and
    // rejects `permissions` outright, so the shape has to follow the detected
    // major version. Either way, editing and shell access are denied and the
    // IDE MCP server remains the only path to Openship.
    let v2 = major >= 2;
    let permission = if v2 {
        json!([
            { "action": "*", "resource": "*", "effect": "allow" },
            { "action": "edit", "resource": "*", "effect": "deny" },
            { "action": "shell", "resource": "*", "effect": "deny" },
            { "action": "external_directory", "resource": "*", "effect": "deny" },
            { "action": "webfetch", "resource": "*", "effect": "deny" },
            { "action": "websearch", "resource": "*", "effect": "deny" }
        ])
    } else {
        json!({
            "edit": "deny",
            "bash": "deny",
            "webfetch": "deny",
            "external_directory": "deny"
        })
    };

    let mut value = json!({
        "$schema": "https://opencode.ai/config.json",
        "default_agent": "build"
    });
    if v2 {
        value["permissions"] = permission;
        // The V2 `permissions` array is only accepted inside the config
        // document; sending the V1 object through OPENCODE_PERMISSION would be
        // rejected as an unknown shape.
        Ok((
            serde_json::to_string(&value).map_err(|error| {
                AppError::Other(format!("OpenCode 設定を生成できませんでした: {error}"))
            })?,
            None,
        ))
    } else {
        value["permission"] = permission.clone();
        Ok((
            serde_json::to_string(&value).map_err(|error| {
                AppError::Other(format!("OpenCode 設定を生成できませんでした: {error}"))
            })?,
            Some(permission.to_string()),
        ))
    }
}

fn mcp_servers_param(port: u16, token: &str) -> Value {
    json!([{
        "type": "http",
        "name": "right-stuff-ide",
        "url": format!("http://127.0.0.1:{port}/mcp"),
        "headers": [{ "name": "Authorization", "value": format!("Bearer {token}") }]
    }])
}

async fn write_message(
    stdin: &Arc<tokio::sync::Mutex<ChildStdin>>,
    value: &Value,
) -> AppResult<()> {
    let mut encoded = serde_json::to_vec(value).map_err(|error| {
        AppError::Other(format!("ACP メッセージを生成できませんでした: {error}"))
    })?;
    encoded.push(b'\n');
    let mut guard = stdin.lock().await;
    guard.write_all(&encoded).await.map_err(|error| {
        AppError::Other(format!(
            "OpenCode にメッセージを送信できませんでした: {error}"
        ))
    })?;
    guard.flush().await.map_err(|error| {
        AppError::Other(format!("OpenCode への送信を完了できませんでした: {error}"))
    })
}

async fn send_request(
    session: &AcpSession,
    method: &str,
    params: Value,
    timeout: Duration,
) -> AppResult<Value> {
    let id = session.next_id.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = oneshot::channel();
    if let Ok(mut pending) = session.pending.lock() {
        pending.insert(id, tx);
    }
    write_message(
        &session.stdin,
        &json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }),
    )
    .await?;

    match tokio::time::timeout(timeout, rx).await {
        Ok(Ok(value)) => {
            if let Some(error) = value.get("error") {
                let message = error
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("OpenCode がエラーを返しました");
                return Err(AppError::Other(truncate_chars(message, 800)));
            }
            Ok(value.get("result").cloned().unwrap_or(Value::Null))
        }
        Ok(Err(_)) => Err(AppError::Other(
            "OpenCode の応答チャネルが閉じられました。".into(),
        )),
        Err(_) => Err(AppError::Other(format!(
            "OpenCode の応答がタイムアウトしました ({method})。"
        ))),
    }
}

fn audit(state: &AppState, kind: &str, outcome: &str, detail: String) {
    if let Ok(conn) = state.db.lock() {
        let policy = policy::load_policy(&conn).unwrap_or_default();
        let input = AuditInput {
            kind: kind.to_string(),
            mode: Some(state.opencode.mode()),
            plan_id: None,
            step_id: None,
            skill_id: None,
            action_id: None,
            title: Some("OpenCode".into()),
            command: None,
            outcome: Some(outcome.to_string()),
            detail: Some(truncate_chars(&detail, policy::MAX_AUDIT_DETAIL_CHARS)),
        };
        let _ = policy::record_audit(&conn, &policy, &input);
    }
}

fn fs_read_text(root: &Path, params: &Value) -> AppResult<Value> {
    let raw = params
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Other("path が指定されていません。".into()))?;
    let relative = paths::to_relative(root, Path::new(raw));
    let resolved = paths::resolve_existing(root, &relative)?;
    let metadata = std::fs::metadata(&resolved)
        .map_err(|error| AppError::Other(format!("ファイルを読み取れませんでした: {error}")))?;
    if metadata.len() > 4 * 1024 * 1024 {
        return Err(AppError::Other("ファイルが大きすぎます。".into()));
    }
    let text = std::fs::read_to_string(&resolved)
        .map_err(|error| AppError::Other(format!("ファイルを読み取れませんでした: {error}")))?;
    let line = params
        .get("line")
        .and_then(Value::as_u64)
        .unwrap_or(1)
        .max(1) as usize;
    let limit = params
        .get("limit")
        .and_then(Value::as_u64)
        .map(|value| value as usize);
    let content = if line > 1 || limit.is_some() {
        let lines: Vec<&str> = text.lines().collect();
        let start = (line - 1).min(lines.len());
        let end = limit
            .map(|limit| (start + limit).min(lines.len()))
            .unwrap_or(lines.len());
        lines[start..end].join("\n")
    } else {
        text
    };
    Ok(json!({ "content": content }))
}

fn handle_agent_request(root: &Path, method: &str, params: &Value) -> Value {
    match method {
        "session/request_permission" => {
            let options = params
                .get("options")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let selected = options
                .iter()
                .find(|option| {
                    let id = option
                        .get("optionId")
                        .or_else(|| option.get("id"))
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_ascii_lowercase();
                    let kind = option
                        .get("kind")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_ascii_lowercase();
                    id.contains("allow") || kind == "allow_once" || kind == "allow_always"
                })
                .or_else(|| options.first());
            if let Some(option) = selected {
                let option_id = option
                    .get("optionId")
                    .or_else(|| option.get("id"))
                    .and_then(Value::as_str)
                    .unwrap_or("allow");
                json!({
                    "jsonrpc": "2.0",
                    "result": { "outcome": { "outcome": "selected", "optionId": option_id } }
                })
            } else {
                json!({
                    "jsonrpc": "2.0",
                    "result": { "outcome": { "outcome": "cancelled" } }
                })
            }
        }
        "fs/read_text_file" => match fs_read_text(root, params) {
            Ok(result) => json!({ "jsonrpc": "2.0", "result": result }),
            Err(error) => error_response(error.to_string()),
        },
        _ => error_response(format!("未対応の ACP リクエストです: {method}")),
    }
}

fn error_response(message: String) -> Value {
    json!({
        "jsonrpc": "2.0",
        "error": { "code": -32601, "message": truncate_chars(&message, 800) }
    })
}

fn spawn_reader(
    app: AppHandle,
    stdout: tokio::process::ChildStdout,
    stdin: Arc<tokio::sync::Mutex<ChildStdin>>,
    session_id: String,
    pending: Arc<Mutex<HashMap<i64, oneshot::Sender<Value>>>>,
    transcript: Arc<Mutex<String>>,
) {
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    if line.len() > MAX_LINE_BYTES {
                        continue;
                    }
                    let Ok(value) = serde_json::from_str::<Value>(&line) else {
                        continue;
                    };
                    let method = value.get("method").and_then(Value::as_str);
                    let id = value.get("id").and_then(Value::as_i64);

                    if let (Some(method), Some(id)) = (method, id) {
                        let state = app.state::<AppState>();
                        let root = state.root();
                        let response = match root {
                            Ok(root) => {
                                let mut response = handle_agent_request(
                                    &root,
                                    method,
                                    value.get("params").unwrap_or(&Value::Null),
                                );
                                response["id"] = json!(id);
                                response
                            }
                            Err(error) => {
                                let mut response = error_response(error.to_string());
                                response["id"] = json!(id);
                                response
                            }
                        };
                        let _ = app.emit(OPENCODE_EVENT, &value);
                        // Requests from the agent must be answered on the same
                        // stdin the session writes to.
                        let _ = write_message(&stdin, &response).await;
                        continue;
                    }

                    if let (Some(method), None) = (method, id) {
                        if method == "session/update"
                            && let Some(update) =
                                value.get("params").and_then(|params| params.get("update"))
                            && update.get("sessionUpdate").and_then(Value::as_str)
                                == Some("agent_message_chunk")
                            && let Some(text) = update
                                .get("content")
                                .and_then(|content| content.get("text"))
                                .and_then(Value::as_str)
                            && let Ok(mut transcript) = transcript.lock()
                        {
                            transcript.push_str(text);
                        }
                        let _ = app.emit(OPENCODE_EVENT, &value);
                        continue;
                    }

                    if let Some(id) = id
                        && let Ok(mut pending) = pending.lock()
                        && let Some(sender) = pending.remove(&id)
                    {
                        let _ = sender.send(value);
                    }
                }
                Ok(None) => break,
                Err(_) => break,
            }
        }

        let _ = app.emit(
            OPENCODE_EVENT,
            json!({
                "jsonrpc": "2.0",
                "method": "session/closed",
                "params": { "sessionId": session_id }
            }),
        );
        clear_session_if_current(&app, &session_id).await;
    });
}

async fn clear_session_if_current(app: &AppHandle, session_id: &str) {
    let state = app.state::<AppState>();
    let mut guard = state.opencode.session.lock().await;
    let current = guard
        .as_ref()
        .and_then(|session| session.session_id.lock().ok().map(|value| value.clone()));
    if current.as_deref() == Some(session_id) {
        guard.take();
        state
            .opencode
            .record_error("OpenCode のセッションが終了しました。");
    }
}

fn spawn_stderr(app: AppHandle, stderr: tokio::process::ChildStderr) {
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app.emit(
                OPENCODE_EVENT,
                json!({
                    "jsonrpc": "2.0",
                    "method": "process/log",
                    "params": { "line": truncate_chars(&line, 2000) }
                }),
            );
        }
    });
}

async fn abort_session(session: &AcpSession) {
    let _ = session.child.lock().await.start_kill();
    if let Some(shutdown) = session
        .shutdown
        .lock()
        .ok()
        .and_then(|mut value| value.take())
    {
        let _ = shutdown.send(());
    }
}

pub async fn status(state: &AppState) -> OpencodeStatus {
    let running = state.opencode.session.lock().await.is_some();
    let session_id = {
        let guard = state.opencode.session.lock().await;
        guard.as_ref().and_then(|session| {
            session
                .session_id
                .lock()
                .ok()
                .map(|value| value.clone())
                .filter(|value| !value.is_empty())
        })
    };
    if !running {
        let stored = configured_path(state).ok().flatten();
        match detect_binary(None, stored) {
            Some(path) => {
                let label = path.to_string_lossy().to_string();
                if let Ok(mut value) = state.opencode.binary.lock() {
                    *value = Some(label);
                }
                match probe_version(&path, Duration::from_secs(5)).await {
                    Ok((major, minor, patch)) => {
                        let version = format!("{major}.{minor}.{patch}");
                        if let Ok(mut value) = state.opencode.version.lock() {
                            *value = Some(version.clone());
                        }
                        if version_supported(&version) {
                            if let Ok(mut value) = state.opencode.last_error.lock() {
                                *value = None;
                            }
                        } else {
                            state.opencode.record_error(&format!(
                                "OpenCode {version} は古すぎます。{MIN_VERSION} 以上が必要です。"
                            ));
                        }
                    }
                    Err(error) => state.opencode.record_error(&error),
                }
            }
            None => {
                if let Ok(mut value) = state.opencode.binary.lock() {
                    *value = None;
                }
                if let Ok(mut value) = state.opencode.version.lock() {
                    *value = None;
                }
                if let Ok(mut value) = state.opencode.last_error.lock() {
                    *value = None;
                }
            }
        }
    }
    let (available, binary, version, error) = state.opencode.status_snapshot();
    let message = if running {
        "OpenCode の ACP セッションが動作しています。".to_string()
    } else if !error.is_empty() {
        error
    } else if available {
        format!(
            "OpenCode {} を検出しました。セッションを開始できます。",
            version.clone().unwrap_or_default()
        )
    } else {
        "OpenCode が見つかりません。`opencode` を PATH に追加するか、設定の「OpenCode」で実行ファイルを指定してください。".into()
    };
    OpencodeStatus {
        available,
        binary,
        version,
        running,
        session_id,
        mode: state.opencode.mode(),
        min_version: MIN_VERSION.into(),
        message,
    }
}

pub async fn start(
    app: &AppHandle,
    state: &AppState,
    mode: &str,
    explicit_path: Option<String>,
) -> AppResult<OpencodeStatus> {
    if !matches!(mode, "passive" | "assistive" | "autonomous") {
        return Err(AppError::Other("不明なエージェントモードです。".into()));
    }
    if mode == "passive" {
        return Err(AppError::Other(
            "Passive モードでは OpenCode を起動できません。".into(),
        ));
    }

    let root = state.root()?;
    stop(state).await;

    let stored = configured_path(state).ok().flatten();
    let binary = detect_binary(explicit_path, stored).ok_or_else(|| {
        AppError::Other(
            "OpenCode が見つかりません。`opencode` を PATH に追加するか、設定の「OpenCode」で実行ファイルを指定してください。"
                .into(),
        )
    })?;

    let version = probe_version(&binary, Duration::from_secs(10))
        .await
        .map_err(AppError::Other)?;
    let version_label = format!("{}.{}.{}", version.0, version.1, version.2);
    if !version_supported(&version_label) {
        return Err(AppError::Other(format!(
            "OpenCode {version_label} は古すぎます。{MIN_VERSION} 以上が必要です。"
        )));
    }

    let (config, permission) = injected_config(version.0, version.1)?;
    let token = random_token()?;
    let (port, shutdown) = mcp_server::start(app.clone(), token.clone()).await?;

    let mut command = Command::new(&binary);
    command
        .arg("acp")
        .current_dir(&root)
        .env("OPENCODE_CONFIG_CONTENT", &config)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(permission) = permission {
        command.env("OPENCODE_PERMISSION", permission);
    }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            let _ = shutdown.send(());
            return Err(AppError::Other(format!(
                "`opencode acp` を起動できませんでした: {error}"
            )));
        }
    };

    let pipes = (child.stdin.take(), child.stdout.take(), child.stderr.take());
    let (Some(stdin), Some(stdout), Some(stderr)) = pipes else {
        let _ = child.start_kill();
        let _ = shutdown.send(());
        return Err(AppError::Other(
            "OpenCode の標準入出力を取得できませんでした。".into(),
        ));
    };

    let pending = Arc::new(Mutex::new(HashMap::new()));
    let transcript = Arc::new(Mutex::new(String::new()));
    let session = Arc::new(AcpSession {
        child: tokio::sync::Mutex::new(child),
        stdin: Arc::new(tokio::sync::Mutex::new(stdin)),
        pending: pending.clone(),
        next_id: AtomicI64::new(1),
        session_id: Mutex::new(String::new()),
        transcript: transcript.clone(),
        shutdown: Mutex::new(Some(shutdown)),
    });

    let initialize = send_request(
        &session,
        "initialize",
        json!({
            "protocolVersion": 1,
            "clientCapabilities": {
                "fs": { "readTextFile": true, "writeTextFile": false },
                "terminal": false
            },
            "clientInfo": {
                "name": "right-stuff-agent-ide",
                "version": env!("CARGO_PKG_VERSION")
            }
        }),
        REQUEST_TIMEOUT,
    )
    .await;

    if let Err(error) = initialize {
        abort_session(&session).await;
        return Err(error);
    }

    let created = send_request(
        &session,
        "session/new",
        json!({
            "cwd": root.to_string_lossy(),
            "mcpServers": mcp_servers_param(port, &token)
        }),
        REQUEST_TIMEOUT,
    )
    .await;

    let created = match created {
        Ok(value) => value,
        Err(error) => {
            abort_session(&session).await;
            return Err(error);
        }
    };
    let Some(session_id) = created
        .get("sessionId")
        .or_else(|| created.get("session_id"))
        .and_then(Value::as_str)
        .map(str::to_string)
    else {
        abort_session(&session).await;
        return Err(AppError::Other(
            "OpenCode がセッション ID を返しませんでした。".into(),
        ));
    };
    if let Ok(mut value) = session.session_id.lock() {
        *value = session_id.clone();
    }

    {
        let mut guard = state.opencode.session.lock().await;
        *guard = Some(session.clone());
    }
    state.opencode.set_mode(mode)?;
    if let Ok(mut value) = state.opencode.binary.lock() {
        *value = Some(binary.to_string_lossy().to_string());
    }
    if let Ok(mut value) = state.opencode.version.lock() {
        *value = Some(version_label.clone());
    }
    if let Ok(mut value) = state.opencode.last_error.lock() {
        *value = None;
    }

    spawn_reader(
        app.clone(),
        stdout,
        session.stdin.clone(),
        session_id.clone(),
        pending,
        transcript,
    );
    spawn_stderr(app.clone(), stderr);

    audit(
        state,
        "opencode_session_created",
        "ok",
        format!("OpenCode {version_label} / session {session_id} / mode {mode}"),
    );

    Ok(OpencodeStatus {
        available: true,
        binary: Some(binary.to_string_lossy().to_string()),
        version: Some(version_label),
        running: true,
        session_id: Some(session_id),
        mode: mode.to_string(),
        min_version: MIN_VERSION.into(),
        message: "OpenCode の ACP セッションを開始しました。".into(),
    })
}

pub async fn stop(state: &AppState) {
    let session = {
        let mut guard = state.opencode.session.lock().await;
        guard.take()
    };
    if let Some(session) = session {
        let _ = write_message(
            &session.stdin,
            &json!({ "jsonrpc": "2.0", "method": "session/cancel", "params": { "sessionId": session.session_id } }),
        )
        .await;
        let mut child = session.child.lock().await;
        let _ = child.start_kill();
        let _ = child.wait().await;
        drop(child);
        if let Some(shutdown) = session
            .shutdown
            .lock()
            .ok()
            .and_then(|mut value| value.take())
        {
            let _ = shutdown.send(());
        }
        if let Ok(mut value) = state.opencode.last_error.lock() {
            *value = None;
        }
    }
}

pub fn record_error(state: &AppState, message: &str) {
    state.opencode.record_error(message);
}

pub fn set_mode(state: &AppState, mode: &str) -> AppResult<()> {
    let previous = state.opencode.mode();
    state.opencode.set_mode(mode)?;
    if previous != mode {
        audit(
            state,
            "opencode_agent_switched",
            "ok",
            format!("{previous} → {mode}"),
        );
    }
    Ok(())
}

pub async fn prompt(
    state: &AppState,
    mode: &str,
    text: String,
    _prompt_id: Option<String>,
) -> AppResult<OpencodePromptResult> {
    set_mode(state, mode)?;
    if state.opencode.mode() == "passive" {
        return Err(AppError::Other(
            "Passive モードでは OpenCode にプロンプトを送信できません。".into(),
        ));
    }
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(AppError::Other("プロンプトが空です。".into()));
    }
    if trimmed.chars().count() > 32_000 {
        return Err(AppError::Other("プロンプトが長すぎます。".into()));
    }

    let session = {
        let guard = state.opencode.session.lock().await;
        guard
            .as_ref()
            .cloned()
            .ok_or_else(|| AppError::Other("OpenCode セッションが開始されていません。".into()))?
    };
    if let Ok(mut transcript) = session.transcript.lock() {
        transcript.clear();
    }

    audit(
        state,
        "opencode_session_prompted",
        "ok",
        truncate_chars(trimmed, 1000),
    );

    let params = json!({
        "sessionId": session.session_id,
        "prompt": [{ "type": "text", "text": trimmed }]
    });
    let result = send_request(&session, "session/prompt", params, PROMPT_TIMEOUT).await?;
    let stop_reason = result
        .get("stopReason")
        .or_else(|| result.get("stop_reason"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let text = session
        .transcript
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default();
    Ok(OpencodePromptResult { stop_reason, text })
}

pub async fn cancel(state: &AppState) -> AppResult<()> {
    let session = {
        let guard = state.opencode.session.lock().await;
        guard
            .as_ref()
            .cloned()
            .ok_or_else(|| AppError::Other("OpenCode セッションが開始されていません。".into()))?
    };
    write_message(
        &session.stdin,
        &json!({
            "jsonrpc": "2.0",
            "method": "session/cancel",
            "params": { "sessionId": session.session_id }
        }),
    )
    .await
}

/// Used by the MCP server to record calls that reach the IDE gate.
pub fn record_tool_call(state: &AppState, tool: &str, args: &Value) {
    audit(
        state,
        "opencode_tool_called",
        "ok",
        format!("{tool} {}", truncate_chars(&args.to_string(), 1200)),
    );
}

// Openship implementation handles live in `commands::openship`; the MCP module
// calls them directly so there is a single execution path.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_is_64_hex_characters() {
        let first = random_token().expect("token");
        let second = random_token().expect("token");
        assert_eq!(first.len(), 64);
        assert!(first.chars().all(|value| value.is_ascii_hexdigit()));
        assert_ne!(first, second);
    }

    #[test]
    fn parses_versions_with_and_without_prefix() {
        assert_eq!(parse_version("1.2.27"), Some((1, 2, 27)));
        assert_eq!(parse_version("opencode 1.2.27"), Some((1, 2, 27)));
        assert_eq!(parse_version("v1.19.6\n"), Some((1, 19, 6)));
        assert_eq!(parse_version("dev"), None);
    }

    #[test]
    fn rejects_versions_below_minimum() {
        assert!(!version_supported("1.1.9"));
        assert!(version_supported("1.2.0"));
        assert!(version_supported("1.19.6"));
    }

    #[test]
    fn detect_binary_prefers_explicit_then_stored() {
        let base = std::env::temp_dir().join(format!("rs-oc-{}", random_token().unwrap()));
        std::fs::create_dir_all(&base).expect("temp dir");
        let explicit = base.join("explicit");
        let stored = base.join("stored");
        std::fs::write(&explicit, b"").expect("write explicit");
        std::fs::write(&stored, b"").expect("write stored");

        let explicit_label = explicit.to_string_lossy().to_string();
        let stored_label = stored.to_string_lossy().to_string();
        assert_eq!(
            detect_binary(Some(explicit_label.clone()), Some(stored_label.clone())),
            Some(explicit.clone())
        );
        assert_eq!(
            detect_binary(None, Some(stored_label.clone())),
            Some(stored.clone())
        );
        assert_eq!(
            detect_binary(
                Some(base.join("missing").to_string_lossy().to_string()),
                Some(stored_label)
            ),
            Some(stored)
        );

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn status_requires_a_supported_version() {
        let manager = OpencodeManager::default();
        *manager.binary.lock().expect("binary") = Some("/tmp/opencode".into());
        *manager.version.lock().expect("version") = Some("1.1.0".into());
        assert!(!manager.status_snapshot().0);
        *manager.version.lock().expect("version") = Some("1.2.0".into());
        assert!(manager.status_snapshot().0);
    }

    #[test]
    fn v1_config_uses_permission_object_everywhere() {
        let (config, permission) = injected_config(1, 2).expect("config");
        let value: Value = serde_json::from_str(&config).expect("json");
        assert!(value.get("permission").is_some());
        assert!(value.get("permissions").is_none());
        let permission: Value =
            serde_json::from_str(&permission.expect("permission env")).expect("json");
        assert_eq!(permission["bash"], "deny");
        assert_eq!(permission["edit"], "deny");
    }

    #[test]
    fn v1_config_is_used_for_late_1x_versions() {
        let (config, _) = injected_config(1, 19).expect("config");
        let value: Value = serde_json::from_str(&config).expect("json");
        assert!(value.get("permission").is_some());
        assert!(value.get("permissions").is_none());
    }

    #[test]
    fn v2_config_uses_permissions_array_without_env_override() {
        let (config, permission) = injected_config(2, 0).expect("config");
        let value: Value = serde_json::from_str(&config).expect("json");
        assert!(value["permissions"].is_array());
        assert!(value.get("permission").is_none());
        assert!(permission.is_none());
        let denied = value["permissions"]
            .as_array()
            .expect("array")
            .iter()
            .any(|entry| entry["action"] == "shell" && entry["effect"] == "deny");
        assert!(denied);
    }
}
