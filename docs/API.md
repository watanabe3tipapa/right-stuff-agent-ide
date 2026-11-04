# API

Tauri コマンドは `invoke("<command>", { ...args })` で呼び出す。
エラーは文字列にシリアライズされ、UI のトーストに表示される。

## アプリ

| コマンド | 引数 | 戻り値 |
| --- | --- | --- |
| `app_info` | — | `{ name, version, tauriVersion, platform, arch }` |
| `app_quit` | — | —（確認済みの終了要求でプロセスを終了） |

`app_quit` は WebView 側で未保存変更の確認を終えた後にのみ呼ぶ。`⌘Q` と
アプリメニューの「終了」は Rust が `app://quit-requested` イベントを送り、
WebView が同じ確認フローを実行する。

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
| `agent_run` | `{ args: string[], audit?: AgentAuditMeta }` | `AgentRunResult` |

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

実行前の扱いはエージェントポリシーで決まる。既定では読み取り専用アクション（`snapshot`, `list-apps`, `list-windows`, `list-notifications`, `--version`, `--help`）を許可し、それ以外はネイティブ承認ダイアログを表示する。ポリシーが `ask` の場合は承認、`block` の場合は CLI を起動せずエラーを返す。変更アクションを `allow` にすることはできない。

`agent_run` の `audit` を指定すると、実行結果を計画の手順（`planId` / `stepId`）へ紐付けて監査ログに記録する。

出力は 200,000 文字で打ち切る。

## 計画立案

計画立案は専用の Tauri コマンドを持たない。フロントエンドが既存の `llm_chat`
へ計画用システムプロンプトと意図を送り、ストリーミング応答を `src/lib/plan.ts`
で解析・検証する。承認後の手順は `agent_run` にそのまま渡す。

```ts
interface AgentPlanStep {
  id: string;
  title: string;
  command: string[];      // 先頭要素は許可アクション
  action: string;
  risk: "read" | "write"; // 許可リストから決定 (モデルの自己申告は使わない)
  rationale?: string;
  status: "pending" | "approved" | "running" | "done" | "failed" | "skipped";
  output?: string;
  error?: string;
}

interface AgentPlan {
  id: string;
  goal: string;
  steps: AgentPlanStep[];
  createdAt: number;
  status: "draft" | "approved" | "running" | "completed" | "failed" | "cancelled";
}
```

- モデルには JSON オブジェクトだけを返すよう指示し、コードフェンスや前置きが
  付いた場合は JSON 部分を抽出する。
- 手順は最大 12。`command` は 1 個以上 12 個以下、1 引数 16,384 文字、
  合計 32,768 文字まで。NUL 文字は拒否する。
- 先頭要素は「許可アクション」のいずれかでなければならない。`launch` /
  `close-app` など `agent_run` と同じ引数規則を適用する。
- 読み取り専用アクション以外は `risk: "write"` とし、実行時に `agent_run` の
  ネイティブ承認ダイアログを通す。
- 計画は `draft` → `approved` → `running` → `completed` / `failed` と遷移する。
  `cancelled` は却下・中止を表す。計画本体は永続化しないが、作成・承認・却下・中止は監査ログに記録する。

## エージェントポリシーと監査ログ

| コマンド | 引数 | 戻り値 |
| --- | --- | --- |
| `agent_policy_get` | — | `AgentPolicy` |
| `agent_policy_set` | `{ policy }` | `AgentPolicy` |
| `audit_log_add` | `{ input: AuditInput }` | — |
| `audit_log_list` | `{ limit?, offset? }` | `AuditEntry[]` |

```ts
type AgentPolicyDecision = "allow" | "ask" | "block";

interface AgentPolicy {
  auditEnabled: boolean;
  auditRetentionDays: number;             // 1 - 365
  actions: Record<string, AgentPolicyDecision>;
}

interface AgentAuditMeta {
  planId?: string;
  stepId?: string;
  title?: string;
  mode?: "passive" | "assistive" | "autonomous";
}

type AuditKind =
  | "plan_created"
  | "plan_approved"
  | "plan_rejected"
  | "plan_cancelled"
  | "action_run"
  | "action_blocked"
  | "action_cancelled"
  | "policy_updated";

type AuditOutcome = "ok" | "error" | "blocked" | "cancelled";

interface AuditInput {
  kind: AuditKind;
  mode?: AgentMode | null;
  planId?: string | null;
  stepId?: string | null;
  title?: string | null;
  command?: string[] | null;
  outcome?: AuditOutcome | null;
  detail?: string | null;
}

interface AuditEntry extends Omit<AuditInput, "command"> {
  id: number;
  createdAt: number;              // Unix ミリ秒
  command: string[] | null;
}
```

- ポリシーは SQLite の `settings` テーブルに `agent_policy` として保存する。
- 既定値は読み取り専用アクションが `allow`、変更アクションが `ask`。未知のアクションや、変更アクションに対する `allow` は `agent_policy_set` が拒否する。
- `agent_run` / `agent_snapshot` は実行のたびに SQLite からポリシーを読み直す。`block` は CLI 起動前に拒否し、`ask` はネイティブ承認ダイアログを表示する。
- `auditEnabled` が `false` の間は新しい記録を追加しない。無効化しても既存の記録は削除しない。
- 記録時に `auditRetentionDays` を過ぎた行と、最新 5,000 件を超えた行を削除する。
- `audit_log_list` の `limit` は 1〜200（既定 50）、`offset` は 0 以上（既定 0）。新しい順に返す。
- 監査ログはローカルの SQLite にのみ保存し、外部へ送信しない。API キーは記録しない。
- 計画イベントはフロントエンドが `audit_log_add` で記録し、操作の実行・拒否・キャンセルは Rust 側の `agent_run` / `agent_snapshot` が記録する。

## Openship（ローカルファースト）

| コマンド | 引数 | 戻り値 |
| --- | --- | --- |
| `openship_config_get` | — | `OpenShipSettings` |
| `openship_config_set` | `{ config }` | `OpenShipSettings` |
| `openship_token_set` | `{ token }` | — |
| `openship_token_delete` | — | — |
| `openship_status` | — | `OpenShipStatus` |
| `openship_projects` | — | `OpenShipProject[]` |
| `openship_deployments` | `{ projectId?, limit? }` | `OpenShipDeployment[]` |
| `openship_deploy` | `{ projectId? }` | `OpenShipDeployResult` |
| `openship_logs` | `{ deploymentId }` | `OpenShipLogs` |
| `openship_rollback` | `{ deploymentId }` | `OpenShipDeployResult` |

```ts
interface OpenShipConfig {
  baseUrl: string;
  organizationId: string;
  projectId: string;
  branch: string;
  cliPath: string;
}

interface OpenShipSettings extends OpenShipConfig {
  tokenConfigured: boolean;
}

interface OpenShipStatus {
  cliAvailable: boolean;
  cliPath: string | null;
  cliVersion: string | null;
  serverConfigured: boolean;
  serverReachable: boolean;
  serverMessage: string;
  tokenConfigured: boolean;
  baseUrl: string;
}

interface OpenShipDeployResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  command: string[];
  deployment: OpenShipDeployment | null;
}
```

- 設定は SQLite の `settings` テーブルに `openship_config` として保存する。PAT は OS キーチェーン (`com.rightstuff.agentide.openship`) にのみ保存し、`tokenConfigured` の真偽値だけを返す。
- CLI は設定された `cliPath`、`PATH`、環境変数 `OPENSHIP_BIN` の順に検出し、`openship --version` で応答を確認する。
- `openship_deploy` は CLI があればワークスペースルートで `openship --json deploy` を実行する。CLI がない、または失敗した場合は `POST {baseUrl}/api/deployments` に `{ projectId, branch, environment: "production" }` を送る。
- REST の想定エンドポイント: `GET /api/health`、`GET /api/projects`、`GET /api/deployments`、`GET /api/deployments/{id}/logs`、`POST /api/deployments/{id}/rollback`。
- `baseUrl` は `https://` を必須とし、`http://` は `localhost` / `127.0.0.1` / `::1` のみ許可する。末尾のスラッシュは正規化する。
- `deploy` と `rollback` は変更操作として扱い、Passive モードでは拒否する。Assistive / Autonomous でもネイティブ承認ダイアログを必ず表示し、ポリシーで省略できない。実行結果は監査ログ (`action_run` / `action_blocked`) に記録する。
- プロジェクト ID・デプロイ ID・ブランチは英数字と `-` / `_` に制限し、シェル引数へ直接展開しない。

## Git

| コマンド | 引数 | 戻り値 |
| --- | --- | --- |
| `git_status` | — | `GitStatus` |
| `git_init` | — | `GitCommandResult` |
| `git_diff` | `{ path, staged }` | `GitDiff` |
| `git_stage` | `{ path }` | `GitCommandResult` |
| `git_unstage` | `{ path }` | `GitCommandResult` |
| `git_stage_all` | — | `GitCommandResult` |
| `git_unstage_all` | — | `GitCommandResult` |
| `git_commit` | `{ message }` | `GitCommandResult` |
| `git_log` | `{ limit? }` | `GitCommit[]` |

```ts
interface GitStatus {
  repo: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  staged: GitFile[];
  unstaged: GitFile[];
  untracked: GitFile[];
  clean: boolean;
  message: string | null;
}

interface GitFile { path: string; status: string; }
interface GitDiff { path: string; staged: boolean; diff: string; truncated: boolean; }
interface GitCommandResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  command: string[];
}
interface GitCommit { hash: string; author: string; date: string; subject: string; }
```

- すべての操作はワークスペースルートで `git` CLI を `std::process::Command` から直接実行する。シェル文字列は組み立てない。
- `git_status` は `git status --porcelain=v2 --branch --untracked-files=all` を解析する。リポジトリでない場合は `repo: false` とメッセージを返し、エラーにしない。
- `path` は `paths::validate_relative` で正規化し、絶対パスと `..` を拒否する。`git_stage` は `git add --`、`git_unstage` は `git restore --staged --` を使う。
- `git_diff` は `--no-color --unified=3` で取得し、未追跡ファイルは `git diff --no-index -- /dev/null <path>` にフォールバックする。出力は 200,000 文字で打ち切る。
- `git_commit` は空メッセージと 5,000 文字超を拒否する。`git_log` の `limit` は 1–50（既定 20）。
- コマンド出力は `stdout` / `stderr` をそれぞれ 200,000 文字で打ち切る。

## 統合ターミナル

| コマンド | 引数 | 戻り値 |
| --- | --- | --- |
| `terminal_start` | `{ cols, rows }` | `{ id, shell }` |
| `terminal_write` | `{ id, data }` | — |
| `terminal_resize` | `{ id, cols, rows }` | — |
| `terminal_kill` | `{ id }` | — |

- `portable-pty` で PTY を開き、ワークスペースルートを作業ディレクトリにしてシェルを起動する。シェルは `RIGHT_STUFF_SHELL` → `SHELL` → `/bin/zsh` の順で解決し、絶対パスかつ存在するファイルのみ許可する。
- `cols` は 1–400、`rows` は 1–200 にクランプする。`TERM=xterm-256color`、`COLORTERM=truecolor` を設定する。
- 出力は Tauri イベントで送る。バイト列のため `number[]` として渡し、フロントエンドで `Uint8Array` に戻す。

```ts
interface TerminalOutput { id: string; data: number[]; }
interface TerminalExit { id: string; }
```

- イベント名は `terminal://output` と `terminal://exit`。読み取りスレッドは PTY が閉じると終了イベントを送る。
- `terminal_kill` とアプリ終了時 (`app_quit`) は子プロセスを kill し、セッションを破棄する。

## 設定

| コマンド | 引数 | 戻り値 |
| --- | --- | --- |
| `settings_get` | `{ key }` | `string \| null` |
| `settings_set` | `{ key, value }` | — |

現在は `last_workspace`、LLM 設定 (`llm_config`)、エージェントポリシー (`agent_policy`)、Openship 設定 (`openship_config`) を利用する。API キーと Openship PAT は SQLite に保存せず、OS キーチェーンにのみ保存する。

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
