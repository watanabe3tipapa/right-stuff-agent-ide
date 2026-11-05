use std::collections::BTreeSet;
use std::fs;
use std::path::Path;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::skills::exec;
use crate::skills::{VerificationCheck, VerificationMode};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CheckStatus {
    Passed,
    Failed,
    Skipped,
    Timeout,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationCheckResult {
    pub name: VerificationCheck,
    pub ecosystem: String,
    pub status: CheckStatus,
    pub command: Vec<String>,
    pub exit_code: Option<i32>,
    pub output: String,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationResult {
    pub status: CheckStatus,
    pub checks: Vec<VerificationCheckResult>,
}

#[derive(Debug, Clone)]
pub struct PlannedCheck {
    pub name: VerificationCheck,
    pub ecosystem: &'static str,
    pub program: String,
    pub args: Vec<String>,
    pub skip_reason: Option<String>,
}

impl PlannedCheck {
    pub fn command(&self) -> Vec<String> {
        if self.skip_reason.is_some() {
            Vec::new()
        } else {
            std::iter::once(self.program.clone())
                .chain(self.args.iter().cloned())
                .collect()
        }
    }

    fn skipped(&self, reason: &str) -> VerificationCheckResult {
        VerificationCheckResult {
            name: self.name,
            ecosystem: self.ecosystem.to_string(),
            status: CheckStatus::Skipped,
            command: self.command(),
            exit_code: None,
            output: reason.to_string(),
            duration_ms: 0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PackageManager {
    Npm,
    Pnpm,
    Yarn,
}

impl PackageManager {
    fn program(self) -> &'static str {
        match self {
            PackageManager::Npm => "npm",
            PackageManager::Pnpm => "pnpm",
            PackageManager::Yarn => "yarn",
        }
    }

    fn detect(root: &Path) -> Self {
        if root.join("pnpm-lock.yaml").is_file() {
            PackageManager::Pnpm
        } else if root.join("yarn.lock").is_file() {
            PackageManager::Yarn
        } else {
            PackageManager::Npm
        }
    }
}

/// Build the commands from the workspace layout. The manifest only chooses
/// which checks run; the command strings never come from the manifest.
pub fn plan_checks(
    root: &Path,
    checks: &[VerificationCheck],
    mode: VerificationMode,
) -> AppResult<Vec<PlannedCheck>> {
    if mode != VerificationMode::Auto {
        return Ok(Vec::new());
    }

    let node = node_scripts(root)?;
    let rust = root.join("Cargo.toml").is_file();
    let mut planned = Vec::new();

    for check in checks {
        let mut added = false;
        if let Some((manager, scripts)) = &node {
            let script = script_name(*check);
            if scripts.contains(script) {
                planned.push(PlannedCheck {
                    name: *check,
                    ecosystem: "node",
                    program: manager.program().to_string(),
                    args: vec!["run".to_string(), script.to_string()],
                    skip_reason: None,
                });
            } else {
                planned.push(PlannedCheck {
                    name: *check,
                    ecosystem: "node",
                    program: manager.program().to_string(),
                    args: vec!["run".to_string(), script.to_string()],
                    skip_reason: Some(format!("package.json に {script} script がありません")),
                });
            }
            added = true;
        }

        if rust {
            let args = match check {
                VerificationCheck::Typecheck => vec!["check".to_string()],
                VerificationCheck::Lint => {
                    vec![
                        "clippy".to_string(),
                        "--".to_string(),
                        "-D".to_string(),
                        "warnings".to_string(),
                    ]
                }
                VerificationCheck::Test => vec!["test".to_string()],
            };
            planned.push(PlannedCheck {
                name: *check,
                ecosystem: "rust",
                program: "cargo".to_string(),
                args,
                skip_reason: None,
            });
            added = true;
        }

        if !added {
            planned.push(PlannedCheck {
                name: *check,
                ecosystem: "workspace",
                program: String::new(),
                args: Vec::new(),
                skip_reason: Some("package.json も Cargo.toml も見つかりません".to_string()),
            });
        }
    }

    Ok(planned)
}

fn script_name(check: VerificationCheck) -> &'static str {
    match check {
        VerificationCheck::Typecheck => "typecheck",
        VerificationCheck::Lint => "lint",
        VerificationCheck::Test => "test",
    }
}

fn node_scripts(root: &Path) -> AppResult<Option<(PackageManager, BTreeSet<String>)>> {
    let path = root.join("package.json");
    if !path.is_file() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path)
        .map_err(|error| AppError::Other(format!("package.json を読めません: {error}")))?;
    let json: Value = serde_json::from_str(&text)
        .map_err(|error| AppError::Other(format!("package.json が壊れています: {error}")))?;
    let scripts = json
        .get("scripts")
        .and_then(Value::as_object)
        .map(|map| map.keys().cloned().collect())
        .unwrap_or_default();
    Ok(Some((PackageManager::detect(root), scripts)))
}

/// Execute the planned checks. Failures are returned in the result instead of
/// bubbling up, so the caller can report every check consistently.
pub fn run_planned(
    root: &Path,
    planned: Vec<PlannedCheck>,
    timeout: Duration,
    stop_on_failure: bool,
    max_output_chars: usize,
) -> VerificationResult {
    let mut results = Vec::new();
    let mut stopped = false;

    for check in planned {
        if stopped {
            results.push(check.skipped("stopOnFailure により後続の検証をスキップしました"));
            continue;
        }
        if let Some(reason) = &check.skip_reason {
            results.push(check.skipped(reason));
            continue;
        }
        let result = run_one(root, &check, timeout, max_output_chars);
        let failed = matches!(result.status, CheckStatus::Failed | CheckStatus::Timeout);
        results.push(result);
        if failed && stop_on_failure {
            stopped = true;
        }
    }

    VerificationResult {
        status: aggregate(&results),
        checks: results,
    }
}

fn run_one(
    root: &Path,
    check: &PlannedCheck,
    timeout: Duration,
    max_output_chars: usize,
) -> VerificationCheckResult {
    let output = exec::run(root, &check.program, &check.args, timeout, max_output_chars);
    let status = if output.timed_out {
        CheckStatus::Timeout
    } else if output.success {
        CheckStatus::Passed
    } else {
        CheckStatus::Failed
    };
    VerificationCheckResult {
        name: check.name,
        ecosystem: check.ecosystem.to_string(),
        status,
        command: check.command(),
        exit_code: output.exit_code,
        output: output.output,
        duration_ms: output.duration_ms,
    }
}

fn aggregate(checks: &[VerificationCheckResult]) -> CheckStatus {
    if checks
        .iter()
        .any(|check| check.status == CheckStatus::Timeout)
    {
        CheckStatus::Timeout
    } else if checks
        .iter()
        .any(|check| check.status == CheckStatus::Failed)
    {
        CheckStatus::Failed
    } else if checks
        .iter()
        .any(|check| check.status == CheckStatus::Passed)
    {
        CheckStatus::Passed
    } else {
        CheckStatus::Skipped
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    fn workspace(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock before epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "right-stuff-verify-{tag}-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create workspace");
        root
    }

    #[test]
    fn plans_node_scripts_from_package_json() {
        let root = workspace("node");
        fs::write(
            root.join("package.json"),
            r#"{"scripts":{"typecheck":"tsc --noEmit","lint":"eslint src"}}"#,
        )
        .expect("write package");
        let planned = plan_checks(
            &root,
            &[VerificationCheck::Typecheck, VerificationCheck::Test],
            VerificationMode::Auto,
        )
        .expect("plan");
        assert_eq!(planned.len(), 2);
        assert_eq!(planned[0].program, "npm");
        assert_eq!(planned[0].args, vec!["run", "typecheck"]);
        assert!(planned[0].skip_reason.is_none());
        assert!(planned[1].skip_reason.is_some());
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn detects_pnpm_and_yarn_from_lockfiles() {
        let root = workspace("pnpm");
        fs::write(
            root.join("package.json"),
            r#"{"scripts":{"test":"vitest"}}"#,
        )
        .expect("package");
        fs::write(root.join("pnpm-lock.yaml"), "").expect("lock");
        let planned =
            plan_checks(&root, &[VerificationCheck::Test], VerificationMode::Auto).expect("plan");
        assert_eq!(planned[0].program, "pnpm");
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn plans_cargo_checks() {
        let root = workspace("rust");
        fs::write(root.join("Cargo.toml"), "[package]\nname = \"demo\"").expect("cargo");
        let planned = plan_checks(
            &root,
            &[VerificationCheck::Lint, VerificationCheck::Test],
            VerificationMode::Auto,
        )
        .expect("plan");
        assert_eq!(planned[0].program, "cargo");
        assert_eq!(planned[0].args, vec!["clippy", "--", "-D", "warnings"]);
        assert_eq!(planned[1].args, vec!["test"]);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn skips_when_no_project_is_present() {
        let root = workspace("empty");
        let planned = plan_checks(
            &root,
            &[VerificationCheck::Typecheck],
            VerificationMode::Auto,
        )
        .expect("plan");
        assert_eq!(planned.len(), 1);
        assert!(planned[0].skip_reason.is_some());
        let result = run_planned(&root, planned, Duration::from_secs(1), true, 100);
        assert_eq!(result.status, CheckStatus::Skipped);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn stops_after_failure_and_truncates_output() {
        let value = "a".repeat(20);
        assert_eq!(crate::skills::exec::truncate_chars(&value, 5), "aaaaa…");
        let checks = vec![VerificationCheckResult {
            name: VerificationCheck::Typecheck,
            ecosystem: "node".into(),
            status: CheckStatus::Failed,
            command: vec!["npm".into()],
            exit_code: Some(1),
            output: String::new(),
            duration_ms: 1,
        }];
        assert_eq!(aggregate(&checks), CheckStatus::Failed);
    }

    #[test]
    fn runs_a_real_command_and_captures_output() {
        let root = workspace("run");
        let planned = vec![PlannedCheck {
            name: VerificationCheck::Typecheck,
            ecosystem: "test",
            program: "sh".into(),
            args: vec!["-c".into(), "echo hello; echo boom >&2".into()],
            skip_reason: None,
        }];
        let result = run_planned(&root, planned, Duration::from_secs(5), true, 1_000);
        assert_eq!(result.status, CheckStatus::Passed);
        assert!(result.checks[0].output.contains("hello"));
        assert!(result.checks[0].output.contains("[stderr]"));
        fs::remove_dir_all(root).ok();
    }
}
