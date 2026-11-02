use std::path::{Component, Path, PathBuf};

use crate::error::{AppError, AppResult};

/// Reject absolute paths and any `..` traversal. Returns a normalized relative path.
pub fn validate_relative(rel: &str) -> AppResult<PathBuf> {
    if rel.trim().is_empty() {
        return Err(AppError::Other("パスが空です".into()));
    }

    let candidate = Path::new(rel);
    if candidate.is_absolute() {
        return Err(AppError::OutsideWorkspace(rel.to_string()));
    }

    let mut normalized = PathBuf::new();
    for component in candidate.components() {
        match component {
            Component::Normal(part) => normalized.push(part),
            Component::CurDir => {}
            _ => return Err(AppError::OutsideWorkspace(rel.to_string())),
        }
    }

    if normalized.as_os_str().is_empty() {
        return Err(AppError::Other("パスが空です".into()));
    }

    Ok(normalized)
}

/// Resolve a path that must already exist, and make sure it stays inside the workspace.
pub fn resolve_existing(root: &Path, rel: &str) -> AppResult<PathBuf> {
    let relative = validate_relative(rel)?;
    let joined = root.join(&relative);

    let canonical = joined
        .canonicalize()
        .map_err(|_| AppError::NotFound(rel.to_string()))?;

    if !canonical.starts_with(root) {
        return Err(AppError::OutsideWorkspace(rel.to_string()));
    }

    Ok(canonical)
}

/// Resolve a path that may not exist yet. The closest existing ancestor must be inside the workspace.
pub fn resolve_new(root: &Path, rel: &str) -> AppResult<PathBuf> {
    let relative = validate_relative(rel)?;
    let joined = root.join(&relative);

    let mut ancestor = joined.parent();
    while let Some(dir) = ancestor {
        if dir.exists() {
            let canonical = dir.canonicalize()?;
            if !canonical.starts_with(root) {
                return Err(AppError::OutsideWorkspace(rel.to_string()));
            }
            break;
        }
        ancestor = dir.parent();
    }

    Ok(joined)
}

/// Forward-slash relative path used as the stable identifier in the UI.
pub fn to_relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/")
}
