import { useEffect, useState } from "react";

import type { AgentPolicy, AgentPolicyDecision } from "../shared/types";
import { api, errorMessage } from "../lib/api";
import { ALLOWED_ACTIONS } from "../lib/plan";
import {
  POLICY_DECISION_HELP,
  POLICY_DECISION_LABELS,
  allowedDecisions,
  defaultAgentPolicy,
  isReadOnlyAction,
} from "../lib/policy";
import { useAgentStore } from "../stores/agentStore";
import { Icon } from "./Icon";

function samePolicy(a: AgentPolicy, b: AgentPolicy): boolean {
  if (
    a.auditEnabled !== b.auditEnabled ||
    a.auditRetentionDays !== b.auditRetentionDays
  ) {
    return false;
  }
  return ALLOWED_ACTIONS.every(
    (action) => a.actions[action] === b.actions[action],
  );
}

function PolicyActions({
  title,
  description,
  actions,
  draft,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  actions: readonly string[];
  draft: AgentPolicy;
  disabled: boolean;
  onChange: (action: string, decision: AgentPolicyDecision) => void;
}) {
  return (
    <section className="policy-group">
      <div className="policy-group-head">
        <h4>{title}</h4>
        <p>{description}</p>
      </div>
      <div className="policy-rows">
        {actions.map((action) => {
          const decision = draft.actions[action] ?? "ask";
          return (
            <div className="policy-row" key={action}>
              <code className="policy-action">{action}</code>
              <select
                className="policy-select"
                value={decision}
                onChange={(event) =>
                  onChange(
                    action,
                    event.target.value as AgentPolicyDecision,
                  )
                }
                disabled={disabled}
                aria-label={`${action} のポリシー`}
              >
                {allowedDecisions(action).map((option) => (
                  <option key={option} value={option}>
                    {POLICY_DECISION_LABELS[option]}
                  </option>
                ))}
              </select>
              <span className="policy-help">
                {POLICY_DECISION_HELP[decision]}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function AgentPolicySettings() {
  const policy = useAgentStore((state) => state.policy);
  const policyLoading = useAgentStore((state) => state.policyLoading);
  const policyError = useAgentStore((state) => state.policyError);
  const refreshPolicy = useAgentStore((state) => state.refreshPolicy);
  const savePolicy = useAgentStore((state) => state.savePolicy);
  const closeSettings = useAgentStore((state) => state.closeSettings);

  const [draft, setDraft] = useState<AgentPolicy>(defaultAgentPolicy);
  const [saved, setSaved] = useState<AgentPolicy>(defaultAgentPolicy);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const demo = !api.isTauri;

  useEffect(() => {
    if (policy) {
      setDraft(policy);
      setSaved(policy);
    }
  }, [policy]);

  useEffect(() => {
    if (policyError) setError(policyError);
  }, [policyError]);

  const dirty = !samePolicy(draft, saved);

  function updateAction(action: string, decision: AgentPolicyDecision) {
    setDraft((current) => ({
      ...current,
      actions: { ...current.actions, [action]: decision },
    }));
    setNotice(null);
    setError(null);
  }

  function setAuditEnabled(enabled: boolean) {
    setDraft((current) => ({ ...current, auditEnabled: enabled }));
    setNotice(null);
    setError(null);
  }

  function setRetention(value: number) {
    setDraft((current) => ({
      ...current,
      auditRetentionDays: Math.max(1, Math.min(365, Math.round(value))),
    }));
    setNotice(null);
    setError(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const savedPolicy = await savePolicy(draft);
      setDraft(savedPolicy);
      setSaved(savedPolicy);
      setNotice("エージェントポリシーを保存しました。");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  const readOnlyActions = ALLOWED_ACTIONS.filter((action) =>
    isReadOnlyAction(action),
  );
  const mutatingActions = ALLOWED_ACTIONS.filter(
    (action) => !isReadOnlyAction(action),
  );

  return (
    <>
      <div className="settings-body">
        {demo && (
          <div className="dialog-note warn" role="note">
            ブラウザデモではエージェントポリシーを保存できません。<code>npm run tauri dev</code> で Tauri 版を起動してください。
          </div>
        )}

        {policyLoading && !policy ? (
          <div className="policy-loading">
            <span className="typing typing-inline">
              <span />
              <span />
              <span />
            </span>
            ポリシーを読み込み中…
          </div>
        ) : (
          <>
            <section className="policy-group">
              <div className="policy-group-head">
                <h4>監査ログ</h4>
                <p>
                  計画の承認・却下、操作の実行、ポリシー変更をローカルの SQLite
                  に記録します。
                </p>
              </div>
              <div className="policy-audit">
                <label className="policy-check">
                  <input
                    type="checkbox"
                    checked={draft.auditEnabled}
                    onChange={(event) =>
                      setAuditEnabled(event.target.checked)
                    }
                    disabled={demo || saving || policyLoading}
                  />
                  監査ログを有効にする
                </label>
                <label className="policy-retention">
                  保持期間
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={draft.auditRetentionDays}
                    onChange={(event) => {
                      const value = Number.parseInt(event.target.value, 10);
                      setRetention(Number.isFinite(value) ? value : 30);
                    }}
                    disabled={demo || saving || policyLoading}
                  />
                  日
                </label>
              </div>
              <p className="field-help">
                最新 5,000 件まで保持し、期間を過ぎた記録は次回の記録時に削除します。
                監査ログを無効にしても、すでに保存された記録は残ります。
              </p>
            </section>

            <PolicyActions
              title="読み取り専用アクション"
              description="snapshot や一覧取得など、状態を変更しない操作です。許可・確認・禁止を選べます。"
              actions={readOnlyActions}
              draft={draft}
              disabled={demo || saving || policyLoading}
              onChange={updateAction}
            />

            <PolicyActions
              title="変更アクション"
              description="クリック・入力・アプリ起動など、状態を変更する操作です。ネイティブ承認を省略することはできません。"
              actions={mutatingActions}
              draft={draft}
              disabled={demo || saving || policyLoading}
              onChange={updateAction}
            />

            <div className="policy-reset">
              <button
                type="button"
                className="btn small ghost"
                onClick={() => {
                  setDraft(defaultAgentPolicy());
                  setNotice(null);
                  setError(null);
                }}
                disabled={demo || saving || policyLoading}
              >
                既定値に戻す
              </button>
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
            {policyError && !policy && (
              <button
                type="button"
                className="btn small"
                onClick={() => void refreshPolicy()}
              >
                <Icon name="refresh" size={12} />
                再読み込み
              </button>
            )}
          </>
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
          disabled={
            demo || saving || policyLoading || !policy || !dirty
          }
        >
          {saving ? "保存中…" : "ポリシーを保存"}
        </button>
      </div>
    </>
  );
}
