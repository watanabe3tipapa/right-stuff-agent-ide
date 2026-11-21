# v0.4.0 — 検証の自動修正と日本語品質

## ハイライト

### 検証の自動修正

- スキル実行後の typecheck / lint / test が失敗したとき、変更ファイルと失敗出力だけを
  LLM に渡して修正案を作成
- 修正案に使えるのは `code-edit` の `editor.replaceText` だけ。新しいファイルの作成、
  削除、シェル、Git、ターミナル、デバッグ操作は提案できない
- 変更できるのは、その実行で変更したファイルと、失敗出力に現れたファイルだけ
- `.env`、鍵、バイナリ、lockfile、`node_modules`、`target`、`.git` は文脈から除外
- 文脈は最大 8 ファイル / 60,000 文字、失敗出力は 20,000 文字で打ち切り
- 修正の適用は毎回ネイティブ承認ダイアログを通る。承認を省略する経路はない
- Skills タブと Plan タブのスキル手順の両方で利用可能
- 停止条件は、検証合格、最大試行回数、同じ失敗シグネチャの再発、無効な修正案、
  ユーザーによる中止
- 既定は手動実行（`manual`）。`auto` は Autonomous モードでのみ有効
- 監査ログに `verification_fix` を追加

### 日本語品質

- `docs/GLOSSARY.md` に用語集を追加し、`npm run glossary` で
  `README.md`、`docs/**/*.md`、`templates/**/*.md` の表記ゆれを CI で検査
- 読み取り専用スキル `japanese-text`（`editor.checkJapanese`）を追加。
  全角英数字、半角カタカナ、行頭の閉じ括弧、行末の開き括弧、句読点の連続、
  用語集の表記ゆれを検出
- `templates/open-vibecoding-ja/` に AGENTS.md、PRD、テストレポート、
  `.gitattributes` の静的テンプレートを追加
- `docs/OPEN-VIBECODING-JA.md` に提案との対応と対象外の範囲を記録

### スキルポリシー

- `verification.autoFix`（`off` / `manual` / `auto`）を追加
- `verification.maxFixAttempts`（1〜3、既定 2）を追加
- ポリシーのバージョンを 2 に更新。v1 の設定は読み込み時に既定値を補完

### ブラウザデモの PWA 対応

- `/app/` のブラウザデモを PWA としてインストール可能に
- `manifest.webmanifest`、192 / 512 / maskable アイコン、Apple Touch Icon を追加
- service worker を追加。ナビゲーションは network-first、ハッシュ付きアセットは
  cache-first。オフライン時は `offline.html` を表示
- service worker は本番ビルドかつ Tauri 外のときだけ登録。Tauri 版の動作は変わりません

### 非公開リポジトリの案内

- リポジトリ、Releases、DMG、Issue は非公開のままです
- LP、README、このリリースノートで、DMG の入手に GitHub のアクセス権が
  必要であることを明記
- 公開している LP とブラウザデモは、どなたでも利用できます

## ダウンロード

| プラットフォーム | ファイル | サイズ | SHA-256 |
|---|---|---|---|
| Apple Silicon (arm64) | `Right-Stuff.Agent.IDE_0.4.0_aarch64.dmg` | 8.9 MiB (9,335,924 bytes) | `db28ce5cad8990baffe2832e14fc9bef269fb2bc2eaff11e0108b344d9f4ac7e` |
| Intel (x86_64) | `Right-Stuff.Agent.IDE_0.4.0_x64.dmg` | 9.4 MiB (9,897,466 bytes) | `38e3409b066ae47880b4f534bc7eb717045ecbc6bd935e4f631b51f2c4988eca` |

DMG は Developer ID 署名・公証を受けていません（arm64 は ad-hoc 署名、x64 は未署名）。
初回起動時に Gatekeeper の警告が出た場合は、右クリック →「開く」で起動してください。

## アップグレード

- 既存のスキルポリシーは自動で v2 に移行します。`autoFix` は `manual`、
  `maxFixAttempts` は 2 になります。
- 日本語チェックを使うには `.agents/skills/japanese-text.json` が必要です。
  リポジトリには同梱済みです。

## 制限

- 自動修正は Tauri 版のみです。ブラウザデモでは LLM とネイティブ承認を
  利用できないため無効になります。
- 日本語 lint の指摘は自動修正しません。文脈に依存する修正を避けるためです。
- テンプレートのワンクリック導入は v0.5.0 で検討します。
- i18n エンジン、CLI のローカライズ、Open VibeCoding 本体のフォークと同期は
  対象外です。
