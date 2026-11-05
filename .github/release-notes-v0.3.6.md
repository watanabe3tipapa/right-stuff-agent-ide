## 概要

v0.3.6 は、スキルから Git・ターミナル・デバッガを操作するための固定ハンドラを追加したリリースです。マニフェストは操作を宣言するだけで、実行は Rust 側の許可リストと固定関数だけが行います。ターミナルはシェル文字列を組み立てず `program + args` で直接実行し、デバッグは Debug タブと同じ DAP セッションを共有します。ローカルファーストの設計はそのまま維持しています。

## ハイライト

### Git スキル

- **読み取り** — `git.status` / `git.diff` / `git.branches`。既存の Git コマンドを `*_at` ヘルパーへ切り出して再利用
- **書き込み** — `git.stage` / `git.stageAll` / `git.commit`。ネイティブ承認を挟み、結果を監査ログに記録
- **安全策** — `push` / `reset --hard` / `checkout` はハンドラに含めない

### ターミナルスキル

- **許可プログラム** — `npm` / `pnpm` / `yarn` / `cargo` / `node` / `python3` / `pytest` / `make` のみ
- **シェルなし** — `program + args` を直接実行し、パイプ・リダイレクト・`sh -c` を組み立てない
- **制限** — 引数 32 件・各 512 文字まで。独立プロセスグループ、タイムアウト、出力上限を適用
- **失敗の伝播** — 非ゼロ終了とタイムアウトを `SkillRunStatus::Failed` として返す

### デバッグスキル

- **セッション操作** — `debug.start` / `stop` / `continue` / `next` / `stepIn` / `pause` / `setBreakpoint` / `evaluate`
- **DAP ハンドシェイク** — initialize → launch → initialized → configurationDone。失敗時はセッションを停止して削除
- **共有セッション** — `sessionId` を受け取り、Debug タブと同じセッションを操作
- **request/response 相関** — `request_seq` による応答待ちとイベント購読を `rpc.rs` に追加

### 既存機能（v0.3.5 まで）

- 検証ループ（typecheck / lint / test）
- スキルライブラリとショーケース別窓
- LSP / DAP、Git パネル、統合ターミナル (PTY)、Openship 連携、監査ログ

## ダウンロード

DMG はビルド後にこのセクションへ追記します。

> **注意:** どちらのビルドも Apple の公証（notarization）を受けていません。ダウンロードした Mac では初回起動時に Gatekeeper の警告が表示されます。「システム設定 > プライバシーとセキュリティ」から許可するか、アプリを右クリックして「開く」を選んでください。arm64 版は ad-hoc 署名済み、x64 版は未署名です。Apple Silicon で x64 版を動かす場合は Rosetta 2 が必要です。

## 変更内容

### 追加

- `src-tauri/src/skills/exec.rs` — 共通のプロセス実行（独立プロセスグループ、タイムアウト、出力上限）
- `src-tauri/src/skills/git.rs` — Git スキルハンドラ
- `src-tauri/src/skills/terminal.rs` — ターミナルスキルハンドラ
- `src-tauri/src/skills/debug.rs` — DAP スキルハンドラ
- `src-tauri/src/rpc.rs` — DAP の request/response 相関、イベント購読、`send_request` / `request` / `subscribe` / `wait_event`
- `commands/git.rs` の `*_at` ヘルパーと `GitBranch`
- `commands/dap.rs` の `start_at`
- `.agents/skills/git-operation.json` / `terminal-command.json` / `debug-control.json` の v1 マニフェスト
- `HandlerOutcome.failed` / `exit_code` と `SkillRunStatus::Failed` への伝播

### 改善

- 検証ループのプロセス実行を `skills/exec.rs` に共通化
- スキルライブラリの Git / ターミナル / デバッグを `status: "ready"` に更新
- README / README.en / アーキテクチャ / API / スキル設計 / LP / 実装計画を更新
- バージョン表記を 0.3.6 に更新

### 既知の制約

- macOS 11 以降（Apple Silicon / Intel）専用です
- ターミナルスキルは許可リストのプログラムだけを実行し、対話的な PTY 入力は行いません
- デバッグは `lldb-dap` と `debugpy` のみに対応し、アダプターの追加はできません
- `skill_cancel` と実行中の検証のキャンセルは未実装です
