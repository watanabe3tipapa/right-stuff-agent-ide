## 概要

v0.3.7 は、スキル実行の内容を自己完結した HTML レポートとして出力するレンダラーを追加したリリースです。承認・実行・検証・結果の流れをインライン SVG のフロー図で示し、パラメータ、変更ファイル、stdout / stderr、検証結果を 1 枚にまとめます。アプリ内でプレビューし、ワークスペースの `.agents/reports/` へローカル保存できます。外部 CDN、テレメトリ、クラウド送信はありません。

## ハイライト

### HTML レポート

- **自己完結** — 外部 CSS / JavaScript / 画像を参照せず、1 ファイルで完結
- **Archify 要素** — 承認 → 実行 → 検証 → 結果のインライン SVG フロー図、`data-status` による状態色、`<title>` / `<desc>` によるアクセシビリティ
- **明暗テーマ** — 既定は `prefers-color-scheme`。ボタンで切り替え可能
- **印刷向け** — 印刷時はテーマ切替を隠し、パネルを分割しない
- **保存** — `.agents/reports/<run-id>.html` に `atomic_write` で保存
- **プレビュー** — `sandbox="allow-scripts"` の iframe でアプリ内表示

### 安全性

- すべての可変値を HTML エスケープ
- Rust 側でファイル名を検証し、`.html` とワークスペース内パスだけを許可
- レポートは 4 MB まで
- 可変値をレポート内の JavaScript に埋め込まない

### 既存機能（v0.3.6 まで）

- Git / ターミナル / デバッグのスキルハンドラ
- 検証ループ（typecheck / lint / test）
- スキルライブラリ、LSP / DAP、Git パネル、統合ターミナル (PTY)、Openship 連携、監査ログ

## ダウンロード

| アーキテクチャ | ファイル | サイズ | SHA-256 |
|---|---|---|---|
| Apple Silicon (arm64) | [Right-Stuff.Agent.IDE_0.3.7_aarch64.dmg](https://github.com/watanabe3tipapa/right-stuff-agent-ide/releases/download/v0.3.7/Right-Stuff.Agent.IDE_0.3.7_aarch64.dmg) | 8.2 MB | `9aa5ac485581ebee85a27f176cbfaaf3396e3d2bd6d09c5e460f3e031af38f03` |
| Intel (x86_64) | [Right-Stuff.Agent.IDE_0.3.7_x64.dmg](https://github.com/watanabe3tipapa/right-stuff-agent-ide/releases/download/v0.3.7/Right-Stuff.Agent.IDE_0.3.7_x64.dmg) | 8.6 MB | `43890b975320f8704aa63f11e2ccc6e5226f50377961a63b67f2866f37018570` |

> **注意:** どちらのビルドも Apple の公証（notarization）を受けていません。ダウンロードした Mac では初回起動時に Gatekeeper の警告が表示されます。「システム設定 > プライバシーとセキュリティ」から許可するか、アプリを右クリックして「開く」を選んでください。arm64 版は ad-hoc 署名済み、x64 版は未署名です。Apple Silicon で x64 版を動かす場合は Rosetta 2 が必要です。

## 変更内容

### 追加

- `src/lib/report.ts` — スキル実行レポートの HTML 生成、インライン SVG フロー、テーマ、エスケープ
- `src/lib/report.test.ts` — エスケープ、図、外部参照なし、ファイル名のテスト
- `src-tauri/src/commands/report.rs` — `report_export` と保存先・ファイル名の検証
- Skills タブの「HTML レポート」ボタン、プレビュー、保存 UI
- `report_export` の Tauri コマンド登録

### 改善

- README / README.en / アーキテクチャ / API / スキル設計 / LP / 実装計画を更新
- リリース履歴と開発手順を `DEV-MEMO.md` に分離し、README を現行機能中心に整理
- バージョン表記を 0.3.7 に更新

### 既知の制約

- macOS 11 以降（Apple Silicon / Intel）専用です
- レポートはスキル実行結果のスナップショットで、実行後に自動更新されません
- レポート内の図は固定の 4 段階フローで、任意のトポロジーを描くものではありません
- ブラウザデモではワークスペースが無いため、ファイル保存ではなくダウンロードになります
