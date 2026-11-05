# スキル実行と検証ループの設計

v0.4.0 の実装前に、スキーマ・実行ポリシー・承認・検証・監査の設計を確定する。実装状況は「未実装」であり、本書は実装の契約として使う。

- 機械可読スキーマ: [`skills.schema.json`](./skills.schema.json)
- 関連: [ARCHITECTURE.md](./ARCHITECTURE.md) / [SECURITY.md](./SECURITY.md) / [API.md](./API.md)

## 1. 目的

現状の計画実行は、Agent Desktop の許可アクション（`snapshot`、`click`、`launch` など）に限定されている。v0.4.0 では、次の 3 つを追加する。

1. **スキルマニフェスト**: エディタ・Git・ターミナル・デバッガの操作を宣言する。
2. **実行ポリシー**: スキル単位・アクション単位で `allow` / `ask` / `block` を決める。
3. **検証ループ**: 変更後に型検査・Lint・テストを実行し、結果を UI と監査ログに残す。

v0.4.0 の最小垂直スライスは `code-edit` とする。LLM の計画に「ファイルを読む → 文字列を置換する → 検証する」を通し、承認・監査・失敗時の停止までを完成させる。

## 2. 非目標

- サードパーティ製スキルの配布・マーケットプレイス
- スキルからのネットワークアクセス
- 検証失敗時に LLM が自動で修正を繰り返すループ（v0.5 以降）
- 統合ターミナルへの直接入力（PTY）をスキルから操作すること
- デバッガ（DAP）連携
- Windows / Linux 対応、署名・公証

## 3. 現状の整理

| 領域 | 現状 | v0.4.0 で追加するもの |
|---|---|---|
| スキル定義 | `.agents/skills/*.json` は v0 形式の宣言のみ。実行時には読まれない | v1 マニフェスト、ローダー、バリデータ |
| 計画 | `src/lib/plan.ts` が Agent Desktop の許可アクションだけを検証 | `kind: "skill"` の手順とパラメータ検証 |
| 実行 | `agent_run` が許可リスト・引数検証・ネイティブ承認を行う | `skill_run`、プレビュー、承認、キャンセル |
| ポリシー | `AgentPolicy` が Agent Desktop のアクション単位で保持 | `SkillPolicy`（スキル / アクション / 検証） |
| 監査 | `audit_log` に `action_run` などを記録 | `skill_run` 系の種別と `skill_id` / `action_id` |
| 検証 | 未実装 | 変更後の typecheck / lint / test 実行 |

## 4. 設計原則

1. **マニフェストは宣言、実行は Rust の閉じたハンドラ**。マニフェストから任意のコードやシェルを実行させない。
2. **シェルを介さない**。コマンドは `program` + `args` の配列で渡し、パイプ・リダイレクト・`sh -c` を禁止する。
3. **既定拒否**。未知のスキル、未知のアクション、未知のプログラムは実行しない。
4. **書き込みは承認必須、破壊的操作は常に承認**。`allow` は読み取り専用アクションだけに許可する。
5. **パスはワークスペース内**。絶対パス、`..`、シンボリックリンク経由の脱出を拒否する。
6. **すべて監査**。実行・拒否・キャンセル・検証をローカル SQLite に記録する。
7. **検証は独立した工程**。タイムアウト・出力上限・終了コードを管理し、スキルの書き込み権限と混ぜない。
8. **モデルに秘密を渡さない**。環境変数は許可リストだけを渡し、API キーやトークンを含めない。検証出力も既定では LLM に送らない。

## 5. マニフェスト v1

### 5.1 フィールド

マニフェストは `<workspace>/.agents/skills/<id>.json` に置く。ワークスペース外のマニフェストは読み込まない。

| フィールド | 必須 | 内容 |
|---|---|---|
| `schemaVersion` | はい | `1` 固定 |
| `id` | はい | kebab-case。ファイル名と一致させる（例: `code-edit`） |
| `name` | はい | UI 表示名 |
| `description` | はい | 何をするスキルか（500 文字以内） |
| `version` | はい | SemVer（例: `0.1.0`） |
| `category` | はい | `editor` / `git` / `terminal` / `debug` |
| `risk` | いいえ | スキル全体の最大リスク。省略時はアクションから導出 |
| `actions` | はい | 1〜32 個のアクション |
| `permissions` | いいえ | パス・コマンド・環境変数の許可範囲 |
| `approval` | いいえ | 既定の承認方針とアクション単位の上書き |
| `verification` | いいえ | 検証の実行方法 |
| `limits` | いいえ | ファイル数・バイト数・タイムアウト・出力上限 |

### 5.2 アクション

| フィールド | 必須 | 内容 |
|---|---|---|
| `id` | はい | `category.action` 形式（例: `editor.replaceText`）。全スキルで一意 |
| `handler` | はい | Rust 側の実装名。許可されたハンドラ以外は拒否 |
| `description` | はい | 承認ダイアログに表示する説明 |
| `risk` | はい | `read` / `write` / `destructive` |
| `params` | いいえ | パラメータ定義（型・必須・最大長・列挙・正規表現） |
| `timeoutMs` | いいえ | 1,000〜600,000 ms |
| `maxOutputChars` | いいえ | 1,000〜200,000 文字 |

パラメータは JSON Schema 全体ではなく、次の小さな型システムで表現する。実装と UI 表示を単純に保つため。

```json
{
  "path": {
    "type": "string",
    "description": "ワークスペースからの相対パス",
    "required": true,
    "maxLength": 1024
  },
  "oldText": {
    "type": "string",
    "description": "置換前の文字列。ファイル内で 1 回だけ一致すること",
    "required": true,
    "maxLength": 100000
  },
  "newText": {
    "type": "string",
    "description": "置換後の文字列",
    "required": true,
    "maxLength": 100000
  }
}
```

### 5.3 `code-edit` の例

```json
{
  "schemaVersion": 1,
  "id": "code-edit",
  "name": "Code Edit",
  "description": "ワークスペース内のファイルを読み取り、文字列を置換して保存する",
  "version": "0.1.0",
  "category": "editor",
  "risk": "write",
  "actions": [
    {
      "id": "editor.readFile",
      "handler": "editor.readFile",
      "description": "ファイルを読み取る",
      "risk": "read",
      "params": {
        "path": {
          "type": "string",
          "description": "ワークスペースからの相対パス",
          "required": true,
          "maxLength": 1024
        }
      },
      "timeoutMs": 5000
    },
    {
      "id": "editor.replaceText",
      "handler": "editor.replaceText",
      "description": "一意に一致する文字列を置換する",
      "risk": "write",
      "params": {
        "path": {
          "type": "string",
          "description": "ワークスペースからの相対パス",
          "required": true,
          "maxLength": 1024
        },
        "oldText": {
          "type": "string",
          "description": "置換前の文字列。ファイル内で 1 回だけ一致すること",
          "required": true,
          "maxLength": 100000
        },
        "newText": {
          "type": "string",
          "description": "置換後の文字列",
          "required": true,
          "maxLength": 100000
        }
      },
      "timeoutMs": 30000
    },
    {
      "id": "editor.createFile",
      "handler": "editor.createFile",
      "description": "存在しないファイルを作成する",
      "risk": "write",
      "params": {
        "path": {
          "type": "string",
          "description": "ワークスペースからの相対パス",
          "required": true,
          "maxLength": 1024
        },
        "content": {
          "type": "string",
          "description": "初期内容",
          "required": false,
          "maxLength": 100000
        }
      },
      "timeoutMs": 30000
    }
  ],
  "permissions": {
    "paths": {
      "read": ["**/*"],
      "write": ["**/*"]
    }
  },
  "approval": {
    "default": "ask",
    "overrides": {
      "editor.readFile": "allow"
    }
  },
  "verification": {
    "mode": "auto",
    "checks": ["typecheck", "lint", "test"],
    "timeoutMs": 300000,
    "stopOnFailure": true
  },
  "limits": {
    "maxFiles": 20,
    "maxBytes": 1048576
  }
}
```

### 5.4 バリデーション規則

Rust のローダーは JSON Schema に加えて次を検査する。

- `id` とファイル名（拡張子を除く）が一致する
- アクション `id` がスキル内で重複しない
- `handler` が実装済みハンドラの閉じた集合に含まれる
- `risk` がアクションの最大リスクと一致する（省略時は最大リスクを採用）
- `approval.overrides` のキーが実在するアクションを指す
- `allow` は `read` アクションにだけ許可する
- パラメータ名が `^[a-z][a-zA-Z0-9]*$` に一致し、スキル内で重複しない
- `permissions.paths` の glob が空でない
- `commands[].program` にパス区切り・シェルメタ文字を含めない
- `limits` と `timeoutMs` が範囲内
- マニフェスト全体のサイズが 256 KB 以下

不正なマニフェストは起動時に一覧へ出さず、警告として UI に表示する。1 つの壊れたマニフェストで他のスキルを巻き込まない。

### 5.5 v0 からの移行

現在の `.agents/skills/*.json` は v0 の参考定義として残し、実行時には読み込まない。v0.4.0 の実装時に次の対応で v1 へ移行する。

| v0 | v1 |
|---|---|
| `name` | `id` と `name` に分離 |
| `actions: string[]` | `actions: { id, handler, description, risk, params }[]` |
| `verification: "snapshot_after_action"` | `verification.mode: "auto"` または `"none"` |
| `approval.required` / `blocked` | `approval.overrides` とポリシーへ移行 |
| なし | `schemaVersion`、`version`、`category`、`limits` |

## 6. 実行ポリシー

### 6.1 決定値

| 値 | 意味 |
|---|---|
| `allow` | 承認なしで実行する。読み取り専用アクションのみ |
| `ask` | プレビューを表示し、ネイティブ承認ダイアログで確認する |
| `block` | 実行せず、監査ログに `skill_blocked` を記録する |

### 6.2 優先順位

1. ポリシーのアクション上書き（`actions["editor.replaceText"]`）
2. ポリシーのスキル決定（`skills["code-edit"]`）
3. マニフェストの `approval.default`
4. グローバル既定（`read` は `allow`、`write` / `destructive` は `ask`、`terminal` は `block`）

`block` は常に最優先する。`write` と `destructive` は `allow` に正規化しない（保存時に `ask` へ丸める）。`destructive` はポリシーで `allow` を選べない。

### 6.3 ポリシー例

```json
{
  "version": 1,
  "skills": {
    "code-edit": "ask",
    "git-operation": "ask",
    "terminal-command": "block"
  },
  "actions": {
    "editor.readFile": "allow",
    "editor.replaceText": "ask"
  },
  "verification": {
    "autoRun": false,
    "allowChecks": ["typecheck", "lint"]
  },
  "limits": {
    "timeoutMs": 300000,
    "maxOutputChars": 50000,
    "maxFiles": 20,
    "maxBytes": 1048576
  }
}
```

保存先は既存の `settings` テーブル（キー `skill_policy`）。`AgentPolicy` と同様に、読み込み時に正規化し、不正値は既定へフォールバックする。`version` は将来のマイグレーション用。

### 6.4 パスの規則

マニフェストの glob に加えて、次の拒否リストを常に適用する。

- ワークスペース外（`paths::resolve_existing` / `resolve_new` で検証）
- シンボリックリンクの実体がワークスペース外
- `.git/**`、`.right-stuff/**`、`node_modules/**`、`target/**`、`dist/**`、`build/**`
- `.env*`、`**/*.pem`、`**/*.key`、`**/id_rsa*`、`**/.ssh/**`
- `maxBytes` を超えるファイル
- ディレクトリそのものへの書き込み

書き込みは一時ファイル + `rename`（既存の `atomic_write` を共通化）で行い、適用前に現在の内容を `db::record_version` へ記録する。

### 6.5 コマンドの規則

- `program` は許可リストの完全一致。`/`、`\`、`..` を含むものは拒否
- 引数は配列で渡し、シェルを介さない
- NUL 文字、改行を含む引数は拒否
- `sudo`、`sh`、`bash`、`zsh`、`python -c` など、任意コード実行につながるプログラムは許可しない
- 作業ディレクトリはワークスペースルート固定
- 環境変数は `PATH`、`HOME`、`SHELL`、`TERM`、`LANG` など最小限のみ
- タイムアウト時にプロセスグループごと終了する
- 出力は `maxOutputChars` で打ち切り、打ち切ったことを結果に明示する

## 7. 実行フロー

```
計画の手順（skill）
  → マニフェスト検索
  → パラメータ検証
  → ポリシー解決（block / ask / allow）
  → [ask] プレビュー生成 → ネイティブ承認ダイアログ
  → 事前検証（パス正規化、コマンド許可、dirty buffer 確認）
  → ハンドラ実行
  → 結果 + 監査ログ
  → [verification] 検証実行 → 結果表示
  → 次の手順へ（失敗時は停止）
```

### 7.1 プレビューと承認

`skill_preview` は書き込みを行わず、次を返す。

- スキル名、アクション名、リスク
- 対象パス（相対）
- 変更前後の差分（追加・削除行数と先頭 200 行）
- 実行するコマンド（`program` と `args`）、作業ディレクトリ、タイムアウト
- 警告（dirty buffer、拒否リスト該当、大きいファイルなど）

承認は既存の `agent_run` と同じネイティブダイアログで行う。ダイアログの文言は Rust が生成し、WebView の表示だけに依存しない。`write` / `destructive` は「この手順のみ許可」とし、永続的な `allow` にはしない。

### 7.2 キャンセルとタイムアウト

- 実行ごとに `runId` を発行する
- `skill_cancel(runId)` で子プロセスを終了する
- タイムアウトはアクション単位で適用し、プロセスグループを終了する
- 計画のキャンセルは実行中の `runId` も停止する

### 7.3 同時実行

- 書き込み・破壊的操作はワークスペース単位で直列化する
- 読み取りは直列化しなくてよいが、v1 では実装を単純にするため全スキルを直列実行する
- 同じファイルに対する並行書き込みは、直列化と `atomic_write` で防ぐ

## 8. v1 ハンドラ

| スキル | ハンドラ | リスク | 内容 |
|---|---|---|---|
| `code-edit` | `editor.readFile` | read | 相対パスのファイルを読む |
| `code-edit` | `editor.replaceText` | write | 一意に一致する文字列を置換し、保存する |
| `code-edit` | `editor.createFile` | write | 存在しないファイルを作成する |
| `git-operation` | `git.status` / `git.diff` / `git.branches` | read | 既存の Git コマンドを再利用 |
| `git-operation` | `git.stage` / `git.commit` | write | v0.4.x で追加 |
| `terminal-command` | `terminal.run` | destructive | v0.5 以降。許可プログラムのみ |
| `debug-control` | `debug.*` | — | DAP 実装後 |

`editor.replaceText` は unified diff を解析せず、`oldText` がファイル内で 1 回だけ一致することを必須にする。0 回または 2 回以上なら失敗し、モデルに再試行を促す。これによりパーサの複雑さと部分適用の危険を避ける。

エディタで未保存の変更があるファイルは、UI 側の事前チェックで拒否する。ユーザーに保存または破棄を求めてから再実行する。Rust 側だけでは未保存バッファを検知できないため、この確認はフロントエンドの責務とする。

## 9. 検証ループ

### 9.1 実行方法

`verification.mode: "auto"` のとき、ワークスペースの構成から検証コマンドを決める。マニフェストから任意のコマンド文字列は受け取らない。

| 構成 | typecheck | lint | test |
|---|---|---|---|
| Node + `package-lock.json` | `npm run typecheck`（script がある場合） | `npm run lint` | `npm run test` |
| Node + `pnpm-lock.yaml` | `pnpm run typecheck` | `pnpm run lint` | `pnpm run test` |
| Node + `yarn.lock` | `yarn run typecheck` | `yarn run lint` | `yarn run test` |
| Rust (`Cargo.toml`) | `cargo check` | `cargo clippy -- -D warnings` | `cargo test` |

- `package.json` に script がない check は `skipped` とする
- Node と Rust が同居する場合は両方を実行し、`stopOnFailure` に従う
- `npm install` などのネットワーク操作は実行しない
- 出力は 50,000 文字で打ち切り、UI には先頭と末尾を表示する

### 9.2 承認

- `typecheck` と `lint` は初回のみ承認を求め、ユーザーが「このセッションでは自動実行」を選べば以降は省略できる
- `test` はプロジェクトのコードを実行するため、毎回承認する
- `autoRun` を有効にしたワークスペースでも `test` は承認を省略しない

### 9.3 結果と停止

- 各 check は `passed` / `failed` / `skipped` / `timeout` を返す
- 失敗した check がある場合、その手順を `failed` にし、既定では計画を停止する
- v0.4.0 では自動修正しない。UI に「失敗した検証」と出力を表示し、ユーザーが次の計画を立てる
- 検証出力は既定では LLM に送らない。送る場合はユーザーが明示的に選ぶ

## 10. 計画スキーマの拡張

`AgentPlanStep` を判別可能な union にする。

```ts
export type AgentPlanStep =
  | {
      kind: "agent";
      id: string;
      title: string;
      command: string[];
      action: string;
      risk: PlanStepRisk;
      rationale?: string;
      status: PlanStepStatus;
      output?: string;
      error?: string;
    }
  | {
      kind: "skill";
      id: string;
      title: string;
      skillId: string;
      actionId: string;
      params: Record<string, unknown>;
      risk: PlanStepRisk;
      rationale?: string;
      status: PlanStepStatus;
      output?: string;
      error?: string;
      verification?: VerificationResult;
    };
```

計画 JSON の例:

```json
{
  "goal": "型エラーを修正する",
  "steps": [
    {
      "kind": "skill",
      "skillId": "code-edit",
      "actionId": "editor.readFile",
      "params": { "path": "src/App.tsx" },
      "title": "App.tsx を確認する",
      "rationale": "修正対象の型を特定するため"
    },
    {
      "kind": "skill",
      "skillId": "code-edit",
      "actionId": "editor.replaceText",
      "params": {
        "path": "src/App.tsx",
        "oldText": "const value: string = 1;",
        "newText": "const value: number = 1;"
      },
      "title": "型を修正する",
      "rationale": "型エラーを解消するため"
    }
  ]
}
```

- LLM のシステムプロンプトには `skills_list` の要約（id、action、params、risk）を含める
- フロントエンドの `parsePlan` は、読み込み済みカタログと照合してスキル・アクション・パラメータを検証する
- Rust の `skill_run` は同じ検証を再実行する（多層防御）
- 既存の `kind` がない手順は `agent` として扱い、後方互換を保つ

## 11. 監査ログ

### 11.1 種別

既存の種別に次を追加する。

- `skill_run`（成功・失敗）
- `skill_blocked`
- `skill_cancelled`
- `verification_run`
- `skill_policy_updated`

### 11.2 記録項目

`audit_log` に `skill_id` と `action_id` を追加する（`PRAGMA table_info` で存在確認して `ALTER TABLE`）。

- 実行者: 常にローカルユーザー
- 対象: スキル ID、アクション ID、計画 ID、手順 ID
- 判断: `allow` / `ask` / `block`、承認結果
- 実行: コマンド配列、作業ディレクトリ、終了コード、所要時間
- 変更: 変更ファイルの相対パス、追加・削除行数、`paramsHash`
- 検証: check 名、コマンド、結果、出力の先頭 4,000 文字

ファイル内容そのものは保存しない。パラメータに秘密情報が含まれる可能性があるため、`detail` は保存前にマスクする（`sk-`、`ghp_`、`Bearer`、`token=` など）。生のパラメータは `paramsHash`（SHA-256）だけを残す。

## 12. API

| コマンド | 用途 |
|---|---|
| `skills_list` | マニフェスト一覧とポリシーを返す |
| `skill_policy_get` / `skill_policy_set` | スキルポリシーの取得・保存 |
| `skill_preview` | 実行前の差分・コマンド・警告を返す |
| `skill_run` | 検証・承認・実行を行い、結果を返す |
| `skill_cancel` | 実行中のスキルを停止する |
| `skill_verify` | 検証チェックを実行する |

```ts
interface SkillRequest {
  skillId: string;
  actionId: string;
  params: Record<string, unknown>;
  planId?: string;
  stepId?: string;
  mode?: "passive" | "assistive" | "autonomous";
}

type SkillRunStatus = "ok" | "blocked" | "cancelled" | "failed" | "timeout";

interface SkillRunResult {
  runId: string;
  status: SkillRunStatus;
  decision: "allow" | "ask" | "block";
  changedFiles: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  auditId: number;
  errorCode?: string;
  verification?: VerificationResult;
}

interface VerificationResult {
  status: "passed" | "failed" | "skipped" | "timeout";
  checks: {
    name: "typecheck" | "lint" | "test";
    status: "passed" | "failed" | "skipped" | "timeout";
    command: string[];
    exitCode: number | null;
    output: string;
    durationMs: number;
  }[];
}
```

想定内の拒否・キャンセルは例外ではなく `status` で返す。不正なリクエスト（未知のスキル、パラメータ型違反）は `AppError` とし、UI に安全なメッセージを表示する。

## 13. セキュリティ

| 脅威 | 対策 |
|---|---|
| プロンプトインジェクションで危険な計画が生成される | 許可ハンドラ、リスク上限、書き込みの承認、検証失敗時の停止 |
| パス脱出（`..`、絶対パス、シンボリックリンク） | `resolve_existing` / `resolve_new`、canonicalize、拒否リスト |
| コマンドインジェクション | argv 配列、シェル禁止、プログラム許可リスト、メタ文字拒否 |
| TOCTOU（検証後の差し替え） | 実行直前に再検証、`atomic_write`、適用前のバージョン記録 |
| 秘密情報の漏えい | 環境変数の許可リスト、ネットワーク禁止、監査のマスク、LLM へ送らない |
| リソース枯渇 | タイムアウト、出力上限、ファイル数・バイト数上限、プロセスグループ終了 |
| 承認 UI の偽装 | Rust がダイアログ文言を生成し、WebView の表示だけに依存しない |
| 監査ログの改ざん | ローカル SQLite、追記のみ、将来はハッシュチェーンを検討 |
| 悪意あるマニフェスト | リポジトリ内のみ、ハンドラの閉じた集合、サイズ上限、起動時検証 |

## 14. テスト計画

### 14.1  fixtures

- 有効な `code-edit` マニフェスト
- `id` とファイル名が一致しない
- 重複したアクション ID
- 未実装ハンドラ
- `write` アクションに `allow` を指定
- 範囲外の `limits`
- パス脱出、シンボリックリンク、拒否リスト該当
- シェルメタ文字、未許可プログラム
- タイムアウト、出力上限

### 14.2 テスト種別

- 単体: マニフェスト検証、ポリシー正規化、glob、マスク、コマンド検証
- 結合: 一時ワークスペースで `replaceText` → バージョン履歴 → 検証検出
- UI: プレビュー、承認、dirty buffer の拒否、キャンセル
- E2E: 計画 → スキル → 検証の流れ（ブラウザデモはモック、Tauri は手動）

### 14.3 v0.4.0 の受け入れ条件

- `code-edit` の読み取りと置換が計画から実行できる
- 置換前に差分が表示され、ネイティブ承認を経る
- 置換後に typecheck / lint / test が実行され、結果が UI に出る
- 失敗時に計画が停止し、監査ログに理由が残る
- ワークスペース外・拒否リスト・未許可コマンドが実行できない
- 既存の Agent Desktop アクションとポリシーが退行しない

## 15. 実装順

1. マニフェストの型・ローダー・バリデータ + fixtures + JSON Schema の CI 検証
2. スキルポリシーの型・正規化・保存 + テスト
3. `atomic_write` の共通化、`editor.readFile` / `replaceText` / `createFile` + バージョン履歴
4. `skill_preview`、ネイティブ承認、監査ログ
5. 検証コマンドの検出・実行・結果表示
6. 計画スキーマの union 化、フロントエンドのプレビュー UI、README / SECURITY / LP 更新

## 16. 決定事項と保留

### 決定済み

- マニフェストはリポジトリ内のみ。実行は Rust の閉じたハンドラ
- v0.4.0 は `code-edit` の最小垂直スライス
- 置換は一意一致の文字列置換。unified diff は v0.5 以降
- 書き込みは承認必須。`allow` は読み取り専用のみ
- 検証は「実行して報告して停止」。自動修正は v0.5 以降
- ターミナルとデバッガは v0.4.0 の対象外

### 実装前に決めること

1. `git.status` / `git.diff` の読み取りを v0.4.0 に含めるか（推奨: 含める）
2. 検証の `autoRun` を既定で有効にするか（推奨: 無効。初回は承認）
3. スキルポリシー UI を「設定 > スキル」に置くか（推奨: そこに置く）
4. `terminal.run` を v0.5 のどこで解禁するか（推奨: Git 書き込みの後）
