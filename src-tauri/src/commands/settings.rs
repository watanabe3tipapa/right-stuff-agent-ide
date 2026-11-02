use tauri::State;

use crate::db;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[tauri::command]
pub async fn settings_get(key: String, state: State<'_, AppState>) -> AppResult<Option<String>> {
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Other("DB ロックの取得に失敗しました".into()))?;
    db::get_setting(&conn, &key)
}

#[tauri::command]
pub async fn settings_set(key: String, value: String, state: State<'_, AppState>) -> AppResult<()> {
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Other("DB ロックの取得に失敗しました".into()))?;
    db::set_setting(&conn, &key, &value)
}
