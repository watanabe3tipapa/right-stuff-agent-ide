mod commands;
mod db;
mod error;
mod paths;
mod state;

use state::AppState;
use tauri::{Emitter, Manager};

/// macOS builds the predefined Quit item as `Quit <AppName>` (muda sets an
/// explicit title), so match the prefix rather than the exact word.
#[cfg(target_os = "macos")]
fn is_quit_item_text(text: &str) -> bool {
    let text = text.replace('&', "").trim().to_lowercase();
    text == "quit" || text.starts_with("quit ") || text == "exit" || text == "終了"
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::is_quit_item_text;

    #[test]
    fn detects_the_native_quit_item_title() {
        // muda titles the item `Quit <AppName>`; a bare "quit" comparison
        // silently skipped the guard before this was handled.
        assert!(is_quit_item_text("Quit right-stuff-agent-ide"));
        assert!(is_quit_item_text("Quit"));
    }

    #[test]
    fn ignores_case_padding_and_mnemonics() {
        assert!(is_quit_item_text("  QUIT App "));
        assert!(is_quit_item_text("&Quit App"));
        assert!(is_quit_item_text("Exit"));
        assert!(is_quit_item_text("終了"));
    }

    #[test]
    fn ignores_unrelated_menu_items() {
        assert!(!is_quit_item_text(""));
        assert!(!is_quit_item_text("Hide Others"));
        assert!(!is_quit_item_text("Show All"));
    }
}

/// Replace the native macOS Quit menu item with one that notifies the WebView
/// first. `RunEvent::ExitRequested` is not emitted for Cmd+Q on macOS, so the
/// menu item is the only reliable hook for the keyboard shortcut and app menu.
#[cfg(target_os = "macos")]
fn install_quit_menu_guard(app: &tauri::App) -> tauri::Result<()> {
    let Some(menu) = app.menu() else {
        return Ok(());
    };

    let mut target = None;
    'outer: for item in menu.items()? {
        let Some(submenu) = item.as_submenu() else {
            continue;
        };
        for (index, child) in submenu.items()?.into_iter().enumerate() {
            let Some(predefined) = child.as_predefined_menuitem() else {
                continue;
            };
            let text = predefined.text().unwrap_or_default();
            if is_quit_item_text(&text) {
                target = Some((submenu.clone(), index));
                break 'outer;
            }
        }
    }

    let Some((submenu, index)) = target else {
        return Ok(());
    };

    submenu.remove_at(index)?;
    let quit = tauri::menu::MenuItem::with_id(
        app,
        "app:quit",
        "Quit Right-Stuff Agent IDE",
        true,
        Some("CmdOrCtrl+Q"),
    )?;
    submenu.append(&quit)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .on_menu_event(|app, event| {
            if event.id() == "app:quit" {
                let _ = app.emit("app://quit-requested", ());
            }
        })
        .setup(|app| {
            #[cfg(target_os = "macos")]
            install_quit_menu_guard(app)?;

            let state = AppState::new(app.handle())?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::app_info,
            commands::app::app_quit,
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
            commands::policy::agent_policy_get,
            commands::policy::agent_policy_set,
            commands::policy::audit_log_add,
            commands::policy::audit_log_list,
            commands::openship::openship_config_get,
            commands::openship::openship_config_set,
            commands::openship::openship_token_set,
            commands::openship::openship_token_delete,
            commands::openship::openship_status,
            commands::openship::openship_projects,
            commands::openship::openship_deployments,
            commands::openship::openship_deploy,
            commands::openship::openship_logs,
            commands::openship::openship_rollback,
            commands::llm::llm_config_get,
            commands::llm::llm_config_set,
            commands::llm::llm_key_set,
            commands::llm::llm_key_status,
            commands::llm::llm_key_delete,
            commands::llm::llm_test,
            commands::llm::llm_chat,
            commands::llm::llm_cancel,
            commands::git::git_status,
            commands::git::git_init,
            commands::git::git_diff,
            commands::git::git_stage,
            commands::git::git_unstage,
            commands::git::git_stage_all,
            commands::git::git_unstage_all,
            commands::git::git_commit,
            commands::git::git_log,
            commands::terminal::terminal_start,
            commands::terminal::terminal_write,
            commands::terminal::terminal_resize,
            commands::terminal::terminal_kill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running right-stuff-agent-ide");
}
