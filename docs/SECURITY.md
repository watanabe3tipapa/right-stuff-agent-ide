# Security

## パス検証

すべてのファイル操作は Rust 側で次の検証を通る。

1. 相対パスのみ許可。絶対パスと `..` を含むパスは `OutsideWorkspace` エラー。
2. 既存パスは `canonicalize` した上でワークスペースルート配下か確認する。
3. 新規パスは最も近い既存の祖先を `canonicalize` して同じ確認を行う。
4. シンボリックリンクはファイルツリーに列挙しない。

これにより、UI やエージェントが `../../.ssh/id_rsa` のようなパスを渡しても
バックエンドで拒否される。

## ファイル書き込み

- 同一ディレクトリに一時ファイルを書いてから `rename` する atomic write。
- 保存のたびに SQLite へ内容を記録する (最新 100 版 / ファイル)。
- 削除は即時削除ではなく `<workspace>/.right-stuff/trash/<timestamp>/` へ移動する。
- `.right-stuff` 自体は削除できない。

## エージェント操作

### モード

| モード | ファイル読み書き | チャット | 外部アプリ操作 |
| --- | --- | --- | --- |
| Passive | 読み取りのみ | なし | なし |
| Assistive | 可 (危険操作は承認) | 可 | なし |
| Autonomous | 可 | 可 | 承認フロー経由 |

### 承認が必要な操作

`agent_run` は次の二段階で防御する。

1. **引数検証** — アクション名の許可リスト、引数個数（最大 12）、1 引数あたりの長さ（最大 16,384 文字）、合計長（最大 32,768 文字）、NUL 文字の拒否。`launch` / `close-app` はアプリ名 1 つだけを許可し、パス区切り・`..`・先頭 `-` を拒否する。`type` / `set-value` / `clipboard-set` は内容の存在を必須にする。
2. **ネイティブ承認** — 読み取り専用アクション（`snapshot`, `list-apps`, `list-windows`, `list-notifications`, `--version`, `--help`）以外は、実行直前に OS の確認ダイアログを表示する。ダイアログには実行するコマンドを表示し、承認した場合のみ CLI を起動する。

CLI はシェルを介さず `Command::new(binary).args(args)` で直接起動するため、シェルインジェクションは成立しない。

### 出力

- `agent_run` の stdout / stderr は 200,000 文字で打ち切る。
- コマンドは UI に `command[]` として表示し、何を実行したか追跡できるようにする。

## LLM 接続と API キー

- LLM への HTTP 通信は WebView ではなく Rust 側で行う。CSP の `connect-src` に外部オリジンを追加しない。
- API キーは OS キーチェーン（macOS は Keychain Services）にのみ保存する。キーはプロバイダーごとに 1 つ保持する。
- SQLite にはプロバイダー名・Base URL・モデル名・Temperature・最大トークン数のみを保存する。API キーは保存しない。
- `llm_config_get` / `llm_key_status` が返すのは「設定済みかどうか」の真偽値だけ。キー本文は WebView に返さない。
- キーはログ・エラー文字列・監査ログに出力しない。キーチェーン操作の失敗は一般的なメッセージに置き換える。
- Base URL は `https://` を必須とし、`http://` は `localhost` / `127.0.0.1` / `::1` のみ許可する。URL にユーザー名・パスワード・クエリ・フラグメントは含められない。
- メッセージは role の許可リスト、1 件あたり 100,000 文字、合計 400,000 文字、最大 100 件で検証する。
- ストリーミングは `llm_cancel` で協調的に停止できる。

### 送信範囲

- 現在のチャットは、ユーザーが入力したプロンプトと直近 20 件の会話だけを送信する。
- ローカル通知、コマンド出力、システムメッセージ、`/status` などのローカルコマンドは履歴から除外する。
- ワークスペースのファイル、デスクトップスナップショット、クリップボードの内容を自動で送信しない。
- ローカルプロバイダー（Ollama / LM Studio）は `http://localhost` を許可するが、外部ホストへの平文 HTTP は拒否する。
- プロバイダーが返したエラー本文に API キーが含まれる場合は、WebView へ渡す前に `[REDACTED]` へ置換する。
- 接続テストなどで読み取る HTTP レスポンス本文は 1 MiB で打ち切る。
- HTTP リダイレクトには追従しない。API キーの送信先を Base URL のホストに固定するため。

## CSP と HTTP ヘッダー

- Tauri は本番用 `csp` と開発用 `devCsp` を分けて設定する。本番は `default-src 'self'` を基底とし、Monaco の worker 用に `worker-src 'self' blob:`、Google Fonts 用に `font-src`、Tauri IPC 用に `connect-src ipc: http://ipc.localhost` を許可する。
- Vercel は `Content-Security-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy`, `X-Content-Type-Options`, `Referrer-Policy` を全レスポンスへ付与する。
- `frame-ancestors 'none'` と `X-Frame-Options: DENY` でクリックジャッキングを防ぐ。

## スナップショットとプライバシー

- スナップショットは現時点ではメモリ上にのみ保持し、SQLite へ永続化しない。
- LLM へ自動送信するのはチャットの会話のみ。スナップショットやファイル内容は送信しない。
- 今後、以下を追加する:
  - 銀行・メールクライアント等の機密ウィンドウの自動マスク
  - LLM 送信前のパス・ユーザー名の匿名化
  - 永続化の明示的なオプトイン
- テレメトリは送信しない。

## 保存データ

| データ | 場所 |
| --- | --- |
| ワークスペースのファイル | ユーザーが選んだフォルダ |
| バージョン履歴・LLM 設定 | OS の app data ディレクトリ内 `right-stuff.db` |
| エージェントモード | WebView の `localStorage` |
| API キー | OS キーチェーン |

`right-stuff.db` は WAL モードで開く。履歴にはファイル内容が含まれるため、
バックアップや共有の際は注意する。

## 既知の制約

- LLM は OpenAI 互換 API のみ対応する。Anthropic 固有の API は未対応。
- LLM による計画単位の承認キューは未実装。
- 承認履歴の監査ログとポリシー設定 UI は未実装。
- API キーのローテーションや複数キーの管理は未実装。
