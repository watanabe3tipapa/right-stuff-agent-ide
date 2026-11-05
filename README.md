# right-stuff-agent-ide

**日本語** | [English](./README.en.md)

**書く、任せる、確かめる。エージェントとワークスペースを、ひとつの画面へ。**

right-stuff-agent-ide は、Tauri 2.0 + React 18 で構築した macOS 専用のデスクトップ IDE です。[Right-Stuff Editor](https://github.com/watanabe3tipapa/right-stuff-editor-desktop) の執筆体験と [Agent Desktop](https://github.com/vercel-labs/agent-desktop) の OS レベル操作を統合し、Markdown の編集からエージェントによるアプリ操作までを同じワークスペースで扱います。

> **位置付け:** 開発の主力は Tauri 2.0 のネイティブアプリで、GitHub Releases の DMG からインストールできます。Vercel で公開している LP とブラウザデモは、インストールせずに UI を試すためのサンプル（参考実装）です。

> **ファイルは手元に、操作は見える形で。** 原稿は選んだフォルダのファイルに残り、エージェントが実行したコマンドと結果は UI に表示されます。アカウント登録、テレメトリ、クラウド同期はありません。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/watanabe3tipapa/right-stuff-agent-ide/actions/workflows/ci.yml/badge.svg)](https://github.com/watanabe3tipapa/right-stuff-agent-ide/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-v0.3.0-blue.svg)](https://github.com/watanabe3tipapa/right-stuff-agent-ide/releases)
[![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg)](https://github.com/watanabe3tipapa/right-stuff-agent-ide)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8DB.svg)](https://tauri.app/)
[![Phase](https://img.shields.io/badge/local--first-openship-orange.svg)](https://github.com/watanabe3tipapa/right-stuff-agent-ide)
[![Vercel](https://img.shields.io/badge/Vercel-live-black.svg)](https://right-stuff-agent-ide.vercel.app/)
[![GitHub issues](https://img.shields.io/github/issues/watanabe3tipapa/right-stuff-agent-ide.svg)](https://github.com/watanabe3tipapa/right-stuff-agent-ide/issues)

**クイックリンク:** [公開サイト](https://right-stuff-agent-ide.vercel.app/) · [ブラウザデモ](https://right-stuff-agent-ide.vercel.app/app/) · [設計書](./right-stuff-agent-ide-implementation-plan.html) · [アーキテクチャ](./docs/ARCHITECTURE.md) · [API](./docs/API.md) · [セキュリティ](./docs/SECURITY.md) · [Issues](https://github.com/watanabe3tipapa/right-stuff-agent-ide/issues) · [Releases](https://github.com/watanabe3tipapa/right-stuff-agent-ide/releases)

## ダウンロード

v0.3.0 は [GitHub Releases](https://github.com/watanabe3tipapa/right-stuff-agent-ide/releases) の DMG（Apple Silicon / Intel）またはソースからのビルドで利用できます。ソースからビルドする手順は「インストールとビルド」を参照してください。

- Apple Silicon (arm64): `Right-Stuff.Agent.IDE_0.3.0_aarch64.dmg`
- Intel (x86_64): `Right-Stuff.Agent.IDE_0.3.0_x64.dmg`

対応 OS は **macOS 11 以降（Apple Silicon / Intel）のみ**です。Windows / Linux 版は提供しません。

> DMG は Apple Developer ID 署名・公証を受けていません（arm64 は ad-hoc 署名、x64 は未署名）。初回起動時に警告が出た場合は、アプリを右クリック →「開く」を選択してください。Apple Silicon で x64 版を使う場合は Rosetta 2 が必要です。

## コンセプト

### なぜ「Agent IDE」なのか

エディタとエージェントは、これまで別々の画面にありました。書いた仕様をエージェントへ渡し、その実行結果を確認するには、ウィンドウを何度も行き来する必要があります。Agent IDE はその境界を取り除き、**ワークスペースとエージェントの操作履歴を同じ画面**に置きました。

Phase 0 では、その土台となるワークスペース、エディタ、履歴、Agent Desktop ブリッジを実装しています。Phase 1 では、OpenAI 互換 API への接続、OS キーチェーンへの API キー保存、ストリーミングチャットに加え、LLM による計画立案と計画単位の承認フロー、エージェントポリシー、監査ログを追加しました。ローカルファーストの Openship 連携も Deploy タブへ統合しています。Phase 2 では、クイックオープン、Git パネル、統合ターミナル (PTY) を追加し、編集・確認・実行を同じワークスペースで完結できるようにしました。

| 体験 | right-stuff-agent-ide の対応物 |
|---|---|
| 書く | Monaco による Markdown / コード編集、タブ、未保存管理 |
| 確かめる | GFM プレビューの分割表示、コマンドパレット、ステータスバー |
| 残す | ワークスペースへ直接保存、SQLite にバージョン履歴 |
| 守る | atomic write、パス検証、ゴミ箱へのソフトデリート |
| つなぐ | Agent Desktop CLI の検出、スナップショット、許可アクションの実行 |
| 任せる | LLM チャット（OpenAI 互換）、計画立案と計画単位の承認 |
| 広げる | クイックオープン、Git パネル、統合ターミナル (PTY)、LSP / DAP（今後） |

### 設計方針

1. **ファイルが主役** — アプリ独自のデータベースを原稿の正とせず、選んだフォルダのファイルを直接読み書きする
2. **操作を見える化** — エージェントが実行したコマンド、stdout / stderr、終了コードを UI に残す
3. **端末内で完結** — アカウント、テレメトリ、クラウド同期を持たない
4. **壊さない** — atomic write、ワークスペース外パスの拒否、削除時のゴミ箱退避
5. **自律性は段階的に** — Passive / Assistive / Autonomous の 3 モードで権限を切り替える

## 主な特徴

### 機能

- **ワークスペース** — フォルダを選択すると配下のファイルを再帰的に一覧表示。作成・名前変更・削除・再読み込みに対応。前回のワークスペースは次回起動時に復元
- **エディタ** — Monaco 0.52 によるシンタックスハイライト、タブ、未保存インジケーター、`⌘S` / `⌘⇧S` 保存。ワークスペース切替時と全タブクローズ時は、未保存の変更を「保存して続行」「保存せず続行」「キャンセル」から選択できます。ウィンドウを閉じる場合と `⌘Q` でも同じ確認を行います
- **Markdown プレビュー** — `react-markdown` + `remark-gfm` による GFM プレビューを分割表示
- **バージョン履歴** — 保存のたびに SQLite (WAL) へ記録。ファイルあたり最新 100 版を保持し、任意の版をプレビューしてエディタへ復元
- **ファイル操作** — 新規作成、名前変更、削除。削除は `.right-stuff/trash/<timestamp>/` へ移動するソフトデリート
- **エージェントパネル** — Chat / Plan / Git / Deploy / Audit / Runtime の 6 タブ。Passive / Assistive / Autonomous のモード切替、`/status`・`/snapshot`・`/plan`・`/ship`・`/deploy`・`/logs`・`/rollback` コマンド
- **クイックオープン** — `⌘P` でワークスペース内のファイルを名前から絞り込み、キーボードだけで開けます
- **Git パネル** — 現在のブランチ、ahead / behind、変更・ステージ済み・未追跡を表示。ステージ / アンステージ、一括操作、差分プレビュー、コミット、直近の履歴に対応。Git リポジトリでないフォルダでは `git init` を実行できます
- **統合ターミナル** — `⌘J` でワークスペース直下に PTY を開き、xterm.js で対話的に操作。リサイズ、再起動、クリアに対応し、シェルは `RIGHT_STUFF_SHELL` → `SHELL` → `/bin/zsh` の順で解決します
- **LLM チャット** — OpenAI / Ollama / LM Studio / OpenRouter などの OpenAI 互換 API に接続。ストリーミング表示、生成停止、接続テストに対応。API キーは OS キーチェーンに保存
- **計画立案と承認** — 意図を入力すると LLM が Agent Desktop の許可アクションだけを使った実行計画を生成。手順ごとの引数検証、計画単位の承認、Assistive での個別実行、Autonomous での連続実行に対応。モデルが生成した不正なアクションや引数は実行前に拒否
- **承認監査ログ** — 計画の作成・承認・却下・中止、操作の実行・拒否・キャンセル、ポリシー変更、Openship のデプロイ・ロールバックをローカルの SQLite に記録。Audit タブで新しい順に確認でき、保持期間（既定 30 日）を過ぎた記録と最新 5,000 件を超えた記録は自動で削除
- **Openship 連携（ローカルファースト）** — Deploy タブからデプロイ履歴・ログ・ロールバックを操作。`openship` CLI を検出できれば CLI を優先し、未検出または失敗時のみセルフホスト REST API にフォールバック。接続設定は SQLite、PAT は OS キーチェーンに保存し、変更操作は必ずネイティブ承認ダイアログを通ります。構成図は [docs/diagrams/openship-local-first.html](./docs/diagrams/openship-local-first.html)
- **エージェントポリシー** — 読み取り専用アクションは「許可 / 確認 / 禁止」、変更アクションは「確認 / 禁止」から選択。変更アクションのネイティブ承認を省略することはできず、ポリシーで禁止した操作は Rust 側で実行前に拒否
- **Agent Desktop ブリッジ** — `agent-desktop` CLI を検出し、許可されたアクションのみ実行。コマンドと出力はそのまま UI に表示
- **コマンドパレット** — `⌘K` / `⌘⇧P` からワークスペース、エディタ、エージェント、Git、ターミナルの操作を検索して実行。`⌘P` はクイックオープン、`⌘J` はターミナルの表示切替
- **ネイティブダイアログ** — 確認と入力はアプリ内モーダルで統一。ブラウザのブロッキングダイアログを使わない
- **ブラウザデモ（サンプル）** — Tauri なしでも `npm run dev` でインメモリ・ワークスペース（デモ）を操作可能。Vercel ではインストールせずに UI を試せるサンプルとして公開
- **スキル定義** — `.agents/skills/*.json` にエージェント向けの操作定義を配置（スキル実行は未実装）
- **テーマ** — ダークテーマ、Overlay タイトルバー、macOS ネイティブウィンドウ

### アーキテクチャ

- **フロントエンド**: Vite 8 + React 18.3 + TypeScript 6
- **エディタ**: Monaco Editor 0.52（`@monaco-editor/react`）
- **状態管理**: Zustand 5（workspace / editor / agent / git）
- **デスクトップ基盤**: Tauri 2.0（Rust 2024 edition）
- **バックエンド**: Tauri コマンド（workspace / editor / agent / policy / llm / openship / git / terminal / settings / app）、パス検証、atomic write
- **Git / ターミナル**: `git` CLI を `std::process::Command` 経由で実行（シェル文字列を組み立てない）。ターミナルは `portable-pty` で PTY を確保し、出力を Tauri イベントで xterm.js へストリーミング
- **データベース**: SQLite（WAL、`rusqlite` bundled）。バージョン履歴、設定、監査ログを保存
- **ブリッジ**: `src/lib/api.ts` が `invoke` を薄くラップし、ブラウザでは `src/lib/demo.ts` にフォールバック
- **パッケージ**: `tauri build`（`.app` / `.dmg`）

### データとセキュリティ

- 原稿はワークスペースのファイルとして保存され、外部サーバーへ送信されません
- アカウント登録、テレメトリ、クラウド同期はありません
- ファイル操作は Rust 側で検証し、絶対パス、`..`、ワークスペース外への書き込みを拒否します
- シンボリックリンクはファイルツリーに列挙しません
- 書き込みは一時ファイル + `rename` の atomic write。削除はゴミ箱へ退避します
- Agent Desktop の実行はアクション名の許可リスト、引数の長さ・形式の検証、エージェントポリシー、変更操作のネイティブ承認ダイアログを通し、出力は 200,000 文字で打ち切ります
- Git 操作は `git` CLI をシェル経由せずに実行し、ステージ対象のパスはワークスペース内の相対パスに限定します。差分・コマンド出力は上限付きで UI に表示します
- 統合ターミナルは絶対パスのシェルのみを起動し、作業ディレクトリをワークスペース直下に固定します。PTY の入出力はローカルで完結し、外部へ送信しません
- 監査ログはローカルの SQLite にのみ保存し、外部へ送信しません。コマンド引数・出力・エラーの抜粋を含むため、バックアップや共有の際は注意してください
- スナップショットはメモリ上にのみ保持し、SQLite へ永続化しません
- API キーと Openship の PAT は OS キーチェーンにのみ保存し、SQLite・ログ・エラーメッセージには含めません。LLM と Openship への通信は Rust 側で行い、WebView から外部 API を直接呼びません
- Openship の REST 接続はセルフホストを想定し、`http://` は localhost / 127.0.0.1 / ::1 のみ許可します。デプロイ・ロールバックは Passive モードでは無効で、それ以外のモードでもネイティブ承認を省略できません
- CSP は Tauri（本番 / 開発で別ポリシー）と Vercel の両方に `default-src 'self'` ベースで設定しています
- 脆弱性は公開 Issue ではなく [SECURITY.md](./SECURITY.md) の非公開報告フォームから連絡してください
- 依存関係は Dependabot の週次更新とセキュリティ更新で追従し、CI で `cargo-audit` を実行します

## インストールとビルド

### 前提条件

| ツール | 必要バージョン | 確認コマンド |
|---|---:|---|
| macOS | 11 以降 | `sw_vers` |
| Node.js | `^20.19.0 \|\| >=22.12.0`（`.nvmrc` は 24） | `node --version` |
| Rust | >= 1.88（edition 2024、let chains） | `rustc --version` |
| Xcode Command Line Tools | — | `xcode-select -p` |

検証環境は macOS 27 / Node.js 26.9（CI は Node.js 24）/ Rust 1.99 です。

### 基本的な手順

1. リポジトリを取得

```bash
git clone https://github.com/watanabe3tipapa/right-stuff-agent-ide.git
cd right-stuff-agent-ide
```

2. 依存をインストール

```bash
npm ci
```

3. ネイティブウィンドウで起動

```bash
npm run tauri dev
```

Vite は `http://localhost:1420` で起動し、Tauri がネイティブウィンドウで読み込みます。前回のワークスペースがあれば自動で開きます。

4. アプリをビルド

```bash
npm run tauri build
open "src-tauri/target/release/bundle/macos/Right-Stuff Agent IDE.app"
```

Intel (x86_64) 向けにクロスビルドする場合（Apple Silicon 上）:

```bash
rustup target add x86_64-apple-darwin
npm run tauri build -- --target x86_64-apple-darwin
```

成果物は `src-tauri/target/x86_64-apple-darwin/release/bundle/` に出力されます。`cargo` が Homebrew の Rust を指していると x86_64 の標準ライブラリが見つからず失敗するため、rustup のツールチェーンを使用してください（例: `PATH="$HOME/.cargo/bin:$PATH"`）。

バンドルを作らずにデバッグビルドだけ確認する場合:

```bash
npm run tauri build -- --debug --no-bundle
./src-tauri/target/debug/right-stuff-agent-ide
```

### ブラウザで UI を確認

```bash
npm run dev
```

`http://localhost:1420` で、`src/lib/demo.ts` のインメモリ・ワークスペースを使って UI を操作できます。変更はページを再読み込みするとリセットされます。

### 主要コマンド

| コマンド | 用途 |
|---|---|
| `npm run tauri dev` | ネイティブウィンドウで開発起動（HMR） |
| `npm run dev` | Vite 開発サーバーのみ起動（ブラウザデモ） |
| `npm run build` | 型検査 + フロントエンドを `dist/` へビルド |
| `npm run typecheck` | TypeScript の型検査 |
| `npm run lint` | ESLint による静的解析 |
| `npm test` | Vitest による単体テスト |
| `npm run check` | 型検査 + `cargo check` |
| `npm run tauri build` | macOS アプリ（`.app` / `.dmg`）をビルド |
| `npm run preview` | `dist/` をローカルでプレビュー |

### 依存関係の監査

```bash
npm audit
cargo install cargo-audit --locked   # 初回のみ
cargo audit --file src-tauri/Cargo.lock
```

GitHub Actions の `Dependency audit (RustSec)` ジョブでも同じ監査を実行します。npm と Cargo の依存更新は Dependabot が週次で提案します。

### Agent Desktop の指定

`agent-desktop` が `PATH` にない場合は、環境変数でバイナリを指定します。

```bash
AGENT_DESKTOP_BIN=/path/to/agent-desktop npm run tauri dev
```

検出順:

1. 環境変数 `AGENT_DESKTOP_BIN`
2. `PATH` 上の `agent-desktop`
3. `PATH` 上の `agent-desktop-cli`
4. `PATH` 上の `agent`

## 使い方

1. 起動後、サイドバーのフォルダ名からワークスペースを選択します
2. 「＋」で新規ファイルを作成するか、ツリーからファイルを開きます
3. Monaco で編集します。未保存のタブにはインジケーターが付きます
4. `⌘S` で保存、`⌘⇧S` ですべて保存します
5. Markdown はツールバーのプレビュー切替で分割表示できます
6. 履歴ボタンから過去の版を確認し、必要ならエディタへ復元します（保存は `⌘S`）
7. `⌘K` でコマンドパレットを開き、操作を検索して実行します。`⌘P` のクイックオープンでファイル名から直接開けます
8. エージェントパネルの Git タブで変更を確認し、ステージ・コミット・差分・履歴を操作します
9. `⌘J` で統合ターミナルを開き、ワークスペース直下でコマンドを実行します
10. エージェントパネルで `/status` を実行し、Agent Desktop の検出状態を確認します
11. `/snapshot` でデスクトップのスナップショットを取得できます
12. Openship を使う場合は「設定 > Openship」で Base URL と PAT を登録するか、`openship` CLI を `PATH` に配置します。Deploy タブの「デプロイ」はネイティブ承認を経て実行され、履歴・ログ・ロールバックも同じ画面から操作できます

## 配布

- アプリ本体は Web 配信しません
- v0.3.0 は GitHub Releases の DMG とソースからのビルドの両方で利用できます
- DMG は Developer ID 署名・公証を受けていません（arm64 は ad-hoc 署名、x64 は未署名）。署名・公証は先送りとし、当面はこの状態で配布します
- 対応 OS は macOS 11 以降（Apple Silicon / Intel）のみです。Windows / Linux 版は提供しません

## サンプル公開（Vercel）

ランディングページとブラウザデモは、インストールせずに UI を試せるサンプルとして Vercel で公開中です。製品版は GitHub Releases の DMG で配布しており、開発の主力は Tauri 2.0 のネイティブアプリです。

| URL | 内容 |
|---|---|
| https://right-stuff-agent-ide.vercel.app/ | ランディングページ |
| https://right-stuff-agent-ide.vercel.app/app/ | ブラウザデモ |

リポジトリ内のパス:

| パス | 内容 |
|---|---|
| `/` | ランディングページ（`right-stuff-agent-ide-lp.html`） |
| `/app/` | ブラウザデモ（Vite ビルド、`src/lib/demo.ts` の仮想ワークスペース） |

```bash
npm run build:vercel   # dist-vercel/ を生成（LP + /app/）
vercel                 # プレビュー環境へデプロイ
vercel --prod          # 本番環境へデプロイ
```

`vercel.json` がビルドコマンドと出力先を定義しています。デモはブラウザ内のメモリ上で動作し、変更は保存されません。

## 既知の制約とロードマップ

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

### 次の候補

- [ ] スキル実行と検証ループ
- [ ] LSP / DAP
- [ ] Anthropic 固有 API のアダプター

### 制約

- 本アプリは macOS 専用です（macOS 11 以降）。Windows / Linux 版は提供しません。動作確認は macOS（Apple Silicon）のみで、Intel 実機での起動確認は未実施です。公証は先送りで、配布用 DMG は Developer ID 署名を受けていません（arm64 は ad-hoc 署名、x64 は未署名）
- `agent-desktop` CLI は同梱していません。別途インストールが必要です
- LLM は OpenAI 互換 API のみ対応します。Tauri 版では設定画面から接続できますが、ブラウザデモでは利用できません。Anthropic 固有 API は未対応です
- 計画の実行対象は Agent Desktop の許可アクションに限られます。エディタ・Git・ターミナルのスキル実行は未実装です
- Git パネルはローカルの `git` CLI を利用します。`git` がインストールされていない場合はエラーを表示します。マージ・リベース・プッシュなどの履歴操作は未対応です
- 統合ターミナルは Tauri 版でのみ利用できます。ブラウザデモでは Git とターミナルは無効です。PTY はアプリ終了時に停止します
- ターミナルのシェルは `RIGHT_STUFF_SHELL` または `SHELL` で変更できます。絶対パスで存在する実行ファイルのみ起動します
- 計画と実行結果はメモリ上にのみ保持され、再起動すると失われます。変更操作は計画承認後も、実行時に OS のネイティブ承認ダイアログで確認します（ポリシーで「許可」にすることはできません）
- 監査ログはローカルの SQLite に保存され、保持期間の既定は 30 日、上限は 5,000 件です。監査ログを無効にしても既存の記録は残ります
- スナップショットはメモリ上にのみ保持され、再起動すると失われます
- ブラウザデモの変更は永続化されません
- 同期・共同編集は提供していません
- macOS の Dock メニュー「終了」、ログアウト、再起動による終了は OS が直接アプリを終了するため、未保存確認の対象外です（`⌘Q` とアプリメニューの「終了」は確認します）
- 自動更新はありません

## ディレクトリ構成

```text
src/
├── components/                     # React UI
│   ├── EditorPane.tsx              # Monaco / タブ / Markdown 分割プレビュー
│   ├── FileTree.tsx                # ワークスペースツリーとファイル操作
│   ├── AgentPanel.tsx              # Chat / Plan / Git / Deploy / Audit / Runtime
│   ├── PlanPanel.tsx               # 計画の生成・承認・実行
│   ├── GitPanel.tsx                # Git の状態・差分・コミット
│   ├── QuickOpen.tsx               # ⌘P クイックオープン
│   ├── TerminalDock.tsx            # ⌘J 統合ターミナル (xterm.js)
│   ├── DeployPanel.tsx             # Openship の履歴・ログ・デプロイ
│   ├── AuditPanel.tsx              # 監査ログの一覧
│   ├── AgentPolicySettings.tsx     # エージェントポリシー設定
│   ├── OpenShipSettings.tsx        # Openship 接続・PAT 設定
│   ├── CommandPalette.tsx          # ⌘K コマンドパレット
│   ├── HistoryDialog.tsx           # バージョン履歴
│   ├── UnsavedChangesDialog.tsx    # 未保存変更の保存 / 破棄 / キャンセル
│   └── ConfirmDialog.tsx           # 確認モーダル
├── lib/
│   ├── api.ts                      # Tauri invoke ラッパー
│   ├── demo.ts                     # ブラウザ用インメモリ・ワークスペース
│   ├── llm.ts                      # LLM プロンプト・リクエスト変換
│   ├── plan.ts                     # 計画プロンプト・JSON 解析・引数検証
│   ├── policy.ts                   # ポリシー既定値・表示ラベル
│   └── monaco.ts                   # Monaco テーマ・ワーカー設定
├── shared/types.ts                 # フロントエンド / バックエンド共有型
└── stores/                         # Zustand (workspace / editor / agent / git)

src-tauri/
├── src/
│   ├── commands/                   # workspace / editor / agent / policy / llm / openship / git / terminal / settings / app
│   ├── db.rs                       # SQLite (WAL) 履歴・設定・監査ログ
│   ├── paths.rs                    # パス検証
│   ├── state.rs                    # AppState
│   └── lib.rs                      # コマンド登録
├── icons/
└── tauri.conf.json                 # ウィンドウ・バンドル設定

.agents/skills/                     # スキル定義 (JSON)
docs/                               # アーキテクチャ / API / セキュリティ
docs/diagrams/                      # archify 構成図（JSON / HTML / PNG）
public/openship-local-first.png     # LP 用の構成図プレビュー
public/diagrams/                    # 公開用のインタラクティブ構成図
public/rs-mark.svg                  # アプリアイコン原画
right-stuff-agent-ide-implementation-plan.html
right-stuff-agent-ide-lp.html
```

## ドキュメント

1. [SECURITY.md](./SECURITY.md) — 脆弱性報告、サポート対象、調査の範囲
2. [ARCHITECTURE.md](./docs/ARCHITECTURE.md) — レイヤー、プロセスモデル、保存フロー
3. [API.md](./docs/API.md) — Tauri コマンドと型
4. [docs/SECURITY.md](./docs/SECURITY.md) — パス検証、エージェント権限、保存データ
5. [実装設計書](./right-stuff-agent-ide-implementation-plan.html) — 全体設計とロードマップ
6. [Openship 構成図](./docs/diagrams/openship-local-first.html) — ローカルファーストのデプロイ経路（インタラクティブ）
7. [ランディングページ](./right-stuff-agent-ide-lp.html) — プロダクト概要（静的モック）
8. [README（English）](./README.en.md) — English overview

## ライセンス

MIT ライセンス — 詳細はリポジトリの [LICENSE](LICENSE) ファイルを参照してください。

RIGHT-STUFF AGENT IDE は個人プロジェクトです。Tauri、React、Monaco Editor、Agent Desktop はそれぞれのライセンスに従います。
