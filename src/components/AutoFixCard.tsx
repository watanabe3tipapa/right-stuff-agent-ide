import { useEffect, useRef, useState } from "react";

import type {
  AutoFixAttempt,
  AutoFixAttemptStatus,
  VerificationResult,
} from "../shared/types";
import { api, errorMessage } from "../lib/api";
import {
  buildAutoFixMessages,
  collectContextCandidates,
  combinePreviews,
  failedChecks,
  failureSignature,
  isFixableVerification,
  materializeFixSteps,
  parseAutoFixPlan,
  takeContextFiles,
} from "../lib/autofix";
import { createRunId } from "../lib/skills";
import { useAgentStore } from "../stores/agentStore";
import { Icon } from "./Icon";
import { VerificationDetails } from "./VerificationDetails";

type AutoFixStatus =
  | "idle"
  | "generating"
  | "proposed"
  | "applying"
  | "verifying"
  | "passed"
  | "failed"
  | "cancelled";

const STATUS_LABELS: Record<AutoFixStatus, string> = {
  idle: "待機",
  generating: "修正案を生成中",
  proposed: "修正案あり",
  applying: "適用中",
  verifying: "再検証中",
  passed: "修正済み",
  failed: "停止",
  cancelled: "中止",
};

const ATTEMPT_LABELS: Record<AutoFixAttemptStatus, string> = {
  proposed: "未適用",
  applying: "適用中",
  verifying: "再検証中",
  passed: "成功",
  failed: "失敗",
  cancelled: "中止",
  blocked: "拒否",
  invalid: "無効",
};

function newAttemptId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function AutoFixCard({
  skillId,
  actionId,
  params,
  verification,
  changedFiles,
  planId,
  stepId,
  title,
  onPassed,
  onAttempts,
}: {
  skillId: string;
  actionId: string;
  params: Record<string, unknown>;
  verification: VerificationResult;
  changedFiles: string[];
  planId?: string;
  stepId?: string;
  title?: string;
  onPassed?: (verification: VerificationResult) => void;
  onAttempts?: (attempts: AutoFixAttempt[]) => void;
}) {
  const mode = useAgentStore((state) => state.mode);
  const llm = useAgentStore((state) => state.llm);
  const skillPolicy = useAgentStore((state) => state.skillPolicy);
  const streaming = useAgentStore((state) => state.streaming);
  const planLoading = useAgentStore((state) => state.planLoading);

  const [attempts, setAttempts] = useState<AutoFixAttempt[]>([]);
  const attemptsRef = useRef<AutoFixAttempt[]>([]);
  const [status, setStatus] = useState<AutoFixStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState("");
  const [activeAttemptId, setActiveAttemptId] = useState<string | null>(null);
  const runIdRef = useRef<string | null>(null);
  const autoRef = useRef(false);
  const autoStartedRef = useRef(false);
  const maxAttemptsRef = useRef(2);
  const changedFilesRef = useRef(changedFiles);

  const autoFixMode = skillPolicy?.verification.autoFix ?? "manual";
  const maxAttempts = skillPolicy?.verification.maxFixAttempts ?? 2;
  const busy =
    status === "generating" ||
    status === "applying" ||
    status === "verifying";
  const fixable = isFixableVerification(verification);
  const lastVerification =
    attempts[attempts.length - 1]?.verification ?? verification;
  const lastSignature = failureSignature(lastVerification);
  const canRetry =
    status === "failed" &&
    attempts.length < maxAttemptsRef.current &&
    !busy;

  function audit(
    outcome: "ok" | "error" | "cancelled" | "blocked",
    detail: string,
  ) {
    void api
      .auditLogAdd({
        kind: "verification_fix",
        mode,
        planId,
        stepId,
        skillId,
        actionId,
        title: title ?? "検証の自動修正",
        outcome,
        detail,
      })
      .catch(() => {
        // The audit log must never block the fix flow.
      });
  }

  function replaceAttempts(next: AutoFixAttempt[]) {
    attemptsRef.current = next;
    setAttempts(next);
    onAttempts?.(next);
  }

  function updateAttempt(id: string, patch: Partial<AutoFixAttempt>) {
    const next = attemptsRef.current.map((attempt) =>
      attempt.id === id ? { ...attempt, ...patch } : attempt,
    );
    replaceAttempts(next);
  }

  function readContext(
    baseVerification: VerificationResult,
    files: string[],
  ): Promise<{ path: string; content: string }[]> {
    const paths = collectContextCandidates(baseVerification, files);
    return Promise.all(
      paths.map(async (path) => {
        try {
          const file = await api.readFile(path);
          return { path, content: file.content };
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      const contents = new Map<string, string>();
      for (const entry of entries) {
        if (entry) contents.set(entry.path, entry.content);
      }
      return takeContextFiles(paths, contents);
    });
  }

  async function generate(
    attemptNumber: number,
    baseVerification: VerificationResult,
    nextChangedFiles: string[],
    previous: AutoFixAttempt[] = attemptsRef.current,
  ) {
    if (attemptNumber > maxAttemptsRef.current) {
      setStatus("failed");
      setError(`最大修正回数 (${maxAttemptsRef.current}) に達しました。`);
      return;
    }

    if (!api.isTauri) {
      setStatus("failed");
      setError("自動修正は Tauri 版でのみ利用できます。");
      return;
    }
    if (mode === "passive") {
      setStatus("failed");
      setError("Passive モードでは自動修正を実行できません。");
      return;
    }
    if (!llm?.configured) {
      setStatus("failed");
      setError("LLM が未設定です。設定画面でプロバイダーを登録してください。");
      return;
    }
    if (streaming || planLoading) {
      setStatus("failed");
      setError("他の LLM リクエストが実行中です。完了してから再試行してください。");
      return;
    }

    setStatus("generating");
    setActiveAttemptId(null);
    setError(null);
    setRaw("");
    runIdRef.current = null;
    audit("ok", `修正案の生成を開始 (試行 ${attemptNumber}/${maxAttemptsRef.current})`);

    let rawText = "";
    let cancelled = false;
    let streamError: string | null = null;

    try {
      const catalog =
        useAgentStore.getState().skills ?? (await api.skillsList());
      if (!catalog.skills.some((skill) => skill.id === "code-edit")) {
        throw new Error(
          "自動修正には code-edit スキルが必要です。.agents/skills/code-edit.json を追加してください。",
        );
      }

      const files = await readContext(baseVerification, nextChangedFiles);
      if (files.length === 0) {
        throw new Error(
          "修正対象のファイルを読み取れませんでした。変更ファイルを確認してください。",
        );
      }

      const messages = buildAutoFixMessages({
        skillId,
        skillName:
          catalog.skills.find((skill) => skill.id === skillId)?.name ?? skillId,
        actionId,
        actionDescription:
          catalog.skills
            .flatMap((skill) => skill.actions)
            .find((action) => action.id === actionId)?.description ?? actionId,
        params,
        changedFiles: nextChangedFiles,
        verification: baseVerification,
        files,
        attempt: attemptNumber,
        maxAttempts: maxAttemptsRef.current,
        previousAttempts: previous.map((attempt) => ({
          attempt: attempt.attempt,
          diff: attempt.diff,
          error: attempt.error,
        })),
      });

      await api.llmChat(messages, (event) => {
        switch (event.type) {
          case "delta":
            rawText += event.text;
            setRaw(rawText.slice(-8_000));
            break;
          case "error":
            streamError = event.message;
            break;
          case "cancelled":
            cancelled = true;
            break;
          case "done":
            break;
        }
      });

      if (cancelled) {
        setStatus("cancelled");
        audit("cancelled", `修正案の生成を中止 (試行 ${attemptNumber})`);
        return;
      }
      if (streamError) throw new Error(streamError);
      if (!rawText.trim()) {
        throw new Error(
          "修正案が空でした。モデル名とプロバイダーの設定を確認してください。",
        );
      }

      const draft = parseAutoFixPlan(
        rawText,
        catalog,
        files.map((file) => file.path),
      );
      const steps = materializeFixSteps(draft, newAttemptId);

      const previews: { path: string; diff: string }[] = [];
      for (const step of steps) {
        const preview = await api.skillPreview(
          "code-edit",
          "editor.replaceText",
          step.params ?? {},
          mode,
        );
        previews.push({
          path: preview.path ?? "unknown",
          diff: preview.diff,
        });
      }

      const attempt: AutoFixAttempt = {
        id: newAttemptId(),
        attempt: attemptNumber,
        status: "proposed",
        steps,
        diff: combinePreviews(previews),
        createdAt: Date.now(),
      };
      replaceAttempts([...attemptsRef.current, attempt]);
      setStatus("proposed");
      setActiveAttemptId(attempt.id);
      setRaw("");
      audit(
        "ok",
        `修正案を作成 (試行 ${attemptNumber}/${maxAttemptsRef.current}, ${steps.length} 手順)`,
      );

      if (autoRef.current) {
        await applyAttempt(attempt, baseVerification, nextChangedFiles);
      }
    } catch (caught) {
      const message = errorMessage(caught);
      setStatus("failed");
      setError(message);
      audit("error", `自動修正の生成に失敗: ${message}`);
    }
  }

  async function applyAttempt(
    attempt: AutoFixAttempt,
    baseVerification: VerificationResult,
    nextChangedFiles: string[],
  ) {
    if (status === "applying" || status === "verifying") return;
    setStatus("applying");
    setActiveAttemptId(attempt.id);
    setError(null);
    updateAttempt(attempt.id, { status: "applying", error: undefined });
    audit("ok", `修正案を適用開始 (試行 ${attempt.attempt})`);

    const changed = [...nextChangedFiles];
    try {
      for (const step of attempt.steps) {
        const runId = createRunId();
        runIdRef.current = runId;
        const result = await api.skillRun({
          skillId: "code-edit",
          actionId: "editor.replaceText",
          params: step.params ?? {},
          runId,
          planId,
          stepId,
          title: `${title ?? "自動修正"} / ${step.title}`,
          mode,
        });

        if (result.status === "cancelled") {
          updateAttempt(attempt.id, { status: "cancelled" });
          setStatus("cancelled");
          audit("cancelled", `修正の適用を中止 (試行 ${attempt.attempt})`);
          return;
        }
        if (result.status !== "ok") {
          const message =
            result.stderr.trim() ||
            `修正を適用できませんでした (${result.status})`;
          updateAttempt(attempt.id, { status: "blocked", error: message });
          setStatus("failed");
          setError(message);
          audit("blocked", `修正の適用を拒否 (試行 ${attempt.attempt}): ${message}`);
          return;
        }
        for (const file of result.changedFiles) {
          if (!changed.includes(file)) changed.push(file);
        }
      }

      setStatus("verifying");
      updateAttempt(attempt.id, { status: "verifying" });
      changedFilesRef.current = changed;

      const verifyRunId = createRunId();
      runIdRef.current = verifyRunId;
      const checks = failedChecks(baseVerification);
      const nextVerification = await api.skillVerify(
        skillId,
        actionId,
        checks.length > 0 ? checks : undefined,
        verifyRunId,
      );
      if (nextVerification.status === "cancelled") {
        updateAttempt(attempt.id, {
          status: "cancelled",
          verification: nextVerification,
        });
        setStatus("cancelled");
        audit("cancelled", `再検証を中止 (試行 ${attempt.attempt})`);
        return;
      }
      updateAttempt(attempt.id, {
        status: nextVerification.status === "passed" ? "passed" : "failed",
        verification: nextVerification,
      });

      if (nextVerification.status === "passed") {
        setStatus("passed");
        audit("ok", `修正と再検証に成功 (試行 ${attempt.attempt})`);
        onPassed?.(nextVerification);
        return;
      }

      setStatus("failed");
      const repeated =
        failureSignature(baseVerification) === failureSignature(nextVerification);
      if (repeated) {
        setError("同じ失敗が続いたため停止しました。");
        audit(
          "error",
          `同じ失敗のため停止 (試行 ${attempt.attempt})`,
        );
        return;
      }
      if (attempt.attempt >= maxAttemptsRef.current) {
        setError(`最大修正回数 (${maxAttemptsRef.current}) に達しました。`);
        audit(
          "error",
          `最大修正回数に到達 (試行 ${attempt.attempt})`,
        );
        return;
      }

      audit(
        "error",
        `再検証に失敗 (試行 ${attempt.attempt})。次の修正案へ`,
      );
      if (autoRef.current) {
        await generate(
          attempt.attempt + 1,
          nextVerification,
          changed,
          attemptsRef.current,
        );
      }
    } catch (caught) {
      const message = errorMessage(caught);
      updateAttempt(attempt.id, { status: "failed", error: message });
      setStatus("failed");
      setError(message);
      audit("error", `修正の適用に失敗 (試行 ${attempt.attempt}): ${message}`);
    } finally {
      runIdRef.current = null;
    }
  }

  function start() {
    if (!fixable || busy) {
      if (!fixable) setError("失敗した検証がありません。");
      return;
    }
    if (autoFixMode === "off") {
      setError("設定で自動修正が無効になっています。");
      return;
    }
    const effectiveAuto = autoFixMode === "auto" && mode === "autonomous";
    autoRef.current = effectiveAuto;
    maxAttemptsRef.current = maxAttempts;
    changedFilesRef.current = [...changedFiles];
    replaceAttempts([]);
    setError(null);
    void generate(1, verification, changedFiles, []);
  }

  const startRef = useRef(start);
  startRef.current = start;

  useEffect(() => {
    if (autoStartedRef.current) return;
    if (
      status !== "idle" ||
      !fixable ||
      autoFixMode !== "auto" ||
      mode !== "autonomous" ||
      streaming ||
      planLoading ||
      !api.isTauri ||
      !llm?.configured
    ) {
      return;
    }
    autoStartedRef.current = true;
    startRef.current();
  }, [autoFixMode, fixable, llm?.configured, mode, planLoading, status, streaming]);

  function retry() {
    if (busy || !canRetry) return;
    const base = lastVerification;
    const changed = Array.from(
      new Set([...changedFiles, ...changedFilesRef.current]),
    );
    void generate(attempts.length + 1, base, changed, attemptsRef.current);
  }

  async function verifyAll() {
    if (busy) return;
    const latestAttempt = attemptsRef.current[attemptsRef.current.length - 1];
    if (!latestAttempt) return;
    setStatus("verifying");
    setError(null);
    const runId = createRunId();
    runIdRef.current = runId;
    audit("ok", `すべての検証を再実行 (試行 ${latestAttempt.attempt})`);
    try {
      const next = await api.skillVerify(skillId, actionId, undefined, runId);
      if (next.status === "cancelled") {
        updateAttempt(latestAttempt.id, {
          status: "cancelled",
          verification: next,
        });
        setStatus("cancelled");
        audit("cancelled", "すべての再検証を中止");
        return;
      }
      updateAttempt(latestAttempt.id, {
        status: next.status === "passed" ? "passed" : "failed",
        verification: next,
      });
      if (next.status === "passed") {
        setStatus("passed");
        audit("ok", "すべての再検証に成功");
        onPassed?.(next);
      } else {
        setStatus("failed");
        setError("すべての再検証で失敗が残りました。");
        audit("error", "すべての再検証で失敗");
      }
    } catch (caught) {
      const message = errorMessage(caught);
      setStatus("failed");
      setError(message);
      audit("error", `再検証に失敗: ${message}`);
    } finally {
      runIdRef.current = null;
    }
  }

  async function cancel() {
    if (!busy) {
      if (status === "failed" || status === "proposed") {
        setStatus("cancelled");
      }
      return;
    }
    try {
      if (runIdRef.current) {
        await api.skillCancel(runIdRef.current);
      } else if (status === "generating") {
        await api.llmCancel();
      }
    } catch (cause) {
      setError(errorMessage(cause));
    }
    setStatus("cancelled");
    audit("cancelled", "自動修正を中止");
  }

  const latest =
    attempts.find((attempt) => attempt.id === activeAttemptId) ??
    attempts[attempts.length - 1];
  const proposed = latest?.status === "proposed" ? latest : null;

  if (!fixable && status !== "passed") {
    return null;
  }

  return (
    <section className={`autofix-card ${status}`}>
      <div className="autofix-head">
        <div>
          <h4>
            <Icon name="sparkles" size={14} /> 検証の自動修正
          </h4>
          <p className="field-help">
            {autoFixMode === "off"
              ? "設定で無効になっています。"
              : mode === "passive"
                ? "Passive モードでは自動修正を実行できません。"
                : autoFixMode === "auto" && mode === "autonomous"
                  ? "Autonomous のため、失敗時に修正案を生成して適用します。適用は毎回承認されます。"
                  : "修正案はローカルの LLM 設定を使って生成します。適用は毎回承認されます。"}
          </p>
        </div>
        <span className={`autofix-status ${status}`}>
          {STATUS_LABELS[status]}
        </span>
      </div>

      {error && (
        <div className="dialog-error" role="alert">
          {error}
        </div>
      )}

      {status === "idle" && (
        <div className="autofix-start">
          <p className="field-help">
            変更ファイルと失敗出力を LLM に送り、`editor.replaceText`
            だけで修正案を作ります。最大 {maxAttempts} 回まで試行します。
          </p>
          <button
            type="button"
            className="btn small primary"
            onClick={start}
            disabled={autoFixMode === "off" || mode === "passive" || !api.isTauri}
          >
            <Icon name="sparkles" size={12} />
            修正案を作成
          </button>
        </div>
      )}

      {status === "generating" && (
        <div className="autofix-generating">
          <p className="field-help">修正案を生成しています…</p>
          {raw && <pre className="autofix-raw">{raw}</pre>}
          <button type="button" className="btn small ghost" onClick={() => void cancel()}>
            <Icon name="stop" size={12} />
            停止
          </button>
        </div>
      )}

      {attempts.length > 0 && (
        <ol className="autofix-attempts">
          {attempts.map((attempt) => (
            <li className={`autofix-attempt ${attempt.status}`} key={attempt.id}>
              <div className="autofix-attempt-head">
                <span className="autofix-attempt-no">
                  試行 {attempt.attempt} / {maxAttemptsRef.current}
                </span>
                <span className={`autofix-attempt-status ${attempt.status}`}>
                  {ATTEMPT_LABELS[attempt.status]}
                </span>
                <span className="field-help">
                  {attempt.steps.length} 手順
                </span>
              </div>

              <ul className="autofix-steps">
                {attempt.steps.map((step, index) => (
                  <li key={step.id}>
                    <span className="autofix-step-index">{index + 1}</span>
                    <code>{String(step.params?.path ?? step.title)}</code>
                    <span className="field-help">{step.title}</span>
                  </li>
                ))}
              </ul>

              {attempt.diff && (
                <details
                  className="autofix-diff"
                  open={attempt.id === activeAttemptId}
                >
                  <summary>差分を確認</summary>
                  <pre className="skill-diff">{attempt.diff}</pre>
                </details>
              )}

              {attempt.verification && (
                <VerificationDetails
                  verification={attempt.verification}
                  label="再検証"
                />
              )}

              {attempt.error && (
                <p className="plan-step-error">{attempt.error}</p>
              )}

              {attempt.id === proposed?.id && (
                <div className="autofix-actions">
                  <button
                    type="button"
                    className="btn small primary"
                    onClick={() =>
                      void applyAttempt(
                        attempt,
                        attempt.attempt === 1
                          ? verification
                          : attempts[attempt.attempt - 2]?.verification ??
                              verification,
                        Array.from(
                          new Set([
                            ...changedFiles,
                            ...changedFilesRef.current,
                          ]),
                        ),
                      )
                    }
                    disabled={busy}
                  >
                    <Icon name="play" size={12} />
                    この修正を適用
                  </button>
                  <button
                    type="button"
                    className="btn small ghost"
                    onClick={() => void cancel()}
                    disabled={busy}
                  >
                    中止
                  </button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      {busy && (
        <div className="autofix-actions">
          <button type="button" className="btn small ghost" onClick={() => void cancel()}>
            <Icon name="stop" size={12} />
            停止
          </button>
        </div>
      )}

      {canRetry && (
        <div className="autofix-actions">
          <button type="button" className="btn small primary" onClick={retry}>
            <Icon name="sparkles" size={12} />
            次の修正案を作成
          </button>
          <button
            type="button"
            className="btn small ghost"
            onClick={() => void verifyAll()}
          >
            <Icon name="refresh" size={12} />
            すべて再検証
          </button>
        </div>
      )}

      {status === "failed" && !canRetry && attempts.length > 0 && (
        <div className="autofix-actions">
          <button
            type="button"
            className="btn small ghost"
            onClick={() => void verifyAll()}
          >
            <Icon name="refresh" size={12} />
            すべて再検証
          </button>
        </div>
      )}

      {status === "passed" && (
        <p className="autofix-passed">
          <Icon name="check" size={13} /> 修正が適用され、検証に合格しました。
        </p>
      )}

      {status === "cancelled" && (
        <p className="field-help">自動修正を中止しました。</p>
      )}

      {status === "failed" && !canRetry && attempts.length > 0 && (
        <p className="field-help">
          自動修正を停止しました。差分と検証結果を確認してください。
        </p>
      )}

      {lastSignature && status === "failed" && !error && (
        <p className="field-help">失敗シグネチャ: {lastSignature}</p>
      )}
    </section>
  );
}
