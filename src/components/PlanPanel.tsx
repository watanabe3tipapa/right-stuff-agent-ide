import { useState } from "react";

import type {
  AgentPlan,
  AgentPlanStatus,
  PlanStepStatus,
} from "../shared/types";
import { MAX_PLAN_INTENT_CHARS } from "../lib/plan";
import { skillRiskLabel } from "../lib/skills";
import { useAgentStore } from "../stores/agentStore";
import { Icon } from "./Icon";

const planStatusCopy: Record<AgentPlanStatus, string> = {
  draft: "未承認",
  approved: "承認済み",
  running: "実行中",
  completed: "完了",
  failed: "失敗",
  cancelled: "却下",
};

const stepStatusCopy: Record<PlanStepStatus, string> = {
  pending: "待機",
  approved: "承認済み",
  running: "実行中",
  done: "完了",
  failed: "失敗",
  skipped: "スキップ",
};

function PlanCard({ plan }: { plan: AgentPlan }) {
  const mode = useAgentStore((state) => state.mode);
  const executingStepId = useAgentStore((state) => state.executingStepId);
  const approvePlan = useAgentStore((state) => state.approvePlan);
  const rejectPlan = useAgentStore((state) => state.rejectPlan);
  const resetPlan = useAgentStore((state) => state.resetPlan);
  const runPlanStep = useAgentStore((state) => state.runPlanStep);
  const executePlan = useAgentStore((state) => state.executePlan);

  const busy = executingStepId !== null;
  const done = plan.steps.filter((step) => step.status === "done").length;
  const canRunSteps =
    mode !== "passive" &&
    (plan.status === "approved" || plan.status === "running") &&
    !busy;
  const canExecuteAll =
    mode === "autonomous" && plan.status === "approved" && !busy;

  return (
    <section className={`plan-card ${plan.status}`}>
      <div className="plan-card-head">
        <span className="plan-status">{planStatusCopy[plan.status]}</span>
        <span className="plan-progress">
          {done}/{plan.steps.length} 完了
        </span>
      </div>

      <p className="plan-goal">{plan.goal}</p>

      <ol className="plan-steps">
        {plan.steps.map((step, index) => {
          const canRun =
            canRunSteps && step.status === "approved" && mode !== "autonomous";
          return (
            <li className={`plan-step ${step.status}`} key={step.id}>
              <div className="plan-step-head">
                <span className="plan-step-index">{index + 1}</span>
                <span className="plan-step-title">{step.title}</span>
                <span className={`plan-risk ${step.risk}`}>
                  {skillRiskLabel(step.risk)}
                </span>
                <span className={`plan-step-status ${step.status}`}>
                  {stepStatusCopy[step.status]}
                </span>
              </div>

              <code className="plan-command">
                {step.kind === "skill"
                  ? `${step.skillId} / ${step.skillActionId}`
                  : step.command.join(" ")}
              </code>

              {step.kind === "skill" && step.params && (
                <details className="plan-output">
                  <summary>パラメータ</summary>
                  <pre>{JSON.stringify(step.params, null, 2)}</pre>
                </details>
              )}

              {step.rationale && (
                <p className="plan-rationale">{step.rationale}</p>
              )}

              {step.error && <p className="plan-step-error">{step.error}</p>}

              {step.output && (
                <details className="plan-output">
                  <summary>出力</summary>
                  <pre>{step.output}</pre>
                </details>
              )}

              {canRun && (
                <div className="plan-step-actions">
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => void runPlanStep(step.id)}
                  >
                    <Icon name="play" size={12} />
                    実行
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="plan-actions">
        {plan.status === "draft" && mode !== "passive" && (
          <>
            <button
              type="button"
              className="btn small primary"
              onClick={approvePlan}
            >
              <Icon name="check" size={13} />
              計画を承認
            </button>
            <button
              type="button"
              className="btn small ghost"
              onClick={rejectPlan}
            >
              却下
            </button>
          </>
        )}

        {canExecuteAll && (
          <button
            type="button"
            className="btn small primary"
            onClick={() => void executePlan()}
          >
            <Icon name="play" size={12} />
            残りを実行
          </button>
        )}

        {(plan.status === "approved" || plan.status === "running") && (
          <button
            type="button"
            className="btn small ghost"
            onClick={rejectPlan}
            disabled={busy}
          >
            中止
          </button>
        )}

        {(plan.status === "completed" ||
          plan.status === "failed" ||
          plan.status === "cancelled") && (
          <button type="button" className="btn small" onClick={resetPlan}>
            新しい計画
          </button>
        )}
      </div>

      {plan.status === "draft" && mode === "passive" && (
        <p className="plan-hint">
          Passive モードでは計画を承認できません。Assistive 以上に切り替えてください。
        </p>
      )}
      {plan.status === "approved" && mode === "assistive" && (
        <p className="plan-hint">
          Assistive モードでは各手順を個別に実行します。変更操作は実行時に OS
          の承認ダイアログでも確認されます。
        </p>
      )}
      {plan.status === "approved" && mode === "autonomous" && (
        <p className="plan-hint">
          承認済みの手順を上から順に実行します。変更操作は実行時に OS
          の承認ダイアログでも確認されます。
        </p>
      )}
      {executingStepId && (
        <p className="plan-hint">手順を実行しています…</p>
      )}
    </section>
  );
}

export function PlanPanel() {
  const mode = useAgentStore((state) => state.mode);
  const llm = useAgentStore((state) => state.llm);
  const plan = useAgentStore((state) => state.plan);
  const planLoading = useAgentStore((state) => state.planLoading);
  const planRaw = useAgentStore((state) => state.planRaw);
  const planError = useAgentStore((state) => state.planError);
  const executingStepId = useAgentStore((state) => state.executingStepId);
  const generatePlan = useAgentStore((state) => state.generatePlan);
  const cancelPlanGeneration = useAgentStore(
    (state) => state.cancelPlanGeneration,
  );
  const openSettings = useAgentStore((state) => state.openSettings);

  const [intent, setIntent] = useState("");

  const disabled =
    mode === "passive" ||
    planLoading ||
    executingStepId !== null ||
    intent.trim().length === 0;

  const submit = () => {
    const value = intent.trim();
    if (!value || disabled) return;
    void generatePlan(value);
  };

  return (
    <div className="plan-panel">
      <form
        className="plan-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="plan-form-label" htmlFor="plan-intent">
          計画の目的
        </label>
        <textarea
          id="plan-intent"
          value={intent}
          rows={3}
          maxLength={MAX_PLAN_INTENT_CHARS}
          placeholder={
            mode === "passive"
              ? "Passive モードでは計画を立案できません"
              : "例: Safari を開いて、社内 Wiki のトップページを表示する"
          }
          disabled={mode === "passive" || planLoading || executingStepId !== null}
          onChange={(event) => setIntent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className="plan-form-foot">
          <button
            type="submit"
            className="btn small primary"
            disabled={disabled}
          >
            <Icon name="sparkles" size={13} />
            計画を作成
          </button>
          {planLoading && (
            <button
              type="button"
              className="btn small ghost"
              onClick={() => void cancelPlanGeneration()}
            >
              <Icon name="stop" size={12} />
              停止
            </button>
          )}
        </div>
      </form>

      {!llm?.configured && (
        <div className="plan-notice">
          <span>LLM が未設定です。計画立案には接続設定が必要です。</span>
          <button type="button" className="btn small" onClick={openSettings}>
            <Icon name="gear" size={12} />
            設定
          </button>
        </div>
      )}

      {planLoading && (
        <div className="plan-live">
          <div className="plan-live-head">
            <span className="typing typing-inline">
              <span />
              <span />
              <span />
            </span>
            計画を生成中…
          </div>
          {planRaw && <pre>{planRaw}</pre>}
        </div>
      )}

      {planError && (
        <div className="plan-error">
          <div className="plan-error-head">
            <Icon name="alert" size={13} />
            計画を作成できませんでした
          </div>
          <p>{planError}</p>
          {planRaw && (
            <details>
              <summary>モデルの応答</summary>
              <pre>{planRaw}</pre>
            </details>
          )}
        </div>
      )}

      {plan && <PlanCard plan={plan} />}

      {!plan && !planLoading && !planError && (
        <div className="plan-empty">
          <Icon name="sparkles" size={18} />
          <p>
            意図を入力すると、LLM が Agent Desktop
            で実行できる手順に分解します。生成された計画は、承認するまで実行されません。
          </p>
          <ul>
            <li>各手順は許可アクションと引数検証を通ったものだけを表示します</li>
            <li>
              スキル手順は <code>skills_list</code> のカタログと照合してから実行します
            </li>
            <li>変更操作は実行時に OS の承認ダイアログでも確認します</li>
            <li>
              Assistive は手順ごと、Autonomous は承認後にまとめて実行します
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
