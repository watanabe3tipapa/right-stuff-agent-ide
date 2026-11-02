use tauri::State;

use crate::db::{self, VersionContent, VersionSummary};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[tauri::command]
pub async fn editor_history(
    path: String,
    limit: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<Vec<VersionSummary>> {
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Other("DB ロックの取得に失敗しました".into()))?;
    db::list_versions(&conn, &path, limit.unwrap_or(30).clamp(1, 100))
}

#[tauri::command]
pub async fn editor_version(id: i64, state: State<'_, AppState>) -> AppResult<VersionContent> {
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Other("DB ロックの取得に失敗しました".into()))?;
    db::get_version(&conn, id)
}
