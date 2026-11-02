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
| `agentStore` | モード、Agent Desktop の検出状態、チャット |

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

## エージェント操作フロー (計画立案は Phase 1 後半)

```
ユーザー意図
  → LLM 推論 (実装済み: チャット応答まで)
  → スキル選択 (.agents/skills/*.json) (Phase 1 後半)
  → agent_run (許可リスト + 引数検証 + 変更操作の承認)
  → Agent Desktop が OS を操作
  → agent_snapshot で状態を再取得
  → 結果を検証して UI に返す
```

現時点では `agent_status` / `agent_snapshot` / `agent_run` のブリッジ、
引数検証、ネイティブ承認ダイアログ、UI からの `/status`・`/snapshot` 実行、
OpenAI 互換 API のチャット（ストリーミング・停止・接続テスト）までを実装している。

## ディレクトリ

実際の Rust クレートは Tauri の慣例に合わせて `src-tauri/` に置いている
(設計書の `src/backend/` 案からの変更点)。

```
src/
├── components/ (AgentPanel, SettingsDialog, ...)
├── lib/{api,demo,llm,monaco}.ts
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
