# Open VibeCoding 日本語版との対応

v0.4.0 の検討では、Open VibeCoding 本体を日本語化するための提案書を参照しました。
提案書そのものはリポジトリに含めず、Right-Stuff Agent IDE に合うものだけを採用して
います。この文書は、採用した範囲と、意図的に対象外にした範囲を記録します。

## 採用したもの

| 提案の項目 | このリポジトリでの実装 |
| --- | --- |
| 用語集と CI での表記チェック | [`docs/GLOSSARY.md`](./GLOSSARY.md) と `npm run glossary` |
| 日本語組版の Skill | `japanese-text` スキル（`editor.checkJapanese`） |
| 日本語テンプレート | [`templates/open-vibecoding-ja/`](../templates/open-vibecoding-ja/) |
| エージェント向けガイドライン | `templates/open-vibecoding-ja/AGENTS.md` |
| PRD とテストレポート | `templates/open-vibecoding-ja/PRD.md`、`TEST_REPORT.md` |
| UTF-8 / LF の明示 | `templates/open-vibecoding-ja/.gitattributes` |

## 用語集と CI

`docs/GLOSSARY.md` の表を唯一の情報源にしています。`scripts/check-glossary.mjs`
が表を読み取り、`README.md`、`docs/**/*.md`、`templates/**/*.md` を検査します。
コードブロック、インラインコード、frontmatter、URL だけの行は対象外です。
意図して非推奨表記を使う行には `<!-- glossary: allow -->` を付けます。

CI ではフロントエンドの job で `npm run glossary` を実行します。この検査は
ファイルを書き換えません。修正は人が行います。

## 日本語テキストの検査

`japanese-text` スキルは読み取り専用です。`.agents/skills/japanese-text.json` に
マニフェストがあり、Rust の `editor.checkJapanese` が次の項目を検査します。

- 全角の英数字
- 半角カタカナ
- 行頭の閉じ括弧・句読点
- 行末の開き括弧
- `。。`、`、、` などの句読点の連続
- 用語集の表記ゆれ（`サーバ` → `サーバー` など）

対象は `.md`、`.mdx`、`.txt` です。コードブロック、インラインコード、frontmatter、
URL だけの行は除外します。指摘は `path:line:column` と重要度付きで表示し、
`error` がある場合はスキルの終了コードを 1 にします。

このスキルは指摘するだけで、自動修正はしません。日本語の修正は文脈に依存する
ため、v0.4.0 では自動修正の対象外です。

## テンプレート

`templates/open-vibecoding-ja/` は静的なファイル群です。ビルド時に生成したり、
プロジェクトへ自動で書き込んだりしません。利用者が内容を確認してコピーします。
自動インストーラーは v0.5.0 で検討します。

## 対象外にしたもの

提案書には i18n エンジン、CLI のロケールファイル、Open VibeCoding 本体の
フォークと同期スクリプトが含まれています。Right-Stuff Agent IDE は CLI を
持たず、UI はすでに日本語で書かれているため、これらは採用していません。

- i18n エンジンと `locales/` ディレクトリ
- CLI メッセージのローカライズ
- Open VibeCoding 本体のフォーク、`sync-locale.js`、週次同期
- 日本語 lint の指摘に対する自動修正
- テンプレートのワンクリック導入

## 関連する v0.4.0 の変更

- 検証に失敗したときに修正案を作る自動修正ループ
  （`docs/SKILLS.md` の「検証の自動修正」）
- `verification_fix` の監査ログ
- スキルポリシーの `verification.autoFix` と `maxFixAttempts`

自動修正は `editor.replaceText` だけを使い、書き込みのたびにネイティブ承認を
求めます。日本語表記の修正は、この自動修正の対象に含めていません。
