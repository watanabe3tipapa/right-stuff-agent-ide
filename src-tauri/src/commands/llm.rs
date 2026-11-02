use std::sync::Arc;
use std::sync::MutexGuard;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::State;
use tauri::ipc::Channel;

use crate::db;
use crate::error::{AppError, AppResult};
use crate::state::{AppState, CancelFlag};

const SETTING_LLM_CONFIG: &str = "llm_config";
const KEYRING_SERVICE: &str = "com.rightstuff.agentide.llm";

const MAX_BASE_URL_CHARS: usize = 2_048;
const MAX_MODEL_CHARS: usize = 200;
const MAX_KEY_CHARS: usize = 4_096;
const MAX_MESSAGES: usize = 100;
const MAX_MESSAGE_CHARS: usize = 100_000;
const MAX_TOTAL_MESSAGE_CHARS: usize = 400_000;
const MAX_ERROR_CHARS: usize = 500;
const MAX_MODELS: usize = 100;
const MAX_SSE_LINE_CHARS: usize = 1_048_576;
const MAX_STREAM_CHARS: usize = 2_000_000;
const MAX_HTTP_BODY_BYTES: usize = 1_048_576;

const PROVIDERS: &[&str] = &["openai", "ollama", "lmstudio", "openrouter", "custom"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmConfig {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub temperature: f64,
    pub max_tokens: u32,
}

impl Default for LlmConfig {
    fn default() -> Self {
        Self {
            provider: "openai".into(),
            base_url: "https://api.openai.com/v1".into(),
            model: "gpt-4o-mini".into(),
            temperature: 0.7,
            max_tokens: 2_048,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmSettings {
    #[serde(flatten)]
    pub config: LlmConfig,
    pub configured: bool,
    pub key_configured: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmKeyStatus {
    pub configured: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmTestResult {
    pub ok: bool,
    pub status: Option<u16>,
    pub message: String,
    pub models: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LlmChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum LlmStreamEvent {
    Delta {
        text: String,
    },
    Done {
        #[serde(rename = "finishReason")]
        finish_reason: Option<String>,
    },
    Cancelled,
    Error {
        message: String,
    },
}

fn lock_db<'a>(state: &'a State<'_, AppState>) -> AppResult<MutexGuard<'a, rusqlite::Connection>> {
    state
        .db
        .lock()
        .map_err(|_| AppError::Other("DB ロックの取得に失敗しました".into()))
}

fn load_config(state: &State<'_, AppState>) -> AppResult<(LlmConfig, bool)> {
    let raw = {
        let conn = lock_db(state)?;
        db::get_setting(&conn, SETTING_LLM_CONFIG)?
    };

    let Some(raw) = raw else {
        return Ok((LlmConfig::default(), false));
    };

    match serde_json::from_str::<LlmConfig>(&raw) {
        Ok(mut config) => {
            if validate_config(&mut config).is_err() {
                return Ok((LlmConfig::default(), false));
            }
            Ok((config, true))
        }
        Err(_) => Ok((LlmConfig::default(), false)),
    }
}

fn validate_config(config: &mut LlmConfig) -> AppResult<()> {
    if !PROVIDERS.contains(&config.provider.as_str()) {
        return Err(AppError::Other(
            "未対応のプロバイダーです。OpenAI / Ollama / LM Studio / OpenRouter / カスタムから選択してください。".into(),
        ));
    }

    config.base_url = config.base_url.trim().trim_end_matches('/').to_string();

    if config.base_url.is_empty() {
        return Err(AppError::Other("Base URL を入力してください。".into()));
    }
    if config.base_url.chars().count() > MAX_BASE_URL_CHARS {
        return Err(AppError::Other("Base URL が長すぎます。".into()));
    }
    if config
        .base_url
        .chars()
        .any(|ch| ch.is_control() || ch.is_whitespace())
    {
        return Err(AppError::Other(
            "Base URL に空白や制御文字は使用できません。".into(),
        ));
    }

    let url = reqwest::Url::parse(&config.base_url)
        .map_err(|_| AppError::Other("Base URL の形式が正しくありません。".into()))?;

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
                "Base URL は https:// またはローカルホストの http:// で指定してください。".into(),
            ));
        }
    }

    if !url.username().is_empty() || url.password().is_some() {
        return Err(AppError::Other(
            "Base URL にユーザー名やパスワードを含めないでください。".into(),
        ));
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(AppError::Other(
            "Base URL にクエリやフラグメントを含めないでください。".into(),
        ));
    }

    config.model = config.model.trim().to_string();
    if config.model.is_empty() {
        return Err(AppError::Other("モデル名を入力してください。".into()));
    }
    if config.model.chars().count() > MAX_MODEL_CHARS {
        return Err(AppError::Other("モデル名が長すぎます。".into()));
    }
    if config
        .model
        .chars()
        .any(|ch| ch.is_control() || ch.is_whitespace())
    {
        return Err(AppError::Other(
            "モデル名に空白や制御文字は使用できません。".into(),
        ));
    }

    if !config.temperature.is_finite() || !(0.0..=2.0).contains(&config.temperature) {
        return Err(AppError::Other(
            "Temperature は 0.0 から 2.0 の範囲で指定してください。".into(),
        ));
    }

    if !(1..=128_000).contains(&config.max_tokens) {
        return Err(AppError::Other(
            "最大トークン数は 1 から 128000 の範囲で指定してください。".into(),
        ));
    }

    Ok(())
}

fn validate_key(key: &str) -> AppResult<&str> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err(AppError::Other("API キーを入力してください。".into()));
    }
    if trimmed.chars().count() > MAX_KEY_CHARS {
        return Err(AppError::Other("API キーが長すぎます。".into()));
    }
    if trimmed.chars().any(char::is_control) {
        return Err(AppError::Other(
            "API キーに改行や制御文字は使用できません。".into(),
        ));
    }
    Ok(trimmed)
}

fn validate_messages(messages: &[LlmChatMessage]) -> AppResult<()> {
    if messages.is_empty() {
        return Err(AppError::Other("メッセージが空です。".into()));
    }
    if messages.len() > MAX_MESSAGES {
        return Err(AppError::Other(
            "メッセージ数が多すぎます。会話を整理してから再試行してください。".into(),
        ));
    }

    let mut total = 0usize;
    for message in messages {
        if !matches!(message.role.as_str(), "system" | "user" | "assistant") {
            return Err(AppError::Other("メッセージの role が不正です。".into()));
        }
        let length = message.content.chars().count();
        if length == 0 {
            return Err(AppError::Other("空のメッセージは送信できません。".into()));
        }
        if length > MAX_MESSAGE_CHARS {
            return Err(AppError::Other(
                "1 件のメッセージが長すぎます。内容を分割してください。".into(),
            ));
        }
        total += length;
    }

    if total > MAX_TOTAL_MESSAGE_CHARS {
        return Err(AppError::Other(
            "送信するメッセージが長すぎます。会話を整理してから再試行してください。".into(),
        ));
    }

    Ok(())
}

fn key_entry(provider: &str) -> AppResult<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, provider).map_err(|_| {
        AppError::Other(
            "OS キーチェーンを利用できませんでした。システムのキーチェーン設定を確認してください。"
                .into(),
        )
    })
}

fn read_key(provider: &str) -> AppResult<Option<String>> {
    let entry = key_entry(provider)?;
    match entry.get_password() {
        Ok(key) => {
            let trimmed = key.trim();
            if trimmed.is_empty() {
                Ok(None)
            } else {
                Ok(Some(trimmed.to_string()))
            }
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(AppError::Other(
            "OS キーチェーンから API キーを取得できませんでした。".into(),
        )),
    }
}

fn truncate_chars(value: &str, max: usize) -> String {
    let mut result = String::new();
    for (index, ch) in value.chars().enumerate() {
        if index >= max {
            result.push('…');
            break;
        }
        result.push(ch);
    }
    result
}

fn compact_message(value: &str) -> String {
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    truncate_chars(&compact, MAX_ERROR_CHARS)
}

/// Remove the API key from provider-supplied text before it reaches the WebView.
/// Providers may echo credentials back in validation errors.
fn compact_message_redacted(value: &str, key: Option<&str>) -> String {
    let redacted = match key {
        Some(key) if !key.is_empty() => value.replace(key, "[REDACTED]"),
        _ => value.to_string(),
    };
    compact_message(&redacted)
}

/// Read at most `limit` bytes from a response so a misbehaving provider cannot
/// force the app to buffer an unbounded body.
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

fn describe_request_error(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        "タイムアウトしました。ネットワークまたは Base URL を確認してください。".into()
    } else if error.is_connect() {
        "接続できませんでした。Base URL とネットワークを確認してください。".into()
    } else if error.is_decode() {
        "応答を解析できませんでした。プロバイダーの互換性を確認してください。".into()
    } else {
        compact_message(&error.to_string())
    }
}

fn emit(channel: &Channel<LlmStreamEvent>, event: LlmStreamEvent) -> bool {
    channel.send(event).is_ok()
}

#[tauri::command]
pub async fn llm_config_get(state: State<'_, AppState>) -> AppResult<LlmSettings> {
    let (config, configured) = load_config(&state)?;
    let key_configured = read_key(&config.provider)
        .map(|key| key.is_some())
        .unwrap_or(false);

    Ok(LlmSettings {
        config,
        configured,
        key_configured,
    })
}

#[tauri::command]
pub async fn llm_config_set(
    config: LlmConfig,
    state: State<'_, AppState>,
) -> AppResult<LlmSettings> {
    let mut config = config;
    validate_config(&mut config)?;

    let json = serde_json::to_string(&config)?;
    {
        let conn = lock_db(&state)?;
        db::set_setting(&conn, SETTING_LLM_CONFIG, &json)?;
    }

    let key_configured = read_key(&config.provider)
        .map(|key| key.is_some())
        .unwrap_or(false);

    Ok(LlmSettings {
        config,
        configured: true,
        key_configured,
    })
}

#[tauri::command]
pub async fn llm_key_set(key: String, state: State<'_, AppState>) -> AppResult<()> {
    let key = validate_key(&key)?;
    let (config, _) = load_config(&state)?;
    let entry = key_entry(&config.provider)?;
    entry.set_password(key).map_err(|_| {
        AppError::Other("API キーを OS キーチェーンへ保存できませんでした。".into())
    })?;
    Ok(())
}

#[tauri::command]
pub async fn llm_key_status(state: State<'_, AppState>) -> AppResult<LlmKeyStatus> {
    let (config, _) = load_config(&state)?;
    let configured = read_key(&config.provider)
        .map(|key| key.is_some())
        .unwrap_or(false);
    Ok(LlmKeyStatus { configured })
}

#[tauri::command]
pub async fn llm_key_delete(state: State<'_, AppState>) -> AppResult<()> {
    let (config, _) = load_config(&state)?;
    let entry = key_entry(&config.provider)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err(AppError::Other(
            "OS キーチェーンから API キーを削除できませんでした。".into(),
        )),
    }
}

#[tauri::command]
pub async fn llm_test(state: State<'_, AppState>) -> AppResult<LlmTestResult> {
    let (config, _) = load_config(&state)?;
    let key = read_key(&config.provider)?;
    let url = format!("{}/models", config.base_url);

    let mut request = state
        .http
        .get(&url)
        .header(reqwest::header::ACCEPT, "application/json")
        .timeout(std::time::Duration::from_secs(20));

    if let Some(key) = key.as_deref() {
        request = request.bearer_auth(key);
    }

    let response = match request.send().await {
        Ok(response) => response,
        Err(error) => {
            return Ok(LlmTestResult {
                ok: false,
                status: None,
                message: describe_request_error(&error),
                models: Vec::new(),
            });
        }
    };

    let status = response.status();
    if !status.is_success() {
        let body_bytes = read_body_limited(response, MAX_HTTP_BODY_BYTES).await;
        let body = String::from_utf8_lossy(&body_bytes);
        let detail = if body.trim().is_empty() {
            String::new()
        } else {
            format!(": {}", compact_message_redacted(&body, key.as_deref()))
        };
        return Ok(LlmTestResult {
            ok: false,
            status: Some(status.as_u16()),
            message: format!("接続に失敗しました (HTTP {}){detail}", status.as_u16()),
            models: Vec::new(),
        });
    }

    let body_bytes = read_body_limited(response, MAX_HTTP_BODY_BYTES).await;
    let value: serde_json::Value = match serde_json::from_slice(&body_bytes) {
        Ok(value) => value,
        Err(_) => {
            return Ok(LlmTestResult {
                ok: true,
                status: Some(status.as_u16()),
                message: "接続できましたが、モデル一覧を解析できませんでした。".into(),
                models: Vec::new(),
            });
        }
    };

    let models = value
        .get("data")
        .and_then(|data| data.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("id").and_then(|id| id.as_str()))
                .take(MAX_MODELS)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let message = if models.is_empty() {
        "接続に成功しました。モデル一覧は取得できませんでしたが、API は応答しています。".into()
    } else {
        format!(
            "接続に成功しました。{} 件のモデルを検出しました。",
            models.len()
        )
    };

    Ok(LlmTestResult {
        ok: true,
        status: Some(status.as_u16()),
        message,
        models,
    })
}

#[tauri::command]
pub async fn llm_chat(
    messages: Vec<LlmChatMessage>,
    on_event: Channel<LlmStreamEvent>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    validate_messages(&messages)?;
    let (config, _) = load_config(&state)?;
    let key = read_key(&config.provider)?;

    let cancel = Arc::new(CancelFlag::default());
    {
        let mut slot = state
            .llm_cancel
            .lock()
            .map_err(|_| AppError::Other("生成状態のロックに失敗しました。".into()))?;
        let busy = slot
            .as_ref()
            .map(|current| !current.is_cancelled())
            .unwrap_or(false);
        if busy {
            return Err(AppError::Other(
                "既に別の応答を生成中です。停止してから再試行してください。".into(),
            ));
        }
        *slot = Some(cancel.clone());
    }

    let result = run_chat(
        &state,
        &config,
        key.as_deref(),
        &messages,
        &cancel,
        &on_event,
    )
    .await;

    {
        let mut slot = state
            .llm_cancel
            .lock()
            .map_err(|_| AppError::Other("生成状態のロックに失敗しました。".into()))?;
        if slot
            .as_ref()
            .map(|current| Arc::ptr_eq(current, &cancel))
            .unwrap_or(false)
        {
            *slot = None;
        }
    }

    result
}

#[tauri::command]
pub async fn llm_cancel(state: State<'_, AppState>) -> AppResult<()> {
    let slot = state
        .llm_cancel
        .lock()
        .map_err(|_| AppError::Other("生成状態のロックに失敗しました。".into()))?;
    if let Some(cancel) = slot.as_ref() {
        cancel.cancel();
    }
    Ok(())
}

async fn run_chat(
    state: &State<'_, AppState>,
    config: &LlmConfig,
    key: Option<&str>,
    messages: &[LlmChatMessage],
    cancel: &CancelFlag,
    channel: &Channel<LlmStreamEvent>,
) -> AppResult<()> {
    let url = format!("{}/chat/completions", config.base_url);
    let body = serde_json::json!({
        "model": config.model,
        "messages": messages
            .iter()
            .map(|message| serde_json::json!({
                "role": message.role,
                "content": message.content,
            }))
            .collect::<Vec<_>>(),
        "temperature": config.temperature,
        "max_tokens": config.max_tokens,
        "stream": true,
    });

    let mut request = state
        .http
        .post(&url)
        .header(reqwest::header::ACCEPT, "text/event-stream")
        .json(&body);

    if let Some(key) = key {
        request = request.bearer_auth(key);
    }

    let response = tokio::select! {
        _ = cancel.wait() => {
            emit(channel, LlmStreamEvent::Cancelled);
            return Ok(());
        }
        response = request.send() => response,
    };

    let response = match response {
        Ok(response) => response,
        Err(error) => {
            emit(
                channel,
                LlmStreamEvent::Error {
                    message: format!(
                        "LLM へ接続できませんでした: {}",
                        describe_request_error(&error)
                    ),
                },
            );
            return Ok(());
        }
    };

    let status = response.status();
    if !status.is_success() {
        let body_bytes = read_body_limited(response, MAX_HTTP_BODY_BYTES).await;
        let body = String::from_utf8_lossy(&body_bytes);
        let detail = if body.trim().is_empty() {
            String::new()
        } else {
            format!(": {}", compact_message_redacted(&body, key))
        };
        emit(
            channel,
            LlmStreamEvent::Error {
                message: format!(
                    "LLM がエラーを返しました (HTTP {}){detail}",
                    status.as_u16()
                ),
            },
        );
        return Ok(());
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut finish_reason: Option<String> = None;
    let mut emitted_chars = 0usize;
    let mut done = false;

    while !done {
        let chunk = tokio::select! {
            _ = cancel.wait() => {
                emit(channel, LlmStreamEvent::Cancelled);
                return Ok(());
            }
            chunk = stream.next() => chunk,
        };

        let Some(chunk) = chunk else {
            break;
        };

        let chunk = match chunk {
            Ok(chunk) => chunk,
            Err(error) => {
                emit(
                    channel,
                    LlmStreamEvent::Error {
                        message: format!(
                            "応答の受信に失敗しました: {}",
                            describe_request_error(&error)
                        ),
                    },
                );
                return Ok(());
            }
        };

        buffer.push_str(&String::from_utf8_lossy(&chunk));

        if buffer.chars().count() > MAX_SSE_LINE_CHARS {
            emit(
                channel,
                LlmStreamEvent::Error {
                    message: "応答が大きすぎるため生成を停止しました。".into(),
                },
            );
            return Ok(());
        }

        while let Some(position) = buffer.find('\n') {
            let line = buffer[..position].trim_end_matches('\r').to_string();
            buffer.drain(..=position);

            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data == "[DONE]" {
                done = true;
                break;
            }
            if data.is_empty() {
                continue;
            }

            let value: serde_json::Value = match serde_json::from_str(data) {
                Ok(value) => value,
                Err(_) => continue,
            };

            if let Some(error) = value.get("error") {
                let message = error
                    .get("message")
                    .and_then(|message| message.as_str())
                    .unwrap_or("LLM がエラーを返しました。");
                emit(
                    channel,
                    LlmStreamEvent::Error {
                        message: compact_message_redacted(message, key),
                    },
                );
                return Ok(());
            }

            let Some(choice) = value
                .get("choices")
                .and_then(|choices| choices.as_array())
                .and_then(|choices| choices.first())
            else {
                continue;
            };

            if let Some(reason) = choice
                .get("finish_reason")
                .and_then(|reason| reason.as_str())
            {
                finish_reason = Some(reason.to_string());
            }

            let text = choice
                .get("delta")
                .and_then(|delta| delta.get("content"))
                .and_then(|content| content.as_str());

            if let Some(text) = text {
                if text.is_empty() {
                    continue;
                }

                emitted_chars += text.chars().count();
                if emitted_chars > MAX_STREAM_CHARS {
                    emit(
                        channel,
                        LlmStreamEvent::Error {
                            message: "応答が大きすぎるため生成を停止しました。".into(),
                        },
                    );
                    return Ok(());
                }

                if !emit(
                    channel,
                    LlmStreamEvent::Delta {
                        text: text.to_string(),
                    },
                ) {
                    return Ok(());
                }
            }
        }
    }

    emit(channel, LlmStreamEvent::Done { finish_reason });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(base_url: &str) -> LlmConfig {
        LlmConfig {
            base_url: base_url.into(),
            ..LlmConfig::default()
        }
    }

    #[test]
    fn accepts_https_and_local_http() {
        for url in [
            "https://api.openai.com/v1",
            "http://localhost:11434/v1",
            "http://127.0.0.1:1234/v1",
            "http://[::1]:8080/v1",
        ] {
            let mut value = config(url);
            assert!(validate_config(&mut value).is_ok(), "{url}");
        }
    }

    #[test]
    fn rejects_remote_plain_http() {
        let mut value = config("http://example.com/v1");
        assert!(validate_config(&mut value).is_err());
    }

    #[test]
    fn rejects_credentials_in_url() {
        let mut value = config("https://user:password@example.com/v1");
        assert!(validate_config(&mut value).is_err());
    }

    #[test]
    fn normalizes_trailing_slash() {
        let mut value = config("https://api.openai.com/v1/");
        validate_config(&mut value).unwrap();
        assert_eq!(value.base_url, "https://api.openai.com/v1");
    }

    #[test]
    fn enforces_temperature_and_token_range() {
        let mut value = config("https://api.openai.com/v1");
        value.temperature = 2.1;
        assert!(validate_config(&mut value).is_err());

        let mut value = config("https://api.openai.com/v1");
        value.max_tokens = 0;
        assert!(validate_config(&mut value).is_err());
    }

    #[test]
    fn rejects_blank_model_and_key() {
        let mut value = config("https://api.openai.com/v1");
        value.model = "   ".into();
        assert!(validate_config(&mut value).is_err());

        assert!(validate_key("   ").is_err());
        assert!(validate_key("sk-test\nnext").is_err());
    }

    #[test]
    fn validates_message_roles_and_limits() {
        assert!(validate_messages(&[]).is_err());
        assert!(
            validate_messages(&[LlmChatMessage {
                role: "tool".into(),
                content: "x".into(),
            }])
            .is_err()
        );
        assert!(
            validate_messages(&[LlmChatMessage {
                role: "user".into(),
                content: "こんにちは".into(),
            }])
            .is_ok()
        );
    }

    #[test]
    fn truncates_long_messages_without_splitting_chars() {
        let value = "あ".repeat(MAX_ERROR_CHARS + 10);
        let truncated = truncate_chars(&value, MAX_ERROR_CHARS);
        assert_eq!(truncated.chars().count(), MAX_ERROR_CHARS + 1);
    }

    #[test]
    fn redacts_api_keys_from_provider_errors() {
        let text = "Incorrect API key provided: sk-secret-123";
        let redacted = compact_message_redacted(text, Some("sk-secret-123"));

        assert!(!redacted.contains("sk-secret-123"));
        assert!(redacted.contains("[REDACTED]"));

        let unchanged = compact_message_redacted("plain error", None);
        assert_eq!(unchanged, "plain error");
    }

    #[test]
    fn serializes_settings_in_camel_case() {
        let settings = LlmSettings {
            config: LlmConfig::default(),
            configured: true,
            key_configured: true,
        };
        let value = serde_json::to_value(&settings).unwrap();

        assert_eq!(value["provider"], "openai");
        assert_eq!(value["baseUrl"], "https://api.openai.com/v1");
        assert_eq!(value["maxTokens"], 2_048);
        assert_eq!(value["configured"], true);
        assert_eq!(value["keyConfigured"], true);
        assert!(value.get("config").is_none());
    }

    #[test]
    fn serializes_stream_events_for_the_channel() {
        let value = serde_json::to_value(LlmStreamEvent::Done {
            finish_reason: Some("stop".into()),
        })
        .unwrap();

        assert_eq!(
            value,
            serde_json::json!({ "type": "done", "finishReason": "stop" })
        );
    }
}
