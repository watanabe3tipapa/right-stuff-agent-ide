use std::sync::Arc;

use axum::{
    Router,
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode, header::AUTHORIZATION},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};
use tokio::net::TcpListener;

use crate::commands::openship;
use crate::error::{AppError, AppResult};
use crate::opencode;
use crate::state::AppState;

const SERVER_NAME: &str = "right-stuff-agent-ide";
const PROTOCOL_VERSION: &str = "2025-06-18";

struct McpState {
    app: AppHandle,
    token: String,
}

pub async fn start(
    app: AppHandle,
    token: String,
) -> AppResult<(u16, tokio::sync::oneshot::Sender<()>)> {
    let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|error| {
        AppError::Other(format!("IDE MCP サーバーを起動できませんでした: {error}"))
    })?;
    let port = listener
        .local_addr()
        .map_err(|error| {
            AppError::Other(format!("IDE MCP のポートを取得できませんでした: {error}"))
        })?
        .port();

    let state = Arc::new(McpState { app, token });
    let router = Router::new()
        .route(
            "/mcp",
            post(handle).get(method_not_allowed).delete(handle_delete),
        )
        .route("/health", get(|| async { "ok" }))
        .with_state(state);

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();
    tauri::async_runtime::spawn(async move {
        let server = axum::serve(listener, router).with_graceful_shutdown(async {
            let _ = shutdown_rx.await;
        });
        if let Err(error) = server.await {
            eprintln!("IDE MCP server stopped: {error}");
        }
    });

    Ok((port, shutdown_tx))
}

async fn method_not_allowed() -> StatusCode {
    StatusCode::METHOD_NOT_ALLOWED
}

async fn handle_delete() -> StatusCode {
    StatusCode::OK
}

fn authorized(headers: &HeaderMap, token: &str) -> bool {
    let Some(value) = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
    else {
        return false;
    };
    let Some(candidate) = value.strip_prefix("Bearer ").map(str::trim) else {
        return false;
    };
    if candidate.len() != token.len() {
        return false;
    }
    candidate
        .as_bytes()
        .iter()
        .zip(token.as_bytes())
        .fold(0u8, |acc, (left, right)| acc | (left ^ right))
        == 0
}

async fn handle(State(state): State<Arc<McpState>>, headers: HeaderMap, body: Bytes) -> Response {
    if !authorized(&headers, &state.token) {
        return (
            StatusCode::UNAUTHORIZED,
            [("content-type", "application/json")],
            r#"{"jsonrpc":"2.0","error":{"code":-32001,"message":"unauthorized"}}"#,
        )
            .into_response();
    }

    let Ok(request) = serde_json::from_slice::<Value>(&body) else {
        return json_response(rpc_error(&Value::Null, -32700, "parse error"));
    };
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let method = request
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let params = request.get("params").cloned().unwrap_or(Value::Null);

    let response = match method {
        "initialize" => rpc_ok(&id, initialize_result(&params)),
        "notifications/initialized" | "notifications/cancelled" => {
            return StatusCode::ACCEPTED.into_response();
        }
        "ping" => rpc_ok(&id, json!({})),
        "tools/list" => rpc_ok(&id, json!({ "tools": tool_definitions() })),
        "tools/call" => match call_tool(&state.app, &params).await {
            Ok(value) => rpc_ok(&id, value),
            Err(message) => rpc_ok(&id, tool_error(message)),
        },
        _ if request.get("id").is_none() => return StatusCode::ACCEPTED.into_response(),
        _ => rpc_error(&id, -32601, "method not found"),
    };

    json_response(response)
}

fn json_response(value: Value) -> Response {
    (
        StatusCode::OK,
        [("content-type", "application/json; charset=utf-8")],
        value.to_string(),
    )
        .into_response()
}

fn rpc_ok(id: &Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn rpc_error(id: &Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn initialize_result(params: &Value) -> Value {
    let requested = params
        .get("protocolVersion")
        .and_then(Value::as_str)
        .unwrap_or(PROTOCOL_VERSION);
    json!({
        "protocolVersion": requested,
        "capabilities": { "tools": { "listChanged": false } },
        "serverInfo": { "name": SERVER_NAME, "version": env!("CARGO_PKG_VERSION") }
    })
}

fn tool_error(message: String) -> Value {
    json!({
        "content": [{ "type": "text", "text": message }],
        "isError": true
    })
}

fn tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "name": "openship_status",
            "description": "Openship CLI と REST API の接続状態を確認します。読み取り専用です。",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "openship_projects",
            "description": "Openship のプロジェクト一覧を取得します。読み取り専用です。",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "openship_deployments",
            "description": "Openship のデプロイ履歴を取得します。読み取り専用です。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "projectId": { "type": "string", "description": "絞り込むプロジェクト ID" },
                    "limit": { "type": "number", "description": "取得件数 (1-100)" }
                }
            }
        }),
        json!({
            "name": "openship_logs",
            "description": "指定したデプロイのログを取得します。読み取り専用です。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "deploymentId": { "type": "string", "description": "デプロイ ID" }
                },
                "required": ["deploymentId"]
            }
        }),
        json!({
            "name": "openship_deploy",
            "description": "Openship へデプロイします。IDE のネイティブ承認ダイアログが必ず表示されます。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "projectId": { "type": "string", "description": "デプロイするプロジェクト ID (省略時は設定値)" }
                }
            }
        }),
        json!({
            "name": "openship_rollback",
            "description": "指定したデプロイへロールバックします。IDE のネイティブ承認ダイアログが必ず表示されます。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "deploymentId": { "type": "string", "description": "ロールバック先のデプロイ ID" }
                },
                "required": ["deploymentId"]
            }
        }),
    ]
}

async fn call_tool(app: &AppHandle, params: &Value) -> Result<Value, String> {
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| "ツール名が指定されていません。".to_string())?;
    let args = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let state = app.state::<AppState>();

    if state.opencode.mode() == "passive" {
        return Err("Passive モードではツールを実行できません。".into());
    }
    opencode::record_tool_call(&state, name, &args);

    match name {
        "openship_status" => ok_json(openship::openship_status_impl(&state).await),
        "openship_projects" => ok_json(openship::openship_projects_impl(&state).await),
        "openship_deployments" => {
            let project_id = args
                .get("projectId")
                .and_then(Value::as_str)
                .map(str::to_string);
            let limit = args.get("limit").and_then(Value::as_i64);
            ok_json(openship::openship_deployments_impl(project_id, limit, &state).await)
        }
        "openship_logs" => {
            let deployment_id = args
                .get("deploymentId")
                .and_then(Value::as_str)
                .ok_or_else(|| "deploymentId が必要です。".to_string())?
                .to_string();
            ok_json(openship::openship_logs_impl(deployment_id, &state).await)
        }
        "openship_deploy" => {
            let project_id = args
                .get("projectId")
                .and_then(Value::as_str)
                .map(str::to_string);
            ok_json(openship::openship_deploy_impl(app, project_id, &state).await)
        }
        "openship_rollback" => {
            let deployment_id = args
                .get("deploymentId")
                .and_then(Value::as_str)
                .ok_or_else(|| "deploymentId が必要です。".to_string())?
                .to_string();
            ok_json(openship::openship_rollback_impl(app, deployment_id, &state).await)
        }
        _ => Err(format!("未対応のツールです: {name}")),
    }
}

fn ok_json<T: serde::Serialize>(result: crate::error::AppResult<T>) -> Result<Value, String> {
    match result {
        Ok(value) => {
            let text = serde_json::to_string(&value).map_err(|error| error.to_string())?;
            Ok(json!({
                "content": [{ "type": "text", "text": text }],
                "isError": false
            }))
        }
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn tool_success_is_wrapped_in_content() {
        let result = ok_json(Ok(json!({ "status": "ok" }))).expect("result");
        assert_eq!(result["isError"], false);
        assert_eq!(result["content"][0]["type"], "text");
        assert_eq!(result["content"][0]["text"], r#"{"status":"ok"}"#);
    }

    #[test]
    fn accepts_only_the_session_bearer() {
        let mut headers = HeaderMap::new();
        headers.insert(AUTHORIZATION, HeaderValue::from_static("Bearer abc123"));
        assert!(authorized(&headers, "abc123"));
        assert!(!authorized(&headers, "abc124"));
        assert!(!authorized(&headers, "abc12"));
    }

    #[test]
    fn rejects_missing_or_malformed_authorization() {
        let mut headers = HeaderMap::new();
        assert!(!authorized(&headers, "abc123"));
        headers.insert(AUTHORIZATION, HeaderValue::from_static("abc123"));
        assert!(!authorized(&headers, "abc123"));
        headers.insert(AUTHORIZATION, HeaderValue::from_static("bearer abc123"));
        assert!(!authorized(&headers, "abc123"));
    }
}
