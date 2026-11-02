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

## エージェント操作フロー (Phase 1 で完成)

```
ユーザー意図
  → LLM 推論
  → スキル選択 (.agents/skills/*.json)
  → agent_run (許可されたアクションのみ)
  → Agent Desktop が OS を操作
  → agent_snapshot で状態を再取得
  → 結果を検証して UI に返す
```

現時点では `agent_status` / `agent_snapshot` / `agent_run` のブリッジと、
UI からの `/status`・`/snapshot` 実行までを実装している。

## ディレクトリ

実際の Rust クレートは Tauri の慣例に合わせて `src-tauri/` に置いている
(設計書の `src/backend/` 案からの変更点)。

```
src/
├── components/
├── lib/{api,demo,monaco}.ts
├── shared/types.ts
└── stores/{workspace,editor,agent}Store.ts
src-tauri/src/
├── commands/{workspace,editor,agent,settings,app}.rs
├── db.rs
├── error.rs
├── paths.rs
└── state.rs
```

## 今後の分割

- 大きなツリーの列挙は `spawn_blocking` + ページングに移行する。
- Monaco と Agent パネルは動的 import でチャンク分割する (現在は単一バンドル)。
- ターミナルは PTY (portable-pty) を別スレッドで管理し、イベントで差分を流す。
