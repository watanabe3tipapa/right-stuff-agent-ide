import type { VerificationResult } from "../shared/types";

export function VerificationDetails({
  verification,
  label = "検証",
}: {
  verification: VerificationResult;
  label?: string;
}) {
  return (
    <div className={`skill-verify ${verification.status}`}>
      <div className="skill-preview-head">
        <span className={`skill-decision ${verification.status}`}>
          {verification.status}
        </span>
        <span className="skill-action-desc">
          {label} / {verification.checks.length} 項目
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
            open={
              check.status === "failed" ||
              check.status === "timeout" ||
              check.status === "cancelled"
            }
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
  );
}
