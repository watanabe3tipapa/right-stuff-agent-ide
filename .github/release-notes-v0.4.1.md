# v0.4.1 — ドキュメント再構成、スナップショット確認、リリース自動化

## ハイライト

### README とドキュメントの再構成

- README を約 40 KB から読み切りやすい長さへ削減し、価値提案、対象ユーザー、
  できないこと、ダウンロード、3 分クイックスタートを先頭に置いた
- 詳細は [docs/FEATURES.md](../docs/FEATURES.md)、制約は
  [docs/LIMITATIONS.md](../docs/LIMITATIONS.md)、開発手順は
  [docs/DEVELOPMENT.md](../docs/DEVELOPMENT.md) へ移動
- Openship の採用理由と代替案の比較を [docs/OPENSHIP.md](../docs/OPENSHIP.md) に追加
- README.en も同じ構成へ更新

### スナップショット取得前の確認

- `/snapshot` は、エージェントポリシーにかかわらず取得前にネイティブ確認ダイアログを表示
- ダイアログで、メール・銀行・パスワード管理などの機密情報が含まれうること、
  自動マスクが未実装であること、内容が外部送信されないことを明示
- キャンセル時は監査ログに `cancelled` として記録
- ポリシー設定の説明にも、snapshot は毎回確認する旨を追記

### リリースの自動化

- `.github/workflows/release.yml` を追加
- `v*` タグの push で arm64 と x64 の DMG をビルドし、SHA-256 とともに
  GitHub Release へ自動添付
- arm64 は `macos-15`、x64 は `macos-15-intel` の GitHub ホステッドランナーを使用
- リリースノートは `.github/release-notes-vX.Y.Z.md` があればそれを利用
- Developer ID 署名と公証は引き続き未対応

### ドキュメントの正確性

- 実環境と一致しない検証環境の表記を削除し、実測値（macOS 15.8.4 / Node.js 22.17 /
  Rust 1.94.1）と CI（Node.js 24 / Rust stable）を分けて記載
- v0.3.9 の起動確認記述を v0.4.0 に更新
- 外部接続について、LLM と Openship に送るもの・送らないものを README に明記
- 外部送信内容の可視化と機密情報のマスクを見直し中であることを明記
- README のバージョンバッジを GitHub Releases 連動に変更し、リリースごとの更新を不要にした

## 既知の制約

- DMG は Developer ID 署名・公証を受けていない（arm64 は ad-hoc 署名、x64 は未署名）
- スナップショットの機密ウィンドウ自動マスクは未実装
- macOS 専用で、Windows / Linux 版は提供しない
- LLM は OpenAI 互換 API のみ対応
- IDE 機能（LSP / DAP / Git / ターミナル）は今後も継続的に改善する

## アップグレード

GitHub Releases から v0.4.1 の DMG を取得してください。
アプリ内の自動更新はありません。
