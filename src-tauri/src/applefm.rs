use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

pub const DEFAULT_HOST: &str = "127.0.0.1";
pub const DEFAULT_PORT: u16 = 1976;
pub const PROVIDER_ID: &str = "applefm";

const PROBE_TIMEOUT: Duration = Duration::from_secs(8);
const HEALTH_TIMEOUT: Duration = Duration::from_secs(3);
const START_ATTEMPTS: usize = 30;
const START_INTERVAL: Duration = Duration::from_millis(200);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppleFmModel {
    pub id: String,
    pub available: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppleFmStatus {
    pub supported: bool,
    pub binary: Option<String>,
    pub server_running: bool,
    pub managed: bool,
    pub host: String,
    pub port: u16,
    pub base_url: String,
    pub models: Vec<AppleFmModel>,
    pub message: String,
}

pub struct AppleFmManager {
    child: Mutex<Option<Child>>,
    host: Mutex<String>,
    port: Mutex<u16>,
}

impl Default for AppleFmManager {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
            host: Mutex::new(DEFAULT_HOST.into()),
            port: Mutex::new(DEFAULT_PORT),
        }
    }
}

impl AppleFmManager {
    pub async fn target(&self) -> (String, u16) {
        let host = self.host.lock().await.clone();
        let port = *self.port.lock().await;
        (host, port)
    }

    async fn set_target(&self, host: &str, port: u16) {
        *self.host.lock().await = host.to_string();
        *self.port.lock().await = port;
    }

    pub async fn managed(&self) -> bool {
        let mut guard = self.child.lock().await;
        let Some(child) = guard.as_mut() else {
            return false;
        };
        match child.try_wait() {
            Ok(None) => true,
            _ => {
                *guard = None;
                false
            }
        }
    }

    pub async fn stop(&self) {
        let Some(mut child) = self.child.lock().await.take() else {
            return;
        };
        let _ = child.start_kill();
        let _ = child.wait().await;
    }
}

pub fn supported() -> bool {
    cfg!(all(target_os = "macos", target_arch = "aarch64"))
}

/// Apple FM is usable when this is Apple Silicon and the `fm` CLI exists.
pub fn available() -> bool {
    supported() && detect_binary().is_some()
}

pub fn default_base_url() -> String {
    api_base_url(DEFAULT_HOST, DEFAULT_PORT)
}

pub fn origin(host: &str, port: u16) -> String {
    let host = host.trim();
    if host.contains(':') && !host.starts_with('[') {
        format!("http://[{host}]:{port}")
    } else {
        format!("http://{host}:{port}")
    }
}

pub fn api_base_url(host: &str, port: u16) -> String {
    format!("{}/v1", origin(host, port))
}

fn validate_target(host: &str, port: u16) -> AppResult<(String, u16)> {
    if !supported() {
        return Err(AppError::Other(
            "Apple FM は Apple Silicon（arm64）専用です。".into(),
        ));
    }
    if port == 0 {
        return Err(AppError::Other(
            "ポートは 1 から 65535 の範囲で指定してください。".into(),
        ));
    }

    let host = host.trim();
    let normalized = match host {
        "localhost" | "127.0.0.1" => "127.0.0.1",
        "::1" | "[::1]" => "::1",
        _ => {
            return Err(AppError::Other(
                "fm serve は 127.0.0.1 / localhost / ::1 でのみ起動できます。".into(),
            ));
        }
    };

    Ok((normalized.to_string(), port))
}

fn detect_binary() -> Option<PathBuf> {
    let system = PathBuf::from("/usr/bin/fm");
    if system.is_file() {
        return Some(system);
    }

    let paths = std::env::var_os("PATH")?;
    std::env::split_paths(&paths)
        .map(|dir| dir.join("fm"))
        .find(|path| path.is_file())
}

fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != '\x1b' {
            out.push(ch);
            continue;
        }
        if chars.peek() == Some(&'[') {
            chars.next();
            for marker in chars.by_ref() {
                if ('@'..='~').contains(&marker) {
                    break;
                }
            }
        }
    }
    out
}

fn parse_models(output: &str) -> Vec<AppleFmModel> {
    output
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            let (available, rest) = if let Some(rest) = line.strip_prefix('✓') {
                (true, rest)
            } else {
                let rest = line.strip_prefix('✗')?;
                (false, rest)
            };

            let rest = rest.trim();
            let mut parts = rest.splitn(2, char::is_whitespace);
            let id = parts.next()?.trim();
            if id.is_empty() {
                return None;
            }
            let detail = parts
                .next()
                .unwrap_or_default()
                .trim()
                .trim_matches(|ch| ch == '(' || ch == ')')
                .trim();

            Some(AppleFmModel {
                id: id.to_string(),
                available,
                reason: (!available && !detail.is_empty()).then(|| detail.to_string()),
            })
        })
        .collect()
}

async fn probe_models(binary: &Path) -> Result<Vec<AppleFmModel>, String> {
    let mut command = Command::new(binary);
    command.arg("models").kill_on_drop(true);
    let output = tokio::time::timeout(PROBE_TIMEOUT, command.output())
        .await
        .map_err(|_| "`fm models` がタイムアウトしました。".to_string())?
        .map_err(|error| format!("`fm models` を実行できませんでした: {error}"))?;

    let text = strip_ansi(&format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    ));
    let models = parse_models(&text);
    if models.is_empty() {
        return Err("`fm models` の出力を解析できませんでした。".into());
    }
    Ok(models)
}

async fn probe_health(
    state: &AppState,
    host: &str,
    port: u16,
) -> (bool, Option<String>, Vec<AppleFmModel>) {
    let url = format!("{}/health", origin(host, port));
    let response = state.http.get(&url).timeout(HEALTH_TIMEOUT).send().await;

    let response = match response {
        Ok(response) => response,
        Err(error) => {
            return (
                false,
                Some(format!("fm serve に接続できませんでした: {error}")),
                Vec::new(),
            );
        }
    };

    if !response.status().is_success() {
        return (
            false,
            Some(format!(
                "fm serve が HTTP {} を返しました。",
                response.status().as_u16()
            )),
            Vec::new(),
        );
    }

    let value: serde_json::Value = match response.json().await {
        Ok(value) => value,
        Err(_) => {
            return (
                true,
                Some("fm serve は応答していますが、ヘルス情報を解析できませんでした。".into()),
                Vec::new(),
            );
        }
    };

    let models = value
        .get("models")
        .and_then(|models| models.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let id = item.get("name").and_then(|name| name.as_str())?;
                    Some(AppleFmModel {
                        id: id.to_string(),
                        available: item
                            .get("available")
                            .and_then(|value| value.as_bool())
                            .unwrap_or(false),
                        reason: item
                            .get("reason")
                            .and_then(|value| value.as_str())
                            .map(str::to_string),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    (true, None, models)
}

pub async fn status(state: &AppState) -> AppleFmStatus {
    let (host, port) = state.applefm.target().await;
    let managed = state.applefm.managed().await;
    let binary = detect_binary();

    let (healthy, health_message, health_models) = probe_health(state, &host, port).await;
    let mut models = if health_models.is_empty() {
        match binary.as_deref() {
            Some(binary) => probe_models(binary).await.unwrap_or_default(),
            None => Vec::new(),
        }
    } else {
        health_models
    };

    if models.is_empty() {
        models.push(AppleFmModel {
            id: "system".into(),
            available: false,
            reason: Some("モデル情報を取得できませんでした。".into()),
        });
    }

    let system_available = models
        .iter()
        .any(|model| model.id == "system" && model.available);

    let message = if !supported() {
        "Apple FM は Apple Silicon（arm64）専用です。Intel Mac では利用できません。".into()
    } else if binary.is_none() {
        "`fm` が見つかりません。macOS 27 以降の Apple Silicon で利用できます。".into()
    } else if !healthy {
        health_message
            .unwrap_or_else(|| "fm は検出しましたが、fm serve は起動していません。".into())
    } else if !system_available {
        "fm serve は起動していますが、利用可能な system モデルがありません。Apple Intelligence を有効にしてください。".into()
    } else {
        "fm serve は起動しています。".into()
    };

    let base_url = api_base_url(&host, port);

    AppleFmStatus {
        supported: supported(),
        binary: binary.map(|path| path.to_string_lossy().to_string()),
        server_running: healthy,
        managed,
        host,
        port,
        base_url,
        models,
        message,
    }
}

pub async fn start(state: &AppState, host: &str, port: u16) -> AppResult<AppleFmStatus> {
    let (host, port) = validate_target(host, port)?;
    let binary = detect_binary().ok_or_else(|| {
        AppError::Other(
            "`fm` が見つかりません。macOS 27 以降の Apple Silicon で利用できます。".into(),
        )
    })?;

    if !probe_health(state, &host, port).await.0 {
        state.applefm.stop().await;

        let mut command = Command::new(&binary);
        command
            .arg("serve")
            .arg("--host")
            .arg(&host)
            .arg("--port")
            .arg(port.to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);

        let child = command.spawn().map_err(|error| {
            AppError::Other(format!("`fm serve` を起動できませんでした: {error}"))
        })?;
        *state.applefm.child.lock().await = Some(child);
    }

    state.applefm.set_target(&host, port).await;

    for _ in 0..START_ATTEMPTS {
        if probe_health(state, &host, port).await.0 {
            return Ok(status(state).await);
        }
        if !state.applefm.managed().await {
            break;
        }
        tokio::time::sleep(START_INTERVAL).await;
    }

    let status = status(state).await;
    if status.server_running {
        return Ok(status);
    }

    state.applefm.stop().await;
    Err(AppError::Other(format!(
        "`fm serve` を起動できませんでした。Apple Intelligence が有効か、初回の `sudo fm license` に同意済みか確認してください。{}",
        status.message
    )))
}

pub async fn stop(state: &AppState) -> AppleFmStatus {
    state.applefm.stop().await;
    status(state).await
}

#[cfg(test)]
mod tests {
    use super::{api_base_url, origin, parse_models};

    #[test]
    fn parses_fm_models_output() {
        let output = "  Apple Foundation Models\n  ✓ system (AFM 3 Core Advanced)\n  ✗ pcc                           (Private Cloud Compute is not available in this context.)\n";
        let models = parse_models(output);
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "system");
        assert!(models[0].available);
        assert!(models[0].reason.is_none());
        assert_eq!(models[1].id, "pcc");
        assert!(!models[1].available);
        assert!(
            models[1]
                .reason
                .as_deref()
                .unwrap_or_default()
                .contains("Private Cloud")
        );
    }

    #[test]
    fn builds_local_api_urls() {
        assert_eq!(origin("127.0.0.1", 1976), "http://127.0.0.1:1976");
        assert_eq!(api_base_url("127.0.0.1", 1976), "http://127.0.0.1:1976/v1");
        assert_eq!(origin("::1", 1976), "http://[::1]:1976");
    }
}
