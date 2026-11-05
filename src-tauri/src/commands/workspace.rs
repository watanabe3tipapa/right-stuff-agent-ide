use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::State;

use crate::db;
use crate::error::{AppError, AppResult};
use crate::fsutil::{atomic_write, now_millis};
use crate::paths;
use crate::state::AppState;

const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
const MAX_TREE_ENTRIES: usize = 5000;
const MAX_TREE_DEPTH: usize = 12;
const SETTING_LAST_WORKSPACE: &str = "last_workspace";

const IGNORED_NAMES: &[&str] = &[
    ".git",
    ".hg",
    ".svn",
    ".right-stuff",
    "node_modules",
    "target",
    "dist",
    "dist-ssr",
    ".next",
    ".nuxt",
    ".venv",
    "__pycache__",
    ".DS_Store",
    ".idea",
    ".turbo",
];

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    pub root: String,
    pub name: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<i64>,
    pub children: Vec<FileEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub path: String,
    pub content: String,
    pub language: String,
    pub size: u64,
    pub modified: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub path: String,
    pub version_id: i64,
    pub saved_at: i64,
    pub size: u64,
}

fn modified_millis(path: &Path) -> Option<i64> {
    fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
}

fn workspace_info(root: &Path) -> WorkspaceInfo {
    WorkspaceInfo {
        root: root.to_string_lossy().to_string(),
        name: root
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| root.to_string_lossy().to_string()),
    }
}

fn should_ignore(name: &str) -> bool {
    IGNORED_NAMES.contains(&name)
}

fn build_tree(root: &Path, dir: &Path, depth: usize, budget: &mut usize) -> Vec<FileEntry> {
    if depth > MAX_TREE_DEPTH || *budget == 0 {
        return Vec::new();
    }

    let Ok(read_dir) = fs::read_dir(dir) else {
        return Vec::new();
    };

    let mut entries: Vec<FileEntry> = Vec::new();

    for entry in read_dir.flatten() {
        if *budget == 0 {
            break;
        }

        let name = entry.file_name().to_string_lossy().to_string();
        if should_ignore(&name) {
            continue;
        }

        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }

        let path = entry.path();
        *budget -= 1;

        if file_type.is_dir() {
            let children = build_tree(root, &path, depth + 1, budget);
            entries.push(FileEntry {
                name,
                path: paths::to_relative(root, &path),
                is_dir: true,
                size: 0,
                modified: modified_millis(&path),
                children,
            });
        } else if file_type.is_file() {
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            entries.push(FileEntry {
                name,
                path: paths::to_relative(root, &path),
                is_dir: false,
                size,
                modified: modified_millis(&path),
                children: Vec::new(),
            });
        }
    }

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    entries
}

pub fn language_for(path: &str) -> String {
    let extension = Path::new(path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    match extension.as_str() {
        "ts" | "tsx" => "typescript",
        "js" | "jsx" | "mjs" | "cjs" => "javascript",
        "json" | "jsonc" => "json",
        "rs" => "rust",
        "py" => "python",
        "go" => "go",
        "java" => "java",
        "kt" | "kts" => "kotlin",
        "swift" => "swift",
        "c" | "h" => "c",
        "cc" | "cpp" | "cxx" | "hpp" => "cpp",
        "cs" => "csharp",
        "rb" => "ruby",
        "php" => "php",
        "sh" | "bash" | "zsh" => "shell",
        "yml" | "yaml" => "yaml",
        "toml" => "toml",
        "html" | "htm" => "html",
        "css" => "css",
        "scss" => "scss",
        "sql" => "sql",
        "md" | "markdown" => "markdown",
        "xml" => "xml",
        "dockerfile" => "dockerfile",
        _ => {
            if path.to_lowercase().ends_with("dockerfile") {
                "dockerfile"
            } else {
                "plaintext"
            }
        }
    }
    .to_string()
}

#[tauri::command]
pub async fn workspace_open(path: String, state: State<'_, AppState>) -> AppResult<WorkspaceInfo> {
    let root = PathBuf::from(&path)
        .canonicalize()
        .map_err(|_| AppError::NotFound(path.clone()))?;

    if !root.is_dir() {
        return Err(AppError::Other(format!(
            "ディレクトリではありません: {path}"
        )));
    }

    {
        let conn = state
            .db
            .lock()
            .map_err(|_| AppError::Other("DB ロックの取得に失敗しました".into()))?;
        db::set_setting(&conn, SETTING_LAST_WORKSPACE, &root.to_string_lossy())?;
    }

    let info = workspace_info(&root);
    *state
        .root
        .lock()
        .map_err(|_| AppError::Other("状態ロックの取得に失敗しました".into()))? = Some(root);

    Ok(info)
}

#[tauri::command]
pub async fn workspace_last(state: State<'_, AppState>) -> AppResult<Option<WorkspaceInfo>> {
    let saved = {
        let conn = state
            .db
            .lock()
            .map_err(|_| AppError::Other("DB ロックの取得に失敗しました".into()))?;
        db::get_setting(&conn, SETTING_LAST_WORKSPACE)?
    };

    let Some(saved) = saved else {
        return Ok(None);
    };

    let Ok(root) = PathBuf::from(&saved).canonicalize() else {
        return Ok(None);
    };
    if !root.is_dir() {
        return Ok(None);
    }

    let info = workspace_info(&root);
    *state
        .root
        .lock()
        .map_err(|_| AppError::Other("状態ロックの取得に失敗しました".into()))? = Some(root);

    Ok(Some(info))
}

#[tauri::command]
pub async fn workspace_list_files(state: State<'_, AppState>) -> AppResult<Vec<FileEntry>> {
    let root = state.root()?;
    let mut budget = MAX_TREE_ENTRIES;
    Ok(build_tree(&root, &root, 0, &mut budget))
}

#[tauri::command]
pub async fn workspace_read_file(
    path: String,
    state: State<'_, AppState>,
) -> AppResult<FileContent> {
    let root = state.root()?;
    let absolute = paths::resolve_existing(&root, &path)?;

    if !absolute.is_file() {
        return Err(AppError::Other(format!("ファイルではありません: {path}")));
    }

    let metadata = fs::metadata(&absolute)?;
    if metadata.len() > MAX_FILE_BYTES {
        return Err(AppError::TooLarge(path));
    }

    let bytes = fs::read(&absolute)?;
    if bytes.iter().take(8000).any(|b| *b == 0) {
        return Err(AppError::BinaryFile(path));
    }

    Ok(FileContent {
        path: path.clone(),
        content: String::from_utf8_lossy(&bytes).to_string(),
        language: language_for(&path),
        size: metadata.len(),
        modified: modified_millis(&absolute).unwrap_or_else(now_millis),
    })
}

#[tauri::command]
pub async fn workspace_write_file(
    path: String,
    content: String,
    state: State<'_, AppState>,
) -> AppResult<SaveResult> {
    let root = state.root()?;
    let absolute = paths::resolve_new(&root, &path)?;

    if absolute.is_dir() {
        return Err(AppError::Other(format!(
            "ディレクトリには書き込めません: {path}"
        )));
    }

    atomic_write(&absolute, content.as_bytes())?;

    let saved_at = now_millis();
    let version_id = {
        let conn = state
            .db
            .lock()
            .map_err(|_| AppError::Other("DB ロックの取得に失敗しました".into()))?;
        db::record_version(&conn, &path, &content)?
    };

    Ok(SaveResult {
        path,
        version_id,
        saved_at,
        size: content.len() as u64,
    })
}

#[tauri::command]
pub async fn workspace_create_entry(
    path: String,
    is_dir: bool,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let root = state.root()?;
    let absolute = paths::resolve_new(&root, &path)?;

    if absolute.exists() {
        return Err(AppError::AlreadyExists(path));
    }

    if is_dir {
        fs::create_dir_all(&absolute)?;
    } else {
        if let Some(parent) = absolute.parent() {
            fs::create_dir_all(parent)?;
        }
        atomic_write(&absolute, b"")?;

        let conn = state
            .db
            .lock()
            .map_err(|_| AppError::Other("DB ロックの取得に失敗しました".into()))?;
        db::record_version(&conn, &path, "")?;
    }

    Ok(path)
}

#[tauri::command]
pub async fn workspace_rename_entry(
    from: String,
    to: String,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let root = state.root()?;
    let source = paths::resolve_existing(&root, &from)?;
    let target = paths::resolve_new(&root, &to)?;

    if target.exists() {
        return Err(AppError::AlreadyExists(to));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::rename(&source, &target)?;

    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Other("DB ロックの取得に失敗しました".into()))?;
    conn.execute(
        "UPDATE file_versions SET path = ?1 WHERE path = ?2",
        rusqlite::params![to, from],
    )?;

    Ok(to)
}

#[tauri::command]
pub async fn workspace_delete_entry(path: String, state: State<'_, AppState>) -> AppResult<String> {
    let root = state.root()?;
    if path == ".right-stuff" || path.starts_with(".right-stuff/") {
        return Err(AppError::Other("内部ディレクトリは削除できません".into()));
    }

    let absolute = paths::resolve_existing(&root, &path)?;
    if absolute == root {
        return Err(AppError::Other(
            "ワークスペースルートは削除できません".into(),
        ));
    }

    let trash_dir = root
        .join(".right-stuff")
        .join("trash")
        .join(now_millis().to_string());
    fs::create_dir_all(&trash_dir)?;

    let file_name = absolute
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or_else(|| AppError::Other("削除対象の名前が不正です".into()))?;

    let trashed = trash_dir.join(file_name);
    fs::rename(&absolute, &trashed)?;

    Ok(paths::to_relative(&root, &trashed))
}
