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

  function setAutoFix(mode: SkillPolicy["verification"]["autoFix"]) {
    setDraft((current) => ({
      ...current,
      verification: { ...current.verification, autoFix: mode },
    }));
    setNotice(null);
    setError(null);
  }

  function setMaxFixAttempts(value: number) {
    setDraft((current) => ({
      ...current,
      verification: {
        ...current.verification,
        maxFixAttempts: Math.min(3, Math.max(1, Math.round(value))),
      },
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
                <h4>検証と自動修正</h4>
                <p>
                  変更後の typecheck / lint / test の実行方法と、失敗したときの
                  自動修正の扱いです。
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
              <div className="policy-row">
                <label className="field-label" htmlFor="auto-fix-mode">
                  自動修正
                </label>
                <select
                  id="auto-fix-mode"
                  className="policy-select"
                  value={draft.verification.autoFix}
                  onChange={(event) =>
                    setAutoFix(
                      event.target.value as SkillPolicy["verification"]["autoFix"],
                    )
                  }
                  disabled={demo || saving || loading}
                >
                  <option value="off">無効</option>
                  <option value="manual">ボタンから実行</option>
                  <option value="auto">Autonomous で自動実行</option>
                </select>
                <span className="policy-help">
                  修正案の生成時だけ、変更ファイルと失敗出力を設定済み LLM
                  へ送信します。適用は毎回承認します。
                </span>
              </div>
              <div className="policy-row">
                <label className="field-label" htmlFor="max-fix-attempts">
                  最大修正回数
                </label>
                <select
                  id="max-fix-attempts"
                  className="policy-select"
                  value={draft.verification.maxFixAttempts}
                  onChange={(event) =>
                    setMaxFixAttempts(Number(event.target.value))
                  }
                  disabled={demo || saving || loading}
                >
                  <option value={1}>1 回</option>
                  <option value={2}>2 回</option>
                  <option value={3}>3 回</option>
                </select>
                <span className="policy-help">
                  同じ失敗が続いた場合は、回数に達する前に停止します。
                </span>
              </div>
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
