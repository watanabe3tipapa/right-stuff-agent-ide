import { useEffect, useState } from "react";

import type { OpenShipDeployment } from "../shared/types";
import { useAgentStore } from "../stores/agentStore";
import { Icon } from "./Icon";

function statusClass(status: string): string {
  return status.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function formatTimestamp(value: number | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function DeploymentRow({
  deployment,
  selected,
  busy,
  canMutate,
  onLogs,
  onRollback,
}: {
  deployment: OpenShipDeployment;
  selected: boolean;
  busy: boolean;
  canMutate: boolean;
  onLogs: () => void;
  onRollback: () => void;
}) {
  return (
    <li className={`deploy-row${selected ? " selected" : ""}`}>
      <div className="deploy-row-main">
        <span className={`deploy-status ${statusClass(deployment.status)}`}>
          {deployment.status}
        </span>
        <code className="deploy-id">{deployment.id}</code>
        {deployment.environment && (
          <span className="deploy-env">{deployment.environment}</span>
        )}
        {deployment.branch && (
          <span className="deploy-branch">
            <Icon name="branch" size={11} />
            {deployment.branch}
          </span>
        )}
        <span className="deploy-time">{formatTimestamp(deployment.createdAt)}</span>
      </div>

      <div className="deploy-row-foot">
        {deployment.commit && (
          <code className="deploy-commit">{deployment.commit.slice(0, 12)}</code>
        )}
        {deployment.url && (
          <a
            className="deploy-url"
            href={deployment.url}
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="external" size={11} />
            {deployment.url}
          </a>
        )}
        <div className="deploy-row-actions">
          <button
            type="button"
            className="btn small ghost"
            onClick={onLogs}
            disabled={busy}
          >
            <Icon name="terminal" size={12} />
            ログ
          </button>
          <button
            type="button"
            className="btn small ghost"
            onClick={onRollback}
            disabled={busy || !canMutate}
            title={
              canMutate
                ? "このデプロイへロールバック"
                : "Passive モードではロールバックできません"
            }
          >
            ロールバック
          </button>
        </div>
      </div>
    </li>
  );
}

export function DeployPanel() {
  const mode = useAgentStore((state) => state.mode);
  const settings = useAgentStore((state) => state.openship);
  const status = useAgentStore((state) => state.openshipStatus);
  const deployments = useAgentStore((state) => state.openshipDeployments);
  const logs = useAgentStore((state) => state.openshipLogs);
  const loading = useAgentStore((state) => state.openshipLoading);
  const busy = useAgentStore((state) => state.openshipBusy);
  const error = useAgentStore((state) => state.openshipError);
  const notice = useAgentStore((state) => state.openshipNotice);
  const lastResult = useAgentStore((state) => state.openshipLastResult);
  const refreshOpenShip = useAgentStore((state) => state.refreshOpenShip);
  const refreshDeployments = useAgentStore(
    (state) => state.refreshOpenShipDeployments,
  );
  const deploy = useAgentStore((state) => state.deployOpenShip);
  const loadLogs = useAgentStore((state) => state.loadOpenShipLogs);
  const rollback = useAgentStore((state) => state.rollbackOpenShip);
  const clearNotice = useAgentStore((state) => state.clearOpenShipNotice);
  const openSettings = useAgentStore((state) => state.openSettings);

  const [projectId, setProjectId] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) void refreshOpenShip();
  }, [settings, refreshOpenShip]);

  useEffect(() => {
    setProjectId(settings?.projectId ?? "");
  }, [settings?.projectId]);

  useEffect(() => {
    if (settings?.baseUrl && settings.tokenConfigured) {
      void refreshDeployments();
    }
  }, [settings?.baseUrl, settings?.tokenConfigured, refreshDeployments]);

  const online = Boolean(status?.cliAvailable || status?.serverReachable);
  const canMutate = mode !== "passive";
  const selectedLogs = selected ? logs[selected] : undefined;
  const needsSetup = !status?.cliAvailable && !status?.serverConfigured;

  return (
    <div className="deploy-panel">
      <div className={`deploy-summary${online ? " online" : ""}`}>
        <div className="deploy-summary-head">
          <span className={`health-dot${online ? " online" : ""}`} />
          <span>
            {status?.cliAvailable
              ? "Openship CLI 検出済み"
              : status?.serverReachable
                ? "Openship API 接続可能"
                : "Openship 未接続"}
          </span>
          <span className="deploy-summary-actions">
            <button
              type="button"
              className="btn small ghost"
              onClick={() => void refreshOpenShip()}
              disabled={loading}
            >
              <Icon name="refresh" size={12} />
              更新
            </button>
            <button
              type="button"
              className="btn small ghost"
              onClick={openSettings}
            >
              <Icon name="gear" size={12} />
              設定
            </button>
          </span>
        </div>
        <p>{status?.serverMessage ?? "接続状態を確認しています…"}</p>
        <p className="deploy-local-first">
          ローカルファースト: CLI と自ホスト API
          のみを使用し、設定・トークン・監査ログはこの端末から出ません。
        </p>
      </div>

      <dl className="deploy-meta">
        <div>
          <dt>Base URL</dt>
          <dd>{status?.baseUrl || settings?.baseUrl || "—"}</dd>
        </div>
        <div>
          <dt>CLI</dt>
          <dd>{status?.cliVersion ?? (status?.cliAvailable ? "検出済み" : "—")}</dd>
        </div>
        <div>
          <dt>トークン</dt>
          <dd>{settings?.tokenConfigured ? "キーチェーンに保存済み" : "未設定"}</dd>
        </div>
      </dl>

      {needsSetup && (
        <div className="deploy-notice">
          <Icon name="alert" size={13} />
          <span>
            Openship CLI を PATH に配置するか、設定画面で Base URL と PAT
            を登録してください。
          </span>
          <button type="button" className="btn small" onClick={openSettings}>
            設定を開く
          </button>
        </div>
      )}

      <form
        className="deploy-form"
        onSubmit={(event) => {
          event.preventDefault();
          clearNotice();
          void deploy(projectId.trim() || undefined);
        }}
      >
        <label className="field-label" htmlFor="openship-project">
          プロジェクト ID
        </label>
        <div className="deploy-form-row">
          <input
            id="openship-project"
            className="text-input"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            placeholder="proj_xxx（設定済みなら省略できます）"
            spellCheck={false}
            autoComplete="off"
            disabled={busy}
          />
          <button
            type="submit"
            className="btn small primary"
            disabled={busy || !canMutate || needsSetup}
            title={
              canMutate
                ? "ネイティブ承認ダイアログを経てデプロイします"
                : "Passive モードではデプロイできません"
            }
          >
            <Icon name="send" size={12} />
            {busy ? "実行中…" : "デプロイ"}
          </button>
        </div>
        <p className="field-help">
          CLI が検出できればカレントワークスペースで{" "}
          <code>openship --json deploy</code> を実行します。CLI
          がなければ REST API の <code>POST /api/deployments</code>
          を使用します。実行前にネイティブ承認ダイアログが表示されます。
        </p>
      </form>

      {error && (
        <div className="deploy-error" role="alert">
          <Icon name="alert" size={13} />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="deploy-notice ok" role="status">
          <Icon name="check" size={13} />
          <span>{notice}</span>
        </div>
      )}

      {lastResult && (
        <details className="deploy-result" open={!lastResult.ok}>
          <summary>
            最後の実行: {lastResult.command.join(" ")} (exit{" "}
            {lastResult.code ?? "?"})
          </summary>
          <pre>{lastResult.stdout || lastResult.stderr || "(出力なし)"}</pre>
        </details>
      )}

      <section className="deploy-history">
        <div className="deploy-history-head">
          <h4>最近のデプロイ</h4>
          <button
            type="button"
            className="btn small ghost"
            onClick={() => void refreshDeployments()}
            disabled={busy || !settings?.tokenConfigured}
          >
            <Icon name="refresh" size={12} />
            再読み込み
          </button>
        </div>

        {deployments.length === 0 ? (
          <div className="plan-empty">
            <Icon name="history" size={18} />
            <p>
              REST API を設定すると、デプロイ履歴・ログ・ロールバックをここから操作できます。
            </p>
            <ul>
              <li>デプロイは CLI 優先、未検出なら REST API を使用します</li>
              <li>変更操作は実行前にネイティブ承認ダイアログで確認します</li>
              <li>実行結果は監査ログに記録されます</li>
            </ul>
          </div>
        ) : (
          <ul className="deploy-list">
            {deployments.map((deployment) => (
              <DeploymentRow
                key={deployment.id}
                deployment={deployment}
                selected={selected === deployment.id}
                busy={busy}
                canMutate={canMutate}
                onLogs={() => {
                  setSelected(deployment.id);
                  void loadLogs(deployment.id);
                }}
                onRollback={() => void rollback(deployment.id)}
              />
            ))}
          </ul>
        )}

        {selected && (
          <div className="deploy-logs">
            <div className="deploy-logs-head">
              <span>
                <Icon name="terminal" size={12} />
                ログ: {selected}
              </span>
              <div>
                <button
                  type="button"
                  className="btn small ghost"
                  onClick={() => void loadLogs(selected)}
                  disabled={busy}
                >
                  <Icon name="refresh" size={12} />
                  更新
                </button>
                <button
                  type="button"
                  className="btn small ghost"
                  onClick={() => setSelected(null)}
                >
                  <Icon name="x" size={12} />
                  閉じる
                </button>
              </div>
            </div>
            <pre>
              {selectedLogs
                ? selectedLogs.logs
                : busy
                  ? "ログを読み込んでいます…"
                  : "(ログなし)"}
            </pre>
          </div>
        )}
      </section>
    </div>
  );
}
