use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, State};

use crate::error::{AppError, AppResult};
use crate::paths;
use crate::rpc::{self, SpawnOptions};
use crate::state::AppState;

static NEXT_DAP_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DapAdapterInfo {
    pub id: String,
    pub label: String,
    pub available: bool,
    pub command: Vec<String>,
    pub install: String,
    pub languages: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DapStart {
    pub id: String,
    pub adapter: String,
    pub command: Vec<String>,
    pub program: Option<String>,
    pub root: String,
}

/// `lldb-dap` ships with the Command Line Tools but is not on the GUI PATH.
/// Ask `xcrun` for its location as a fallback.
fn lldb_dap_command() -> Option<Vec<String>> {
    if let Some(path) = rpc::find_executable("lldb-dap") {
        return Some(vec![path.to_string_lossy().to_string()]);
    }

    let output = Command::new("xcrun")
        .args(["-f", "lldb-dap"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8(output.stdout).ok()?.trim().to_string();
    if path.is_empty() || !Path::new(&path).is_file() {
        return None;
    }
    Some(vec![path])
}

fn debugpy_command() -> Option<Vec<String>> {
    let python = rpc::find_executable("python3")?;
    let status = Command::new(&python)
        .args(["-c", "import debugpy.adapter"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .ok()?;
    if !status.success() {
        return None;
    }
    Some(vec![
        python.to_string_lossy().to_string(),
        "-m".into(),
        "debugpy.adapter".into(),
    ])
}

fn adapter_command(adapter: &str) -> Option<Vec<String>> {
    match adapter {
        "lldb-dap" => lldb_dap_command(),
        "debugpy" => debugpy_command(),
        _ => None,
    }
}

#[tauri::command]
pub fn dap_adapters() -> Vec<DapAdapterInfo> {
    let lldb = lldb_dap_command();
    let debugpy = debugpy_command();

    vec![
        DapAdapterInfo {
            id: "lldb-dap".into(),
            label: "LLDB (lldb-dap)".into(),
            available: lldb.is_some(),
            command: lldb.unwrap_or_default(),
            install: "xcode-select --install".into(),
            languages: vec![
                "c".into(),
                "cpp".into(),
                "rust".into(),
                "swift".into(),
                "objective-c".into(),
            ],
        },
        DapAdapterInfo {
            id: "debugpy".into(),
            label: "Python (debugpy)".into(),
            available: debugpy.is_some(),
            command: debugpy.unwrap_or_default(),
            install: "pip install debugpy".into(),
            languages: vec!["python".into()],
        },
    ]
}

/// Accept an absolute executable, or a workspace-relative one. The result is
/// canonicalized so `..` cannot escape the workspace for relative inputs.
fn validate_program(root: &Path, program: &str) -> AppResult<PathBuf> {
    let candidate = if Path::new(program).is_absolute() {
        PathBuf::from(program)
    } else {
        root.join(paths::validate_relative(program)?)
    };

    let canonical = candidate
        .canonicalize()
        .map_err(|_| AppError::NotFound(program.to_string()))?;
    if !canonical.is_file() {
        return Err(AppError::Other(format!(
            "デバッグ対象がファイルではありません: {program}"
        )));
    }
    Ok(canonical)
}

#[tauri::command]
pub fn dap_start(
    app: AppHandle,
    state: State<'_, AppState>,
    adapter: String,
    program: Option<String>,
) -> AppResult<DapStart> {
    let root = state.root()?;
    let command = adapter_command(&adapter).ok_or_else(|| {
        AppError::Other(format!(
            "デバッグアダプター {adapter} が見つかりません。対応するツールを導入してください。"
        ))
    })?;

    let program = match program
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => Some(
            validate_program(&root, value)?
                .to_string_lossy()
                .to_string(),
        ),
        None => None,
    };

    let id = format!("dap-{}", NEXT_DAP_ID.fetch_add(1, Ordering::Relaxed));
    let session = rpc::spawn(
        &app,
        "dap",
        &id,
        SpawnOptions {
            command: &command,
            cwd: &root,
        },
    )?;

    state
        .dap_sessions
        .lock()
        .map_err(|_| AppError::Other("DAP 状態のロックに失敗しました。".into()))?
        .insert(id.clone(), session);

    Ok(DapStart {
        id,
        adapter,
        command,
        program,
        root: root.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn dap_send(state: State<'_, AppState>, id: String, message: Value) -> AppResult<()> {
    let sessions = state
        .dap_sessions
        .lock()
        .map_err(|_| AppError::Other("DAP 状態のロックに失敗しました。".into()))?;
    let session = sessions
        .get(&id)
        .ok_or_else(|| AppError::Other("デバッグセッションが見つかりません。".into()))?;
    rpc::write_message(session, &message)
}

#[tauri::command]
pub fn dap_stop(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let mut sessions = state
        .dap_sessions
        .lock()
        .map_err(|_| AppError::Other("DAP 状態のロックに失敗しました。".into()))?;
    if let Some(mut session) = sessions.remove(&id) {
        rpc::kill(&mut session);
    }
    Ok(())
}

pub fn shutdown_dap(state: &AppState) {
    rpc::shutdown(&state.dap_sessions);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_adapter() {
        assert!(adapter_command("gdb").is_none());
    }

    #[test]
    fn validates_absolute_programs() {
        let root = std::env::temp_dir();
        let found = validate_program(&root, "/bin/ls").unwrap();
        assert!(found.ends_with("ls"));
    }

    #[test]
    fn rejects_missing_programs() {
        let root = std::env::temp_dir();
        assert!(validate_program(&root, "definitely-not-a-real-binary-xyz").is_err());
    }
}
