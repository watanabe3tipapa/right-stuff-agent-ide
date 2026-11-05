## 概要

v0.3.5 は、スキル実行のあとに自動で検証を走らせる「検証ループ」を追加したリリースです。`verification.mode: "auto"` のスキルがファイルを変更すると、ワークスペースの構成から解決した typecheck / lint / test を実行し、結果を Skills タブと監査ログに記録します。検証コマンドはマニフェストから受け取らず、`package.json` / `Cargo.toml` の固定の組み合わせだけを使います。ローカルファーストの設計はそのまま維持しています。

## ハイライト

### 検証ループ

- **自動実行** — 書き込みを伴うスキル実行のあと、マニフェストの `verification` に従って検証を開始
- **コマンド解決** — Node は `package.json` の `typecheck` / `lint` / `test` script、Rust は `cargo check` / `cargo clippy -- -D warnings` / `cargo test`
- **パッケージマネージャー判定** — `pnpm-lock.yaml` → `pnpm`、`yarn.lock` → `yarn`、それ以外は `npm`
- **承認** — `autoRun` と `allowChecks` に沿って省略。`test` はプロジェクトのコードを実行するため常にネイティブ承認を要求
- **安全な停止** — 各チェックは独立したプロセスグループで実行し、`timeoutMs` を超えたらグループごと停止。`stopOnFailure` で後続をスキップ
- **結果表示** — `passed` / `failed` / `skipped` / `timeout` とコマンド・出力・実行時間を Skills タブに表示。失敗したチェックは自動で展開
- **監査** — 検証結果を `verification_run` として監査ログに記録

### 既存機能（v0.3.4 まで）

- スキルライブラリとショーケース別窓
- LSP（補完・定義・ホバー・診断・名前変更・参照検索・コードアクション・シンボル検索）
- DAP（`lldb-dap` / `debugpy`、Debug タブ、ブレークポイント）
- Git パネル、統合ターミナル (PTY)、クイックオープン、Openship 連携、監査ログ

## ダウンロード

| アーキテクチャ | ファイル | サイズ | SHA-256 |
|---|---|---|---|
| Apple Silicon (arm64) | [Right-Stuff.Agent.IDE_0.3.5_aarch64.dmg](https://github.com/watanabe3tipapa/right-stuff-agent-ide/releases/download/v0.3.5/Right-Stuff.Agent.IDE_0.3.5_aarch64.dmg) | 8.2 MB | `a80c07c84034a01bfd04262839773539ef96103f1ef17408ad96b252ebaad225` |
| Intel (x86_64) | [Right-Stuff.Agent.IDE_0.3.5_x64.dmg](https://github.com/watanabe3tipapa/right-stuff-agent-ide/releases/download/v0.3.5/Right-Stuff.Agent.IDE_0.3.5_x64.dmg) | 8.6 MB | `efc9ce0ae232cd0a842fae49620cf36ac4a06b977317dd9c85d1881080051df8` |

> **注意:** どちらのビルドも Apple の公証（notarization）を受けていません。ダウンロードした Mac では初回起動時に Gatekeeper の警告が表示されます。「システム設定 > プライバシーとセキュリティ」から許可するか、アプリを右クリックして「開く」を選んでください。arm64 版は ad-hoc 署名済み、x64 版は未署名です。Apple Silicon で x64 版を動かす場合は Rosetta 2 が必要です。

## 変更内容

### 追加

- `skill_verify` コマンドと検証結果の型（`VerificationResult` / `VerificationCheckResult`）
- `src-tauri/src/skills/verify.rs` — コマンド解決、プロセスグループ、タイムアウト、出力打ち切り
- Skills タブの「検証を実行」ボタンと自動検証、チェックごとの結果表示
- 検証のネイティブ承認ダイアログ
- 検証の単体テスト（コマンド解決、プロセス実行、打ち切り）
- `libc` 依存（プロセスグループの停止）

### 改善

- `skill_run` の変更後に検証を自動実行し、失敗時はその場で出力を確認できるようにした
- 検証結果を `verification_run` として監査ログへ記録
- README / README.en / アーキテクチャ / API / スキル設計 / LP / 実装計画を更新
- バージョン表記を 0.3.5 に更新

### 既知の制約

- macOS 11 以降（Apple Silicon / Intel）専用です
- 検証対象は `package.json`（npm / pnpm / yarn）または `Cargo.toml` を持つワークスペースだけです
- 検証コマンドは固定の組み合わせで、`npm install` などのネットワーク操作や任意のコマンドは実行しません
- 検証失敗時の自動修正は行いません。結果を表示して停止します
- `skill_cancel` と実行中の検証のキャンセルは未実装です
