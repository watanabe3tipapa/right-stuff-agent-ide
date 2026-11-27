import { useEffect, useState } from "react";

import type { OpencodeStatus } from "../shared/types";
import { api, errorMessage } from "../lib/api";
import { useAgentStore } from "../stores/agentStore";
import { Icon } from "./Icon";

export function OpenCodeSettings() {
  const closeSettings = useAgentStore((state) => state.closeSettings);

  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState("");
  const [status, setStatus] = useState<OpencodeStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const demo = !api.isTauri;

  async function refresh() {
    setLoading(true);
    try {
      const [path, current] = await Promise.all([
        api.opencodeConfig(),
        api.opencodeStatus(),
      ]);
      setDraft(path);
      setSaved(path);
      setStatus(current);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const dirty = draft.trim() !== saved.trim();

  function update(value: string) {
    setDraft(value);
    setError(null);
    setNotice(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await api.opencodeConfigSet(draft);
      setSaved(draft.trim());
      setNotice("OpenCode 設定を保存しました。");
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function redetect() {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      setStatus(await api.opencodeStatus());
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="settings-body">
        {demo && (
          <div className="dialog-note warn" role="note">
            ブラウザデモでは OpenCode 設定を保存できません。
            <code>npm run tauri dev</code> で Tauri 版を起動してください。
          </div>
        )}

        <div className="settings-section-head">
          <div>
            <h4>OpenCode</h4>
            <p>
              自然言語デプロイに使う <code>opencode</code> の実行ファイルを指定します。
              同梱はしていないため、1.2.0 以上を別途インストールしてください。
              認証は OpenCode 自身のストアで管理されます。
            </p>
          </div>
          <button
            type="button"
            className="btn small ghost"
            onClick={() => void redetect()}
            disabled={demo || loading}
          >
            <Icon name="refresh" size={12} />
            再検出
          </button>
        </div>

        <label className="field-label" htmlFor="opencode-path">
          実行ファイルのパス
        </label>
        <input
          id="opencode-path"
          className="text-input"
          value={draft}
          onChange={(event) => update(event.target.value)}
          placeholder="/opt/homebrew/bin/opencode"
          spellCheck={false}
          autoComplete="off"
          disabled={demo || loading || saving}
        />
        <p className="field-help">
          空にすると環境変数 <code>RIGHT_STUFF_OPENCODE</code> と{" "}
          <code>PATH</code> から検出します。指定する場合は絶対パスで入力してください。
        </p>

        <div className="openship-status">
          <div className="openship-status-row">
            <span
              className={`health-dot${status?.available ? " online" : ""}`}
            />
            <span>
              OpenCode:{" "}
              {status?.available
                ? `${status.version ?? "検出済み"} を検出`
                : "未検出"}
            </span>
          </div>
          {status?.binary && (
            <p className="field-help">
              実行ファイル: <code>{status.binary}</code>
            </p>
          )}
          {status?.message && <p className="field-help">{status.message}</p>}
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
