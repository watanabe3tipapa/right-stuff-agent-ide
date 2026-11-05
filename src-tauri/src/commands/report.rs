use std::fs;

use tauri::State;

use crate::error::{AppError, AppResult};
use crate::fsutil::atomic_write;
use crate::paths;
use crate::state::AppState;

/// Reports live under the workspace so they stay local and travel with it.
pub const REPORT_DIR: &str = ".agents/reports";
const MAX_REPORT_BYTES: usize = 4 * 1024 * 1024;
const MAX_FILE_NAME_CHARS: usize = 120;

/// Write a self-contained HTML report into `.agents/reports/`.
/// The WebView supplies the bytes, but Rust still owns the destination:
/// absolute paths, separators, and traversal are rejected.
#[tauri::command]
pub fn report_export(
    state: State<'_, AppState>,
    file_name: String,
    html: String,
) -> AppResult<String> {
    let root = state.root()?;
    let name = validate_file_name(&file_name)?;
    if html.len() > MAX_REPORT_BYTES {
        return Err(AppError::Other(format!(
            "レポートが大きすぎます (上限 {} MB)",
            MAX_REPORT_BYTES / (1024 * 1024)
        )));
    }

    let relative = format!("{REPORT_DIR}/{name}");
    let absolute = paths::resolve_new(&root, &relative)?;
    if let Some(parent) = absolute.parent() {
        fs::create_dir_all(parent)?;
    }
    atomic_write(&absolute, html.as_bytes())?;
    Ok(paths::to_relative(&root, &absolute))
}

fn validate_file_name(file_name: &str) -> AppResult<String> {
    let name = file_name.trim();
    if name.is_empty() {
        return Err(AppError::Other("ファイル名が空です".into()));
    }
    if name.chars().count() > MAX_FILE_NAME_CHARS {
        return Err(AppError::Other(format!(
            "ファイル名は {MAX_FILE_NAME_CHARS} 文字以内にしてください"
        )));
    }
    if name == "." || name == ".." || name.starts_with('.') {
        return Err(AppError::Other("ファイル名が不正です".into()));
    }
    if !name.ends_with(".html") {
        return Err(AppError::Other(
            "レポートの拡張子は .html である必要があります".into(),
        ));
    }
    if !name
        .chars()
        .all(|value| value.is_ascii_alphanumeric() || matches!(value, '.' | '_' | '-'))
    {
        return Err(AppError::Other(
            "ファイル名には英数字と . _ - だけを使えます".into(),
        ));
    }
    Ok(name.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_bounded_html_name() {
        assert_eq!(
            validate_file_name("run-2026-11-05.html").expect("valid"),
            "run-2026-11-05.html"
        );
    }

    #[test]
    fn rejects_traversal_and_other_extensions() {
        for name in [
            "../report.html",
            "/tmp/report.html",
            ".hidden.html",
            "report.txt",
            "report html",
        ] {
            assert!(
                validate_file_name(name).is_err(),
                "{name} should be rejected"
            );
        }
    }
}
