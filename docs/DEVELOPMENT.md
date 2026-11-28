# 開発ガイド

ビルド、主要コマンド、ツールの導入、配布の手順をまとめます。設計は
[ARCHITECTURE.md](./ARCHITECTURE.md)、スキルは [SKILLS.md](./SKILLS.md) を参照してください。

## 前提条件

| ツール | 必要バージョン | 確認コマンド |
|---|---:|---|
| macOS | 11 以降 | `sw_vers` |
| Node.js | `^20.19.0 \|\| >=22.12.0`（`.nvmrc` は 24） | `node --version` |
| Rust | 1.88 以降（edition 2024、let chains） | `rustc --version` |
| Xcode Command Line Tools | — | `xcode-select -p` |

開発機の実測値は macOS 15.8.4 / Intel Core i7、Node.js 22.17、Rust 1.94.1 です。
CI は Node.js 24 と Rust stable を使い、フロントエンドを Ubuntu、Rust を macOS ランナーで検証します。

## ビルドと起動

```bash
git clone https://github.com/watanabe3tipapa/right-stuff-agent-ide.git
cd right-stuff-agent-ide
npm ci
```

ネイティブウィンドウで起動します。

```bash
npm run tauri dev
```

Vite は `http://localhost:1420` で起動し、Tauri がネイティブウィンドウで読み込みます。
前回のワークスペースがあれば自動で開きます。

アプリをビルドします。

```bash
npm run tauri build
open "src-tauri/target/release/bundle/macos/Right-Stuff Agent IDE.app"
```

Apple Silicon 上で Intel (x86_64) 向けにクロスビルドする場合:

```bash
rustup target add x86_64-apple-darwin
npm run tauri build -- --target x86_64-apple-darwin
```

成果物は `src-tauri/target/x86_64-apple-darwin/release/bundle/` に出力されます。
`cargo` が Homebrew の Rust を指していると x86_64 の標準ライブラリが見つからず失敗するため、
rustup のツールチェーンを使用してください（例: `PATH="$HOME/.cargo/bin:$PATH"`）。

バンドルを作らずにデバッグビルドだけ確認する場合:

```bash
npm run tauri build -- --debug --no-bundle
./src-tauri/target/debug/right-stuff-agent-ide
```

## 主要コマンド

| コマンド | 用途 |
|---|---|
| `npm run tauri dev` | ネイティブウィンドウで開発起動（HMR） |
| `npm run dev` | Vite 開発サーバーのみ起動（ブラウザデモ） |
| `npm run build` | 型検査 + フロントエンドを `dist/` へビルド |
| `npm run typecheck` | TypeScript の型検査 |
| `npm run lint` | ESLint による静的解析 |
| `npm test` | Vitest による単体テスト |
| `npm run glossary` | 日本語表記の用語集チェック |
| `npm run check` | 型検査 + `cargo check` |
| `npm run tauri build` | macOS アプリ（`.app` / `.dmg`）をビルド |
| `npm run preview` | `dist/` をローカルでプレビュー |
| `npm run screenshots` | LP 用スクリーンショットと OGP 画像を再生成（Chrome headless） |

Rust 側の確認:

```bash
export PATH="$HOME/.cargo/bin:$PATH"
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

## 依存関係の監査

```bash
npm audit
cargo install cargo-audit --locked   # 初回のみ
cargo audit --file src-tauri/Cargo.lock
```

GitHub Actions の `Dependency audit (RustSec)` ジョブでも同じ監査を実行します。
npm と Cargo の依存更新は Dependabot が週次で提案します。

## Agent Desktop の指定

`agent-desktop` が `PATH` にない場合は、環境変数でバイナリを指定します。

```bash
AGENT_DESKTOP_BIN=/path/to/agent-desktop npm run tauri dev
```

検出順:

1. 環境変数 `AGENT_DESKTOP_BIN`
2. `PATH` 上の `agent-desktop`
3. `PATH` 上の `agent-desktop-cli`
4. `PATH` 上の `agent`

## LSP / DAP ツール

Language Server とデバッグアダプターは、アプリが固定レジストリから検出します。
導入されていない場合は、設定ダイアログの「ツール」タブ、またはステータスバーの LSP 表示から状態を確認できます。

| 言語 | Language Server | 導入例 |
|---|---|---|
| Rust | `rust-analyzer` | `rustup component add rust-analyzer` |
| TypeScript / JavaScript | `typescript-language-server` | `npm install -g typescript-language-server typescript` |
| Python | `pyright-langserver` | `npm install -g pyright` |
| Go | `gopls` | `go install golang.org/x/tools/gopls@latest` |
| C / C++ / Objective-C | `clangd` | `xcode-select --install` |
| Swift | `sourcekit-lsp` | `xcode-select --install` |
| Lua | `lua-language-server` | `brew install lua-language-server` |

| デバッガ | 対象 | 導入例 |
|---|---|---|
| `lldb-dap` | C / C++ / Rust / Swift / Objective-C | `xcode-select --install`（`xcrun -f lldb-dap` でも解決） |
| `debugpy` | Python | `pip install debugpy` |

GUI から起動したアプリでは `PATH` が限られるため、検出時は `/opt/homebrew/bin`、
`/usr/local/bin`、`/usr/bin`、`~/.cargo/bin` も確認します。

## ブラウザデモと Vercel

```bash
npm run dev
```

`http://localhost:1420` で、`src/lib/demo.ts` のデモ用ワークスペースを使って UI を操作できます。
編集内容・履歴・スキルポリシーはブラウザの localStorage に保存され、デモバーの「初期状態に戻す」で削除できます。
LLM・Git・ターミナル・OS 操作は Tauri 版のみです。

ランディングページとブラウザデモは Vercel で公開しています。

| URL | 内容 |
|---|---|
| https://right-stuff-agent-ide.vercel.app/ | ランディングページ |
| https://right-stuff-agent-ide.vercel.app/app/ | ブラウザデモ |

```bash
npm run build:vercel   # dist-vercel/ を生成（LP + /app/）
vercel                 # プレビュー環境へデプロイ
vercel --prod          # 本番環境へデプロイ
```

`vercel.json` がビルドコマンドと出力先を定義しています。デモはブラウザ内で動作し、
編集内容・履歴・スキルポリシーはそのブラウザの localStorage に保存されます。サーバーへは送信しません。

### PWA

ブラウザデモは PWA としてインストールできます。`public/manifest.webmanifest`、`public/sw.js`、
`public/offline.html`、`public/icons/` を Vite が `/app/` 配下へコピーし、
`src/main.tsx` が本番ビルドかつ Tauri 外のときだけ service worker を登録します。

| 対象 | 戦略 |
|---|---|
| ナビゲーション（`/app/`） | network-first。成功時にキャッシュし、失敗時はキャッシュ → オフラインページの順にフォールバック |
| ハッシュ付きアセット、アイコン、manifest | cache-first。初回取得後にキャッシュ |
| 更新 | 新しい service worker は待機し、既存タブを閉じた後に有効化。キャッシュ名はバージョン付きで、古いキャッシュは activate 時に削除 |

Tauri 版はカスタムプロトコルから読み込むため、service worker を登録しません。

## ディレクトリ構成

```text
src/
├── components/                     # React UI
│   ├── EditorPane.tsx              # Monaco / タブ / Markdown 分割プレビュー
│   ├── FileTree.tsx                # ワークスペースツリーとファイル操作
│   ├── AgentPanel.tsx              # OpenCode / Chat / Plan / Skills / Git / Debug / Deploy / Audit / Runtime
│   ├── OpenCodePanel.tsx           # OpenCode (ACP) の起動・対話・ストリーミング
│   ├── OpenCodeSettings.tsx        # OpenCode 実行ファイルのパス設定と検出結果
│   ├── PlanPanel.tsx               # 計画の生成・承認・実行
│   ├── SkillsPanel.tsx             # スキル実行・検証・HTML レポート
│   ├── AutoFixCard.tsx             # 検証失敗からの自動修正
│   ├── VerificationDetails.tsx     # 検証チェックの表示
│   ├── SkillLibrary.tsx            # スキルライブラリの別窓
│   ├── GitPanel.tsx                # Git の状態・差分・コミット
│   ├── DebugPanel.tsx              # DAP デバッグ
│   ├── QuickOpen.tsx               # ⌘P クイックオープン
│   ├── TerminalDock.tsx            # ⌘J 統合ターミナル (xterm.js)
│   ├── DeployPanel.tsx             # Openship の履歴・ログ・デプロイ
│   ├── AuditPanel.tsx              # 監査ログの一覧
│   ├── AgentPolicySettings.tsx     # エージェントポリシー設定
│   ├── OpenShipSettings.tsx        # Openship 接続・PAT 設定
│   ├── SettingsDialog.tsx          # 設定ダイアログ
│   ├── CommandPalette.tsx          # ⌘K コマンドパレット
│   ├── HistoryDialog.tsx           # バージョン履歴
│   ├── UnsavedChangesDialog.tsx    # 未保存変更の保存 / 破棄 / キャンセル
│   └── ConfirmDialog.tsx           # 確認モーダル
├── lib/
│   ├── api.ts                      # Tauri invoke ラッパー
│   ├── demo.ts                     # ブラウザ用デモ・ワークスペース
│   ├── demoStorage.ts              # デモの localStorage 保存・復元・検証
│   ├── llm.ts                      # LLM プロンプト・リクエスト変換
│   ├── plan.ts                     # 計画プロンプト・JSON 解析・引数検証
│   ├── autofix.ts                  # 自動修正の文脈収集・プロンプト・検証
│   ├── policy.ts                   # ポリシー既定値・表示ラベル
│   ├── skillLibrary.ts             # スキルライブラリ定義
│   ├── skillWindow.ts              # スキルライブラリの別窓
│   ├── report.ts                   # スキル実行の HTML レポート生成
│   ├── lsp.ts / lspMapping.ts      # LSP クライアントと Monaco 変換
│   ├── dap.ts                      # DAP クライアント
│   └── monaco.ts                   # Monaco テーマ・ワーカー設定
├── shared/types.ts                 # フロントエンド / バックエンド共有型
└── stores/                         # Zustand (workspace / editor / agent / git / lsp / dap)

src-tauri/
├── src/
│   ├── commands/                   # workspace / editor / agent / policy / llm / openship / opencode / git / terminal / lsp / dap / skills / report / settings / app
│   ├── skills/                     # mod / editor / git / japanese / terminal / debug / exec / params / policy / verify
│   ├── db.rs                       # SQLite (WAL) 履歴・設定・監査ログ
│   ├── mcp_server.rs               # IDE MCP サーバー (HTTP / 127.0.0.1 / Bearer)
│   ├── opencode.rs                 # OpenCode ACP クライアント
│   ├── paths.rs                    # パス検証
│   ├── rpc.rs                      # LSP / DAP の JSON-RPC トランスポート
│   ├── state.rs                    # AppState
│   └── lib.rs                      # コマンド登録
├── icons/
└── tauri.conf.json                 # ウィンドウ・バンドル設定

.agents/skills/                     # スキル定義 (JSON)
.agents/reports/                    # スキル実行の HTML レポート
docs/                               # アーキテクチャ / API / スキル / セキュリティ / 用語集
docs/diagrams/                      # archify 構成図（JSON / HTML / PNG）
scripts/check-glossary.mjs          # 用語集チェック
templates/open-vibecoding-ja/       # 日本語テンプレート（静的）
public/screenshots/                 # LP / README 用スクリーンショット
public/rs-mark.svg                  # アプリアイコン原画
right-stuff-agent-ide-implementation-plan.html
right-stuff-agent-ide-lp.html
DEV-MEMO.md                         # リリース履歴・開発手順
```

## バージョン更新

リリース時は次のファイルの `version` を揃えます。

- `package.json`
- `package-lock.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `src-tauri/tauri.conf.json`
- `src/components/StatusBar.tsx`
- `src/lib/demo.ts`
- `.github/ISSUE_TEMPLATE/bug_report.yml`

README / README.en / LP / 実装設計書 / docs のバージョン表記と DMG 名も更新します。

## リリース

`v*` タグを push すると [release.yml](../.github/workflows/release.yml) が起動し、
arm64 と x64 の DMG をビルドして SHA-256 とともに GitHub Release へ添付します。

```bash
git tag v0.4.3
git push origin v0.4.3
```

リリースノートは `.github/release-notes-vX.Y.Z.md` があればそれを使い、なければ自動生成します。
ジョブは GitHub ホステッドランナー（arm64 は `macos-15`、x64 は `macos-15-intel`）で動きます。

### 手動リリース（フォールバック）

CI を使わずにリリースする場合:

```bash
export PATH="$HOME/.cargo/bin:$PATH"
npm run tauri build -- --target aarch64-apple-darwin
npm run tauri build -- --target x86_64-apple-darwin
```

DMG を `Right-Stuff.Agent.IDE_X.Y.Z_aarch64.dmg` / `Right-Stuff.Agent.IDE_X.Y.Z_x64.dmg`
にリネームし、SHA-256 とサイズを `.github/release-notes-vX.Y.Z.md` に追記してから
`gh release create vX.Y.Z --notes-file .github/release-notes-vX.Y.Z.md` でアップロードします。

x86_64 ビルドには `rustup target add x86_64-apple-darwin` が必要です。
ツールチェーンは `PATH="$HOME/.cargo/bin:$PATH"` で実行してください。

### 署名と公証

現時点では Developer ID 署名と公証を行っていません。Apple Developer Program に加入したら、
CI に証明書と notarytool の資格情報を追加し、`codesign` / `xcrun notarytool submit` /
`xcrun stapler staple` をビルド後に実行します。
