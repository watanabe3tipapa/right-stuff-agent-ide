use tauri::State;

use crate::applefm::{self, AppleFmStatus};
use crate::error::AppResult;
use crate::state::AppState;

#[tauri::command]
pub async fn apple_fm_status(state: State<'_, AppState>) -> AppResult<AppleFmStatus> {
    Ok(applefm::status(&state).await)
}

#[tauri::command]
pub async fn apple_fm_start(
    host: String,
    port: u16,
    state: State<'_, AppState>,
) -> AppResult<AppleFmStatus> {
    applefm::start(&state, &host, port).await
}

#[tauri::command]
pub async fn apple_fm_stop(state: State<'_, AppState>) -> AppResult<AppleFmStatus> {
    Ok(applefm::stop(&state).await)
}
