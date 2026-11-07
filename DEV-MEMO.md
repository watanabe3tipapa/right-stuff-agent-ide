# DEV-MEMO

開発者向けのメモです。ユーザー向けの概要は [README.md](./README.md) を参照してください。
リリース履歴、ビルド手順、リリース手順、設計上の決定事項をまとめます。

## リリース履歴

### v0.3.8

- [x] ウィンドウ位置の補正 — 起動時はプライマリモニタの作業領域中央に配置し、macOS が切断済みディスプレイのフレームを復元した場合はタイトルバーが見えるモニタ中央へ移動（`src-tauri/tauri.conf.json` の `center`、`src-tauri/src/window_state.rs`、単体テスト 8 件）
- [x] Agent Desktop 連携の修正 — `snapshot` から CLI 1.0.2 が拒否する `--json` を削除し、エラー JSON が stdout に返る場合も UI・監査ログへ表示（`src-tauri/src/commands/agent.rs`、`src/stores/agentStore.ts`、計画プロンプト・UI ラベル・テスト）
- [x] Openship 連携の修正 — CLI デプロイに設定済みの `--project` / `--branch` を明示、失敗詳細の stdout フォールバック、Base URL の `/api` 正規化、REST フォールバック条件を「CLI 未検出時のみ」に修正

### v0.3.7

- [x] HTML レンダラー — スキル実行結果を自己完結 HTML に変換し、アプリ内プレビューと `.agents/reports/` への保存に対応
- [x] Archify 要素 — 承認・実行・検証・結果のインライン SVG フロー図、明暗テーマ、印刷向けスタイル、自己完結（外部 CDN なし）
- [x] 安全な出力 — パラメータ・stdout / stderr・検証出力をすべて HTML エスケープし、`sandbox` 付き iframe でプレビュー
- [x] 保存先の制限 — Rust 側でファイル名を検証し、ワークスペース内の `.agents/reports/*.html` だけに書き込み
- [x] テスト — HTML エスケープ、図の生成、外部参照なし、ファイル名のサニタイズを検証

### v0.3.6

- [x] Git ハンドラ — 既存の Git コマンドを `*_at` ヘルパーへ切り出し、スキルから `status` / `diff` / `branches` / `stage` / `stageAll` / `commit` を実行
- [x] ターミナルハンドラ — 許可プログラムを `program + args` で直接実行し、シェル文字列・パイプ・リダイレクトを使わない
- [x] デバッグハンドラ — DAP の request/response 相関とイベント購読を追加し、Debug タブと同じセッションを操作
- [x] 共通実行基盤 — 独立プロセスグループ、タイムアウト、出力上限を `skills/exec.rs` に集約
- [x] 失敗の伝播 — ターミナルの非ゼロ終了とタイムアウトを `SkillRunStatus::Failed` として返し、監査ログに記録
- [x] マニフェストとライブラリ — Git / ターミナル / デバッグを v1 マニフェスト化し、ライブラリの `status` を `ready` に更新

### v0.3.5

- [x] 検証ループ — `verification.mode: "auto"` のスキル実行後に typecheck / lint / test を実行し、結果を表示
- [x] コマンド解決 — `package.json` の scripts と `Cargo.toml` から検証コマンドを決め、マニフェストから任意のコマンド文字列は受け取らない
- [x] 承認 — `autoRun` と `allowChecks` に沿って承認を省略。`test` は常にネイティブ承認を求める
- [x] 安全な実行 — チェックごとにプロセスグループとタイムアウトを適用し、失敗時は `stopOnFailure` で後続をスキップ
- [x] 監査と UI — 検証結果を監査ログへ記録し、Skills タブに各チェックの出力を表示

### v0.3.4

- [x] スキルライブラリ — スキルを目的・リスク・パラメータ・マニフェストで読める形に整理したカタログ
- [x] ショーケース別窓 — エージェントパネルの Skills タブとコマンドパレットから `skill-library` ウィンドウを起動（ブラウザでは別タブ）
- [x] ワークスペースへの追加 — マニフェストを `.agents/skills/<id>.json` として書き出し、既存ファイルは確認してから上書き
- [x] 予定スキルの可視化 — Git / ターミナル / デバッグの設計カードを表示し、未実装であることを明示
- [x] 空の別窓ルート — `index.html?window=skills` を通常のアプリ起動と分岐して描画

### v0.3.3

- [x] LSP 名前変更 — F2 で `textDocument/prepareRename` と `textDocument/rename` を実行し、複数ファイルの編集をタブへ反映
- [x] 参照検索 — ⇧F12 で `textDocument/references` を実行し、Monaco の参照ビューで一覧表示
- [x] コードアクション — 電球メニューから quick fix / refactor / source を実行し、`workspace/executeCommand` にも対応
- [x] ワークスペースシンボル検索 — `⌘T` で `workspace/symbol` を検索し、選択した定義へジャンプ
- [x] `workspace/applyEdit` を受けて、ワークスペース内のテキスト編集を適用（リソース操作は拒否）
- [x] 変換ロジックの単体テストを追加（Undo 可能な編集順序、URI 検証、シンボル種別）

### v0.3.1

- [x] LSP クライアント — 固定レジストリの言語サーバーを検出し、補完・定義ジャンプ・ホバー・診断を Monaco に接続
- [x] ファイル同期 — タブの開閉・編集（300ms デバウンス）・保存を didOpen / didChange / didSave / didClose で送信
- [x] DAP クライアント — `lldb-dap` / `debugpy` を検出し、Debug タブから起動・停止・再開・ステップ実行
- [x] ブレークポイント — グリフマージンのクリックと F9 で切り替え、セッション中は即時反映
- [x] コールスタック・変数・出力の表示
- [x] 設定ダイアログの「ツール」タブで LSP / DAP の検出状態を確認
- [x] ワークスペース切替・アプリ終了時の LSP / DAP セッション停止
- [x] macOS 専用化（グローバルショートカットを Command に統一）

### v0.3.0

- [x] クイックオープン（`⌘P`）— ワークスペース内のファイルを名前で検索して開く
- [x] Git パネル — ブランチ / ahead・behind、変更・ステージ・未追跡、ステージ / アンステージ、差分、コミット、履歴、`git init`
- [x] 統合ターミナル（`⌘J`）— `portable-pty` と xterm.js による対話シェル、リサイズ・再起動・クリア
- [x] ステータスバーに実際の Git ブランチを表示し、クリックで Git タブを開く
- [x] ターミナル終了時の PTY クリーンアップと、アプリ終了時の全セッション停止

### v0.2.1

- [x] Rust 1.99 の `clippy::collapsible_match` に対応
- [x] Frontend / Rust の CI を green に回復
- [x] v0.2.0 リリース後の CI 修正を反映するメンテナンスリリース

### v0.2.0

- [x] LLM による実行計画の生成（Plan タブ、`/plan <意図>`）
- [x] 許可アクション・引数のクライアント側検証とリスク表示
- [x] 計画単位の承認・却下、Assistive での手順別実行
- [x] Autonomous での承認済み計画の連続実行（失敗時は停止）
- [x] 実行結果（stdout / stderr / 終了コード）の手順ごとの表示
- [x] 承認・実行・ポリシー変更の監査ログ（SQLite、保持期間 / 件数上限つき）
- [x] エージェントポリシー設定 UI（読み取り専用は許可 / 確認 / 禁止、変更は確認 / 禁止）
- [x] Openship CLI 検出と `openship --json deploy` の実行
- [x] セルフホスト REST API へのフォールバック（デプロイ・履歴・ログ・ロールバック）
- [x] Openship 設定 UI、PAT の OS キーチェーン保存、Deploy タブ
- [x] `/ship`・`/deploy`・`/logs`・`/rollback` コマンドと監査ログ記録

### v0.1.1

- [x] OpenAI 互換 LLM 接続（OpenAI / Ollama / LM Studio / OpenRouter / カスタム）
- [x] ストリーミングチャット、生成停止、接続テスト
- [x] API キーの OS キーチェーン保存・削除
- [x] LLM 設定ダイアログとモデル一覧表示
- [x] API キーのマスク、HTTP レスポンス本文の上限、リダイレクト無効化
- [x] README / API / SECURITY / ARCHITECTURE / LP の更新

### v0.1.0

- [x] Tauri 2.0 + React 18 + Vite の基盤、ネイティブウィンドウ
- [x] ワークスペースの選択・復元、ツリー表示、作成・名前変更・削除
- [x] Monaco エディタ、タブ、未保存管理、すべて保存
- [x] アプリ内の確認・入力ダイアログ
- [x] GFM Markdown プレビュー
- [x] SQLite (WAL) バージョン履歴（最新 100 版 / ファイル）と復元
- [x] パス検証、atomic write、ゴミ箱へのソフトデリート
- [x] Agent Desktop の検出、スナップショット、許可アクション実行
- [x] Agent Desktop の引数検証とネイティブ承認ダイアログ
- [x] CSP（Tauri / Vercel）とセキュリティヘッダー
- [x] ESLint / Vitest / GitHub Actions CI
- [x] エージェントパネル（Chat / Runtime、3 モード、`/status`・`/snapshot`）
- [x] コマンドパレット
- [x] ブラウザ用デモワークスペース
- [x] アーキテクチャ / API / セキュリティのドキュメント、スキル定義

## 次の候補

- [ ] Anthropic 固有 API のアダプター
- [ ] `skill_cancel` と実行中検証のキャンセル
- [ ] DAP の attach と条件付きブレークポイント
- [ ] 署名・公証と自動更新
- [ ] 拡張機能エコシステム

## 開発コマンド

```bash
# フロントエンド
npm run typecheck
npm run lint
npm test
npm run build

# Rust（PATH に cargo を通す）
export PATH="$HOME/.cargo/bin:$PATH"
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml

# タイポ
typos
```

## バージョン更新箇所

リリース時は次のファイルの `version` を揃える。

- `package.json`
- `package-lock.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `src-tauri/tauri.conf.json`
- `src/components/StatusBar.tsx`
- `src/lib/demo.ts`
- `src/lib/lsp.ts`
- `.github/ISSUE_TEMPLATE/bug_report.yml`

README / README.en / LP / 実装設計書 / docs のバージョン表記と DMG 名も更新する。

## リリース手順

1. バージョンを更新し、テスト・lint・build・clippy・typos を通す
2. `main` へ commit / push し、`vX.Y.Z` タグを作成して push する
3. DMG をビルドする

   ```bash
   export PATH="$HOME/.cargo/bin:$PATH"
   npm run tauri build -- --target aarch64-apple-darwin
   npm run tauri build -- --target x86_64-apple-darwin
   ```

4. DMG を `Right-Stuff.Agent.IDE_X.Y.Z_aarch64.dmg` / `Right-Stuff.Agent.IDE_X.Y.Z_x64.dmg` にリネームする
5. SHA-256 とサイズを `.github/release-notes-vX.Y.Z.md` に追記する
6. `gh release create vX.Y.Z --notes-file ...` で DMG をアップロードする

x86_64 ビルドには `rustup target add x86_64-apple-darwin` が必要。
ツールチェーンは `PATH="$HOME/.cargo/bin:$PATH"` で実行する。

### 実機検証（v0.3.7 / Intel）

2026-11-06 に Intel Core i7-1068NG7 / macOS 15.8.3（x86_64）で確認した。

- DMG: `Right-Stuff.Agent.IDE_0.3.7_x64.dmg`
- SHA-256: `43890b975320f8704aa63f11e2ccc6e5226f50377961a63b67f2866f37018570`（リリースノートと一致）
- 実行ファイル: `Mach-O 64-bit executable x86_64`、`CFBundleShortVersionString` は `0.3.7`、最低 OS は `11.0`
- 署名: 未署名（`codesign` は "code object is not signed at all"、`spctl` は "rejected: no usable signature"）
- 起動: `/Applications` へコピー後に起動し、ファイルツリー、Monaco エディタ、Agent パネルの各タブ、ステータスバーの `v0.3.7` を確認
- 注意: 検証では `curl` で DMG を取得したため quarantine 属性が付かず、Gatekeeper の「開く」操作は不要だった。ブラウザから取得した DMG では警告が出る
- 初回起動時にウィンドウがプライマリモニタ以外の位置（`position: 45, -1086`）に開いたため、起動位置をプライマリモニタ中央に固定し、画面外なら補正する仕組みを追加した（v0.3.8）

### 実機検証（v0.3.8 / Openship CLI 0.9.11）

2026-11-07 に Intel Core i7-1068NG7 / macOS 15.8.3（x86_64）で Openship CLI 0.9.11 を実機確認した。CLI は Volta 管理の `~/.volta/bin/openship` に入る。

- `openship --version` → `0.9.11`
- `openship status` → Health `ok`、Mode `self-hosted`、Deploy `bare`、Auth `local`、Team `single_user`
- `openship deploy --help` → `--project` / `--branch` / `--watch` を確認（アプリの CLI 引数と一致）
- `openship deployments rollback <id>` がロールバックの正しいコマンド。アプリのロールバックは REST のみを使う
- `openship --json projects list` / `openship --json deployments list` は JSON を返す
- 接続失敗時の CLI エラーは stderr に `TypeError: fetch failed`、stdout は空
- ローカル管理者は `POST /api/system/bootstrap-admin`（`X-Internal-Token` 必須）で作成できた。`openship up` だけでは管理者は作られない
- `openship --local token create <name> --full-access` で PAT を発行
- PAT で `GET /api/health` → 200、`GET /api/projects` → `{"data":[],"total":0,...}`、`GET /api/deployments` → `{"success":true,"data":[],...}`
- 存在しないデプロイの `GET /api/deployments/:id/logs` と `POST /api/deployments/:id/rollback` はどちらも 404 `NOT_FOUND` を返し、ルートとベアラ認証が有効なことを確認
- 未認証の `GET /api/projects` は 401 `Unauthorized`

確認後、ローカルサービスは `openship stop` で停止できる（データは `~/.openship` に残る）。

### 実機検証（v0.3.8 / Intel）

2026-11-07 に Intel Core i7-1068NG7 / macOS 15.8.3（x86_64）で確認した。

- DMG: `Right-Stuff.Agent.IDE_0.3.8_x64.dmg`（9,140,029 bytes、8.7 MB）
- SHA-256: `e363cbc43b21e4787fa229856c1fdd26173bba6f2ecf6c93da6cae90a648d819`
- 実行ファイル: `Mach-O 64-bit executable x86_64`、`CFBundleShortVersionString` は `0.3.8`、最低 OS は `11.0`
- 署名: 未署名（`codesign` は "code object is not signed at all"）
- 起動: DMG をマウントして `/Applications` へコピー後に起動し、ファイルツリー、Monaco エディタ、Agent パネル、ステータスバーの `v0.3.8` を確認
- ウィンドウ: `position 105, 53` / `size 1281, 821`。プライマリモニタ（1440x900）の作業領域中央に配置された
- arm64 DMG: `Right-Stuff.Agent.IDE_0.3.8_aarch64.dmg`（8,720,889 bytes、8.3 MB）、SHA-256 `1388fd8b21cc6a43121bd74959fd2f2dd3e1b701e2f7bf7f272aad7b6fb34c53`、`Mach-O 64-bit executable arm64`、ad-hoc 署名

## 設計メモ

- レポートは WebView の `src/lib/report.ts` で生成し、Rust の `report_export` は保存だけを担当する。保存先は `.agents/reports/*.html` に限定し、ファイル名は英数字と `.` `_` `-` のみ。
- ターミナルスキルは PTY ではなく `program + args` を直接実行する。許可プログラムは `npm` / `pnpm` / `yarn` / `cargo` / `node` / `python3` / `pytest` / `make`。
- `skills/exec.rs` が独立プロセスグループ、タイムアウト、出力上限を共通化する。
- DAP は `rpc.rs` の request/response 相関とイベント購読を使い、Debug タブと同じセッションを共有する。
- マニフェストから任意のコマンド文字列は受け取らない。実行は Rust の固定ハンドラと許可リストだけが行う。
- `package.json` の `overrides.minimatch` は、ESLint / typescript-eslint が参照する推移的依存を 11.0.3 以上に固定するためのもの。上流が同等以上を解決するようになったら削除を検討する。
- メインウィンドウは `tauri.conf.json` の `center: true` でプライマリモニタの作業領域中央に開く。起動時に `window_state::ensure_on_screen` で接続中モニタの `work_area` と比較し、タイトルバーが画面外ならプライマリモニタ中央へ移動する。これにより、切断済みディスプレイの座標が復元されても操作不能にならない。

## 関連ドキュメント

- [README.md](./README.md) — ユーザー向け概要
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — レイヤーとフロー
- [docs/SKILLS.md](./docs/SKILLS.md) — スキル設計
- [docs/API.md](./docs/API.md) — Tauri コマンド
- [docs/SECURITY.md](./docs/SECURITY.md) — セキュリティ
