use std::io::Read;
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

/// Run a program with a timeout and a bounded output buffer. The command is
/// always passed as program + args (never through a shell), and it runs in its
/// own process group so a timeout also stops the children it spawned.
pub struct CommandOutput {
    pub success: bool,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub output: String,
    pub duration_ms: u64,
}

pub fn run(
    root: &Path,
    program: &str,
    args: &[String],
    timeout: Duration,
    max_output_chars: usize,
) -> CommandOutput {
    let started = Instant::now();
    let mut process = Command::new(program);
    process
        .args(args)
        .current_dir(root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("CI", "1")
        .env("NO_COLOR", "1")
        .env("FORCE_COLOR", "0");
    // process_group is unavailable on Windows, but this app is macOS-only.
    process.process_group(0);

    let mut child = match process.spawn() {
        Ok(child) => child,
        Err(error) => {
            return CommandOutput {
                success: false,
                exit_code: None,
                timed_out: false,
                output: truncate_chars(&format!("起動に失敗しました: {error}"), max_output_chars),
                duration_ms: started.elapsed().as_millis() as u64,
            };
        }
    };

    let out_handle = read_stream(child.stdout.take());
    let err_handle = read_stream(child.stderr.take());

    let deadline = Instant::now() + timeout;
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {
                if Instant::now() >= deadline {
                    timed_out = true;
                    kill_group(&child);
                    let _ = child.wait();
                    break None;
                }
                thread::sleep(Duration::from_millis(50));
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                let output = format!("待機中にエラーが発生しました: {error}");
                return CommandOutput {
                    success: false,
                    exit_code: None,
                    timed_out: false,
                    output: truncate_chars(&output, max_output_chars),
                    duration_ms: started.elapsed().as_millis() as u64,
                };
            }
        }
    };

    let stdout = out_handle
        .and_then(|handle| handle.join().ok())
        .unwrap_or_default();
    let stderr = err_handle
        .and_then(|handle| handle.join().ok())
        .unwrap_or_default();
    let output = truncate_chars(&combine_output(stdout, stderr), max_output_chars);

    if timed_out {
        return CommandOutput {
            success: false,
            exit_code: None,
            timed_out: true,
            output: truncate_chars(
                &format!(
                    "{output}\n… {} ms を超えたため停止しました",
                    timeout.as_millis()
                ),
                max_output_chars,
            ),
            duration_ms: started.elapsed().as_millis() as u64,
        };
    }

    let exit_code = status.and_then(|status| status.code());
    CommandOutput {
        success: exit_code == Some(0),
        exit_code,
        timed_out: false,
        output,
        duration_ms: started.elapsed().as_millis() as u64,
    }
}

fn read_stream(stream: Option<impl Read + Send + 'static>) -> Option<thread::JoinHandle<String>> {
    stream.map(|mut stream| {
        thread::spawn(move || {
            let mut buffer = String::new();
            let _ = stream.read_to_string(&mut buffer);
            buffer
        })
    })
}

fn kill_group(child: &Child) {
    let pid = child.id() as i32;
    // process_group(0) put the child in its own group, so the negative PID
    // targets every process that inherited the pipe.
    unsafe {
        libc::kill(-pid, libc::SIGKILL);
    }
}

fn combine_output(stdout: String, stderr: String) -> String {
    let mut output = stdout.trim_end().to_string();
    let stderr = stderr.trim_end();
    if !stderr.is_empty() {
        if !output.is_empty() {
            output.push('\n');
        }
        output.push_str("[stderr]\n");
        output.push_str(stderr);
    }
    output
}

pub fn truncate_chars(value: &str, limit: usize) -> String {
    let limit = limit.max(1);
    if value.chars().count() <= limit {
        value.to_string()
    } else {
        format!("{}…", value.chars().take(limit).collect::<String>())
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
            "right-stuff-exec-{tag}-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create workspace");
        root
    }

    #[test]
    fn captures_stdout_and_stderr() {
        let root = workspace("run");
        let result = run(
            &root,
            "sh",
            &["-c".into(), "echo hello; echo boom >&2".into()],
            Duration::from_secs(5),
            1_000,
        );
        assert!(result.success);
        assert_eq!(result.exit_code, Some(0));
        assert!(result.output.contains("hello"));
        assert!(result.output.contains("[stderr]"));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn reports_non_zero_exit_and_timeout() {
        let root = workspace("fail");
        let failed = run(
            &root,
            "sh",
            &["-c".into(), "exit 3".into()],
            Duration::from_secs(5),
            100,
        );
        assert!(!failed.success);
        assert_eq!(failed.exit_code, Some(3));

        let timed_out = run(
            &root,
            "sh",
            &["-c".into(), "sleep 5".into()],
            Duration::from_millis(150),
            100,
        );
        assert!(timed_out.timed_out);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn truncates_output() {
        assert_eq!(truncate_chars(&"a".repeat(20), 5), "aaaaa…");
    }
}
