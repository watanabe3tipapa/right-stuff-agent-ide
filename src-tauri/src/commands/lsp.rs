use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, State};

use crate::error::{AppError, AppResult};
use crate::rpc::{self, SpawnOptions};
use crate::state::AppState;

static NEXT_LSP_ID: AtomicU64 = AtomicU64::new(1);

struct ServerSpec {
    language: &'static str,
    label: &'static str,
    program: &'static str,
    args: &'static [&'static str],
    install: &'static str,
}

/// Servers are limited to this fixed registry so the WebView cannot ask Rust to
/// run an arbitrary command. Users install the server; the IDE only launches it.
const SERVERS: &[ServerSpec] = &[
    ServerSpec {
        language: "rust",
        label: "rust-analyzer",
        program: "rust-analyzer",
        args: &[],
        install: "rustup component add rust-analyzer",
    },
    ServerSpec {
        language: "typescript",
        label: "typescript-language-server",
        program: "typescript-language-server",
        args: &["--stdio"],
        install: "npm install -g typescript-language-server typescript",
    },
    ServerSpec {
        language: "javascript",
        label: "typescript-language-server",
        program: "typescript-language-server",
        args: &["--stdio"],
        install: "npm install -g typescript-language-server typescript",
    },
    ServerSpec {
        language: "typescriptreact",
        label: "typescript-language-server",
        program: "typescript-language-server",
        args: &["--stdio"],
        install: "npm install -g typescript-language-server typescript",
    },
    ServerSpec {
        language: "javascriptreact",
        label: "typescript-language-server",
        program: "typescript-language-server",
        args: &["--stdio"],
        install: "npm install -g typescript-language-server typescript",
    },
    ServerSpec {
        language: "python",
        label: "pyright-langserver",
        program: "pyright-langserver",
        args: &["--stdio"],
        install: "npm install -g pyright",
    },
    ServerSpec {
        language: "go",
        label: "gopls",
        program: "gopls",
        args: &[],
        install: "go install golang.org/x/tools/gopls@latest",
    },
    ServerSpec {
        language: "c",
        label: "clangd",
        program: "clangd",
        args: &[],
        install: "xcode-select --install",
    },
    ServerSpec {
        language: "cpp",
        label: "clangd",
        program: "clangd",
        args: &[],
        install: "xcode-select --install",
    },
    ServerSpec {
        language: "objective-c",
        label: "clangd",
        program: "clangd",
        args: &[],
        install: "xcode-select --install",
    },
    ServerSpec {
        language: "objective-cpp",
        label: "clangd",
        program: "clangd",
        args: &[],
        install: "xcode-select --install",
    },
    ServerSpec {
        language: "swift",
        label: "sourcekit-lsp",
        program: "sourcekit-lsp",
        args: &[],
        install: "xcode-select --install",
    },
    ServerSpec {
        language: "lua",
        label: "lua-language-server",
        program: "lua-language-server",
        args: &[],
        install: "brew install lua-language-server",
    },
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspServerInfo {
    pub language: String,
    pub label: String,
    pub available: bool,
    pub command: Vec<String>,
    pub install: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspStart {
    pub id: String,
    pub language: String,
    pub command: Vec<String>,
    pub root: String,
}

fn spec_for(language: &str) -> AppResult<&'static ServerSpec> {
    SERVERS
        .iter()
        .find(|spec| spec.language == language)
        .ok_or_else(|| AppError::Other(format!("この言語の LSP サーバーは未対応です: {language}")))
}

fn resolved_command(spec: &ServerSpec) -> Option<(Vec<String>, PathBuf)> {
    let program = rpc::find_executable(spec.program)?;
    let mut command = vec![program.to_string_lossy().to_string()];
    command.extend(spec.args.iter().map(|arg| (*arg).to_string()));
    Some((command, program))
}

#[tauri::command]
pub fn lsp_servers() -> Vec<LspServerInfo> {
    SERVERS
        .iter()
        .map(|spec| {
            let resolved = resolved_command(spec);
            LspServerInfo {
                language: spec.language.to_string(),
                label: spec.label.to_string(),
                available: resolved.is_some(),
                command: resolved.map(|(command, _)| command).unwrap_or_default(),
                install: spec.install.to_string(),
            }
        })
        .collect()
}

#[tauri::command]
pub fn lsp_start(
    app: AppHandle,
    state: State<'_, AppState>,
    language: String,
) -> AppResult<LspStart> {
    let root = state.root()?;
    let spec = spec_for(&language)?;
    let (command, _) = resolved_command(spec).ok_or_else(|| {
        AppError::Other(format!(
            "LSP サーバー {} が見つかりません。{} で導入してください。",
            spec.label, spec.install
        ))
    })?;

    let id = format!("lsp-{}", NEXT_LSP_ID.fetch_add(1, Ordering::Relaxed));
    let session = rpc::spawn(
        &app,
        "lsp",
        &id,
        SpawnOptions {
            command: &command,
            cwd: &root,
        },
    )?;

    state
        .lsp_sessions
        .lock()
        .map_err(|_| AppError::Other("LSP 状態のロックに失敗しました。".into()))?
        .insert(id.clone(), session);

    Ok(LspStart {
        id,
        language,
        command,
        root: root.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn lsp_send(state: State<'_, AppState>, id: String, message: Value) -> AppResult<()> {
    let sessions = state
        .lsp_sessions
        .lock()
        .map_err(|_| AppError::Other("LSP 状態のロックに失敗しました。".into()))?;
    let session = sessions
        .get(&id)
        .ok_or_else(|| AppError::Other("LSP セッションが見つかりません。".into()))?;
    rpc::write_message(session, &message)
}

#[tauri::command]
pub fn lsp_stop(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let mut sessions = state
        .lsp_sessions
        .lock()
        .map_err(|_| AppError::Other("LSP 状態のロックに失敗しました。".into()))?;
    if let Some(mut session) = sessions.remove(&id) {
        rpc::kill(&mut session);
    }
    Ok(())
}

pub fn shutdown_lsp(state: &AppState) {
    rpc::shutdown(&state.lsp_sessions);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_registry_language_is_unique() {
        let mut seen = std::collections::HashSet::new();
        for spec in SERVERS {
            assert!(seen.insert(spec.language), "duplicate {}", spec.language);
        }
    }

    #[test]
    fn rejects_unknown_language() {
        assert!(spec_for("cobol").is_err());
    }

    #[test]
    fn resolves_specs_to_commands_without_a_shell() {
        let spec = spec_for("typescript").unwrap();
        assert_eq!(spec.program, "typescript-language-server");
        assert_eq!(spec.args, &["--stdio"]);
    }
}
