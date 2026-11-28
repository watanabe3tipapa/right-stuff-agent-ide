# v0.4.3 — OpenCode のセッション開始修正とモデル選択

## ハイライト

### OpenCode のセッションが開始できない問題を修正

- ACP の応答を読む処理を起動前に開始するよう修正
- `initialize` / `session/new` の応答を取りこぼしてタイムアウトしていた問題を解消
- セッション終了時に保留中のリクエストを解放し、状態表示が古いまま残らないよう改善

### OpenCode のモデルを選択

- Agent パネルの OpenCode タブにモデル選択を追加
- OpenCode が返すモデル一覧（`session/new` の `configOptions`）をそのまま表示
- 選択したモデルは `session/set_config_option` で即時切り替え
- 選択内容を保存し、次回セッション開始時に自動で再適用
- 現在のモデルをセッション情報に表示

### ドキュメント

- README / README.en に OpenCode タブでのセッション開始とモデル選択を追記

## 既知の制約

- OpenCode 1.2.0 以上が必要
- モデル一覧は OpenCode の設定と認証状態に依存する
- DMG は Developer ID 署名・公証を受けていない（arm64 は ad-hoc 署名、x64 は未署名）
- アプリ内の自動更新はない

## アップグレード

GitHub Releases から v0.4.3 の DMG を取得してください。
