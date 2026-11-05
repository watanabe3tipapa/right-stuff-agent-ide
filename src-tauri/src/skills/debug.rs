use std::path::Path;
use std::time::Duration;

use serde_json::{Value, json};
use tauri::AppHandle;

use crate::commands::dap as dap_commands;
use crate::error::{AppError, AppResult};
use crate::paths;
use crate::rpc;
use crate::skills::{HandlerOutcome, params};
use crate::state::AppState;

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

pub fn run(
    app: &AppHandle,
    state: &AppState,
    root: &Path,
    handler: &str,
    params: &Value,
) -> AppResult<HandlerOutcome> {
    match handler {
        "debug.start" => start(app, state, root, params),
        "debug.stop" => stop(state, params),
        "debug.continue" => request(state, params, "continue", thread_arguments(params)?),
        "debug.next" => request(state, params, "next", thread_arguments(params)?),
        "debug.stepIn" => request(state, params, "stepIn", thread_arguments(params)?),
        "debug.pause" => request(state, params, "pause", thread_arguments(params)?),
        "debug.setBreakpoint" => set_breakpoint(root, state, params),
        "debug.evaluate" => evaluate(state, params),
        other => Err(AppError::Other(format!(
            "未実装のデバッグハンドラです: {other}"
        ))),
    }
}

fn start(
    app: &AppHandle,
    state: &AppState,
    root: &Path,
    params: &Value,
) -> AppResult<HandlerOutcome> {
    let adapter = params::string_param(params, "adapter")?;
    let program = params::string_param(params, "program")?;
    let started = dap_commands::start_at(app, state, root, adapter, Some(program))?;
    let program_path = started.program.clone().unwrap_or_default();

    let handshake = handshake(state, &started.id, root, adapter, &program_path);
    if let Err(error) = handshake {
        if let Ok(mut sessions) = state.dap_sessions.lock()
            && let Some(mut session) = sessions.remove(&started.id)
        {
            rpc::kill(&mut session);
        }
        return Err(error);
    }

    Ok(HandlerOutcome {
        stdout: serde_json::to_string_pretty(&json!({
            "sessionId": started.id,
            "adapter": started.adapter,
            "program": program_path,
        }))
        .unwrap_or_default(),
        detail: format!(
            "デバッグセッションを開始しました: {} ({})",
            started.id, started.adapter
        ),
        ..HandlerOutcome::default()
    })
}

fn handshake(
    state: &AppState,
    session_id: &str,
    root: &Path,
    adapter: &str,
    program: &str,
) -> AppResult<()> {
    let sessions = state
        .dap_sessions
        .lock()
        .map_err(|_| AppError::Other("DAP 状態のロックに失敗しました".into()))?;
    let session = sessions
        .get(session_id)
        .ok_or_else(|| AppError::Other("デバッグセッションが見つかりません".into()))?;

    rpc::request(
        session,
        "initialize",
        json!({
            "clientID": "right-stuff-agent-ide",
            "clientName": "Right-Stuff Agent IDE",
            "adapterID": adapter,
            "locale": "ja-JP",
            "linesStartAt1": true,
            "columnsStartAt1": true,
            "pathFormat": "path",
            "supportsRunInTerminalRequest": false,
        }),
        HANDSHAKE_TIMEOUT,
    )?;

    // Register before launch so a fast adapter cannot emit `initialized`
    // before we start listening.
    let initialized = rpc::subscribe(session, "initialized")?;
    let mut launch = json!({
        "program": program,
        "cwd": root.to_string_lossy(),
        "stopOnEntry": false,
    });
    if adapter == "debugpy" {
        launch["console"] = json!("internalConsole");
    }
    rpc::send_request(session, "launch", launch)?;
    rpc::wait_event(initialized, "initialized", HANDSHAKE_TIMEOUT)?;
    rpc::request(session, "configurationDone", json!({}), HANDSHAKE_TIMEOUT)?;
    Ok(())
}

fn stop(state: &AppState, params: &Value) -> AppResult<HandlerOutcome> {
    let session_id = params::string_param(params, "sessionId")?;
    let mut sessions = state
        .dap_sessions
        .lock()
        .map_err(|_| AppError::Other("DAP 状態のロックに失敗しました".into()))?;
    let mut session = sessions
        .remove(session_id)
        .ok_or_else(|| AppError::Other("デバッグセッションが見つかりません".into()))?;
    rpc::kill(&mut session);
    Ok(HandlerOutcome {
        stdout: format!("{session_id} を停止しました"),
        detail: format!("デバッグセッション {session_id} を停止しました"),
        ..HandlerOutcome::default()
    })
}

fn thread_arguments(params: &Value) -> AppResult<Value> {
    let thread_id = params::i64_param(params, "threadId")?;
    Ok(json!({ "threadId": thread_id }))
}

fn request(
    state: &AppState,
    params: &Value,
    command: &str,
    arguments: Value,
) -> AppResult<HandlerOutcome> {
    let session_id = params::string_param(params, "sessionId")?;
    with_session(state, session_id, |session| {
        let response = rpc::request(session, command, arguments, REQUEST_TIMEOUT)?;
        Ok(HandlerOutcome {
            stdout: serde_json::to_string_pretty(&response).unwrap_or_default(),
            detail: format!("DAP {command} を送信しました ({session_id})"),
            ..HandlerOutcome::default()
        })
    })
}

fn set_breakpoint(root: &Path, state: &AppState, params: &Value) -> AppResult<HandlerOutcome> {
    let session_id = params::string_param(params, "sessionId")?;
    let path = params::string_param(params, "path")?;
    paths::validate_relative(path)?;
    let line = params::i64_param(params, "line")?;
    if line < 1 {
        return Err(AppError::Other("line は 1 以上である必要があります".into()));
    }
    let source = root.join(path).to_string_lossy().to_string();
    with_session(state, session_id, |session| {
        let response = rpc::request(
            session,
            "setBreakpoints",
            json!({
                "source": { "path": source },
                "breakpoints": [{ "line": line }],
            }),
            REQUEST_TIMEOUT,
        )?;
        Ok(HandlerOutcome {
            stdout: serde_json::to_string_pretty(&response).unwrap_or_default(),
            detail: format!("{path}:{line} にブレークポイントを設定しました"),
            ..HandlerOutcome::default()
        })
    })
}

fn evaluate(state: &AppState, params: &Value) -> AppResult<HandlerOutcome> {
    let session_id = params::string_param(params, "sessionId")?;
    let expression = params::string_param(params, "expression")?;
    let frame_id = params::optional_i64_param(params, "frameId")?;
    let context = params::string_param_or(params, "context", "repl")?;
    with_session(state, session_id, |session| {
        let mut arguments = json!({ "expression": expression, "context": context });
        if let Some(frame_id) = frame_id {
            arguments["frameId"] = json!(frame_id);
        }
        let response = rpc::request(session, "evaluate", arguments, REQUEST_TIMEOUT)?;
        let result = response
            .get("body")
            .and_then(|body| body.get("result"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        Ok(HandlerOutcome {
            stdout: result.clone(),
            detail: format!("式を評価しました: {}", truncate(expression)),
            ..HandlerOutcome::default()
        })
    })
}

fn with_session<T>(
    state: &AppState,
    session_id: &str,
    action: impl FnOnce(&rpc::RpcSession) -> AppResult<T>,
) -> AppResult<T> {
    let sessions = state
        .dap_sessions
        .lock()
        .map_err(|_| AppError::Other("DAP 状態のロックに失敗しました".into()))?;
    let session = sessions
        .get(session_id)
        .ok_or_else(|| AppError::Other("デバッグセッションが見つかりません".into()))?;
    action(session)
}

fn truncate(value: &str) -> String {
    crate::skills::exec::truncate_chars(value, 120)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_thread_ids() {
        let arguments = thread_arguments(&json!({ "threadId": 7 })).expect("thread id");
        assert_eq!(arguments["threadId"], 7);
        assert!(thread_arguments(&json!({ "threadId": "7" })).is_err());
    }

    #[test]
    fn truncates_long_expressions() {
        let value = "a".repeat(200);
        assert!(truncate(&value).ends_with('…'));
    }
}
