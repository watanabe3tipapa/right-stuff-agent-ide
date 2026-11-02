mod commands;
mod db;
mod error;
mod paths;
mod state;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let state = AppState::new(app.handle())?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::app_info,
            commands::workspace::workspace_open,
            commands::workspace::workspace_last,
            commands::workspace::workspace_list_files,
            commands::workspace::workspace_read_file,
            commands::workspace::workspace_write_file,
            commands::workspace::workspace_create_entry,
            commands::workspace::workspace_rename_entry,
            commands::workspace::workspace_delete_entry,
            commands::editor::editor_history,
            commands::editor::editor_version,
            commands::settings::settings_get,
            commands::settings::settings_set,
            commands::agent::agent_status,
            commands::agent::agent_run,
            commands::agent::agent_snapshot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running right-stuff-agent-ide");
}
