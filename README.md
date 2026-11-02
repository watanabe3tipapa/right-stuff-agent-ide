# right-stuff-agent-ide

**日本語** | [English](./README.en.md)

**書く、任せる、確かめる。エージェントとワークスペースを、ひとつの画面へ。**

right-stuff-agent-ide は、Tauri 2.0 + React 18 で構築した macOS 向けのデスクトップ IDE です。[Right-Stuff Editor](https://github.com/watanabe3tipapa/right-stuff-editor-desktop) の執筆体験と [Agent Desktop](https://github.com/vercel-labs/agent-desktop) の OS レベル操作を統合し、Markdown の編集からエージェントによるアプリ操作までを同じワークスペースで扱います。

> **位置付け:** 開発の主力は Tauri 2.0 のネイティブアプリです。Vercel で公開している LP とブラウザデモは、Tauri 版が公開できるまでのサンプル（参考実装）です。

> **ファイルは手元に、操作は見える形で。** 原稿は選んだフォルダのファイルに残り、エージェントが実行したコマンドと結果は UI に表示されます。アカウント登録、テレメトリ、クラウド同期はありません。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-v0.1.1-blue.svg)](https://github.com/watanabe3tipapa/right-stuff-agent-ide/releases)
[![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg)](https://github.com/watanabe3tipapa/right-stuff-agent-ide)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8DB.svg)](https://tauri.app/)
[![Phase](https://img.shields.io/badge/phase-1%20llm%20chat-orange.svg)](https://github.com/watanabe3tipapa/right-stuff-agent-ide)
[![Vercel](https://img.shields.io/badge/Vercel-live-black.svg)](https://right-stuff-agent-ide.vercel.app/)
[![GitHub issues](https://img.shields.io/github/issues/watanabe3tipapa/right-stuff-agent-ide.svg)](https://github.com/watanabe3tipapa/right-stuff-agent-ide/issues)

**クイックリンク:** [公開サイト](https://right-stuff-agent-ide.vercel.app/) · [ブラウザデモ](https://right-stuff-agent-ide.vercel.app/app/) · [設計書](./right-stuff-agent-ide-implementation-plan.html) · [アーキテクチャ](./docs/ARCHITECTURE.md) · [API](./docs/API.md) · [セキュリティ](./docs/SECURITY.md) · [Issues](https://github.com/watanabe3tipapa/right-stuff-agent-ide/issues) · [Releases](https://github.com/watanabe3tipapa/right-stuff-agent-ide/releases)

## ダウンロード

v0.1.1 は現在、ソースからのビルドを前提としています。配布用バイナリはまだ公開していません。

> ビルドは ad-hoc 署名です。Apple Developer ID 署名・公証は行っていません。初回起動時に警告が出た場合は、アプリを右クリック →「開く」を選択してください。

## コンセプト

### なぜ「Agent IDE」なのか

エディタとエージェントは、これまで別々の画面にありました。書いた仕様をエージェントへ渡し、その実行結果を確認するには、ウィンドウを何度も行き来する必要があります。Agent IDE はその境界を取り除き、**ワークスペースとエージェントの操作履歴を同じ画面**に置きました。

Phase 0 では、その土台となるワークスペース、エディタ、履歴、Agent Desktop ブリッジを実装しています。Phase 1 PR1 では、OpenAI 互換 API への接続、OS キーチェーンへの API キー保存、ストリーミングチャットを追加しました。LLM による計画立案と、計画単位の承認フローは Phase 1 の後半で追加します。

| 体験 | right-stuff-agent-ide の対応物 |
|---|---|
| 書く | Monaco による Markdown / コード編集、タブ、未保存管理 |
| 確かめる | GFM プレビューの分割表示、コマンドパレット、ステータスバー |
| 残す | ワークスペースへ直接保存、SQLite にバージョン履歴 |
| 守る | atomic write、パス検証、ゴミ箱へのソフトデリート |
| つなぐ | Agent Desktop CLI の検出、スナップショット、許可アクションの実行 |
| 任せる | LLM チャット（OpenAI 互換）、計画単位の承認フローは Phase 1 後半 |
| 広げる | ターミナル、Git、LSP / DAP（Phase 2 以降） |

### 設計方針

1. **ファイルが主役** — アプリ独自のデータベースを原稿の正とせず、選んだフォルダのファイルを直接読み書きする
2. **操作を見える化** — エージェントが実行したコマンド、stdout / stderr、終了コードを UI に残す
3. **端末内で完結** — アカウント、テレメトリ、クラウド同期を持たない
4. **壊さない** — atomic write、ワークスペース外パスの拒否、削除時のゴミ箱退避
5. **自律性は段階的に** — Passive / Assistive / Autonomous の 3 モードで権限を切り替える

## 主な特徴

### 機能

- **ワークスペース** — フォルダを選択すると配下のファイルを再帰的に一覧表示。作成・名前変更・削除・再読み込みに対応。前回のワークスペースは次回起動時に復元
- **エディタ** — Monaco 0.52 によるシンタックスハイライト、タブ、未保存インジケーター、`⌘S` / `⌘⇧S` 保存
- **Markdown プレビュー** — `react-markdown` + `remark-gfm` による GFM プレビューを分割表示
- **バージョン履歴** — 保存のたびに SQLite (WAL) へ記録。ファイルあたり最新 100 版を保持し、任意の版をプレビューしてエディタへ復元
- **ファイル操作** — 新規作成、名前変更、削除。削除は `.right-stuff/trash/<timestamp>/` へ移動するソフトデリート
- **エージェントパネル** — Chat / Runtime の 2 タブ。Passive / Assistive / Autonomous のモード切替、`/status`・`/snapshot` コマンド
- **LLM チャット** — OpenAI / Ollama / LM Studio / OpenRouter などの OpenAI 互換 API に接続。ストリーミング表示、生成停止、接続テストに対応。API キーは OS キーチェーンに保存
- **Agent Desktop ブリッジ** — `agent-desktop` CLI を検出し、許可されたアクションのみ実行。コマンドと出力はそのまま UI に表示
- **コマンドパレット** — `⌘K` / `⌘⇧P` からワークスペース、エディタ、エージェントの操作を検索して実行
- **ネイティブダイアログ** — 確認と入力はアプリ内モーダルで統一。ブラウザのブロッキングダイアログを使わない
- **ブラウザデモ（サンプル）** — Tauri なしでも `npm run dev` でインメモリのデモワークスペースを操作可能。Vercel では Tauri 版が公開できるまでのサンプルとして公開
- **スキル定義** — `.agents/skills/*.json` にエージェント向けの操作定義を配置（実行は Phase 1）
- **テーマ** — ダークテーマ、Overlay タイトルバー、macOS ネイティブウィンドウ

### アーキテクチャ

- **フロントエンド**: Vite 8 + React 18.3 + TypeScript 6
- **エディタ**: Monaco Editor 0.52（`@monaco-editor/react`）
- **状態管理**: Zustand 5（workspace / editor / agent）
- **デスクトップ基盤**: Tauri 2.0（Rust 2024 edition）
- **バックエンド**: Tauri コマンド（workspace / editor / agent / llm / settings / app）、パス検証、atomic write
- **データベース**: SQLite（WAL、`rusqlite` bundled）。バージョン履歴と設定を保存
- **ブリッジ**: `src/lib/api.ts` が `invoke` を薄くラップし、ブラウザでは `src/lib/demo.ts` にフォールバック
- **パッケージ**: `tauri build`（`.app` / `.dmg`）

### データとセキュリティ

- 原稿はワークスペースのファイルとして保存され、外部サーバーへ送信されません
- アカウント登録、テレメトリ、クラウド同期はありません
- ファイル操作は Rust 側で検証し、絶対パス、`..`、ワークスペース外への書き込みを拒否します
- シンボリックリンクはファイルツリーに列挙しません
- 書き込みは一時ファイル + `rename` の atomic write。削除はゴミ箱へ退避します
- Agent Desktop の実行はアクション名の許可リスト、引数の長さ・形式の検証、変更操作のネイティブ承認ダイアログを通し、出力は 200,000 文字で打ち切ります
- スナップショットはメモリ上にのみ保持し、SQLite へ永続化しません
- API キーは OS キーチェーンにのみ保存し、SQLite・ログ・エラーメッセージには含めません。LLM への通信は Rust 側で行い、WebView から外部 API を直接呼びません
- CSP は Tauri（本番 / 開発で別ポリシー）と Vercel の両方に `default-src 'self'` ベースで設定しています

## インストールとビルド

### 前提条件

| ツール | 必要バージョン | 確認コマンド |
|---|---:|---|
| macOS | 11 以降 | `sw_vers` |
| Node.js | `^20.19.0 \|\| >=22.12.0`（`.nvmrc` は 24） | `node --version` |
| Rust | >= 1.85（edition 2024） | `rustc --version` |
| Xcode Command Line Tools | — | `xcode-select -p` |

検証環境は macOS 15 / Node.js 22.17（CI は Node.js 24）/ Rust 1.94 です。

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
7. `⌘K` でコマンドパレットを開き、操作を検索して実行します
8. エージェントパネルで `/status` を実行し、Agent Desktop の検出状態を確認します
9. `/snapshot` でデスクトップのスナップショットを取得できます

## 配布

- アプリ本体は Web 配信しません
- v0.1.1 はソースからのビルドのみを想定しています
- GitHub Releases での配布は準備中です
- 署名は ad-hoc です。Developer ID 署名・公証は行っていません
- macOS（Apple Silicon / Intel）を対象としています

## サンプル公開（Vercel）

ランディングページとブラウザデモは、Tauri 版が公開できるまでのサンプルとして Vercel で公開中です。製品版の開発は Tauri 2.0 のネイティブアプリが中心です。

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

- [ ] 計画立案と計画単位の承認フロー
- [ ] 承認履歴の監査ログとポリシー設定 UI
- [ ] スキル実行と検証ループ
- [ ] ターミナル (PTY)、Git、LSP / DAP
- [ ] Anthropic 固有 API のアダプター
- [ ] リリースパッケージング（署名・公証・DMG）
- [ ] Windows / Linux 対応

### 制約

- 動作確認は macOS のみです。配布用の署名・公証は未対応です
- `agent-desktop` CLI は同梱していません。別途インストールが必要です
- LLM は OpenAI 互換 API のみ対応します。Tauri 版では設定画面から接続できますが、ブラウザデモでは利用できません。Anthropic 固有 API、計画立案、計画単位の承認は未実装です
- スナップショットはメモリ上にのみ保持され、再起動すると失われます
- ブラウザデモの変更は永続化されません
- 同期・共同編集は提供していません
- 自動更新はありません

## ディレクトリ構成

```text
src/
├── components/                     # React UI
│   ├── EditorPane.tsx              # Monaco / タブ / Markdown 分割プレビュー
│   ├── FileTree.tsx                # ワークスペースツリーとファイル操作
│   ├── AgentPanel.tsx              # Chat / Runtime
│   ├── CommandPalette.tsx          # ⌘K コマンドパレット
│   ├── HistoryDialog.tsx           # バージョン履歴
│   └── ConfirmDialog.tsx           # 確認モーダル
├── lib/
│   ├── api.ts                      # Tauri invoke ラッパー
│   ├── demo.ts                     # ブラウザ用インメモリワークスペース
│   └── monaco.ts                   # Monaco テーマ・ワーカー設定
├── shared/types.ts                 # フロントエンド / バックエンド共有型
└── stores/                         # Zustand (workspace / editor / agent)

src-tauri/
├── src/
│   ├── commands/                   # workspace / editor / agent / settings / app
│   ├── db.rs                       # SQLite (WAL) 履歴・設定
│   ├── paths.rs                    # パス検証
│   ├── state.rs                    # AppState
│   └── lib.rs                      # コマンド登録
├── icons/
└── tauri.conf.json                 # ウィンドウ・バンドル設定

.agents/skills/                     # スキル定義 (JSON)
docs/                               # アーキテクチャ / API / セキュリティ
public/rs-mark.svg                  # アプリアイコン原画
right-stuff-agent-ide-implementation-plan.html
right-stuff-agent-ide-lp.html
```

## ドキュメント

1. [ARCHITECTURE.md](./docs/ARCHITECTURE.md) — レイヤー、プロセスモデル、保存フロー
2. [API.md](./docs/API.md) — Tauri コマンドと型
3. [SECURITY.md](./docs/SECURITY.md) — パス検証、エージェント権限、保存データ
4. [実装設計書](./right-stuff-agent-ide-implementation-plan.html) — 全体設計とロードマップ
5. [ランディングページ](./right-stuff-agent-ide-lp.html) — プロダクト概要（静的モック）
6. [README（English）](./README.en.md) — English overview

## ライセンス

MIT ライセンス — 詳細はリポジトリの [LICENSE](LICENSE) ファイルを参照してください。

RIGHT-STUFF AGENT IDE は個人プロジェクトです。Tauri、React、Monaco Editor、Agent Desktop はそれぞれのライセンスに従います。
