# v0.4.2 — Apple FM 設定 UI と既定プロバイダー

## ハイライト

### Apple FM を設定画面から利用

- 設定に **Apple FM** タブを追加
- `fm` CLI の検出状況と実行ファイルのパスを表示
- `fm serve` の起動・停止をアプリから操作
- ホストとポートを指定して `fm serve` を起動（`127.0.0.1` / `localhost` / `::1` のみ）
- 利用可能なモデルを検出し、`system` / `pcc` を選択
- 「LLM に設定」「設定して接続テスト」で Base URL とモデルを LLM 設定へ反映
- 手動起動用の `fm serve --host 127.0.0.1 --port 1976` を画面に表示
- アプリ終了時に、アプリが起動した `fm serve` を停止

### Apple FM を既定の LLM に

- Apple Silicon かつ `fm` が存在する環境では、Apple FM
  （`http://127.0.0.1:1976/v1`、モデル `system`）を既定プロバイダーに設定
- `fm` がない環境では従来どおり OpenAI を既定に維持
- LLM 設定のプロバイダー一覧に Apple FM を追加

### ドキュメント

- README に Apple Intelligence の有効化、`sudo fm license`、起動方法、
  Base URL とモデルの既定値を追記

## 既知の制約

- Apple FM は Apple Silicon と macOS 27 以降の `fm` CLI が必要
- 初回はターミナルで `sudo fm license` に同意する必要がある
- `pcc`（Private Cloud Compute）はターミナルから起動した場合のみ利用できる
- DMG は Developer ID 署名・公証を受けていない（arm64 は ad-hoc 署名、x64 は未署名）
- アプリ内の自動更新はない

## アップグレード

GitHub Releases から v0.4.2 の DMG を取得してください。
Apple FM を使わない場合も、設定 > LLM から従来どおり任意の
OpenAI 互換プロバイダーを選択できます。
