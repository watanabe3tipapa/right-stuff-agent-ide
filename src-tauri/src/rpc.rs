use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};

/// Event name paired with the one-shot waiter registered by `subscribe`.
type EventWaiter = (String, Sender<Value>);

/// Refuse pathological frames before allocating. LSP/DAP payloads are small;
/// a 16 MB ceiling leaves room for large documents without letting a broken
/// server exhaust memory.
const MAX_MESSAGE_BYTES: usize = 16 * 1024 * 1024;
const MAX_LOG_LINE: usize = 8 * 1024;

pub struct RpcSession {
    stdin: Arc<Mutex<ChildStdin>>,
    child: Child,
    pending: Arc<Mutex<HashMap<i64, Sender<Value>>>>,
    events: Arc<Mutex<Vec<EventWaiter>>>,
    next_id: AtomicI64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcMessage {
    pub id: String,
    pub message: Value,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcExit {
    pub id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcLog {
    pub id: String,
    pub line: String,
}

pub struct SpawnOptions<'a> {
    /// Full argv. The first element is an executable path, never a shell string.
    pub command: &'a [String],
    pub cwd: &'a Path,
}

/// Start a language server or debug adapter and stream framed JSON messages to
/// the WebView. The same Content-Length framing is used by LSP and DAP, so both
/// features share this transport.
pub fn spawn(
    app: &AppHandle,
    channel: &str,
    id: &str,
    options: SpawnOptions<'_>,
) -> AppResult<RpcSession> {
    let (program, args) = options
        .command
        .split_first()
        .ok_or_else(|| AppError::Other("起動するコマンドが指定されていません。".into()))?;

    if program.trim().is_empty() {
        return Err(AppError::Other("起動するコマンドが空です。".into()));
    }

    let mut child = Command::new(program)
        .args(args)
        .current_dir(options.cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| AppError::Other(format!("サーバーを起動できませんでした: {error}")))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| AppError::Other("サーバーの標準入力を開けませんでした。".into()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Other("サーバーの標準出力を開けませんでした。".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Other("サーバーの標準エラーを開けませんでした。".into()))?;
    let stdin = Arc::new(Mutex::new(stdin));
    let pending = Arc::new(Mutex::new(HashMap::<i64, Sender<Value>>::new()));
    let events = Arc::new(Mutex::new(Vec::<(String, Sender<Value>)>::new()));

    let message_event = format!("{channel}://message");
    let exit_event = format!("{channel}://exit");
    let log_event = format!("{channel}://log");

    let read_app = app.clone();
    let read_id = id.to_string();
    let read_pending = pending.clone();
    let read_events = events.clone();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            match read_message(&mut reader) {
                Ok(Some(message)) => {
                    dispatch(&message, &read_pending, &read_events);
                    let _ = read_app.emit(
                        &message_event,
                        RpcMessage {
                            id: read_id.clone(),
                            message,
                        },
                    );
                }
                Ok(None) => break,
                Err(_) => break,
            }
        }
        let _ = read_app.emit(&exit_event, RpcExit { id: read_id });
    });

    let log_app = app.clone();
    let log_id = id.to_string();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut buffer = String::new();
        loop {
            buffer.clear();
            match reader.read_line(&mut buffer) {
                Ok(0) => break,
                Ok(_) => {
                    let line = buffer.trim_end().chars().take(MAX_LOG_LINE).collect();
                    let _ = log_app.emit(
                        &log_event,
                        RpcLog {
                            id: log_id.clone(),
                            line,
                        },
                    );
                }
                Err(_) => break,
            }
        }
    });

    Ok(RpcSession {
        stdin,
        child,
        pending,
        events,
        next_id: AtomicI64::new(1),
    })
}

/// Route a DAP response to the waiting `request` call, or an event to any
/// matching `subscribe` call. LSP messages have neither field, so they are
/// simply forwarded to the WebView as before.
fn dispatch(
    message: &Value,
    pending: &Mutex<HashMap<i64, Sender<Value>>>,
    events: &Mutex<Vec<EventWaiter>>,
) {
    match message.get("type").and_then(Value::as_str) {
        Some("response") => {
            let Some(request_seq) = message.get("request_seq").and_then(Value::as_i64) else {
                return;
            };
            let waiter = pending
                .lock()
                .ok()
                .and_then(|mut pending| pending.remove(&request_seq));
            if let Some(waiter) = waiter {
                let _ = waiter.send(message.clone());
            }
        }
        Some("event") => {
            let event = message
                .get("event")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if let Ok(mut waiters) = events.lock() {
                waiters.retain(|(name, waiter)| {
                    if name == event {
                        let _ = waiter.send(message.clone());
                        false
                    } else {
                        true
                    }
                });
            }
        }
        _ => {}
    }
}

/// Send a request without waiting for its response. DAP's `launch` request is
/// answered only after the debuggee stops, so callers must not block on it.
pub fn send_request(session: &RpcSession, command: &str, arguments: Value) -> AppResult<i64> {
    let id = session.next_id.fetch_add(1, Ordering::Relaxed);
    let message = serde_json::json!({
        "seq": id,
        "type": "request",
        "command": command,
        "arguments": arguments,
    });
    write_message(session, &message)?;
    Ok(id)
}

/// Send a DAP request and wait for the matching response.
pub fn request(
    session: &RpcSession,
    command: &str,
    arguments: Value,
    timeout: Duration,
) -> AppResult<Value> {
    let id = session.next_id.fetch_add(1, Ordering::Relaxed);
    let (sender, receiver) = mpsc::channel();
    session
        .pending
        .lock()
        .map_err(|_| AppError::Other("DAP の応答待ちを登録できませんでした".into()))?
        .insert(id, sender);

    let message = serde_json::json!({
        "seq": id,
        "type": "request",
        "command": command,
        "arguments": arguments,
    });
    if let Err(error) = write_message(session, &message) {
        if let Ok(mut pending) = session.pending.lock() {
            pending.remove(&id);
        }
        return Err(error);
    }

    let response = match receiver.recv_timeout(timeout) {
        Ok(response) => response,
        Err(_) => {
            if let Ok(mut pending) = session.pending.lock() {
                pending.remove(&id);
            }
            return Err(AppError::Other(format!(
                "DAP の応答がタイムアウトしました: {command}"
            )));
        }
    };

    if response.get("success") == Some(&Value::Bool(false)) {
        let message = response
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("不明なエラー");
        return Err(AppError::Other(format!("DAP が失敗しました: {message}")));
    }
    Ok(response)
}

/// Register for a DAP event before sending the request that triggers it.
pub fn subscribe(session: &RpcSession, event: &str) -> AppResult<Receiver<Value>> {
    let (sender, receiver) = mpsc::channel();
    session
        .events
        .lock()
        .map_err(|_| AppError::Other("DAP イベントの購読に失敗しました".into()))?
        .push((event.to_string(), sender));
    Ok(receiver)
}

pub fn wait_event(receiver: Receiver<Value>, event: &str, timeout: Duration) -> AppResult<Value> {
    receiver.recv_timeout(timeout).map_err(|_| {
        AppError::Other(format!(
            "DAP イベント {event} が {} ms 以内に届きませんでした",
            timeout.as_millis()
        ))
    })
}

pub fn write_message(session: &RpcSession, message: &Value) -> AppResult<()> {
    let body = serde_json::to_vec(message)?;
    if body.len() > MAX_MESSAGE_BYTES {
        return Err(AppError::Other("送信するメッセージが大きすぎます。".into()));
    }

    let mut stdin = session
        .stdin
        .lock()
        .map_err(|_| AppError::Other("サーバーの入力をロックできませんでした。".into()))?;
    write!(stdin, "Content-Length: {}\r\n\r\n", body.len())?;
    stdin.write_all(&body)?;
    stdin.flush()?;
    Ok(())
}

/// Resolve an executable from `PATH` plus the locations macOS GUI apps miss
/// when they are launched from Finder (Homebrew, rustup, `/usr/bin`).
pub fn find_executable(name: &str) -> Option<PathBuf> {
    if name.contains('/') {
        let path = PathBuf::from(name);
        return path.is_file().then_some(path);
    }

    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(value) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&value));
    }
    for extra in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
        dirs.push(PathBuf::from(extra));
    }
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(PathBuf::from(home).join(".cargo/bin"));
    }

    dirs.into_iter()
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.is_file())
}

pub fn kill(session: &mut RpcSession) {
    let _ = session.child.kill();
}

/// Terminate every session in a map. Used when the workspace changes and when
/// the app exits, so no language server or adapter outlives the UI.
pub fn shutdown(sessions: &Mutex<HashMap<String, RpcSession>>) {
    if let Ok(mut sessions) = sessions.lock() {
        for (_, mut session) in sessions.drain() {
            kill(&mut session);
        }
    }
}

/// Read one Content-Length framed JSON message. Returns `Ok(None)` on EOF.
fn read_message(reader: &mut impl BufRead) -> AppResult<Option<Value>> {
    let mut length: Option<usize> = None;

    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            return Ok(None);
        }
        let header = line.trim_end_matches(['\r', '\n']);
        if header.is_empty() {
            break;
        }
        if let Some((name, value)) = header.split_once(':')
            && name.trim().eq_ignore_ascii_case("content-length")
        {
            length = value.trim().parse::<usize>().ok();
        }
    }

    let length = length.ok_or_else(|| AppError::Other("Content-Length がありません。".into()))?;
    if length == 0 {
        return Err(AppError::Other("空のメッセージを受信しました。".into()));
    }
    if length > MAX_MESSAGE_BYTES {
        return Err(AppError::Other("受信したメッセージが大きすぎます。".into()));
    }

    let mut body = vec![0u8; length];
    reader.read_exact(&mut body)?;
    let value = serde_json::from_slice(&body)?;
    Ok(Some(value))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn parses_two_framed_messages() {
        let payload = concat!(
            "Content-Length: 14\r\n\r\n",
            "{\"id\":1,\"a\":1}",
            "Content-Length: 8\r\n\r\n",
            "{\"id\":2}"
        );
        let mut reader = Cursor::new(payload.as_bytes());

        let first = read_message(&mut reader).unwrap().unwrap();
        assert_eq!(first["id"], 1);
        let second = read_message(&mut reader).unwrap().unwrap();
        assert_eq!(second["id"], 2);
        assert!(read_message(&mut reader).unwrap().is_none());
    }

    #[test]
    fn accepts_case_insensitive_headers() {
        let mut reader = Cursor::new(b"content-length: 2\r\n\r\n{}".as_slice());
        let value = read_message(&mut reader).unwrap().unwrap();
        assert_eq!(value, serde_json::json!({}));
    }

    #[test]
    fn rejects_missing_length() {
        let mut reader = Cursor::new(b"X-Test: 1\r\n\r\n{}".as_slice());
        assert!(read_message(&mut reader).is_err());
    }

    #[test]
    fn rejects_oversized_frames() {
        let header = format!("Content-Length: {}\r\n\r\n", MAX_MESSAGE_BYTES + 1);
        let mut reader = Cursor::new(header.into_bytes());
        assert!(read_message(&mut reader).is_err());
    }
}
