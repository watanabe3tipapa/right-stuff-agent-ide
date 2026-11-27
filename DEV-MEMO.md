# DEV-MEMO

開発者向けのメモです。ユーザー向けの概要は [README.md](./README.md) を参照してください。
リリース履歴、ビルド手順、リリース手順、設計上の決定事項をまとめます。

## リリース履歴

### v0.4.2

- [x] Apple FM 設定 UI — 設定に Apple FM タブを追加。`fm` の検出、`fm serve` の起動・停止、ホスト / ポート指定、モデル検出、LLM への反映、接続テストを GUI から操作可能にした
- [x] 既定プロバイダー — Apple Silicon かつ `fm` が存在する環境では Apple FM（`http://127.0.0.1:1976/v1` / `system`）を既定に。`fm` がない環境は OpenAI のまま
- [x] プロセス管理 — アプリが起動した `fm serve` を終了時に停止。外部で起動済みのサーバーは検出して再利用し、停止操作の対象外にした
- [x] ドキュメント — README に Apple Intelligence、`sudo fm license`、手動起動コマンド、既定の Base URL / モデルを追記
- [x] 検証 — `npm run typecheck` / `lint` / `test` / `build`、`cargo clippy` / `test`、用語集チェックに合格。実際の `fm serve` に対して `/v1/models` と `/v1/chat/completions` を確認
- [x] バージョン更新 — `0.4.2` へ更新し、リリースノート `.github/release-notes-v0.4.2.md` を追加

### v0.4.1

- [x] README 再構成 — 価値提案、対象ユーザー、できないこと、ダウンロード、3 分クイックスタートを先頭へ。詳細を docs へ分離し、バージョンバッジを Releases 連動に変更
- [x] ドキュメント分離 — `docs/FEATURES.md`、`docs/LIMITATIONS.md`、`docs/DEVELOPMENT.md`、`docs/OPENSHIP.md` を追加
- [x] Openship の採用理由 — セルフホスト、CLI と REST、履歴・ログ・ロールバック、認証の観点と、GitHub Actions / rsync / Docker / SaaS を採用しなかった理由を記録
- [x] 外部接続の明示 — LLM と Openship に送るもの・送らないものを README に記載し、可視化とマスクを見直し中であることを明記
- [x] スナップショット確認 — `/snapshot` はポリシーにかかわらずネイティブ確認を表示。機密情報の可能性と自動マスク未実装を明示し、キャンセルを監査ログへ記録
- [x] リリース自動化 — `v*` タグで arm64 / x64 の DMG をビルドし、SHA-256 とともに GitHub Release へ添付する `.github/workflows/release.yml` を追加
- [x] 検証環境の修正 — 実測値（macOS 15.8.4 / Node.js 22.17 / Rust 1.94.1）と CI（Node.js 24 / Rust stable）を分けて記載
- [x] バージョン更新 — `0.4.1` へ更新し、リリースノート `.github/release-notes-v0.4.1.md` を追加

### v0.4.0

- [x] 検証の自動修正 — Skills タブと Plan タブのスキル手順で、失敗した検証から `editor.replaceText` だけの修正案を生成。文脈は変更ファイルと失敗出力に限定し、8 ファイル / 60,000 文字で打ち切る
- [x] 自動修正の安全策 — 書き込みは毎回ネイティブ承認、対象ファイルは変更ファイルと失敗出力内のパスだけ、`.env`・鍵・lockfile・`node_modules`・`target`・`.git` を除外。合格・最大試行・同一失敗・無効案・中止で停止
- [x] スキルポリシー v2 — `verification.autoFix`（`off` / `manual` / `auto`）と `maxFixAttempts`（1〜3、既定 2）を追加。v1 設定は読み込み時に補完
- [x] 監査 — `verification_fix` を追加し、修正案の生成・適用・拒否・中止・再検証を記録
- [x] 日本語品質 — `docs/GLOSSARY.md`、`scripts/check-glossary.mjs`、`npm run glossary`、CI ステップを追加
- [x] 日本語スキル — 読み取り専用の `japanese-text`（`editor.checkJapanese`）を追加。全角英数字・半角カタカナ・句読点・用語集の表記ゆれを検出
- [x] テンプレート — `templates/open-vibecoding-ja/` に AGENTS.md、PRD、テストレポート、`.gitattributes` を追加
- [x] ドキュメント — `docs/OPEN-VIBECODING-JA.md` に提案との対応と対象外を記録。README / API / SKILLS / リリースノートを更新
- [x] PWA — ブラウザデモに manifest、192 / 512 / maskable アイコン、オフラインページ、service worker を追加。ナビゲーションは network-first、静的アセットは cache-first。Tauri 版では登録しない。Chrome headless で service worker の登録と CacheStorage の生成を確認
- [x] 公開リポジトリ — v0.4.0 の公開に合わせて、LP / README / リリースノートからアクセス権の注記を外し、GitHub と Releases への直接リンクに戻した。GitHub のソーシャルプレビューを README と LP の OGP 画像に採用

### v0.3.9

- [x] スキルの停止 — 新コマンド `skill_cancel { runId? }` を追加し、UI が発行した `runId` で実行中のスキルを停止（`terminal.run` が対象）
- [x] 検証の停止 — `skill_verify` に `runId` を追加し、実行中のチェックをプロセスグループごと停止。残りは `skipped`、全体は `cancelled` として返す
- [x] 共通実行基盤 — `skills/exec.rs` に `CancelFlag` を渡し、タイムアウトと同じループでキャンセルを検知
- [x] 計画の停止 — Plan タブの「中止」で実行中のスキル手順も停止し、ステップを `cancelled` にする
- [x] UI — Skills パネルに「停止」ボタン、検証結果と計画ステップに `cancelled` 表示
- [x] 監査 — 実行中の停止を `skill_cancelled` / `verification_run` に記録
- [x] ブラウザデモの永続化 — `src/lib/demoStorage.ts` を追加し、ワークスペース・履歴・スキルポリシーを localStorage に保存。バージョン付きスキーマ、パスの検証、履歴の剪定、保存失敗時のフォールバックを含む
- [x] デモのリセット — `api.demoReset()` とデモバーの「初期状態に戻す」、保存できない環境向けの警告表示
- [x] デモのディープリンク — `?tab=` / `?file=` / `?preview=1` / `?shot=1` に対応
- [x] スクリーンショット自動化 — `scripts/capture-screenshots.mjs` と `npm run screenshots` を追加。Chrome headless で LP 用 WebP と OGP 画像を生成
- [x] LP 刷新 — 実画面と CSS のみの画面ツアー、Hobby project / Early Access の位置付け、できないこと・セキュリティ・FAQ を整理
- [x] ドキュメント整合 — README / README.en / DEV-MEMO / index.html / sitemap / 404 を更新

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
npm run build:vercel
npm run screenshots   # LP 用画像と OGP を再生成
npm run icons         # PWA アイコンを public/icons/ に再生成（macOS の sips）

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

v0.4.1 以降は GitHub Actions で自動化している。

1. バージョンを更新し、テスト・lint・build・clippy・typos を通す
2. `main` へ commit / push し、`vX.Y.Z` タグを作成して push する
3. `release.yml` が arm64（`macos-15`）と x64（`macos-15-intel`）の DMG をビルドし、
   `Right-Stuff.Agent.IDE_X.Y.Z_aarch64.dmg` / `Right-Stuff.Agent.IDE_X.Y.Z_x64.dmg`
   として SHA-256 とともに GitHub Release へ添付する
4. リリースノートは `.github/release-notes-vX.Y.Z.md` があればそれを使い、
   なければ自動生成する

タグ push 前に DMG を確認したい場合は、手動でビルドする。

```bash
export PATH="$HOME/.cargo/bin:$PATH"
npm run tauri build -- --target aarch64-apple-darwin
npm run tauri build -- --target x86_64-apple-darwin
```

x86_64 ビルドには `rustup target add x86_64-apple-darwin` が必要。
ツールチェーンは `PATH="$HOME/.cargo/bin:$PATH"` で実行する。

CI を使わずにリリースする場合のフォールバック:

1. DMG を `Right-Stuff.Agent.IDE_X.Y.Z_aarch64.dmg` / `Right-Stuff.Agent.IDE_X.Y.Z_x64.dmg` にリネームする
2. SHA-256 とサイズを `.github/release-notes-vX.Y.Z.md` に追記する
3. `gh release create vX.Y.Z --notes-file .github/release-notes-vX.Y.Z.md` でアップロードする

署名と公証は Apple Developer Program 加入後に CI へ追加する。手順は
[docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) を参照。

### 実機検証（v0.3.7 / Intel）

2026-11-06 に Intel Core i7-1068NG7 / macOS 15.8.3（x86_64）で確認した。

- DMG: `Right-Stuff.Agent.IDE_0.3.7_x64.dmg`
- SHA-256: `43890b975320f8704aa63f11e2ccc6e5226f50377961a63b67f2866f37018570`（リリースノートと一致）
- 実行ファイル: `Mach-O 64-bit executable x86_64`、`CFBundleShortVersionString` は `0.3.7`、最低 OS は `11.0`
- 署名: 未署名（`codesign` は "code object is not signed at all"、`spctl` は "rejected: no usable signature"）
- 起動: `/Applications` へコピー後に起動し、ファイルツリー、Monaco エディタ、Agent パネルの各タブ、ステータスバーの `v0.3.7` を確認
- 注意: 検証では `curl` で DMG を取得したため quarantine 属性が付かず、Gatekeeper の「開く」操作は不要だった。ブラウザから取得した DMG では警告が出る
- 初回起動時にウィンドウがプライマリモニタ以外の位置（`position: 45, -1086`）に開いたため、起動位置をプライマリモニタ中央に固定し、画面外なら補正する仕組みを追加した（v0.3.8）

### 実機検証（v0.4.1 / Intel）

2026-11-21 に Intel Core i7-1068NG7 / macOS 15.8.4（x86_64）で確認した。

- DMG: `Right-Stuff.Agent.IDE_0.4.1_x64.dmg`（10,014,742 bytes、9.55 MiB）
- SHA-256: `510aa36153b1c8962ede61d8789d6cb7f61ff817c92310eb2b8ed2906080eabc`
- 実行ファイル: `Mach-O 64-bit executable x86_64`、`CFBundleShortVersionString` は `0.4.1`、最低 OS は `11.0`
- 署名: 未署名（`codesign` は "code object is not signed at all"）
- 起動: DMG をマウントして `/Applications` へコピー後に起動し、ワークスペース、Monaco エディタ、Agent パネル、ステータスバーの `v0.4.1` を確認
- スナップショット確認: 実行ファイルに「スナップショットの取得はキャンセルされました」「機密ウィンドウの自動マスクを行いません」の文字列が含まれることを確認。UI からのダイアログ操作は未確認
- arm64 DMG: GitHub Actions の `release.yml` で生成する（ローカルでは x64 のみ確認）

### 実機検証（v0.3.9 / Intel）

2026-11-19 に Intel Core i7-1068NG7 / macOS 15.8.4（x86_64）で確認した。

- DMG: `Right-Stuff.Agent.IDE_0.3.9_x64.dmg`（9,755,017 bytes、9.3 MB）
- SHA-256: `568334e522ce4d1abac24151c1842f29b8f67219320032cb6f78011d5e925503`
- 実行ファイル: `Mach-O 64-bit executable x86_64`、`CFBundleShortVersionString` は `0.3.9`、最低 OS は `11.0`
- 署名: 未署名（`codesign` は "code object is not signed at all"）
- 起動: DMG をマウントして一時フォルダへコピー後に起動し、ワークスペース、Monaco エディタ、Agent パネル、ステータスバーの `v0.3.9` を確認
- arm64 DMG: `Right-Stuff.Agent.IDE_0.3.9_aarch64.dmg`（9,270,976 bytes、8.8 MB）、SHA-256 `cd995e234dae5a645bc16723480dab072a1aff27b4dc062f942df4f0ba5ae972`、`Mach-O 64-bit executable arm64`、ad-hoc 署名

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
- `skills/exec.rs` が独立プロセスグループ、タイムアウト、出力上限を共通化する。キャンセルも同じループで検知し、`process_group(0)` のグループごと SIGKILL する。
- `skill_run` / `skill_verify` は UI 発行の `runId` を任意で受け取り、`AppState::skill_runs` に `CancelFlag` を登録する。登録は RAII ガードで外れ、`skill_cancel` は `runId` 指定または全件停止に使う。`editor.*` / `git.*` / `debug.*` は同期ハンドラのため途中停止できない。
- DAP は `rpc.rs` の request/response 相関とイベント購読を使い、Debug タブと同じセッションを共有する。
- マニフェストから任意のコマンド文字列は受け取らない。実行は Rust の固定ハンドラと許可リストだけが行う。
- `package.json` の `overrides.minimatch` は、ESLint / typescript-eslint が参照する推移的依存を 11.0.3 以上に固定するためのもの。上流が同等以上を解決するようになったら削除を検討する。
- メインウィンドウは `tauri.conf.json` の `center: true` でプライマリモニタの作業領域中央に開く。起動時に `window_state::ensure_on_screen` で接続中モニタの `work_area` と比較し、タイトルバーが画面外ならプライマリモニタ中央へ移動する。これにより、切断済みディスプレイの座標が復元されても操作不能にならない。

## 関連ドキュメント

- [README.md](./README.md) — ユーザー向け概要
- [docs/FEATURES.md](./docs/FEATURES.md) — 機能詳細
- [docs/LIMITATIONS.md](./docs/LIMITATIONS.md) — 既知の制約
- [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) — ビルド・ツール導入・リリース
- [docs/OPENSHIP.md](./docs/OPENSHIP.md) — Openship 連携の採用理由
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — レイヤーとフロー
- [docs/SKILLS.md](./docs/SKILLS.md) — スキル設計
- [docs/API.md](./docs/API.md) — Tauri コマンド
- [docs/SECURITY.md](./docs/SECURITY.md) — セキュリティ
