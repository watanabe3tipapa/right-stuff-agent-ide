## 概要

v0.3.9 は、ブラウザデモを実際に触れる状態へ近づけ、ランディングページを現在の姿に合わせて作り直したリリースです。デモの編集内容・履歴・スキルポリシーはブラウザの localStorage に保存され、再読み込みしても残ります。あわせて、実行中のスキルと検証を停止できるようになりました。

## ハイライト

### ブラウザデモ

- **永続化** — ワークスペース、バージョン履歴、スキルポリシーを localStorage に保存。バージョン付きスキーマ、パス検証、履歴の剪定を含む
- **リセット** — デモバーの「初期状態に戻す」から、確認ダイアログを経て保存内容を削除
- **保存できない環境** — localStorage が使えない場合は警告を表示し、変更が再読み込みで失われることを明示
- **ディープリンク** — `?tab=` / `?file=` / `?preview=1` でパネルとファイルを直接開ける。`?shot=1` はスクリーンショット用にデモバーを隠す

### スキルと検証の停止

- **`skill_cancel`** — UI が発行した `runId` で実行中のスキルを停止
- **検証の停止** — `skill_verify` も `runId` を受け取り、実行中のチェックをプロセスグループごと停止。残りは `skipped`、全体は `cancelled` として返す
- **計画の停止** — Plan タブの「中止」で実行中のスキル手順も停止
- **監査** — 停止を `skill_cancelled` / `verification_run` に記録

### ランディングページとドキュメント

- **実画面** — ブラウザデモから撮影したスクリーンショットと、CSS だけで動く画面ツアー
- **位置付け** — 個人が自分用に作る Hobby project / Early Access として整理
- **正直な制約** — できること・できないこと、セキュリティ、既知の制約、FAQ を掲載
- **ドキュメント整合** — README / README.en / DEV-MEMO / API / ARCHITECTURE / SKILLS / sitemap / 404 を更新

## ダウンロード

| アーキテクチャ | ファイル | サイズ | SHA-256 |
|---|---|---|---|
| Apple Silicon (arm64) | [Right-Stuff.Agent.IDE_0.3.9_aarch64.dmg](https://github.com/watanabe3tipapa/right-stuff-agent-ide/releases/download/v0.3.9/Right-Stuff.Agent.IDE_0.3.9_aarch64.dmg) | ビルド後に追記 | ビルド後に追記 |
| Intel (x86_64) | [Right-Stuff.Agent.IDE_0.3.9_x64.dmg](https://github.com/watanabe3tipapa/right-stuff-agent-ide/releases/download/v0.3.9/Right-Stuff.Agent.IDE_0.3.9_x64.dmg) | ビルド後に追記 | ビルド後に追記 |

> **注意:** どちらのビルドも Apple の公証（notarization）を受けていません。ダウンロードした Mac では初回起動時に Gatekeeper の警告が表示されます。「システム設定 > プライバシーとセキュリティ」から許可するか、アプリを右クリックして「開く」を選んでください。arm64 版は ad-hoc 署名済み、x64 版は未署名です。Apple Silicon で x64 版を動かす場合は Rosetta 2 が必要です。

## 変更内容

### 追加

- ブラウザデモの localStorage 永続化と「初期状態に戻す」
- デモのディープリンク（`?tab=` / `?file=` / `?preview=1` / `?shot=1`）
- スキルと検証の停止（`skill_cancel`、`runId`、Plan タブの中止連携）
- `npm run screenshots` による LP 用画像と OGP 画像の生成

### 変更

- ランディングページを実画面・画面ツアー・制約・FAQ 中心に再構成
- README / README.en を Hobby project / Early Access の位置付けに更新
- デモの README、ステータスバー、保存時の通知を永続化に合わせて更新

### 修正

- デモのファイル移動時に更新日時とパスを引き継ぐ
- 履歴の剪定をファイルごとに適用し、`nextVersionId` の衝突を防ぐ
- 狭い画面で LP の表とヘッダーが横にはみ出す問題を修正

### テスト

- デモスナップショットの直列化・検証・剪定・保存失敗の単体テスト
- デモのリセットを含む既存テストの初期化
- `typecheck` / `lint` / `npm test`（11 files, 108 tests）/ `build:vercel`

### 既知の制約

- macOS 11 以降（Apple Silicon / Intel）専用です
- 配布用 DMG は Developer ID 署名・公証を受けていません
- ブラウザデモでは LLM・Git・ターミナル・OS 操作は動きません
- localStorage が使えない環境では、デモの変更は再読み込みで失われます
- 計画とスナップショットはメモリ上にのみ保持され、再起動すると失われます
