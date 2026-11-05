use std::path::Path;

use serde_json::Value;

use crate::commands::git as git_commands;
use crate::error::{AppError, AppResult};
use crate::skills::exec::truncate_chars;
use crate::skills::{HandlerOutcome, params};

const MAX_OUTPUT_CHARS: usize = 50_000;

pub fn run(root: &Path, handler: &str, params: &Value) -> AppResult<HandlerOutcome> {
    match handler {
        "git.status" => {
            let status = git_commands::status_at(root)?;
            let output = pretty(&status)?;
            Ok(HandlerOutcome {
                stdout: output,
                detail: match &status.branch {
                    Some(branch) => format!("Git の状態を確認しました (branch: {branch})"),
                    None => "Git の状態を確認しました".into(),
                },
                ..HandlerOutcome::default()
            })
        }
        "git.diff" => {
            let path = params::string_param(params, "path")?;
            let staged = params::bool_param(params, "staged", false)?;
            let diff = git_commands::diff_at(root, path, staged)?;
            Ok(HandlerOutcome {
                stdout: truncate_chars(&diff.diff, MAX_OUTPUT_CHARS),
                detail: format!("{path} の差分を取得しました"),
                ..HandlerOutcome::default()
            })
        }
        "git.branches" => {
            let branches = git_commands::branches_at(root)?;
            Ok(HandlerOutcome {
                stdout: pretty(&branches)?,
                detail: format!("ブランチを {} 件取得しました", branches.len()),
                ..HandlerOutcome::default()
            })
        }
        "git.stage" => {
            let path = params::string_param(params, "path")?;
            let result = git_commands::stage_at(root, path)?;
            ensure_ok(&result.stdout, &result.stderr, &result.command, result.ok)?;
            Ok(HandlerOutcome {
                changed_files: vec![path.to_string()],
                stdout: format!("{path} をステージしました"),
                detail: format!("git add {path}"),
                exit_code: result.code,
                ..HandlerOutcome::default()
            })
        }
        "git.stageAll" => {
            let result = git_commands::stage_all_at(root)?;
            ensure_ok(&result.stdout, &result.stderr, &result.command, result.ok)?;
            Ok(HandlerOutcome {
                stdout: "すべての変更をステージしました".into(),
                detail: "git add -A".into(),
                exit_code: result.code,
                ..HandlerOutcome::default()
            })
        }
        "git.commit" => {
            let message = params::string_param(params, "message")?;
            let result = git_commands::commit_at(root, message)?;
            ensure_ok(&result.stdout, &result.stderr, &result.command, result.ok)?;
            Ok(HandlerOutcome {
                stdout: result.stdout.clone(),
                detail: format!("コミットを作成しました: {}", first_line(message)),
                exit_code: result.code,
                ..HandlerOutcome::default()
            })
        }
        other => Err(AppError::Other(format!(
            "未実装の Git ハンドラです: {other}"
        ))),
    }
}

fn pretty<T: serde::Serialize>(value: &T) -> AppResult<String> {
    serde_json::to_string_pretty(value).map_err(|error| AppError::Other(error.to_string()))
}

fn ensure_ok(stdout: &str, stderr: &str, command: &[String], ok: bool) -> AppResult<()> {
    if ok {
        return Ok(());
    }
    let command = command.join(" ");
    let detail = if stderr.trim().is_empty() {
        stdout.trim()
    } else {
        stderr.trim()
    };
    Err(AppError::Other(format!(
        "{command} が失敗しました: {}",
        truncate_chars(detail, 2_000)
    )))
}

fn first_line(value: &str) -> &str {
    value.lines().next().unwrap_or(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_the_first_commit_line() {
        assert_eq!(first_line("subject\n\nbody"), "subject");
    }

    #[test]
    fn rejects_unknown_handlers() {
        let root = std::env::temp_dir();
        let error = run(&root, "git.push", &Value::Null).expect_err("unknown handler");
        assert!(error.to_string().contains("未実装"));
    }
}
