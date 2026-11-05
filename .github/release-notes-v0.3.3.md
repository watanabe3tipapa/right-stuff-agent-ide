## 概要

v0.3.3 は、v0.3.1 で追加した LSP / DAP をさらに拡張したリリースです。LSP に名前変更、参照検索、コードアクション、ワークスペースシンボル検索を追加し、Monaco の編集体験をひととおり揃えました。ローカルファーストの設計はそのまま維持しています。

## ハイライト

### LSP（v0.3.1 から）

- **補完・定義ジャンプ・ホバー・診断** — rust-analyzer / typescript-language-server / pyright / gopls / clangd / sourcekit-lsp / lua-language-server を固定レジストリから検出して Monaco に接続
- **ファイル同期** — タブの開閉・編集（300ms デバウンス）・保存を didOpen / didChange / didSave / didClose で送信
- **設定ダイアログの「ツール」タブ** — Language Server / デバッグアダプターの検出状態を確認

### LSP 拡張（v0.3.3）

- **名前変更 (`F2`)** — `textDocument/prepareRename` と `textDocument/rename` を実行し、複数ファイルの編集をタブへ反映
- **参照検索 (`⇧F12`)** — `textDocument/references` の結果を Monaco の参照ビューに表示
- **コードアクション** — 電球メニューから quick fix / refactor / source を実行。`workspace/executeCommand` にも対応
- **ワークスペースシンボル検索 (`⌘T`)** — `workspace/symbol` を検索し、選択した定義へジャンプ
- **`workspace/applyEdit`** — ワークスペース内のテキスト編集を適用。ファイルの作成・名前変更・削除を伴う操作は拒否

### デバッガ（v0.3.1 から）

- **DAP** — `lldb-dap`（C / C++ / Rust / Swift / Objective-C）と `debugpy`（Python）を固定レジストリから検出
- **Debug タブ** — 起動・停止・再開・ステップ実行、コールスタック、変数、出力
- **ブレークポイント** — 行番号左のクリックまたは F9 で切り替え、セッション中は即時反映

## ダウンロード

| アーキテクチャ | ファイル | サイズ | SHA-256 |
|---|---|---|---|
| Apple Silicon (arm64) | [Right-Stuff.Agent.IDE_0.3.3_aarch64.dmg](https://github.com/watanabe3tipapa/right-stuff-agent-ide/releases/download/v0.3.3/Right-Stuff.Agent.IDE_0.3.3_aarch64.dmg) | 8.2 MB | `4a476c3fa8c6f4053614906e41773f7cb0e8b036dce5b2c1b0a2f999098711ac` |
| Intel (x86_64) | [Right-Stuff.Agent.IDE_0.3.3_x64.dmg](https://github.com/watanabe3tipapa/right-stuff-agent-ide/releases/download/v0.3.3/Right-Stuff.Agent.IDE_0.3.3_x64.dmg) | 8.6 MB | `12ab297f91d2fe50c19e5bef7768672b7fa7c40ca55ee8fbebabcd97611d8082` |

> **注意:** どちらのビルドも Apple の公証（notarization）を受けていません。ダウンロードした Mac では初回起動時に Gatekeeper の警告が表示されます。「システム設定 > プライバシーとセキュリティ」から許可するか、アプリを右クリックして「開く」を選んでください。arm64 版は ad-hoc 署名済み、x64 版は未署名です。Apple Silicon で x64 版を動かす場合は Rosetta 2 が必要です。

## 変更内容

### 追加

- LSP 名前変更（F2）と `prepareRename` / `rename` の WorkspaceEdit 適用
- LSP 参照検索（⇧F12）
- LSP コードアクション（quick fix / refactor / source）と `workspace/executeCommand`
- ワークスペースシンボル検索（`⌘T`）とシンボル種別ラベル
- `workspace/applyEdit` の受け入れ（テキスト編集のみ）
- LSP / DAP クライアント、固定レジストリのサーバー / アダプター検出
- Debug タブ、ブレークポイント、コールスタック、変数、出力
- 設定ダイアログの「ツール」タブ
- 診断件数と LSP 状態のステータスバー表示

### 改善

- ワークスペース切替時とアプリ終了時に LSP / DAP セッションを停止
- macOS 専用化（グローバルショートカットを Command に統一）
- LSP の変換ロジックを純関数化し、単体テストを追加
- README / README.en / アーキテクチャ / API / セキュリティ / LP / 実装計画を更新

### 既知の制約

- macOS 11 以降（Apple Silicon / Intel）専用です
- LSP はシグネチャヘルプ、セマンティックトークン、フォーマット、ファイルの作成・削除を伴うリファクタリングには未対応です
- DAP は attach と条件付きブレークポイントに未対応です
- 言語サーバー / デバッグアダプターは別途インストールが必要です
