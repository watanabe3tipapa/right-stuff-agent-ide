use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub tauri_version: String,
    pub platform: String,
    pub arch: String,
}

#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo {
        name: "Right-Stuff Agent IDE".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        tauri_version: tauri::VERSION.into(),
        platform: std::env::consts::OS.into(),
        arch: std::env::consts::ARCH.into(),
    }
}

/// Exit after the WebView has confirmed that unsaved changes were handled.
/// Kept as a command so the exit only happens after the in-app dialog resolves.
#[tauri::command]
pub fn app_quit(app: tauri::AppHandle) {
    use tauri::Manager;
    let state = app.state::<crate::state::AppState>();
    crate::commands::terminal::shutdown_terminals(&state.terminals);
    crate::commands::lsp::shutdown_lsp(&state);
    crate::commands::dap::shutdown_dap(&state);
    app.exit(0);
}
