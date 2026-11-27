use tauri::State;

use crate::error::AppResult;
use crate::opencode;
use crate::state::AppState;

#[tauri::command]
pub async fn opencode_status(state: State<'_, AppState>) -> AppResult<opencode::OpencodeStatus> {
    Ok(opencode::status(&state).await)
}

#[tauri::command]
pub async fn opencode_start(
    app: tauri::AppHandle,
    mode: String,
    path: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<opencode::OpencodeStatus> {
    match opencode::start(&app, &state, &mode, path).await {
        Ok(status) => Ok(status),
        Err(error) => {
            opencode::record_error(&state, &error.to_string());
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn opencode_stop(state: State<'_, AppState>) -> AppResult<()> {
    opencode::stop(&state).await;
    Ok(())
}

#[tauri::command]
pub async fn opencode_set_mode(mode: String, state: State<'_, AppState>) -> AppResult<()> {
    opencode::set_mode(&state, &mode)
}

#[tauri::command]
pub async fn opencode_prompt(
    text: String,
    mode: String,
    prompt_id: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<opencode::OpencodePromptResult> {
    opencode::prompt(&state, &mode, text, prompt_id).await
}

#[tauri::command]
pub async fn opencode_cancel(state: State<'_, AppState>) -> AppResult<()> {
    opencode::cancel(&state).await
}
