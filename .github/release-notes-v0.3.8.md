## 概要

v0.3.8 は、起動時のウィンドウ位置を補正し、Agent Desktop と Openship の連携を実機の CLI 仕様に合わせて修正したリリースです。Agent Desktop 1.0.2 が受け付けない `snapshot --json` を削除し、CLI がエラーを stdout に返す場合も UI と監査ログに表示します。Openship の CLI デプロイには設定済みの Project ID / Branch を明示し、REST フォールバックの条件を実際の動作に合わせて整理しました。

## ハイライト

### ウィンドウ位置

- **中央配置** — 起動時はプライマリモニタの作業領域中央に表示
- **画面外補正** — macOS が切断済みディスプレイのフレームを復元した場合は、タイトルバーが見えるモニタ中央へ移動
- **単体テスト** — 画面外・別モニタ・巨大ウィンドウなどの判定を 8 件で検証

### Agent Desktop 連携

- **`snapshot --json` を削除** — Agent Desktop 1.0.2 は `--json` を拒否し、`snapshot` は既定で JSON を返す
- **エラー表示** — CLI がエラー JSON を stdout に返す場合も、UI と監査ログに内容を表示
- **ドキュメント整合** — 計画プロンプト、UI ラベル、コマンドパレット、テストを実際の CLI に合わせて更新

### Openship 連携

- **CLI 引数** — `openship --json deploy --project <id> --branch <branch>` を実行し、設定値を明示
- **監査ログ** — 失敗詳細が stderr にない場合は stdout を使用
- **Base URL** — 末尾の `/api` を正規化し、`/api/api` を防止
- **フォールバック** — REST API は CLI 未検出時のみ使用（CLI 失敗時に二重デプロイしない）
- **ドキュメント** — README / README.en / ARCHITECTURE / SECURITY を実際の動作に合わせて修正

## ダウンロード

| アーキテクチャ | ファイル | サイズ | SHA-256 |
|---|---|---|---|
| Apple Silicon (arm64) | [Right-Stuff.Agent.IDE_0.3.8_aarch64.dmg](https://github.com/watanabe3tipapa/right-stuff-agent-ide/releases/download/v0.3.8/Right-Stuff.Agent.IDE_0.3.8_aarch64.dmg) | 8.3 MB | `1388fd8b21cc6a43121bd74959fd2f2dd3e1b701e2f7bf7f272aad7b6fb34c53` |
| Intel (x86_64) | [Right-Stuff.Agent.IDE_0.3.8_x64.dmg](https://github.com/watanabe3tipapa/right-stuff-agent-ide/releases/download/v0.3.8/Right-Stuff.Agent.IDE_0.3.8_x64.dmg) | 8.7 MB | `e363cbc43b21e4787fa229856c1fdd26173bba6f2ecf6c93da6cae90a648d819` |

> **注意:** どちらのビルドも Apple の公証（notarization）を受けていません。ダウンロードした Mac では初回起動時に Gatekeeper の警告が表示されます。「システム設定 > プライバシーとセキュリティ」から許可するか、アプリを右クリックして「開く」を選んでください。arm64 版は ad-hoc 署名済み、x64 版は未署名です。Apple Silicon で x64 版を動かす場合は Rosetta 2 が必要です。

## 変更内容

### 修正

- 起動時のウィンドウをプライマリモニタ中央に配置し、画面外に復元された場合は表示位置を補正
- Agent Desktop の `snapshot` から `--json` を削除
- Agent Desktop の失敗詳細を stdout の JSON からも取得
- Openship CLI デプロイに `--project` / `--branch` を追加
- Openship の失敗詳細を stdout からも取得
- Openship の Base URL から末尾の `/api` を除去
- README / README.en / ARCHITECTURE / SECURITY のフォールバック条件と検出順を修正

### テスト

- ウィンドウ位置補正の単体テスト 8 件
- Agent Desktop の失敗詳細フォールバック 3 件
- Openship の Base URL 正規化と失敗詳細 2 件
- スナップショットの成功・失敗表示テスト 2 件

### 既知の制約

- macOS 11 以降（Apple Silicon / Intel）専用です
- 配布用 DMG は Developer ID 署名・公証を受けていません
- Agent Desktop と Openship の CLI は同梱していません。別途インストールが必要です
- Openship の履歴・ログ・ロールバックはセルフホスト REST API 経由です。CLI のみで使用する場合は Base URL と PAT の設定が必要です
