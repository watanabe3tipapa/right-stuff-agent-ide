use std::path::Path;
use std::process::{Command, Output};

use serde::Serialize;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::paths;
use crate::state::AppState;

const MAX_OUTPUT_CHARS: usize = 200_000;
const MAX_COMMIT_MESSAGE_CHARS: usize = 5_000;
const MAX_LOG_ENTRIES: usize = 50;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFile {
    pub path: String,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub repo: bool,
    pub branch: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub staged: Vec<GitFile>,
    pub unstaged: Vec<GitFile>,
    pub untracked: Vec<GitFile>,
    pub clean: bool,
    pub message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiff {
    pub path: String,
    pub staged: bool,
    pub diff: String,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommandResult {
    pub ok: bool,
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub command: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
    pub name: String,
    pub current: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub hash: String,
    pub author: String,
    pub date: String,
    pub subject: String,
}

fn truncate(value: &str, limit: usize) -> (String, bool) {
    if value.chars().count() <= limit {
        return (value.to_string(), false);
    }
    let truncated: String = value.chars().take(limit).collect();
    (format!("{truncated}\n… (出力が長いため省略しました)"), true)
}

fn run_git(root: &Path, args: &[&str]) -> AppResult<Output> {
    Command::new("git")
        .args(args)
        .current_dir(root)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("LC_ALL", "C")
        .output()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                AppError::Other(
                    "git が見つかりません。Xcode Command Line Tools をインストールしてください。"
                        .into(),
                )
            } else {
                AppError::Other(format!("git を実行できませんでした: {error}"))
            }
        })
}

fn status_label(code: char) -> &'static str {
    match code {
        'M' => "M",
        'A' => "A",
        'D' => "D",
        'R' => "R",
        'C' => "C",
        'U' => "U",
        'T' => "T",
        _ => "?",
    }
}

fn push_file(target: &mut Vec<GitFile>, path: &str, code: char) {
    if code == '.' || code == ' ' {
        return;
    }
    let path = path.trim();
    if path.is_empty() {
        return;
    }
    target.push(GitFile {
        path: path.to_string(),
        status: status_label(code).to_string(),
    });
}

/// Parse `git status --porcelain=v2 --branch --untracked-files=all`.
fn parse_status(text: &str) -> GitStatus {
    let mut status = GitStatus {
        repo: true,
        branch: None,
        ahead: 0,
        behind: 0,
        staged: Vec::new(),
        unstaged: Vec::new(),
        untracked: Vec::new(),
        clean: true,
        message: None,
    };

    for line in text.lines() {
        if let Some(value) = line.strip_prefix("# branch.head ") {
            let value = value.trim();
            status.branch = if value == "(detached)" {
                Some("detached HEAD".into())
            } else {
                Some(value.to_string())
            };
            continue;
        }
        if let Some(value) = line.strip_prefix("# branch.ab ") {
            for part in value.split_whitespace() {
                if let Some(ahead) = part.strip_prefix('+') {
                    status.ahead = ahead.parse().unwrap_or(0);
                } else if let Some(behind) = part.strip_prefix('-') {
                    status.behind = behind.parse().unwrap_or(0);
                }
            }
            continue;
        }
        if line.starts_with("# ") || line.trim().is_empty() {
            continue;
        }

        match line.chars().next() {
            Some('1') => {
                let parts: Vec<&str> = line.splitn(9, ' ').collect();
                if let (Some(xy), Some(path)) = (parts.get(1), parts.get(8)) {
                    let mut chars = xy.chars();
                    let x = chars.next().unwrap_or('.');
                    let y = chars.next().unwrap_or('.');
                    push_file(&mut status.staged, path, x);
                    push_file(&mut status.unstaged, path, y);
                }
            }
            Some('2') => {
                let parts: Vec<&str> = line.splitn(10, ' ').collect();
                if let (Some(xy), Some(path)) = (parts.get(1), parts.get(9)) {
                    let path = path.split('\t').next().unwrap_or(path);
                    let mut chars = xy.chars();
                    let x = chars.next().unwrap_or('.');
                    let y = chars.next().unwrap_or('.');
                    push_file(&mut status.staged, path, x);
                    push_file(&mut status.unstaged, path, y);
                }
            }
            Some('u') => {
                let parts: Vec<&str> = line.splitn(11, ' ').collect();
                if let (Some(xy), Some(path)) = (parts.get(1), parts.get(10)) {
                    let code = xy.chars().next().unwrap_or('U');
                    push_file(&mut status.unstaged, path, code);
                }
            }
            Some('?') => {
                if let Some(path) = line.strip_prefix("? ") {
                    push_file(&mut status.untracked, path, '?');
                }
            }
            _ => {}
        }
    }

    status.clean =
        status.staged.is_empty() && status.unstaged.is_empty() && status.untracked.is_empty();
    status
}

pub(crate) fn status_at(root: &Path) -> AppResult<GitStatus> {
    let probe = run_git(root, &["rev-parse", "--is-inside-work-tree"])?;
    if !probe.status.success() {
        return Ok(GitStatus {
            repo: false,
            branch: None,
            ahead: 0,
            behind: 0,
            staged: Vec::new(),
            unstaged: Vec::new(),
            untracked: Vec::new(),
            clean: true,
            message: Some("このワークスペースは Git リポジトリではありません。".into()),
        });
    }

    let output = run_git(
        root,
        &[
            "status",
            "--porcelain=v2",
            "--branch",
            "--untracked-files=all",
        ],
    )?;
    if !output.status.success() {
        return Ok(GitStatus {
            repo: false,
            branch: None,
            ahead: 0,
            behind: 0,
            staged: Vec::new(),
            unstaged: Vec::new(),
            untracked: Vec::new(),
            clean: true,
            message: Some(String::from_utf8_lossy(&output.stderr).trim().to_string()),
        });
    }

    Ok(parse_status(&String::from_utf8_lossy(&output.stdout)))
}

#[tauri::command]
pub fn git_status(state: State<'_, AppState>) -> AppResult<GitStatus> {
    let root = state.root()?;
    status_at(&root)
}

#[tauri::command]
pub fn git_init(state: State<'_, AppState>) -> AppResult<GitCommandResult> {
    let root = state.root()?;
    let output = run_git(&root, &["init"])?;
    Ok(command_result("git init", output))
}

pub(crate) fn diff_at(root: &Path, path: &str, staged: bool) -> AppResult<GitDiff> {
    paths::validate_relative(path)?;

    let mut args = vec!["diff", "--no-color", "--unified=3"];
    if staged {
        args.push("--cached");
    }
    args.extend(["--", path]);
    let output = run_git(root, &args)?;

    let mut diff = String::from_utf8_lossy(&output.stdout).to_string();
    if diff.trim().is_empty() && !staged {
        // Untracked files do not show up in `git diff`; compare against an
        // empty file instead so the panel can still preview the contents.
        let output = run_git(
            root,
            &["diff", "--no-color", "--no-index", "--", "/dev/null", path],
        )?;
        if !output.stdout.is_empty() {
            diff = String::from_utf8_lossy(&output.stdout).to_string();
        }
    }

    if diff.trim().is_empty() {
        diff = "差分はありません（バイナリまたは空のファイル）。".into();
    }

    let (diff, truncated) = truncate(&diff, MAX_OUTPUT_CHARS);
    Ok(GitDiff {
        path: path.to_string(),
        staged,
        diff,
        truncated,
    })
}

#[tauri::command]
pub fn git_diff(state: State<'_, AppState>, path: String, staged: bool) -> AppResult<GitDiff> {
    let root = state.root()?;
    diff_at(&root, &path, staged)
}

pub(crate) fn stage_at(root: &Path, path: &str) -> AppResult<GitCommandResult> {
    paths::validate_relative(path)?;
    let output = run_git(root, &["add", "--", path])?;
    Ok(command_result(&format!("git add {path}"), output))
}

#[tauri::command]
pub fn git_stage(state: State<'_, AppState>, path: String) -> AppResult<GitCommandResult> {
    let root = state.root()?;
    stage_at(&root, &path)
}

#[tauri::command]
pub fn git_unstage(state: State<'_, AppState>, path: String) -> AppResult<GitCommandResult> {
    let root = state.root()?;
    paths::validate_relative(&path)?;
    let output = run_git(&root, &["restore", "--staged", "--", path.as_str()])?;
    Ok(command_result(
        &format!("git restore --staged {path}"),
        output,
    ))
}

pub(crate) fn stage_all_at(root: &Path) -> AppResult<GitCommandResult> {
    let output = run_git(root, &["add", "-A"])?;
    Ok(command_result("git add -A", output))
}

#[tauri::command]
pub fn git_stage_all(state: State<'_, AppState>) -> AppResult<GitCommandResult> {
    let root = state.root()?;
    stage_all_at(&root)
}

#[tauri::command]
pub fn git_unstage_all(state: State<'_, AppState>) -> AppResult<GitCommandResult> {
    let root = state.root()?;
    let output = run_git(&root, &["reset"])?;
    Ok(command_result("git reset", output))
}

pub(crate) fn commit_at(root: &Path, message: &str) -> AppResult<GitCommandResult> {
    let message = message.trim();
    if message.is_empty() {
        return Err(AppError::Other(
            "コミットメッセージを入力してください。".into(),
        ));
    }
    if message.chars().count() > MAX_COMMIT_MESSAGE_CHARS {
        return Err(AppError::Other(format!(
            "コミットメッセージが長すぎます (上限 {MAX_COMMIT_MESSAGE_CHARS} 文字)。"
        )));
    }

    let output = run_git(root, &["commit", "-m", message])?;
    Ok(command_result("git commit", output))
}

#[tauri::command]
pub fn git_commit(state: State<'_, AppState>, message: String) -> AppResult<GitCommandResult> {
    let root = state.root()?;
    commit_at(&root, &message)
}

#[tauri::command]
pub fn git_log(state: State<'_, AppState>, limit: Option<usize>) -> AppResult<Vec<GitCommit>> {
    let root = state.root()?;
    let limit = limit.unwrap_or(20).clamp(1, MAX_LOG_ENTRIES);
    let count = format!("-n{limit}");
    let output = run_git(
        &root,
        &["log", &count, "--pretty=format:%h%x09%an%x09%ar%x09%s"],
    )?;
    if !output.status.success() {
        return Ok(Vec::new());
    }

    let text = String::from_utf8_lossy(&output.stdout);
    Ok(text
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(4, '\t');
            let hash = parts.next()?.to_string();
            let author = parts.next()?.to_string();
            let date = parts.next()?.to_string();
            let subject = parts.next().unwrap_or_default().to_string();
            Some(GitCommit {
                hash,
                author,
                date,
                subject,
            })
        })
        .collect())
}

pub(crate) fn branches_at(root: &Path) -> AppResult<Vec<GitBranch>> {
    let output = run_git(
        root,
        &[
            "branch",
            "--format=%(refname:short)%09%(HEAD)",
            "--no-color",
        ],
    )?;
    if !output.status.success() {
        return Ok(Vec::new());
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(2, '\t');
            let name = parts.next()?.trim();
            if name.is_empty() {
                return None;
            }
            Some(GitBranch {
                name: name.to_string(),
                current: parts.next().map(str::trim) == Some("*"),
            })
        })
        .collect())
}

fn command_result(command: &str, output: Output) -> GitCommandResult {
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let (stdout, _) = truncate(&stdout, MAX_OUTPUT_CHARS);
    let (stderr, _) = truncate(&stderr, MAX_OUTPUT_CHARS);
    GitCommandResult {
        ok: output.status.success(),
        code: output.status.code(),
        stdout,
        stderr,
        command: command.split_whitespace().map(str::to_string).collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_branch_and_file_states() {
        let status = parse_status(
            "# branch.head main\n# branch.ab +2 -1\n1 M. N... 100644 100644 100644 abc abc src/a.rs\n1 .M N... 100644 100644 100644 abc abc src/b.rs\n? notes.md\n",
        );
        assert_eq!(status.branch.as_deref(), Some("main"));
        assert_eq!(status.ahead, 2);
        assert_eq!(status.behind, 1);
        assert_eq!(status.staged[0].path, "src/a.rs");
        assert_eq!(status.unstaged[0].path, "src/b.rs");
        assert_eq!(status.untracked[0].path, "notes.md");
        assert!(!status.clean);
    }

    #[test]
    fn parses_renames_and_detached_head() {
        let status = parse_status(
            "# branch.head (detached)\n2 R. N... 100644 100644 100644 abc abc R100 new name.rs\told name.rs\n",
        );
        assert_eq!(status.branch.as_deref(), Some("detached HEAD"));
        assert_eq!(status.staged[0].path, "new name.rs");
        assert_eq!(status.staged[0].status, "R");
    }

    #[test]
    fn empty_status_is_clean() {
        let status = parse_status("# branch.head main\n");
        assert!(status.clean);
        assert!(status.staged.is_empty());
    }

    #[test]
    fn labels_unknown_codes_as_untracked() {
        assert_eq!(status_label('X'), "?");
    }
}
