# Openship 連携

Deploy タブと `/deploy`・`/logs`・`/rollback` が使う Openship 連携について、
何を狙い、何をあえて採用しなかったかをまとめます。

## Openship とは

[Openship](https://openship.io/) は、オープンソースでセルフホストできるデプロイ基盤です。
CLI と REST API を持ち、プロジェクト単位のデプロイ、履歴、ログ、ロールバックを扱えます。
公式ドキュメントは <https://openship.io/docs> にあります。

## なぜ Openship を採用したか

right-stuff-agent-ide は「ファイルは手元に、操作は見える形で」を方針にしています。
デプロイ機能を入れるにあたり、次の条件を満たすものを選びました。

1. **セルフホストできる** — SaaS アカウントを必須にせず、利用者が自分のサーバーや
   localhost で運用できます。クラウド同期を持たないアプリの方針と衝突しません。
2. **CLI と REST API の両方がある** — すでにターミナルから `openship` を使っている人は
   CLI をそのまま利用でき、アプリは履歴・ログ・ロールバックを REST で補完できます。
   どちらか一方しかないツールでは、UI とワークフローが分断されます。
3. **デプロイの一生を UI に収められる** — デプロイ、履歴、ログ、ロールバックという
   小さく明確な操作群が、エージェントパネルの 1 タブに収まります。
4. **ロールバックがある** — エージェントに変更操作を任せる以上、戻せる経路を同じ画面に
   用意する必要がありました。ロールバックを API で扱える点を重視しています。
5. **個人運用に向いた認証** — セルフホストのローカル認証と PAT を使え、PAT を
   OS キーチェーンに預けたまま Rust 側だけで利用できます。

## 代替案を採用しなかった理由

| 候補 | 採用しなかった理由 |
|---|---|
| GitHub Actions | リポジトリと CI 設定が前提になり、実行時ログやロールバックを同じ UI で扱いにくい。デプロイ先の状態は結局別に見に行く必要がある |
| rsync / SSH | 履歴・ログ・ロールバックを自前で作ることになる。デプロイ基盤の保守がアプリの目的から外れる |
| Docker / Kubernetes | 強力だが個人のデスクトップアプリには重い。クラスタの運用を利用者へ押し付ける |
| Vercel / Netlify などの SaaS | 外部アカウントが必須になり、ローカルファーストの方針と合わない。このプロジェクトでは LP とデモの公開にだけ使っている |
| 手元のシェルスクリプト | 実行履歴とロールバックが残らず、エージェントの操作を監査しにくい |

## 連携の仕組み

```text
Deploy タブ / /deploy / /logs / /rollback
  → Tauri invoke（openship_*）
  → Rust: 設定・ID・URL・ブランチを検証
  → CLI があれば openship --json deploy --project <id> --branch <branch>
      → 未検出なら REST POST /api/deployments
  → deploy / rollback は必ずネイティブ承認
  → 実行コマンドと結果を監査ログへ記録
```

- CLI は設定した `cliPath`、`OPENSHIP_BIN`、`PATH` の順に検出します
- CLI のデプロイでは、設定した Project ID と Branch を明示的に渡します。
  カレントの `.openship/project.json` や Git ブランチには依存しません
- REST は履歴・ログ・ロールバックも担当します。使用する経路は
  `GET /api/health`、`GET /api/projects`、`GET /api/deployments`、
  `GET /api/deployments/{id}/logs`、`POST /api/deployments/{id}/rollback` です
- REST を使うには Base URL と PAT が必要です。CLI だけでデプロイする場合は不要ですが、
  その場合は履歴・ログ・ロールバックをアプリから操作できません

### OpenCode からの操作

OpenCode タブでは、自然言語の指示が ACP で `opencode` に渡ります。OpenCode から
Openship に到達する手段は、IDE の MCP サーバーが公開する `openship_status` /
`openship_projects` / `openship_deployments` / `openship_logs` /
`openship_deploy` / `openship_rollback` だけです。OpenCode に Openship の PAT は
渡しません。

```text
opencode (ACP / stdio)
  → MCP (HTTP / 127.0.0.1 + セッション限りの Bearer)
  → IDE MCP サーバー
  → 既存の openship_*_impl
  → ネイティブ承認 → CLI / REST → 監査ログ
```

`deploy` / `rollback` は OpenCode 側の設定に関係なく、IDE のネイティブ承認を
毎回表示します。Passive モードでは MCP ツール自体を実行しません。

## セキュリティ

- 接続設定は SQLite、PAT は OS キーチェーン（`com.rightstuff.agentide.openship`）に保存し、
  WebView へトークンを返しません
- 通信は Rust 側で行い、WebView から Openship へ直接接続しません
- Base URL は `https://` を必須とし、`http://` は localhost / 127.0.0.1 / ::1 のみ許可します
- Project ID・デプロイ ID・ブランチ名は英数字と `-` / `_` に制限し、CLI へは配列引数で渡します
- デプロイとロールバックは Passive モードでは拒否し、Assistive / Autonomous でも
  ネイティブ承認を省略できません
- 監査ログには実行コマンド・終了コード・失敗時の出力抜粋だけを残し、PAT とレスポンス本文全体は記録しません

## 既知の制約

- Openship を知らない人には馴染みが薄いため、Deploy タブは任意の機能として扱っています。
  使わない場合は設定もインストールも不要です
- Openship の API は進化しているため、フィールド名の変更で表示が壊れる可能性があります。
  アプリ側は複数のフィールド名を許容していますが、追従が必要になることがあります
- アプリからのロールバックは REST のみです。CLI だけで運用している場合は使えません
- Openship は GitHub Actions や Kubernetes の代替ではありません。デプロイ手段の 1 つとして
  同じ画面から扱えるようにするものです

## セットアップ

1. Openship をセルフホストで用意するか、既存の環境へ接続します
2. `openship login` と `openship init --project <id>` でプロジェクトを関連付けます
3. アプリの「設定 > Openship」に Base URL・Project ID・Branch を入力します
4. REST で履歴・ログ・ロールバックも使う場合は PAT を保存します
5. Deploy タブ、または `/deploy`・`/logs`・`/rollback` から操作します
6. 自然言語で操作する場合は `opencode`（1.2.0 以上）をインストールし、
   OpenCode タブでセッションを開始します

CLI の導入は <https://openship.io/docs/cli>、デプロイの手順は
<https://openship.io/docs/cli/deploy> を参照してください。
