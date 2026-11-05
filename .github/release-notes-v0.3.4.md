## 概要

v0.3.4 は、エージェントが使えるスキルを「人間が読める形」に整理したリリースです。キュレーション済みのスキルカタログを独立したショーケース窓で表示し、目的・リスク・パラメータ・プロンプト例・マニフェストをひとつの画面で確認できます。利用可能なスキルはその場でワークスペースへ追加できます。ローカルファーストの設計はそのまま維持しています。

## ハイライト

### スキルライブラリ

- **読めるカタログ** — `Code Edit` / `Doc Writer` / `Code Inspector` を、目的・タグ・リスク・アクション・パラメータ・プロンプト例で整理
- **ショーケース別窓** — Skills タブの「ライブラリを開く」またはコマンドパレットから `skill-library` ウィンドウを起動（ブラウザでは別タブ）
- **検索とカテゴリ** — スキル名・タグ・説明で絞り込み、エディタ / Git / ターミナル / デバッグで分類
- **ワークスペースへ追加** — マニフェストを `.agents/skills/<id>.json` として書き出し。既存ファイルは確認してから上書き
- **予定スキルの可視化** — Git / ターミナル / デバッグは設計カードとして表示し、ハンドラ未実装の操作を実行可能に見せない
- **カスタムスキル** — ワークスペースに既にあるがライブラリに無いスキルも一覧に追加

### 既存機能（v0.3.3 まで）

- LSP（補完・定義・ホバー・診断・名前変更・参照検索・コードアクション・シンボル検索）
- DAP（`lldb-dap` / `debugpy`、Debug タブ、ブレークポイント）
- Git パネル、統合ターミナル (PTY)、クイックオープン、Openship 連携、監査ログ

## ダウンロード

| アーキテクチャ | ファイル | サイズ | SHA-256 |
|---|---|---|---|
| Apple Silicon (arm64) | [Right-Stuff.Agent.IDE_0.3.4_aarch64.dmg](https://github.com/watanabe3tipapa/right-stuff-agent-ide/releases/download/v0.3.4/Right-Stuff.Agent.IDE_0.3.4_aarch64.dmg) | 8.2 MB | `ee5b21b8df40b977ae3016d3a2ce2304a729815c16c325c832498c0df6202ea4` |
| Intel (x86_64) | [Right-Stuff.Agent.IDE_0.3.4_x64.dmg](https://github.com/watanabe3tipapa/right-stuff-agent-ide/releases/download/v0.3.4/Right-Stuff.Agent.IDE_0.3.4_x64.dmg) | 8.6 MB | `4dced28546193ff194dc313d9d5339603ddc616eeb1e44f93cf2ea2f8dac6e4f` |

> **注意:** どちらのビルドも Apple の公証（notarization）を受けていません。ダウンロードした Mac では初回起動時に Gatekeeper の警告が表示されます。「システム設定 > プライバシーとセキュリティ」から許可するか、アプリを右クリックして「開く」を選んでください。arm64 版は ad-hoc 署名済み、x64 版は未署名です。Apple Silicon で x64 版を動かす場合は Rosetta 2 が必要です。

## 変更内容

### 追加

- キュレーション済みスキルライブラリ（`src/lib/skillLibrary.ts`）
- スキルショーケース別窓（`src/components/SkillLibrary.tsx`、`index.html?window=skills`）
- Skills タブとコマンドパレットからの起動導線
- マニフェストの書き出しと上書き確認
- 予定スキル（Git / ターミナル / デバッグ）の設計カード
- スキルライブラリの単体テスト

### 改善

- Skills タブがウィンドウのフォーカス時にカタログを再読み込み
- 別窓用の Tauri capability（`core:webview:allow-create-webview-window` / `core:window:allow-set-focus` など）
- README / README.en / アーキテクチャ / API / スキル設計 / LP / 実装計画を更新

### 既知の制約

- macOS 11 以降（Apple Silicon / Intel）専用です
- Git / ターミナル / デバッグのスキルハンドラは未実装で、ライブラリでは設計カードとして表示されます
- 検証ループ（typecheck / lint / test の自動実行）は v0.5 で追加予定です
- 言語サーバー / デバッグアダプターは別途インストールが必要です
