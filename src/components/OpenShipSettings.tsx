import { useEffect, useState } from "react";

import type { OpenShipConfig, OpenShipSettings } from "../shared/types";
import { api, errorMessage } from "../lib/api";
import { useAgentStore } from "../stores/agentStore";
import { Icon } from "./Icon";

function configFrom(settings: OpenShipSettings): OpenShipConfig {
  return {
    baseUrl: settings.baseUrl,
    organizationId: settings.organizationId,
    projectId: settings.projectId,
    branch: settings.branch,
    cliPath: settings.cliPath,
  };
}

function sameConfig(a: OpenShipConfig, b: OpenShipConfig): boolean {
  return (
    a.baseUrl === b.baseUrl &&
    a.organizationId === b.organizationId &&
    a.projectId === b.projectId &&
    a.branch === b.branch &&
    a.cliPath === b.cliPath
  );
}

const EMPTY_CONFIG: OpenShipConfig = {
  baseUrl: "",
  organizationId: "",
  projectId: "",
  branch: "main",
  cliPath: "",
};

export function OpenShipSettings() {
  const settings = useAgentStore((state) => state.openship);
  const status = useAgentStore((state) => state.openshipStatus);
  const loading = useAgentStore((state) => state.openshipLoading);
  const refreshOpenShip = useAgentStore((state) => state.refreshOpenShip);
  const saveConfig = useAgentStore((state) => state.saveOpenShipConfig);
  const saveToken = useAgentStore((state) => state.saveOpenShipToken);
  const deleteToken = useAgentStore((state) => state.deleteOpenShipToken);
  const closeSettings = useAgentStore((state) => state.closeSettings);

  const [draft, setDraft] = useState<OpenShipConfig>(EMPTY_CONFIG);
  const [saved, setSaved] = useState<OpenShipConfig>(EMPTY_CONFIG);
  const [tokenDraft, setTokenDraft] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const demo = !api.isTauri;

  useEffect(() => {
    if (!settings) void refreshOpenShip();
  }, [settings, refreshOpenShip]);

  useEffect(() => {
    if (settings) {
      const config = configFrom(settings);
      setDraft(config);
      setSaved(config);
    }
  }, [settings]);

  const dirty = !sameConfig(draft, saved);
  const tokenConfigured = settings?.tokenConfigured ?? false;

  function update<K extends keyof OpenShipConfig>(
    key: K,
    value: OpenShipConfig[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
    setError(null);
    setNotice(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await saveConfig(draft);
      const config = configFrom(result);
      setDraft(config);
      setSaved(config);
      setNotice("Openship 設定を保存しました。");
      await refreshOpenShip();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function persistToken() {
    if (!tokenDraft.trim()) {
      setError("Openship トークンを入力してください。");
      return;
    }
    setTokenBusy(true);
    setError(null);
    setNotice(null);
    try {
      await saveToken(tokenDraft);
      setTokenDraft("");
      setShowToken(false);
      setNotice("Openship トークンを OS キーチェーンに保存しました。");
      await refreshOpenShip();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setTokenBusy(false);
    }
  }

  async function removeToken() {
    setTokenBusy(true);
    setError(null);
    setNotice(null);
    try {
      await deleteToken();
      setNotice("Openship トークンを OS キーチェーンから削除しました。");
      await refreshOpenShip();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setTokenBusy(false);
    }
  }

  return (
    <>
      <div className="settings-body">
        {demo && (
          <div className="dialog-note warn" role="note">
            ブラウザデモでは Openship 設定を保存できません。
            <code>npm run tauri dev</code> で Tauri 版を起動してください。
          </div>
        )}

        <div className="settings-section-head">
          <div>
            <h4>接続</h4>
            <p>
              CLI が PATH にあれば CLI を優先します。CLI
              がない場合は、セルフホスト型 Openship の REST API を使用します。
              接続先・トークン・履歴はこの端末内にのみ保存されます。
            </p>
          </div>
          <button
            type="button"
            className="btn small ghost"
            onClick={() => void refreshOpenShip()}
            disabled={loading}
          >
            <Icon name="refresh" size={12} />
            接続確認
          </button>
        </div>

        <label className="field-label" htmlFor="openship-base-url">
          Base URL
        </label>
        <input
          id="openship-base-url"
          className="text-input"
          value={draft.baseUrl}
          onChange={(event) => update("baseUrl", event.target.value)}
          placeholder="https://openship.example.com"
          spellCheck={false}
          autoComplete="off"
          disabled={demo || loading || saving}
        />
        <p className="field-help">
          REST API を使う場合に指定します。http:// は localhost / 127.0.0.1 /
          ::1 でのみ使用できます。末尾のスラッシュと <code>/api</code> は自動で除去されます。
        </p>

        <div className="settings-grid">
          <div>
            <label className="field-label" htmlFor="openship-org">
              Organization ID（任意）
            </label>
            <input
              id="openship-org"
              className="text-input"
              value={draft.organizationId}
              onChange={(event) => update("organizationId", event.target.value)}
              placeholder="org_xxx"
              spellCheck={false}
              autoComplete="off"
              disabled={demo || loading || saving}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="openship-project">
              Project ID（任意）
            </label>
            <input
              id="openship-project"
              className="text-input"
              value={draft.projectId}
              onChange={(event) => update("projectId", event.target.value)}
              placeholder="proj_xxx"
              spellCheck={false}
              autoComplete="off"
              disabled={demo || loading || saving}
            />
          </div>
        </div>

        <div className="settings-grid">
          <div>
            <label className="field-label" htmlFor="openship-branch">
              ブランチ
            </label>
            <input
              id="openship-branch"
              className="text-input"
              value={draft.branch}
              onChange={(event) => update("branch", event.target.value)}
              placeholder="main"
              spellCheck={false}
              autoComplete="off"
              disabled={demo || loading || saving}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="openship-cli">
              CLI パス（任意）
            </label>
            <input
              id="openship-cli"
              className="text-input"
              value={draft.cliPath}
              onChange={(event) => update("cliPath", event.target.value)}
              placeholder="/usr/local/bin/openship"
              spellCheck={false}
              autoComplete="off"
              disabled={demo || loading || saving}
            />
          </div>
        </div>
        <p className="field-help">
          CLI パスを空にすると環境変数 <code>OPENSHIP_BIN</code> と{" "}
          <code>PATH</code> から検出します。
        </p>

        <div className="settings-divider" />

        <label className="field-label" htmlFor="openship-token">
          Personal Access Token
        </label>
        <div className="key-row">
          <input
            id="openship-token"
            className="text-input"
            type={showToken ? "text" : "password"}
            value={tokenDraft}
            onChange={(event) => {
              setTokenDraft(event.target.value);
              setError(null);
              setNotice(null);
            }}
            placeholder={
              tokenConfigured
                ? "設定済み（変更する場合は新しいトークンを入力）"
                : "PAT を入力"
            }
            autoComplete="off"
            spellCheck={false}
            disabled={demo || tokenBusy || loading}
          />
          <button
            type="button"
            className="icon-btn"
            onClick={() => setShowToken((value) => !value)}
            aria-label={showToken ? "トークンを隠す" : "トークンを表示"}
            title={showToken ? "トークンを隠す" : "トークンを表示"}
            disabled={demo || loading}
          >
            <Icon name={showToken ? "eye-off" : "eye"} size={14} />
          </button>
          <button
            type="button"
            className="btn small key-save"
            onClick={() => void persistToken()}
            disabled={demo || tokenBusy || loading || saving || !tokenDraft.trim()}
          >
            {tokenBusy ? "保存中…" : "トークンを保存"}
          </button>
        </div>

        <div className="key-status">
          <span className={`key-dot${tokenConfigured ? " on" : ""}`} />
          <span>
            {tokenConfigured
              ? "OS キーチェーンに保存済み"
              : "未設定（CLI のみ使う場合は不要です）"}
          </span>
          {tokenConfigured && (
            <button
              type="button"
              className="link-button danger"
              onClick={() => void removeToken()}
              disabled={demo || tokenBusy || loading || saving}
            >
              削除
            </button>
          )}
        </div>
        <p className="field-help">
          トークンは OS キーチェーンにのみ保存し、WebView
          には返しません。API 呼び出しは Rust 側で行います。
        </p>

        <div className="openship-status">
          <div className="openship-status-row">
            <span
              className={`health-dot${status?.cliAvailable ? " online" : ""}`}
            />
            <span>
              CLI:{" "}
              {status?.cliAvailable
                ? `${status.cliVersion ?? "検出済み"} (${status.cliPath})`
                : "未検出"}
            </span>
          </div>
          <div className="openship-status-row">
            <span
              className={`health-dot${status?.serverReachable ? " online" : ""}`}
            />
            <span>
              サーバー:{" "}
              {status?.serverConfigured
                ? status.serverReachable
                  ? "接続可能"
                  : "接続できません"
                : "未設定"}
            </span>
          </div>
          {status?.serverMessage && (
            <p className="field-help">{status.serverMessage}</p>
          )}
        </div>

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
          className="btn primary"
          onClick={() => void save()}
          disabled={demo || loading || saving || !dirty}
        >
          {saving ? "保存中…" : "設定を保存"}
        </button>
      </div>
    </>
  );
}
