import { useEffect, useMemo, useState } from "react";

import type {
  SkillAction,
  SkillManifest,
  SkillParamDef,
  SkillPreviewResult,
  SkillRunResult,
  VerificationResult,
} from "../shared/types";
import { api, errorMessage } from "../lib/api";
import { openSkillLibraryWindow } from "../lib/skillWindow";
import { skillRiskLabel, validateSkillParams } from "../lib/skills";
import { useAgentStore } from "../stores/agentStore";
import { Icon } from "./Icon";

type FieldValue = string | boolean;

function initialValues(action: SkillAction): Record<string, FieldValue> {
  const values: Record<string, FieldValue> = {};
  for (const [name, definition] of Object.entries(action.params)) {
    values[name] = definition.type === "boolean" ? false : "";
  }
  return values;
}

function buildParams(
  action: SkillAction,
  values: Record<string, FieldValue>,
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const [name, definition] of Object.entries(action.params)) {
    const value = values[name];
    switch (definition.type) {
      case "boolean":
        params[name] = value === true;
        break;
      case "number": {
        const text = String(value ?? "").trim();
        if (text) params[name] = Number(text);
        break;
      }
      case "string[]":
        params[name] = String(value ?? "")
          .split("\n")
          .map((line) => line.trimEnd())
          .filter((line) => line.length > 0);
        break;
      case "string":
        params[name] = String(value ?? "");
        break;
    }
  }
  return params;
}

function ParamField({
  name,
  definition,
  value,
  disabled,
  onChange,
}: {
  name: string;
  definition: SkillParamDef;
  value: FieldValue;
  disabled: boolean;
  onChange: (value: FieldValue) => void;
}) {
  const id = `skill-param-${name}`;

  if (definition.type === "boolean") {
    return (
      <label className="policy-check skill-check">
        <input
          type="checkbox"
          checked={value === true}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        {name}
        <span className="skill-param-hint">{definition.description}</span>
      </label>
    );
  }

  const multiline =
    definition.type === "string[]" ||
    (definition.type === "string" && (definition.maxLength ?? 0) > 500);

  return (
    <div className="skill-field">
      <label className="field-label" htmlFor={id}>
        <code>{name}</code>
        {definition.required && <span className="skill-required">必須</span>}
        <span className="skill-param-type">{definition.type}</span>
      </label>
      {multiline ? (
        <textarea
          id={id}
          className="text-input skill-textarea"
          rows={definition.type === "string[]" ? 3 : 4}
          value={String(value ?? "")}
          disabled={disabled}
          maxLength={definition.maxLength}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
        />
      ) : (
        <input
          id={id}
          className="text-input"
          type={definition.type === "number" ? "number" : "text"}
          value={String(value ?? "")}
          disabled={disabled}
          maxLength={definition.maxLength}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
        />
      )}
      <p className="field-help">
        {definition.description}
        {definition.type === "string[]" && " (1 行に 1 件)"}
      </p>
    </div>
  );
}

function SkillActionCard({
  skill,
  action,
}: {
  skill: SkillManifest;
  action: SkillAction;
}) {
  const mode = useAgentStore((state) => state.mode);
  const [values, setValues] = useState<Record<string, FieldValue>>(() =>
    initialValues(action),
  );
  const [preview, setPreview] = useState<SkillPreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [result, setResult] = useState<SkillRunResult | null>(null);
  const [verification, setVerification] = useState<VerificationResult | null>(
    null,
  );
  const [busy, setBusy] = useState<"preview" | "run" | "verify" | null>(null);

  const disabled = busy !== null || (mode === "passive" && action.risk !== "read");
  const params = useMemo(() => buildParams(action, values), [action, values]);

  async function runPreview() {
    const shapeError = validateSkillParams(action, params);
    if (shapeError) {
      setPreviewError(shapeError);
      setPreview(null);
      return;
    }
    setBusy("preview");
    setPreviewError(null);
    setResult(null);
    setVerification(null);
    try {
      const next = await api.skillPreview(
        skill.id,
        action.id,
        params,
        mode,
      );
      setPreview(next);
    } catch (error) {
      setPreview(null);
      setPreviewError(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function runSkill() {
    const shapeError = validateSkillParams(action, params);
    if (shapeError) {
      setPreviewError(shapeError);
      setPreview(null);
      return;
    }
    setBusy("run");
    setPreviewError(null);
    setResult(null);
    setVerification(null);
    try {
      const next = await api.skillRun({
        skillId: skill.id,
        actionId: action.id,
        params,
        mode,
        title: `${skill.name} / ${action.description}`,
      });
      setResult(next);
      if (
        next.status === "ok" &&
        next.changedFiles.length > 0 &&
        skill.verification.mode === "auto"
      ) {
        await runVerification();
      }
    } catch (error) {
      setPreviewError(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function runVerification() {
    setBusy("verify");
    setPreviewError(null);
    setVerification(null);
    try {
      setVerification(await api.skillVerify(skill.id, action.id));
    } catch (error) {
      setPreviewError(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <details className="skill-action">
      <summary>
        <span className="skill-action-name">
          <code>{action.id}</code>
          <span className={`skill-risk ${action.risk}`}>
            {skillRiskLabel(action.risk)}
          </span>
        </span>
        <span className="skill-action-desc">{action.description}</span>
      </summary>

      <div className="skill-action-body">
        {mode === "passive" && action.risk !== "read" && (
          <p className="plan-hint">
            Passive モードでは変更・破壊的操作を実行できません。
          </p>
        )}

        {Object.entries(action.params).length === 0 ? (
          <p className="field-help">パラメータはありません。</p>
        ) : (
          Object.entries(action.params).map(([name, definition]) => (
            <ParamField
              key={name}
              name={name}
              definition={definition}
              value={values[name] ?? ""}
              disabled={disabled}
              onChange={(value) => {
                setValues((current) => ({ ...current, [name]: value }));
                setPreview(null);
                setPreviewError(null);
                setResult(null);
                setVerification(null);
              }}
            />
          ))
        )}

        <div className="skill-action-buttons">
          <button
            type="button"
            className="btn small"
            onClick={() => void runPreview()}
            disabled={disabled}
          >
            <Icon name="search" size={12} />
            {busy === "preview" ? "確認中…" : "プレビュー"}
          </button>
          <button
            type="button"
            className="btn small primary"
            onClick={() => void runSkill()}
            disabled={disabled}
          >
            <Icon name="play" size={12} />
            {busy === "run" ? "実行中…" : "実行"}
          </button>
          {skill.verification.mode === "auto" && (
            <button
              type="button"
              className="btn small"
              onClick={() => void runVerification()}
              disabled={disabled}
            >
              <Icon name="check" size={12} />
              {busy === "verify" ? "検証中…" : "検証を実行"}
            </button>
          )}
        </div>

        {previewError && (
          <div className="dialog-error" role="alert">
            {previewError}
          </div>
        )}

        {preview && (
          <div className="skill-preview">
            <div className="skill-preview-head">
              <span className={`skill-decision ${preview.decision}`}>
                {preview.decision}
              </span>
              <span className="skill-action-desc">
                {preview.path ?? "—"} / +{preview.addedLines} -{preview.removedLines}
              </span>
            </div>
            {preview.warnings.map((warning) => (
              <p className="skill-warning" key={warning}>
                {warning}
              </p>
            ))}
            {preview.diff ? (
              <pre className="skill-diff">{preview.diff}</pre>
            ) : (
              <p className="field-help">この操作ではファイルを変更しません。</p>
            )}
          </div>
        )}

        {result && (
          <div className={`skill-result ${result.status}`}>
            <div className="skill-preview-head">
              <span className={`skill-decision ${result.status}`}>
                {result.status}
              </span>
              <span className="skill-action-desc">
                {result.decision} / {result.durationMs} ms
                {result.changedFiles.length > 0
                  ? ` / ${result.changedFiles.join(", ")}`
                  : ""}
              </span>
            </div>
            {result.stdout && <pre>{result.stdout}</pre>}
            {result.stderr && <pre>{result.stderr}</pre>}
          </div>
        )}

        {verification && (
          <div className={`skill-verify ${verification.status}`}>
            <div className="skill-preview-head">
              <span className={`skill-decision ${verification.status}`}>
                {verification.status}
              </span>
              <span className="skill-action-desc">
                検証 / {verification.checks.length} 項目
              </span>
            </div>
            {verification.checks.length === 0 ? (
              <p className="field-help">
                検証は実行されませんでした（キャンセルまたは対象外）。
              </p>
            ) : (
              verification.checks.map((check, index) => (
                <details
                  className={`skill-verify-check ${check.status}`}
                  key={`${check.name}-${check.ecosystem}-${index}`}
                  open={check.status === "failed" || check.status === "timeout"}
                >
                  <summary>
                    <span className={`skill-verify-status ${check.status}`}>
                      {check.status}
                    </span>
                    <code>{check.name}</code>
                    <span>{check.ecosystem}</span>
                    <span>{check.durationMs} ms</span>
                  </summary>
                  {check.command.length > 0 && (
                    <pre className="skill-verify-command">
                      {check.command.join(" ")}
                    </pre>
                  )}
                  {check.output && (
                    <pre className="skill-verify-output">{check.output}</pre>
                  )}
                </details>
              ))
            )}
          </div>
        )}
      </div>
    </details>
  );
}

export function SkillsPanel() {
  const skills = useAgentStore((state) => state.skills);
  const skillsLoading = useAgentStore((state) => state.skillsLoading);
  const skillsError = useAgentStore((state) => state.skillsError);
  const refreshSkills = useAgentStore((state) => state.refreshSkills);

  useEffect(() => {
    void refreshSkills();
    const onFocus = () => void refreshSkills();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshSkills]);

  return (
    <div className="skills-panel">
      <div className="skills-head">
        <div>
          <h3>スキルカタログ</h3>
          <p>
            <code>.agents/skills/*.json</code> の宣言を読み込み、Rust
            のハンドラだけで実行します。
          </p>
        </div>
        <div className="skills-head-actions">
          <button
            type="button"
            className="btn small"
            onClick={() => void openSkillLibraryWindow()}
          >
            <Icon name="sparkles" size={12} />
            ライブラリを開く
          </button>
          <button
            type="button"
            className="btn small"
            onClick={() => void refreshSkills()}
            disabled={skillsLoading}
          >
            <Icon name="refresh" size={12} />
            再読み込み
          </button>
        </div>
      </div>

      {skillsError && (
        <div className="dialog-error" role="alert">
          {skillsError}
        </div>
      )}

      {skillsLoading && !skills && (
        <div className="policy-loading">
          <span className="typing typing-inline">
            <span />
            <span />
            <span />
          </span>
          スキルを読み込み中…
        </div>
      )}

      {skills?.warnings.map((warning) => (
        <div className="dialog-note warn" role="note" key={warning.file}>
          <code>{warning.file}</code>: {warning.message}
        </div>
      ))}

      {skills && skills.skills.length === 0 && (
        <div className="plan-empty">
          <Icon name="sparkles" size={18} />
          <p>
            スキルがありません。<code>.agents/skills/</code> に v1
            マニフェストを追加してください。
          </p>
        </div>
      )}

      {skills?.skills.map((skill) => (
        <section className="skill-card" key={skill.id}>
          <div className="skill-card-head">
            <div>
              <h4>
                {skill.name} <code>{skill.id}</code>
              </h4>
              <p>{skill.description}</p>
            </div>
            <span className={`skill-risk ${skill.risk}`}>
              {skillRiskLabel(skill.risk)}
            </span>
          </div>
          {skill.actions.map((action) => (
            <SkillActionCard
              skill={skill}
              action={action}
              key={action.id}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
