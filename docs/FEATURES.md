# 機能詳細

README に載せきれない機能一覧です。使い方の概要は [README.md](../README.md)、
設計は [ARCHITECTURE.md](./ARCHITECTURE.md)、スキルは [SKILLS.md](./SKILLS.md) を参照してください。

## 執筆と編集

- **ワークスペース** — フォルダを選ぶと配下のファイルを再帰的に一覧表示します。作成・名前変更・削除・再読み込みに対応し、前回のワークスペースは次回起動時に復元します
- **エディタ** — Monaco 0.52 によるシンタックスハイライト、タブ、未保存インジケーター、`⌘S` / `⌘⇧S` 保存。ワークスペース切替時と全タブクローズ時は、未保存の変更を「保存して続行」「保存せず続行」「キャンセル」から選択できます。ウィンドウを閉じる場合と `⌘Q` でも同じ確認を行います
- **Markdown プレビュー** — `react-markdown` + `remark-gfm` による GFM プレビューを分割表示します
- **バージョン履歴** — 保存のたびに SQLite (WAL) へ記録します。ファイルあたり最新 100 版を保持し、任意の版をプレビューしてエディタへ復元できます
- **ファイル操作** — 新規作成、名前変更、削除に対応します。削除は `.right-stuff/trash/<timestamp>/` へ移動するソフトデリートです
- **クイックオープン** — `⌘P` でワークスペース内のファイルを名前から絞り込み、キーボードだけで開けます
- **コマンドパレット** — `⌘K` / `⌘⇧P` からワークスペース、エディタ、エージェント、Git、ターミナルの操作を検索して実行します。`⌘P` はクイックオープン、`⌘J` はターミナルの表示切替です
- **テーマ** — ダークテーマ、Overlay タイトルバー、macOS ネイティブウィンドウ

## エージェント

- **エージェントパネル** — Chat / Plan / Skills / Git / Debug / Deploy / Audit / Runtime の 8 タブ。Passive / Assistive / Autonomous のモード切替、`/status`・`/snapshot`・`/plan`・`/ship`・`/deploy`・`/logs`・`/rollback` コマンド
- **LLM チャット** — OpenAI / Ollama / LM Studio / OpenRouter などの OpenAI 互換 API に接続します。ストリーミング表示、生成停止、接続テストに対応し、API キーは OS キーチェーンに保存します
- **計画立案と承認** — 意図を入力すると LLM が Agent Desktop の許可アクションだけを使った実行計画を生成します。手順ごとの引数検証、計画単位の承認、Assistive での個別実行、Autonomous での連続実行に対応し、モデルが生成した不正なアクションや引数は実行前に拒否します
- **Agent Desktop ブリッジ** — `agent-desktop` CLI を検出し、許可されたアクションのみ実行します。コマンドと出力はそのまま UI に表示します。スナップショットは取得前に毎回ネイティブ確認を表示します
- **エージェントポリシー** — 読み取り専用アクションは「許可 / 確認 / 禁止」、変更アクションは「確認 / 禁止」から選択します。変更アクションのネイティブ承認を省略することはできず、ポリシーで禁止した操作は Rust 側で実行前に拒否します
- **承認監査ログ** — 計画の作成・承認・却下・中止、操作の実行・拒否・キャンセル、ポリシー変更、Openship のデプロイ・ロールバックをローカルの SQLite に記録します。Audit タブで新しい順に確認でき、保持期間（既定 30 日）を過ぎた記録と最新 5,000 件を超えた記録は自動で削除します
- **実行の停止** — 実行中のターミナルスキルと検証チェックを、Skills タブの「停止」または Plan タブの「中止」から停止できます。停止は `runId` 単位でプロセスグループに伝わり、監査ログに `cancelled` として残ります

## スキルと検証

- **スキル実行** — `.agents/skills/*.json` の v1 マニフェストを読み込み・検証し、`editor.readFile` / `replaceText` / `createFile` / `checkJapanese` をポリシーと承認付きで実行します（Agent パネルの Skills タブと設定のスキルタブから操作）
- **検証ループ** — スキル実行後に `package.json` / `Cargo.toml` から解決した typecheck・lint・test を実行し、結果と出力を Skills タブに表示します。検証コマンドはワークスペース構成から決まり、マニフェストから任意のコマンドは受け取りません
- **検証の自動修正** — 検証に失敗したとき、変更ファイルと失敗出力だけを LLM に渡して `editor.replaceText` の修正案を作ります。適用は毎回ネイティブ承認を通し、合格・最大試行回数・同じ失敗の再発・中止で停止します。既定は手動実行で、Autonomous モードでは自動実行も選べます
- **日本語品質** — `docs/GLOSSARY.md` の用語集と `npm run glossary` の CI チェック、読み取り専用の `japanese-text` スキル（全角英数字・半角カタカナ・句読点・表記ゆれ）、静的テンプレートを同梱します
- **Git スキル** — `git.status` / `diff` / `branches` / `stage` / `stageAll` / `commit` を固定ハンドラで実行します。読み取り系は承認なし、書き込み系は承認ダイアログを挟み、結果はローカルの監査ログに残します
- **ターミナルスキル** — `terminal.run` が npm / pnpm / yarn / cargo / node / python3 / pytest / make を `program + args` で直接実行します。シェル文字列を組み立てず、独立プロセスグループ・タイムアウト・出力上限を適用します
- **デバッグスキル** — `debug.start` / `stop` / `continue` / `next` / `stepIn` / `pause` / `setBreakpoint` / `evaluate` が DAP の request/response で Debug タブと同じセッションを操作します。`debug.start` は initialize → launch → initialized → configurationDone のハンドシェイクを行います
- **HTML レポート** — スキル実行結果を、承認 → 実行 → 検証 → 結果のインライン SVG フロー図、明暗テーマ、パラメータ、変更ファイル、検証出力を含む自己完結 HTML としてプレビュー・保存します。外部 CDN やテレメトリは使わず、`.agents/reports/` にローカル保存します
- **スキルライブラリ** — キュレーション済みのスキルを人間が読める形で一覧するショーケース別窓です。目的・タグ・リスク・パラメータ・プロンプト例・マニフェストを表示し、その場でワークスペースへ追加できます

## IDE 機能

- **Git パネル** — 現在のブランチ、ahead / behind、変更・ステージ済み・未追跡を表示します。ステージ / ステージ解除、一括操作、差分プレビュー、コミット、直近の履歴に対応し、Git リポジトリでないフォルダでは `git init` を実行できます
- **統合ターミナル** — `⌘J` でワークスペース直下に PTY を開き、xterm.js で対話的に操作します。リサイズ、再起動、クリアに対応し、シェルは `RIGHT_STUFF_SHELL` → `SHELL` → `/bin/zsh` の順で解決します
- **Language Server (LSP)** — rust-analyzer / typescript-language-server / pyright / gopls / clangd / sourcekit-lsp / lua-language-server を固定レジストリから検出し、Monaco の補完・定義ジャンプ・ホバー・診断・名前変更 (F2)・参照検索 (⇧F12)・コードアクションに接続します。`⌘T` のワークスペースシンボル検索も利用できます。開いているタブを didOpen / didChange / didSave / didClose で同期し、診断件数をステータスバーに表示します
- **デバッガ (DAP)** — lldb-dap（C / C++ / Rust / Swift / Objective-C）と debugpy（Python）を固定レジストリから検出します。Debug タブで起動・停止、ブレークポイント、コールスタック、変数、出力を操作し、ブレークポイントは行番号左のクリックまたは F9 で切り替えます
- **ネイティブダイアログ** — 確認と入力はアプリ内モーダルで統一し、ブラウザのブロッキングダイアログを使いません

IDE 機能は搭載済みですが、競合製品と同等の完成度を目指して今後のバージョンでも継続的に高めていきます。

## 連携と配布

- **Openship 連携（ローカルファースト）** — Deploy タブからデプロイ履歴・ログ・ロールバックを操作します。`openship` CLI を検出できれば CLI を優先し、未検出のときのみセルフホスト REST API にフォールバックします。接続設定は SQLite、PAT は OS キーチェーンに保存し、変更操作は必ずネイティブ承認ダイアログを通ります。構成図は [Openship 構成図](./diagrams/openship-local-first.html) を参照してください
- **ブラウザデモ** — Tauri なしでも `npm run dev` でデモ用ワークスペースを操作できます。編集内容・履歴・スキルポリシーはそのブラウザの localStorage に保存され、デモバーの「初期状態に戻す」で削除できます
- **PWA** — ブラウザデモは manifest、service worker、オフラインページを持つ PWA としてインストールできます。Tauri 版では service worker を登録しません

## アーキテクチャ

- **フロントエンド**: Vite 8 + React 18.3 + TypeScript 6
- **エディタ**: Monaco Editor 0.52（`@monaco-editor/react`）
- **状態管理**: Zustand 5（workspace / editor / agent / git / lsp / dap）
- **デスクトップ基盤**: Tauri 2.0（Rust 2024 edition）
- **バックエンド**: Tauri コマンド（workspace / editor / agent / policy / llm / openship / git / terminal / lsp / dap / skills / report / settings / app）、パス検証、atomic write
- **Git / ターミナル**: `git` CLI を `std::process::Command` 経由で実行し、シェル文字列を組み立てません。ターミナルは `portable-pty` で PTY を確保し、出力を Tauri イベントで xterm.js へストリーミングします
- **LSP / DAP**: Content-Length フレーミングの JSON-RPC トランスポート（`src-tauri/src/rpc.rs`）を共用します。サーバー / アダプターは固定レジストリのみで、WebView から任意のコマンドは起動できません
- **データベース**: SQLite（WAL、`rusqlite` bundled）。バージョン履歴、設定、監査ログを保存します
- **ブリッジ**: `src/lib/api.ts` が `invoke` を薄くラップし、ブラウザでは `src/lib/demo.ts` にフォールバックします
- **パッケージ**: `tauri build`（`.app` / `.dmg`）
