import { useEffect, useState } from "react";

import type { AppleFmStatus, LlmConfig, LlmTestResult } from "../shared/types";
import { api, errorMessage } from "../lib/api";
import { useAgentStore } from "../stores/agentStore";
import { Icon } from "./Icon";

function apiBaseUrl(host: string, port: number): string {
  const trimmed = host.trim() || "127.0.0.1";
  const normalized =
    trimmed.includes(":") && !trimmed.startsWith("[") ? `[${trimmed}]` : trimmed;
  return `http://${normalized}:${port}/v1`;
}

function preferredModel(status: AppleFmStatus | null): string {
  const available = status?.models.find((model) => model.available);
  return available?.id ?? "system";
}

export function AppleFmSettings() {
  const closeSettings = useAgentStore((state) => state.closeSettings);
  const refreshLlm = useAgentStore((state) => state.refreshLlm);

  const [status, setStatus] = useState<AppleFmStatus | null>(null);
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("1976");
  const [model, setModel] = useState("system");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"start" | "stop" | "apply" | "test" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<LlmTestResult | null>(null);

  const demo = !api.isTauri;
  const portNumber = Number.parseInt(port, 10);
  const portValid = Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535;
  const selectedModel =
    status?.models.find((entry) => entry.id === model)?.available === true
      ? model
      : preferredModel(status);

  function applyStatus(next: AppleFmStatus, syncFields: boolean) {
    setStatus(next);
    if (syncFields) {
      setHost(next.host);
      setPort(String(next.port));
      setModel(preferredModel(next));
    }
  }

  async function refresh(syncFields = false) {
    setLoading(true);
    setError(null);
    try {
      applyStatus(await api.appleFmStatus(), syncFields);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    api
      .appleFmStatus()
      .then((next) => {
        if (cancelled) return;
        applyStatus(next, true);
      })
      .catch((caught) => {
        if (!cancelled) setError(errorMessage(caught));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function startServer() {
    if (!portValid) {
      setError("ポートは 1 から 65535 の範囲で指定してください。");
      return;
    }
    setBusy("start");
    setError(null);
    setNotice(null);
    setTestResult(null);
    try {
      const next = await api.appleFmStart(host, portNumber);
      applyStatus(next, true);
      setNotice("fm serve を起動しました。");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function stopServer() {
    setBusy("stop");
    setError(null);
    setNotice(null);
    setTestResult(null);
    try {
      applyStatus(await api.appleFmStop(), false);
      setNotice("fm serve を停止しました。");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function applyToLlm(andTest: boolean) {
    if (!portValid) {
      setError("ポートは 1 から 65535 の範囲で指定してください。");
      return;
    }

    setBusy(andTest ? "test" : "apply");
    setError(null);
    setNotice(null);
    setTestResult(null);
    try {
      const targetHost = host.trim() || "127.0.0.1";
      const needsStart =
        !status?.serverRunning ||
        status.host !== targetHost ||
        status.port !== portNumber;
      if (needsStart) {
        const started = await api.appleFmStart(targetHost, portNumber);
        applyStatus(started, true);
        if (!started.serverRunning) {
          throw new Error(started.message);
        }
      }

      const current: LlmConfig = await api.llmConfig();
      const saved = await api.llmConfigSet({
        ...current,
        provider: "applefm",
        baseUrl: apiBaseUrl(host, portNumber),
        model: selectedModel,
      });
      await refreshLlm();
      setNotice(
        `LLM を Apple FM（${saved.model}）に設定しました。${apiBaseUrl(host, portNumber)}`,
      );

      if (andTest) {
        setTestResult(await api.llmTest());
      }
      await refresh(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  const command = `fm serve --host ${host || "127.0.0.1"} --port ${port || "1976"}`;

  return (
    <>
      <div className="settings-body">
        {demo && (
          <div className="dialog-note warn" role="note">
            ブラウザデモでは Apple FM を検出・起動できません。
            <code>npm run tauri dev</code> で Tauri 版を起動してください。
          </div>
        )}
        {status && !status.supported && (
          <div className="dialog-note warn" role="note">
            Apple FM は Apple Silicon（arm64）専用です。Intel Mac では OpenAI
            などのプロバイダーを利用してください。
          </div>
        )}

        <div className="settings-section-head">
          <div>
            <h4>Apple FM</h4>
            <p>
              macOS 27 の Foundation Models を OpenAI 互換の <code>fm serve</code>{" "}
              経由で利用します。API キーは不要で、入力が端末外へ送信されません。
              Apple Intelligence を有効にし、初回は <code>sudo fm license</code>{" "}
              に同意してください。
            </p>
          </div>
          <button
            type="button"
            className="btn small ghost"
            onClick={() => void refresh(false)}
            disabled={demo || loading || busy !== null}
          >
            <Icon name="refresh" size={12} />
            再検出
          </button>
        </div>

        <div className="openship-status">
          <div className="openship-status-row">
            <span className={`health-dot${status?.serverRunning ? " online" : ""}`} />
            <span>
              fm serve:{" "}
              {status?.serverRunning
                ? status.managed
                  ? "起動中（このアプリで管理）"
                  : "起動中（外部プロセス）"
                : "停止中"}
            </span>
            <span className="tools-badge">
              {status?.binary ? "fm 検出済み" : "fm 未検出"}
            </span>
            <div className="deploy-summary-actions">
              {status?.serverRunning ? (
                <button
                  type="button"
                  className="btn small ghost"
                  onClick={() => void stopServer()}
                  disabled={demo || !status?.managed || busy !== null}
                >
                  {busy === "stop" ? "停止中…" : "停止"}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn small"
                  onClick={() => void startServer()}
                  disabled={demo || !status?.supported || !portValid || busy !== null}
                >
                  {busy === "start" ? "起動中…" : "サーバーを起動"}
                </button>
              )}
            </div>
          </div>
          {status?.message && <p className="field-help">{status.message}</p>}
          {status?.binary && (
            <p className="field-help">
              実行ファイル: <code>{status.binary}</code>
            </p>
          )}
        </div>

        <div className="settings-grid">
          <div>
            <label className="field-label" htmlFor="applefm-host">
              ホスト
            </label>
            <input
              id="applefm-host"
              className="text-input"
              value={host}
              onChange={(event) => {
                setHost(event.target.value);
                setError(null);
                setNotice(null);
              }}
              placeholder="127.0.0.1"
              spellCheck={false}
              autoComplete="off"
              disabled={demo || busy !== null}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="applefm-port">
              ポート
            </label>
            <input
              id="applefm-port"
              className="text-input"
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(event) => {
                setPort(event.target.value);
                setError(null);
                setNotice(null);
              }}
              disabled={demo || busy !== null}
            />
          </div>
        </div>
        <p className="field-help">
          ローカル専用です。ホストは <code>127.0.0.1</code> / <code>localhost</code> /{" "}
          <code>::1</code> のみ指定できます。API の Base URL は{" "}
          <code>{apiBaseUrl(host, portValid ? portNumber : 1976)}</code> です。
        </p>

        <label className="field-label">モデル</label>
        <div className="model-chips">
          {(status?.models ?? []).map((entry) => (
            <button
              type="button"
              key={entry.id}
              className={`model-chip${entry.id === selectedModel ? " active" : ""}`}
              onClick={() => {
                setModel(entry.id);
                setError(null);
                setNotice(null);
              }}
              disabled={demo || !entry.available || busy !== null}
              title={entry.reason ?? undefined}
            >
              {entry.id}
            </button>
          ))}
        </div>
        <p className="field-help">
          <code>system</code> はオンデバイス、<code>pcc</code> は Private Cloud
          Compute です。PCC はターミナルから起動した場合のみ利用できます。
        </p>

        <div className="settings-divider" />

        <label className="field-label">手動で起動する場合</label>
        <pre className="settings-command">
          <code>{command}</code>
        </pre>
        <p className="field-help">
          上のボタンを使わずにターミナルで起動することもできます。停止するには
          <code>Ctrl+C</code> を押してください。
        </p>

        {testResult && (
          <div className={`test-result ${testResult.ok ? "ok" : "ng"}`} role="status">
            <div className="test-result-head">
              <Icon name={testResult.ok ? "check" : "alert"} size={13} />
              <span>{testResult.message}</span>
            </div>
          </div>
        )}

        {error && (
          <div className="dialog-error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="dialog-notice" role="status">
            {notice}
          </div>
        )}
      </div>

      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={closeSettings}>
          閉じる
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => void applyToLlm(false)}
          disabled={demo || !status?.supported || !portValid || busy !== null}
        >
          {busy === "apply" ? "設定中…" : "LLM に設定"}
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={() => void applyToLlm(true)}
          disabled={demo || !status?.supported || !portValid || busy !== null}
        >
          {busy === "test" ? "テスト中…" : "設定して接続テスト"}
        </button>
      </div>
    </>
  );
}
