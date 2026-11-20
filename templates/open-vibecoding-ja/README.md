# Open VibeCoding 日本語テンプレート

Open VibeCoding 日本語版の提案から、Right-Stuff Agent IDE が採用した静的な
テンプレートです。自動インストーラーは v0.5.0 で提供予定です。それまでは、
必要なファイルをプロジェクトへコピーして使います。

## ファイル

| ファイル | 用途 |
| --- | --- |
| `AGENTS.md` | エージェント向けのプロジェクトガイドライン |
| `PRD.md` | 製品要件定義の下書き |
| `TEST_REPORT.md` | 日本語ラベルのテストレポート |
| `.gitattributes` | UTF-8 / LF を明示する設定 |

## 使い方

1. プロジェクトのルートへ `AGENTS.md` と `.gitattributes` をコピーします。
2. 必要に応じて `PRD.md` と `TEST_REPORT.md` を `docs/` などへコピーします。
3. `AGENTS.md` の「プロジェクト固有のルール」を自分のリポジトリに合わせます。
4. `npm run glossary` または `node scripts/check-glossary.mjs` で表記を確認します。
5. Tauri 版では `japanese-text` スキルで Markdown の日本語表記を検査できます。

## 方針

- テンプレートは静的な Markdown と設定ファイルだけです。ビルド時に生成しません。
- 日付は `YYYY年MM月DD日` 形式にします。
- コード、コマンド、識別子は半角のままにします。
- 用語は `docs/GLOSSARY.md` に従います。
- Open VibeCoding 本体のフォークや同期は行いません。採用した考え方だけを
  このリポジトリのテンプレートとして維持します。
