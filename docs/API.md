# API

Tauri コマンドは `invoke("<command>", { ...args })` で呼び出す。
エラーは文字列にシリアライズされ、UI のトーストに表示される。

## アプリ

| コマンド | 引数 | 戻り値 |
| --- | --- | --- |
| `app_info` | — | `{ name, version, tauriVersion, platform, arch }` |

## ワークスペース

| コマンド | 引数 | 戻り値 |
| --- | --- | --- |
| `workspace_open` | `{ path }` | `{ root, name }` |
| `workspace_last` | — | `{ root, name } \| null` |
| `workspace_list_files` | — | `FileEntry[]` |
| `workspace_read_file` | `{ path }` | `{ path, content, language, size, modified }` |
| `workspace_write_file` | `{ path, content }` | `{ path, versionId, savedAt, size }` |
| `workspace_create_entry` | `{ path, isDir }` | `path` |
| `workspace_rename_entry` | `{ from, to }` | `to` |
| `workspace_delete_entry` | `{ path }` | 退避先の相対パス |

`FileEntry`:

```ts
interface FileEntry {
  name: string;
  path: string;        // ワークスペースからの相対パス (forward slash)
  isDir: boolean;
  size: number;
  modified: number | null;
  children: FileEntry[];
}
```

- 一覧は `.git`, `node_modules`, `target`, `dist`, `.right-stuff` などを除外する。
- 最大 5,000 エントリ / 深さ 12 まで。
- 読み込みは 5MB まで。NUL バイトを含むファイルはバイナリとして拒否する。

## エディタ履歴

| コマンド | 引数 | 戻り値 |
| --- | --- | --- |
| `editor_history` | `{ path, limit? }` | `VersionSummary[]` |
| `editor_version` | `{ id }` | `{ id, path, content, createdAt }` |

保存ごとに 1 版を記録し、ファイルあたり最新 100 版を保持する。

## エージェント

| コマンド | 引数 | 戻り値 |
| --- | --- | --- |
| `agent_status` | — | `AgentStatus` |
| `agent_snapshot` | `{ app?: string }` | `AgentRunResult` |
| `agent_run` | `{ args: string[] }` | `AgentRunResult` |

```ts
interface AgentStatus {
  available: boolean;
  binary: string | null;
  version: string | null;
  platform: string;
  arch: string;
  message: string;
}

interface AgentRunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  command: string[];
}
```

### バイナリ検出

1. 環境変数 `AGENT_DESKTOP_BIN`
2. `PATH` 上の `agent-desktop`
3. `PATH` 上の `agent-desktop-cli`
4. `PATH` 上の `agent`

### 許可アクション

`agent_run` の先頭要素は次のいずれかでなければならない:

```
snapshot, click, type, set-value, press, scroll,
list-apps, list-windows, focus-window, launch, close-app,
clipboard-get, clipboard-set, list-notifications, dismiss-notification,
session, trace, --version, --help
```

引数は個数・長さ・形式を検証する。`launch` / `close-app` はアプリ名 1 つだけを許可し、パス区切り・`..`・先頭 `-` を拒否する。`type` / `set-value` / `clipboard-set` は内容を必須にする。

読み取り専用アクション（`snapshot`, `list-apps`, `list-windows`, `list-notifications`, `--version`, `--help`）以外は、実行前にネイティブ承認ダイアログを表示する。キャンセルされた場合はエラーを返し、CLI は起動しない。

出力は 200,000 文字で打ち切る。

## 設定

| コマンド | 引数 | 戻り値 |
| --- | --- | --- |
| `settings_get` | `{ key }` | `string \| null` |
| `settings_set` | `{ key, value }` | — |

現在は `last_workspace` と LLM 設定 (`llm_config`) を利用する。API キーは SQLite に保存せず、OS キーチェーンにのみ保存する。

## LLM

| コマンド | 引数 | 戻り値 |
| --- | --- | --- |
| `llm_config_get` | — | `LlmSettings` |
| `llm_config_set` | `{ config }` | `LlmSettings` |
| `llm_key_set` | `{ key }` | — |
| `llm_key_status` | — | `{ configured: boolean }` |
| `llm_key_delete` | — | — |
| `llm_test` | — | `LlmTestResult` |
| `llm_chat` | `{ messages, onEvent }` | —（`Channel` でイベント送信） |
| `llm_cancel` | — | — |

```ts
interface LlmConfig {
  provider: "openai" | "ollama" | "lmstudio" | "openrouter" | "custom";
  baseUrl: string;
  model: string;
  temperature: number; // 0.0 - 2.0
  maxTokens: number;   // 1 - 128000
}

interface LlmSettings extends LlmConfig {
  configured: boolean;
  keyConfigured: boolean;
}

interface LlmTestResult {
  ok: boolean;
  status: number | null;
  message: string;
  models: string[];
}
```

- 設定は SQLite の `settings` テーブルに `llm_config` として保存する。
- `configured` は設定が保存済みかつ検証済みであることを、`keyConfigured` は API キーの有無を示す。
- API キーは OS キーチェーンにのみ保存する。`llm_config_get` / `llm_key_status` は真偽値だけを返し、キー本文は WebView・SQLite・ログ・エラー文字列に含めない。
- `llm_key_set` は保存済みプロバイダーのキーを保存する。プロバイダーを変更する場合は、先に `llm_config_set` を呼ぶ。
- `baseUrl` は `https://` を必須とし、`http://` は `localhost` / `127.0.0.1` / `::1` のみ許可する。
- `llm_chat` は OpenAI 互換の `POST {baseUrl}/chat/completions` に `stream: true` で接続する。
- Channel で送信するイベント:

```ts
type LlmStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; finishReason: string | null }
  | { type: "cancelled" }
  | { type: "error"; message: string };
```

- `llm_cancel` は進行中のストリームへ協調的キャンセルを通知する。
- `llm_test` は `GET {baseUrl}/models` を呼び、HTTP ステータスとモデル一覧を返す。
- リクエストは 1 メッセージあたり 100,000 文字、合計 400,000 文字、最大 100 件に制限する。
- ストリーミング応答は 2,000,000 文字で打ち切る。プロバイダーが返したエラー本文に API キーが含まれる場合は `[REDACTED]` に置換する。
- 接続テストなどで読み取る HTTP レスポンス本文は 1 MiB で打ち切る。
