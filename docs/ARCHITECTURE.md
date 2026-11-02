# Architecture

## レイヤー

```
┌──────────────────────────────────────────────────────────┐
│ Presentation (React 18 + Vite + TypeScript)              │
│  FileTree / EditorPane (Monaco) / AgentPanel / StatusBar │
├──────────────────────────────────────────────────────────┤
│ Frontend Bridge (src/lib/api.ts)                         │
│  Tauri invoke ラッパー + ブラウザ用デモフォールバック        │
├──────────────────────────────────────────────────────────┤
│ Tauri Commands (src-tauri/src/commands)                  │
│  workspace / editor / agent / settings / app             │
├──────────────────────────────────────────────────────────┤
│ Core Engine                                              │
│  paths (検証) / db (SQLite WAL) / atomic write            │
├──────────────────────────────────────────────────────────┤
│ OS Integration                                           │
│  Agent Desktop CLI (snapshot / action / verify)          │
└──────────────────────────────────────────────────────────┘
```

## プロセスモデル

- WebView が UI を描画し、`invoke` で Rust 側のコマンドを呼び出す。
- ファイル I/O と SQLite は Rust プロセス内で完結する。
- Agent Desktop は Rust から子プロセスとして起動する。stdout / stderr はそのまま UI に返す。
- ブラウザで `npm run dev` した場合、`src/lib/demo.ts` の仮想ワークスペースに切り替わる。

## 状態

| 場所 | 内容 |
| --- | --- |
| `AppState.root` | 現在のワークスペース (canonical path) |
| `AppState.db` | SQLite 接続 (履歴・設定) |
| `workspaceStore` | ツリー、選択、展開状態 |
| `editorStore` | 開いているタブ、未保存内容、履歴モーダル |
| `agentStore` | モード、Agent Desktop の検出状態、チャット、計画と実行状態 |

`localStorage` に保存するのはエージェントモードのみ。それ以外の永続データは
SQLite (`right-stuff.db`) とワークスペース内のファイルに置く。

## 保存フロー

```
編集 (Monaco onChange)
  → editorStore.updateContent (dirty = content !== savedContent)
  → ⌘S / 保存ボタン
  → workspace_write_file
      → resolve_new (ワークスペース外を拒否)
      → 一時ファイルへ書き込み → rename (atomic write)
      → db::record_version (最新 100 版を保持)
  → savedContent を更新して dirty を解除
```

保存中にユーザーが編集を続けた場合、書き込んだ内容と現在の内容が一致するまで
dirty を維持する（保存済みと誤判定して未保存の入力を失わない）。

ワークスペース切替と「すべてのタブを閉じる」は `confirmUnsavedChanges` を通す。
未保存のタブがある場合は「保存して続行」「保存せず続行」「キャンセル」を提示し、
キャンセルまたは保存失敗時は破壊的な操作を実行しない。

## 終了時の未保存確認

```
ウィンドウを閉じる (onCloseRequested)
  → event.preventDefault()
  → confirmUnsavedChanges (保存 / 破棄 / キャンセル)
  → 許可された場合のみ app_quit → app.exit(0)

⌘Q / アプリメニューの「終了」
  → Rust がメニュー項目 app:quit を WebView へ通知
  → 同じ confirmUnsavedChanges
  → 許可された場合のみ app_quit
```

macOS では `RunEvent::ExitRequested` が `⌘Q` で発火しないため、既定メニューの
Quit 項目を `app:quit` に置き換えて `app://quit-requested` を送る。Dock メニューの
「終了」やログアウトは OS が直接終了するため対象外。

## LLM チャットフロー

```
ユーザー入力
  → agentStore.send
  → toRequestMessages (直近 20 件、ローカル通知とコマンド出力を除外)
  → api.llmChat (Tauri Channel)
  → Rust: llm_chat
      → 設定と API キーを読み込み (キーは OS キーチェーン)
      → POST {baseUrl}/chat/completions (stream: true)
      → SSE を解析して delta / done / cancelled / error を Channel へ送信
  → agentStore が応答を逐次更新
  → llm_cancel で協調的キャンセル
```

API キーは Rust プロセス内でのみ扱い、WebView・SQLite・ログ・エラー文字列へは渡さない。
CSP の `connect-src` に外部オリジンを追加しないため、LLM への HTTP 通信は必ず Rust 側で行う。

## 計画立案と承認フロー

```
ユーザー意図 (/plan or Plan タブ)
  → buildPlanMessages (許可アクションと JSON スキーマをシステムプロンプトに含める)
  → api.llmChat (既存のストリーミング経路)
  → parsePlan
      → JSON 抽出 (コードフェンス許容)
      → 許可アクション・引数個数・長さ・NUL・アプリ名の検証
      → 読み取り / 変更リスクをアクションから決定
  → agentStore.plan (draft)
  → ユーザーが計画を承認 / 却下
      → Assistive: 承認済みの手順を 1 つずつ実行
      → Autonomous: 承認済みの手順を順に実行し、失敗で停止
  → agent_run (Rust 側で再検証 + 変更操作はネイティブ承認)
  → 手順ごとに stdout / stderr / 終了コードを保存
```

モデルが返した計画は信頼しない。`src/lib/plan.ts` が Rust の `agent_run` と
同じ許可リスト・引数規則で事前検証し、不正な手順を含む計画は表示しない。
計画の承認は実行可否を決める UI 上の状態であり、Rust の検証とネイティブ承認を
置き換えない。計画と実行結果はメモリ上にのみ保持する。

## エージェント操作フロー

```
ユーザー意図
  → 計画立案 (実装済み: Agent Desktop の許可アクションのみ)
  → 計画単位の承認 (実装済み)
  → agent_run (許可リスト + 引数検証 + 変更操作の承認)
  → Agent Desktop が OS を操作
  → agent_snapshot で状態を再取得
  → 結果を検証して UI に返す (検証ループは今後)
```

`agent_status` / `agent_snapshot` / `agent_run` のブリッジ、引数検証、
ネイティブ承認ダイアログ、UI からの `/status`・`/snapshot` 実行、
OpenAI 互換 API のチャット（ストリーミング・停止・接続テスト）、
計画の生成・承認・実行までを実装している。スキル定義
(`.agents/skills/*.json`) の実行と検証ループは未実装。

## ディレクトリ

実際の Rust クレートは Tauri の慣例に合わせて `src-tauri/` に置いている
(設計書の `src/backend/` 案からの変更点)。

```
src/
├── components/ (AgentPanel, PlanPanel, SettingsDialog, ...)
├── lib/{api,demo,llm,plan,monaco}.ts
├── shared/types.ts
└── stores/{workspace,editor,agent}Store.ts
src-tauri/src/
├── commands/{workspace,editor,agent,llm,settings,app}.rs
├── db.rs
├── error.rs
├── paths.rs
└── state.rs
```

## 今後の分割

- 大きなツリーの列挙は `spawn_blocking` + ページングに移行する。
- Monaco と Agent パネルは動的 import でチャンク分割する (現在は単一バンドル)。
- ターミナルは PTY (portable-pty) を別スレッドで管理し、イベントで差分を流す。
