use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::error::{AppError, AppResult};
use crate::state::AppState;

const MAX_TERMINAL_COLS: u16 = 400;
const MAX_TERMINAL_ROWS: u16 = 200;

static NEXT_TERMINAL_ID: AtomicU64 = AtomicU64::new(1);

pub(crate) struct TerminalHandle {
    pub(crate) writer: Box<dyn Write + Send>,
    pub(crate) master: Box<dyn MasterPty + Send>,
    pub(crate) child: Box<dyn Child + Send + Sync>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStart {
    pub id: String,
    pub shell: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutput {
    pub id: String,
    pub data: Vec<u8>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExit {
    pub id: String,
}

fn resolve_shell() -> AppResult<String> {
    let candidate = std::env::var("RIGHT_STUFF_SHELL")
        .ok()
        .or_else(|| std::env::var("SHELL").ok())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "/bin/zsh".into());

    if !candidate.starts_with('/') {
        return Err(AppError::Other(
            "シェルは絶対パスで指定してください。".into(),
        ));
    }
    if !Path::new(&candidate).exists() {
        return Err(AppError::Other(format!(
            "シェルが見つかりません: {candidate}"
        )));
    }
    Ok(candidate)
}

fn pty_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.clamp(1, MAX_TERMINAL_ROWS),
        cols: cols.clamp(1, MAX_TERMINAL_COLS),
        pixel_width: 0,
        pixel_height: 0,
    }
}

#[tauri::command]
pub fn terminal_start(
    app: AppHandle,
    state: State<'_, AppState>,
    cols: u16,
    rows: u16,
) -> AppResult<TerminalStart> {
    let root = state.root()?;
    let shell = resolve_shell()?;

    let pair = native_pty_system()
        .openpty(pty_size(cols, rows))
        .map_err(|error| AppError::Other(format!("ターミナルを開けませんでした: {error}")))?;

    let mut command = CommandBuilder::new(&shell);
    command.cwd(root);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| AppError::Other(format!("シェルを起動できませんでした: {error}")))?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| AppError::Other(format!("ターミナル出力を読めません: {error}")))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| AppError::Other(format!("ターミナル入力を開けません: {error}")))?;

    let id = format!("term-{}", NEXT_TERMINAL_ID.fetch_add(1, Ordering::Relaxed));
    let handle = TerminalHandle {
        writer,
        master: pair.master,
        child,
    };
    state
        .terminals
        .lock()
        .map_err(|_| AppError::Other("ターミナル状態のロックに失敗しました。".into()))?
        .insert(id.clone(), handle);

    let event_id = id.clone();
    let event_app = app.clone();
    std::thread::spawn(move || {
        let mut buffer = [0u8; 16 * 1024];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    let _ = event_app.emit(
                        "terminal://output",
                        TerminalOutput {
                            id: event_id.clone(),
                            data: buffer[..read].to_vec(),
                        },
                    );
                }
                Err(_) => break,
            }
        }
        let _ = event_app.emit("terminal://exit", TerminalExit { id: event_id });
    });

    Ok(TerminalStart { id, shell })
}

#[tauri::command]
pub fn terminal_write(state: State<'_, AppState>, id: String, data: String) -> AppResult<()> {
    let mut terminals = state
        .terminals
        .lock()
        .map_err(|_| AppError::Other("ターミナル状態のロックに失敗しました。".into()))?;
    let handle = terminals
        .get_mut(&id)
        .ok_or_else(|| AppError::Other("ターミナルが見つかりません。".into()))?;
    handle
        .writer
        .write_all(data.as_bytes())
        .and_then(|_| handle.writer.flush())
        .map_err(|error| AppError::Other(format!("ターミナルへ書き込めません: {error}")))
}

#[tauri::command]
pub fn terminal_resize(
    state: State<'_, AppState>,
    id: String,
    cols: u16,
    rows: u16,
) -> AppResult<()> {
    let terminals = state
        .terminals
        .lock()
        .map_err(|_| AppError::Other("ターミナル状態のロックに失敗しました。".into()))?;
    let handle = terminals
        .get(&id)
        .ok_or_else(|| AppError::Other("ターミナルが見つかりません。".into()))?;
    handle
        .master
        .resize(pty_size(cols, rows))
        .map_err(|error| AppError::Other(format!("ターミナルのサイズを変更できません: {error}")))
}

#[tauri::command]
pub fn terminal_kill(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let mut terminals = state
        .terminals
        .lock()
        .map_err(|_| AppError::Other("ターミナル状態のロックに失敗しました。".into()))?;
    if let Some(mut handle) = terminals.remove(&id) {
        let _ = handle.child.kill();
    }
    Ok(())
}

pub fn shutdown_terminals(terminals: &Mutex<HashMap<String, TerminalHandle>>) {
    if let Ok(mut terminals) = terminals.lock() {
        for (_, mut handle) in terminals.drain() {
            let _ = handle.child.kill();
        }
    }
}
