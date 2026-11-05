use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::{AppError, AppResult};

/// Write a file through a temporary file in the same directory, then rename.
/// The rename keeps readers from seeing a partially written file.
pub fn atomic_write(absolute: &Path, content: &[u8]) -> AppResult<()> {
    let parent = absolute
        .parent()
        .ok_or_else(|| AppError::Other("保存先ディレクトリが不正です".into()))?;
    fs::create_dir_all(parent)?;

    let file_name = absolute
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".into());
    let temp_path = parent.join(format!(".{file_name}.rsai-tmp-{}", now_millis()));

    fs::write(&temp_path, content)?;

    match fs::rename(&temp_path, absolute) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = fs::remove_file(&temp_path);
            Err(AppError::Io(error))
        }
    }
}

pub fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}
