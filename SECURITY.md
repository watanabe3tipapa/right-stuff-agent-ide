# セキュリティポリシー

Right-Stuff Agent IDE は、デスクトップ（Tauri）、ブラウザデモ、ランディングページで構成される個人プロジェクトです。脆弱性の報告と対応方針を以下にまとめます。

## サポート対象

| バージョン | サポート |
| --- | --- |
| 0.3.x | サポート中 |
| 0.2.x 以前 | アップグレードを推奨 |

最新リリースは [Releases](https://github.com/watanabe3tipapa/right-stuff-agent-ide/releases) を参照してください。

デスクトップアプリの対応 OS は macOS 11 以降（Apple Silicon / Intel）のみです。Windows / Linux 版は提供していません。

## 脆弱性の報告

**公開 Issue で脆弱性を報告しないでください。**

GitHub の非公開脆弱性報告（Private Vulnerability Reporting）を利用してください。

- 報告フォーム: https://github.com/watanabe3tipapa/right-stuff-agent-ide/security/advisories/new

次の情報を含めてください。

- 影響を受けるバージョンと実行環境（Tauri 版 / ブラウザデモ / LP）
- OS とバージョン
- 再現手順または最小の再現コード
- 想定される影響（情報漏えい、任意コード実行、権限昇格など）
- 回避策や修正案があればその内容
- 公開を希望する場合の希望日（調整可能です）

API キー、アクセストークン、個人情報などの機密情報は報告に含めないでください。必要な場合は、安全な共有方法を別途相談してください。

## 対応の目安

- 受付確認: 7 日以内（ベストエフォート）
- 初期評価: 14 日以内
- 修正と公開: 影響度と再現性に応じて調整

個人プロジェクトのため、上記は保証ではありません。修正が完了するまで、詳細の公開をお控えください。調整のうえ、クレジットを掲載します。

## 対象範囲

- Tauri アプリの Rust バックエンド（パス検証、ファイル操作、エージェント実行、LLM / Openship / Git / ターミナル連携）
- React フロントエンド（権限判定、承認 UI、CSP の回避）
- ブラウザデモのサンプル実装
- ランディングページと配布物

## 対象外

- 依存ライブラリや外部サービスの脆弱性（該当プロジェクトへ報告してください。本リポジトリでも依存更新として追跡します）
- ユーザーが統合ターミナルで実行したコマンド
- Agent Desktop CLI 自体の挙動
- LLM プロバイダーや Openship サーバーの実装
- ソーシャルエンジニアリングやフィッシング
- 設定を変更していない限り影響しない、想定されたローカル権限の範囲内の操作

## セキュリティ設計

パス検証、エージェントの承認フロー、API キーの保存、CSP、監査ログなどの詳細は [docs/SECURITY.md](./docs/SECURITY.md) を参照してください。

## 安全な調査

本プロジェクトの範囲内で、次の条件を守る限り、善意のセキュリティ調査を歓迎します。

- 自分の環境または明示的な許可を得た環境でのみ検証する
- 他のユーザーのデータやサービスへアクセスしない
- サービス妨害、大量リクエスト、ソーシャルエンジニアリングを行わない
- 発見した問題を公開前に報告する

---

# Security Policy

Right-Stuff Agent IDE is a personal project consisting of a desktop app (Tauri), a browser demo, and a landing page.

## Supported versions

| Version | Supported |
| --- | --- |
| 0.3.x | Yes |
| 0.2.x and earlier | Please upgrade |

The desktop app supports macOS 11 or later (Apple Silicon and Intel) only. No Windows or Linux builds are provided.

## Reporting a vulnerability

**Do not report vulnerabilities in public issues.**

Use GitHub Private Vulnerability Reporting:

- Report form: https://github.com/watanabe3tipapa/right-stuff-agent-ide/security/advisories/new

Please include the affected version and runtime (Tauri, browser demo, or landing page), your OS, reproduction steps, the expected impact, and any suggested fix. Do not include secrets or personal data.

## Response targets

- Acknowledgment: within 7 days (best effort)
- Initial assessment: within 14 days
- Fix and disclosure: based on severity and reproducibility

These targets are not guarantees. Please keep details private until a fix is available.

## Scope

In scope: the Rust backend (path validation, file operations, agent execution, LLM / Openship / Git / terminal integrations), the React frontend (permission checks, approval UI, CSP bypasses), the browser demo, and the landing page.

Out of scope: vulnerabilities in third-party dependencies or external services (report them upstream), commands run by the user in the integrated terminal, the Agent Desktop CLI itself, LLM provider and Openship server implementations, and social engineering.

See [docs/SECURITY.md](./docs/SECURITY.md) for the security design.
