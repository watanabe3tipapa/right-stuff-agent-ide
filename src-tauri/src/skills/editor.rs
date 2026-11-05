use std::fs;
use std::path::Path;

use rusqlite::Connection;
use serde::Serialize;
use similar::{ChangeTag, TextDiff};

use crate::db;
use crate::error::{AppError, AppResult};
use crate::fsutil::{atomic_write, now_millis};
use crate::paths;

const DENIED_COMPONENTS: &[&str] = &[
    ".git",
    ".right-stuff",
    "node_modules",
    "target",
    "dist",
    "build",
    ".ssh",
];
const DENIED_NAMES: &[&str] = &["id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"];
const DENIED_EXTENSIONS: &[&str] = &["pem", "key", "p12", "pfx"];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillFileRead {
    pub path: String,
    pub content: String,
    pub size: u64,
    pub modified: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillFileChange {
    pub path: String,
    /// Version recorded before the write. It is the undo target.
    pub version_id: i64,
    pub saved_at: i64,
    pub size: u64,
    pub added_lines: usize,
    pub removed_lines: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillPreview {
    pub path: String,
    pub added_lines: usize,
    pub removed_lines: usize,
    pub diff: String,
}

pub fn read_file(root: &Path, rel: &str, max_bytes: u64) -> AppResult<SkillFileRead> {
    let absolute = resolve_read(root, rel, max_bytes)?;
    let bytes = fs::read(&absolute)?;
    let modified = modified_millis(&absolute);

    Ok(SkillFileRead {
        path: rel.to_string(),
        content: decode_text(rel, &bytes)?,
        size: bytes.len() as u64,
        modified,
    })
}

pub fn preview_replace(
    root: &Path,
    rel: &str,
    old_text: &str,
    new_text: &str,
    max_bytes: u64,
) -> AppResult<SkillPreview> {
    let content = read_text(root, rel, max_bytes)?;
    let updated = apply_replace(&content, old_text, new_text)?;
    if updated.len() as u64 > max_bytes {
        return Err(AppError::TooLarge(rel.to_string()));
    }
    Ok(build_preview(rel, &content, &updated))
}

pub fn preview_create(
    root: &Path,
    rel: &str,
    content: &str,
    max_bytes: u64,
) -> AppResult<SkillPreview> {
    let _ = paths::validate_relative(rel)?;
    ensure_allowed(rel)?;
    if content.len() as u64 > max_bytes {
        return Err(AppError::TooLarge(rel.to_string()));
    }
    let absolute = paths::resolve_new(root, rel)?;
    if absolute.exists() {
        return Err(AppError::AlreadyExists(rel.to_string()));
    }
    Ok(build_preview(rel, "", content))
}

pub fn replace_text(
    root: &Path,
    conn: &Connection,
    rel: &str,
    old_text: &str,
    new_text: &str,
    max_bytes: u64,
) -> AppResult<SkillFileChange> {
    let absolute = resolve_read(root, rel, max_bytes)?;
    let content = read_text_from(&absolute, rel)?;
    let updated = apply_replace(&content, old_text, new_text)?;
    if updated.len() as u64 > max_bytes {
        return Err(AppError::TooLarge(rel.to_string()));
    }

    let (added_lines, removed_lines) = line_delta(&content, &updated);
    // Record the state before the write so the edit can be undone.
    let version_id = db::record_version(conn, rel, &content)?;
    atomic_write(&absolute, updated.as_bytes())?;

    Ok(SkillFileChange {
        path: rel.to_string(),
        version_id,
        saved_at: now_millis(),
        size: updated.len() as u64,
        added_lines,
        removed_lines,
    })
}

pub fn create_file(
    root: &Path,
    conn: &Connection,
    rel: &str,
    content: &str,
    max_bytes: u64,
) -> AppResult<SkillFileChange> {
    let _ = paths::validate_relative(rel)?;
    ensure_allowed(rel)?;
    if content.len() as u64 > max_bytes {
        return Err(AppError::TooLarge(rel.to_string()));
    }

    let absolute = paths::resolve_new(root, rel)?;
    if absolute.exists() {
        return Err(AppError::AlreadyExists(rel.to_string()));
    }
    if absolute.is_dir() {
        return Err(AppError::Other(format!(
            "ディレクトリには書き込めません: {rel}"
        )));
    }

    let (added_lines, _) = line_delta("", content);
    let version_id = db::record_version(conn, rel, "")?;
    atomic_write(&absolute, content.as_bytes())?;

    Ok(SkillFileChange {
        path: rel.to_string(),
        version_id,
        saved_at: now_millis(),
        size: content.len() as u64,
        added_lines,
        removed_lines: 0,
    })
}

fn resolve_read(root: &Path, rel: &str, max_bytes: u64) -> AppResult<std::path::PathBuf> {
    let _ = paths::validate_relative(rel)?;
    ensure_allowed(rel)?;
    let absolute = paths::resolve_existing(root, rel)?;
    if !absolute.is_file() {
        return Err(AppError::Other(format!("ファイルではありません: {rel}")));
    }
    let metadata = fs::metadata(&absolute)?;
    if metadata.len() > max_bytes {
        return Err(AppError::TooLarge(rel.to_string()));
    }
    Ok(absolute)
}

fn read_text(root: &Path, rel: &str, max_bytes: u64) -> AppResult<String> {
    let absolute = resolve_read(root, rel, max_bytes)?;
    read_text_from(&absolute, rel)
}

fn read_text_from(absolute: &Path, rel: &str) -> AppResult<String> {
    let bytes = fs::read(absolute)?;
    decode_text(rel, &bytes)
}

fn decode_text(rel: &str, bytes: &[u8]) -> AppResult<String> {
    if bytes.iter().take(8000).any(|byte| *byte == 0) {
        return Err(AppError::BinaryFile(rel.to_string()));
    }
    String::from_utf8(bytes.to_vec())
        .map_err(|_| AppError::Other(format!("UTF-8 ではないファイルは編集できません: {rel}")))
}

fn apply_replace(content: &str, old_text: &str, new_text: &str) -> AppResult<String> {
    if old_text.is_empty() {
        return Err(AppError::Other("置換前の文字列が空です".into()));
    }
    if old_text == new_text {
        return Err(AppError::Other("置換前と置換後の文字列が同じです".into()));
    }
    let mut matches = content.match_indices(old_text);
    let Some((index, _)) = matches.next() else {
        return Err(AppError::Other(
            "置換前の文字列がファイル内にありません".into(),
        ));
    };
    if matches.next().is_some() {
        return Err(AppError::Other(
            "置換前の文字列がファイル内で複数一致します。一意に特定できる文字列を指定してください"
                .into(),
        ));
    }

    let mut updated = String::with_capacity(content.len() + new_text.len());
    updated.push_str(&content[..index]);
    updated.push_str(new_text);
    updated.push_str(&content[index + old_text.len()..]);
    Ok(updated)
}

fn build_preview(rel: &str, old: &str, new: &str) -> SkillPreview {
    let (added_lines, removed_lines) = line_delta(old, new);
    let diff = TextDiff::from_lines(old, new)
        .unified_diff()
        .context_radius(3)
        .header("before", "after")
        .to_string();
    SkillPreview {
        path: rel.to_string(),
        added_lines,
        removed_lines,
        diff,
    }
}

fn line_delta(old: &str, new: &str) -> (usize, usize) {
    let diff = TextDiff::from_lines(old, new);
    let mut added = 0;
    let mut removed = 0;
    for change in diff.iter_all_changes() {
        match change.tag() {
            ChangeTag::Insert => added += 1,
            ChangeTag::Delete => removed += 1,
            ChangeTag::Equal => {}
        }
    }
    (added, removed)
}

fn ensure_allowed(rel: &str) -> AppResult<()> {
    let path = Path::new(rel);
    for component in path.components() {
        let std::path::Component::Normal(part) = component else {
            continue;
        };
        let name = part.to_string_lossy();
        if DENIED_COMPONENTS.contains(&name.as_ref()) {
            return Err(AppError::Other(format!(
                "スキルから操作できないパスです: {rel}"
            )));
        }
    }

    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if file_name == ".env" || file_name.starts_with(".env.") {
        return Err(AppError::Other(format!(
            "秘密情報の可能性があるパスです: {rel}"
        )));
    }
    if DENIED_NAMES
        .iter()
        .any(|name| file_name == *name || file_name.starts_with(&format!("{name}.")))
    {
        return Err(AppError::Other(format!(
            "秘密鍵の可能性があるパスです: {rel}"
        )));
    }
    if let Some(extension) = path.extension() {
        let extension = extension.to_string_lossy().to_lowercase();
        if DENIED_EXTENSIONS.contains(&extension.as_ref()) {
            return Err(AppError::Other(format!(
                "秘密情報の可能性があるパスです: {rel}"
            )));
        }
    }
    Ok(())
}

fn modified_millis(path: &Path) -> i64 {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_else(now_millis)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    fn workspace(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock before epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "right-stuff-editor-{tag}-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create workspace");
        // `std::env::temp_dir()` is a symlink on macOS (/var -> /private/var),
        // while the path guards compare canonicalized paths.
        fs::canonicalize(&root).expect("canonicalize workspace")
    }

    fn connection() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        crate::db::init(&conn).expect("init db");
        conn
    }

    #[test]
    fn reads_and_replaces_a_unique_string() {
        let root = workspace("replace");
        fs::write(root.join("app.ts"), "const value: string = 1;\n").expect("seed file");
        let conn = connection();

        let read = read_file(&root, "app.ts", 1024 * 1024).expect("read");
        assert!(read.content.contains("const value"));

        let change = replace_text(
            &root,
            &conn,
            "app.ts",
            "const value: string = 1;",
            "const value: number = 1;",
            1024 * 1024,
        )
        .expect("replace");
        assert_eq!(change.added_lines, 1);
        assert_eq!(change.removed_lines, 1);
        assert!(
            fs::read_to_string(root.join("app.ts"))
                .expect("read back")
                .contains("number")
        );
        assert!(db::get_version(&conn, change.version_id).is_ok());

        fs::remove_dir_all(root).expect("clean workspace");
    }

    #[test]
    fn rejects_zero_or_multiple_matches() {
        let root = workspace("matches");
        fs::write(root.join("app.ts"), "let a = 1;\nlet a = 1;\n").expect("seed file");
        let conn = connection();

        let error =
            replace_text(&root, &conn, "app.ts", "missing", "x", 1024).expect_err("zero matches");
        assert!(error.to_string().contains("ありません"));

        let error = replace_text(&root, &conn, "app.ts", "let a = 1;", "x", 1024)
            .expect_err("multiple matches");
        assert!(error.to_string().contains("複数"));

        fs::remove_dir_all(root).expect("clean workspace");
    }

    #[test]
    fn creates_a_new_file_and_refuses_to_overwrite() {
        let root = workspace("create");
        let conn = connection();

        let change =
            create_file(&root, &conn, "src/new.ts", "export {};\n", 1024).expect("create file");
        assert_eq!(change.added_lines, 1);
        assert!(root.join("src/new.ts").exists());

        assert!(
            create_file(&root, &conn, "src/new.ts", "x", 1024).is_err(),
            "existing files must not be overwritten"
        );

        fs::remove_dir_all(root).expect("clean workspace");
    }

    #[test]
    fn rejects_denied_paths() {
        let root = workspace("denied");
        let conn = connection();
        for path in [
            ".env",
            ".env.local",
            ".git/config",
            "node_modules/pkg/index.js",
            "id_rsa",
            "id_ed25519.pub",
            "certs/server.pem",
            "private.key",
        ] {
            assert!(
                create_file(&root, &conn, path, "x", 1024).is_err(),
                "{path} should be rejected"
            );
        }
        fs::remove_dir_all(root).expect("clean workspace");
    }

    #[test]
    fn preview_does_not_write() {
        let root = workspace("preview");
        let path = root.join("app.ts");
        fs::write(&path, "let a = 1;\n").expect("seed file");

        let preview =
            preview_replace(&root, "app.ts", "let a = 1;", "let a = 2;", 1024).expect("preview");
        assert!(preview.diff.contains("let a = 2;"));
        assert_eq!(
            fs::read_to_string(&path).expect("read back"),
            "let a = 1;\n"
        );

        fs::remove_dir_all(root).expect("clean workspace");
    }

    #[test]
    fn enforces_the_byte_limit() {
        let root = workspace("limit");
        fs::write(root.join("big.ts"), "1234567890").expect("seed file");
        let conn = connection();
        assert!(read_file(&root, "big.ts", 5).is_err());
        assert!(replace_text(&root, &conn, "big.ts", "1", "2", 5).is_err());
        fs::remove_dir_all(root).expect("clean workspace");
    }
}
