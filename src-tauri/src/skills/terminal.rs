use std::path::Path;
use std::time::Duration;

use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::skills::exec;
use crate::skills::{HandlerOutcome, SkillManifest, params};

/// Programs the skill may launch. The list is deliberately small and is
/// checked again in Rust even though the manifest also lists it.
const ALLOWED_PROGRAMS: &[&str] = &[
    "npm", "pnpm", "yarn", "cargo", "node", "python3", "pytest", "make",
];
const MAX_ARGS: usize = 32;
const MAX_ARG_CHARS: usize = 512;

pub fn run(
    root: &Path,
    handler: &str,
    params: &Value,
    manifest: &SkillManifest,
) -> AppResult<HandlerOutcome> {
    match handler {
        "terminal.run" => run_command(root, params, manifest),
        other => Err(AppError::Other(format!(
            "未実装のターミナルハンドラです: {other}"
        ))),
    }
}

fn run_command(root: &Path, params: &Value, manifest: &SkillManifest) -> AppResult<HandlerOutcome> {
    let program = params::string_param(params, "program")?.trim();
    if !ALLOWED_PROGRAMS.contains(&program) {
        return Err(AppError::Other(format!(
            "{program} は実行を許可されていません"
        )));
    }
    let args = params::string_array_param(params, "args")?;
    if args.len() > MAX_ARGS {
        return Err(AppError::Other(format!(
            "引数は {MAX_ARGS} 件以内にしてください"
        )));
    }
    for arg in &args {
        if arg.chars().count() > MAX_ARG_CHARS {
            return Err(AppError::Other(format!(
                "引数が長すぎます (上限 {MAX_ARG_CHARS} 文字)"
            )));
        }
        if arg.contains('\0') {
            return Err(AppError::Other("引数に NUL 文字は使えません".into()));
        }
    }

    let timeout = Duration::from_millis(manifest.limits.timeout_ms.clamp(1_000, 600_000));
    let resolved = crate::rpc::find_executable(program)
        .ok_or_else(|| AppError::Other(format!("{program} が見つかりません")))?;
    let result = exec::run(
        root,
        &resolved.to_string_lossy(),
        &args,
        timeout,
        manifest.limits.max_output_chars,
    );

    let command_line = std::iter::once(program.to_string())
        .chain(args.iter().cloned())
        .collect::<Vec<_>>()
        .join(" ");
    if result.timed_out {
        return Ok(HandlerOutcome {
            stdout: result.output,
            detail: format!("{command_line} がタイムアウトしました"),
            failed: true,
            exit_code: None,
            ..HandlerOutcome::default()
        });
    }
    if !result.success {
        return Ok(HandlerOutcome {
            stdout: result.output,
            detail: format!(
                "{command_line} が失敗しました (exit {})",
                result
                    .exit_code
                    .map(|code| code.to_string())
                    .unwrap_or_else(|| "?".into())
            ),
            failed: true,
            exit_code: result.exit_code,
            ..HandlerOutcome::default()
        });
    }

    Ok(HandlerOutcome {
        stdout: result.output,
        detail: format!("{command_line} を実行しました ({} ms)", result.duration_ms),
        exit_code: result.exit_code,
        ..HandlerOutcome::default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn manifest() -> SkillManifest {
        crate::skills::parse_manifest(
            include_str!("../../tests/fixtures/skills/valid/code-edit.json"),
            "code-edit",
        )
        .expect("valid fixture")
    }

    #[test]
    fn rejects_programs_outside_the_allowlist() {
        let root = std::env::temp_dir();
        let error = run(
            &root,
            "terminal.run",
            &json!({ "program": "sh", "args": ["-c", "echo hi"] }),
            &manifest(),
        )
        .expect_err("sh is not allowed");
        assert!(error.to_string().contains("許可"));
    }

    #[test]
    fn limits_argument_count_and_length() {
        let root = std::env::temp_dir();
        let args = (0..33)
            .map(|index| format!("--arg{index}"))
            .collect::<Vec<_>>();
        let error = run(
            &root,
            "terminal.run",
            &json!({ "program": "npm", "args": args }),
            &manifest(),
        )
        .expect_err("too many args");
        assert!(error.to_string().contains("32"));

        let long = "a".repeat(MAX_ARG_CHARS + 1);
        let error = run(
            &root,
            "terminal.run",
            &json!({ "program": "npm", "args": [long] }),
            &manifest(),
        )
        .expect_err("arg too long");
        assert!(error.to_string().contains("長すぎ"));
    }
}
