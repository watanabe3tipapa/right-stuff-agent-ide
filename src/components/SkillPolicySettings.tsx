import { useEffect, useState } from "react";

import type {
  SkillDecision,
  SkillManifest,
  SkillPolicy,
} from "../shared/types";
import { api, errorMessage } from "../lib/api";
import {
  DEFAULT_SKILL_POLICY,
  SKILL_DECISION_LABELS,
} from "../lib/skills";
import { useAgentStore } from "../stores/agentStore";
import { Icon } from "./Icon";

function decisionOptions(risk: SkillManifest["risk"]): SkillDecision[] {
  return risk === "read" ? ["allow", "ask", "block"] : ["ask", "block"];
}

function samePolicy(a: SkillPolicy, b: SkillPolicy): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function SkillPolicyRows({
  skills,
  draft,
  disabled,
  onChange,
}: {
  skills: SkillManifest[];
  draft: SkillPolicy;
  disabled: boolean;
  onChange: (actionId: string, decision: SkillDecision) => void;
}) {
  return (
    <>
      {skills.map((skill) => (
        <section className="policy-group" key={skill.id}>
          <div className="policy-group-head">
            <h4>
              {skill.name} <code>{skill.id}</code>
            </h4>
            <p>{skill.description}</p>
          </div>
          <div className="policy-rows">
            {skill.actions.map((action) => {
              const decision =
                draft.actions[action.id] ??
                draft.skills[skill.id] ??
                (action.risk === "read" ? "allow" : "ask");
              return (
                <div className="policy-row" key={action.id}>
                  <code className="policy-action">{action.id}</code>
                  <select
                    className="policy-select"
                    value={decision}
                    onChange={(event) =>
                      onChange(action.id, event.target.value as SkillDecision)
                    }
                    disabled={disabled}
                    aria-label={`${action.id} のスキルポリシー`}
                  >
                    {decisionOptions(action.risk).map((option) => (
                      <option key={option} value={option}>
                        {SKILL_DECISION_LABELS[option]}
                      </option>
                    ))}
                  </select>
                  <span className="policy-help">{action.description}</span>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}

export function SkillPolicySettings() {
  const skills = useAgentStore((state) => state.skills);
  const skillsLoading = useAgentStore((state) => state.skillsLoading);
  const skillPolicy = useAgentStore((state) => state.skillPolicy);
  const policyLoading = useAgentStore((state) => state.skillPolicyLoading);
  const policyError = useAgentStore((state) => state.skillPolicyError);
  const refreshSkills = useAgentStore((state) => state.refreshSkills);
  const refreshSkillPolicy = useAgentStore((state) => state.refreshSkillPolicy);
  const saveSkillPolicy = useAgentStore((state) => state.saveSkillPolicy);
  const closeSettings = useAgentStore((state) => state.closeSettings);

  const [draft, setDraft] = useState<SkillPolicy>(DEFAULT_SKILL_POLICY);
  const [saved, setSaved] = useState<SkillPolicy>(DEFAULT_SKILL_POLICY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const demo = !api.isTauri;

  useEffect(() => {
    void refreshSkills();
    void refreshSkillPolicy();
  }, [refreshSkills, refreshSkillPolicy]);

  useEffect(() => {
    if (skillPolicy) {
      setDraft(skillPolicy);
      setSaved(skillPolicy);
    }
  }, [skillPolicy]);

  useEffect(() => {
    if (policyError) setError(policyError);
  }, [policyError]);

  const dirty = !samePolicy(draft, saved);
  const loading = policyLoading || skillsLoading;

  function updateAction(actionId: string, decision: SkillDecision) {
    setDraft((current) => ({
      ...current,
      actions: { ...current.actions, [actionId]: decision },
    }));
    setNotice(null);
    setError(null);
  }

  function setAutoRun(enabled: boolean) {
    setDraft((current) => ({
      ...current,
      verification: { ...current.verification, autoRun: enabled },
    }));
    setNotice(null);
    setError(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const savedPolicy = await saveSkillPolicy(draft);
      setDraft(savedPolicy);
      setSaved(savedPolicy);
      setNotice("スキルポリシーを保存しました。");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="settings-body">
        {demo && (
          <div className="dialog-note warn" role="note">
            ブラウザデモではスキルポリシーを保存できません。
            <code>npm run tauri dev</code> で Tauri 版を起動してください。
          </div>
        )}

        {loading && !skillPolicy ? (
          <div className="policy-loading">
            <span className="typing typing-inline">
              <span />
              <span />
              <span />
            </span>
            スキルポリシーを読み込み中…
          </div>
        ) : (
          <>
            <div className="dialog-note" role="note">
              書き込み・破壊的操作を「許可」にすることはできません。承認は実行のたびに
              OS のダイアログで確認します。
            </div>

            {skills && skills.skills.length > 0 ? (
              <SkillPolicyRows
                skills={skills.skills}
                draft={draft}
                disabled={demo || saving || loading}
                onChange={updateAction}
              />
            ) : (
              <div className="plan-empty">
                <Icon name="sparkles" size={18} />
                <p>
                  <code>.agents/skills/</code> に v1
                  マニフェストを追加すると、ここでアクションごとのポリシーを設定できます。
                </p>
              </div>
            )}

            <section className="policy-group">
              <div className="policy-group-head">
                <h4>検証ループ</h4>
                <p>
                  変更後の typecheck / lint / test の実行方法です。検証ループは
                  v0.5 で実装します。
                </p>
              </div>
              <div className="policy-audit">
                <label className="policy-check">
                  <input
                    type="checkbox"
                    checked={draft.verification.autoRun}
                    onChange={(event) => setAutoRun(event.target.checked)}
                    disabled={demo || saving || loading}
                  />
                  承認後に自動で検証する
                </label>
              </div>
              <p className="field-help">
                自動実行の対象は typecheck と lint です。test
                はプロジェクトのコードを実行するため、常に確認を挟みます。
              </p>
            </section>

            <div className="policy-reset">
              <button
                type="button"
                className="btn small ghost"
                onClick={() => {
                  setDraft(DEFAULT_SKILL_POLICY());
                  setNotice(null);
                  setError(null);
                }}
                disabled={demo || saving || loading}
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
          disabled={demo || saving || loading || !skillPolicy || !dirty}
        >
          {saving ? "保存中…" : "ポリシーを保存"}
        </button>
      </div>
    </>
  );
}
