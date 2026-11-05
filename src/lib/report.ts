import type {
  SkillAction,
  SkillManifest,
  SkillRunResult,
  VerificationResult,
} from "../shared/types";

/**
 * Input for the self-contained HTML report. The report is generated in the
 * WebView so it can include the exact parameters and output the user just saw.
 * Nothing is sent to a network service.
 */
export interface SkillReportInput {
  skill: SkillManifest;
  action: SkillAction;
  params: Record<string, unknown>;
  result: SkillRunResult;
  verification: VerificationResult | null;
  generatedAt?: Date;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function reportFileName(result: SkillRunResult): string {
  const safe = result.runId
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${safe || "skill-run"}.html`;
}

function statusLabel(status: string): string {
  switch (status) {
    case "ok":
    case "passed":
      return "成功";
    case "failed":
      return "失敗";
    case "blocked":
      return "ブロック";
    case "cancelled":
      return "キャンセル";
    case "timeout":
      return "タイムアウト";
    case "skipped":
      return "スキップ";
    case "allow":
      return "許可";
    case "ask":
      return "確認";
    case "block":
      return "禁止";
    default:
      return status;
  }
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "—";
  return JSON.stringify(value, null, 2);
}

function summaryCard(label: string, value: string, status?: string): string {
  return `<div class="summary-card"${status ? ` data-status="${escapeHtml(status)}"` : ""}>
  <span class="summary-label">${escapeHtml(label)}</span>
  <strong>${escapeHtml(value)}</strong>
</div>`;
}

function workflowNode(
  index: number,
  title: string,
  value: string,
  subtitle: string,
  status: string,
  x: number,
): string {
  return `<g class="wf-node" data-status="${escapeHtml(status)}">
  <rect x="${x}" y="40" width="210" height="120" rx="16" />
  <text class="wf-step" x="${x + 20}" y="70">${String(index).padStart(2, "0")} / ${escapeHtml(title)}</text>
  <text class="wf-value" x="${x + 20}" y="100">${escapeHtml(value)}</text>
  <text class="wf-sub" x="${x + 20}" y="124">${escapeHtml(subtitle)}</text>
  <title>${escapeHtml(title)}: ${escapeHtml(value)} — ${escapeHtml(subtitle)}</title>
</g>`;
}

function workflowSvg(input: SkillReportInput): string {
  const { result, verification } = input;
  const verificationStatus = verification?.status ?? "skipped";
  const verificationSubtitle = verification
    ? `${verification.checks.length} 項目`
    : "対象外";

  const nodes = [
    workflowNode(
      1,
      "承認",
      statusLabel(result.decision),
      `${input.action.risk} / ${input.action.id}`,
      result.decision === "allow"
        ? "ok"
        : result.decision === "block"
          ? "blocked"
          : "asked",
      20,
    ),
    workflowNode(
      2,
      "実行",
      statusLabel(result.status),
      input.action.handler,
      result.status,
      285,
    ),
    workflowNode(
      3,
      "検証",
      statusLabel(verificationStatus),
      verificationSubtitle,
      verificationStatus,
      550,
    ),
    workflowNode(
      4,
      "結果",
      statusLabel(result.status),
      result.exitCode === null ? "exit —" : `exit ${result.exitCode}`,
      result.status,
      815,
    ),
  ].join("\n");

  return `<svg class="workflow" viewBox="0 0 1045 200" role="img" aria-labelledby="workflow-title workflow-desc">
  <title id="workflow-title">実行フロー</title>
  <desc id="workflow-desc">承認、実行、検証、結果の 4 段階と各段階の状態</desc>
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" class="arrow-head" />
    </marker>
  </defs>
  <path class="wf-edge" d="M 230 100 H 277" marker-end="url(#arrow)" />
  <path class="wf-edge" d="M 495 100 H 542" marker-end="url(#arrow)" />
  <path class="wf-edge" d="M 760 100 H 807" marker-end="url(#arrow)" />
${nodes}
</svg>`;
}

function paramRows(params: Record<string, unknown>): string {
  const entries = Object.entries(params);
  if (entries.length === 0) {
    return `<tr><td colspan="2" class="muted">パラメータはありません。</td></tr>`;
  }
  return entries
    .map(
      ([name, value]) =>
        `<tr><th scope="row"><code>${escapeHtml(name)}</code></th><td><pre class="inline-pre">${escapeHtml(formatValue(value))}</pre></td></tr>`,
    )
    .join("\n");
}

function verificationRows(verification: VerificationResult | null): string {
  if (!verification || verification.checks.length === 0) {
    return `<p class="muted">検証は実行されていません。</p>`;
  }
  const rows = verification.checks
    .map((check) => {
      const command = check.command.length
        ? `<code>${escapeHtml(check.command.join(" "))}</code>`
        : `<span class="muted">—</span>`;
      const output = check.output
        ? `<details><summary>出力</summary><pre>${escapeHtml(check.output)}</pre></details>`
        : "";
      return `<tr>
  <td><span class="status-pill" data-status="${escapeHtml(check.status)}">${escapeHtml(statusLabel(check.status))}</span></td>
  <td><code>${escapeHtml(check.name)}</code></td>
  <td>${escapeHtml(check.ecosystem)}</td>
  <td>${check.exitCode === null ? "—" : check.exitCode}</td>
  <td>${check.durationMs} ms</td>
  <td>${command}${output}</td>
</tr>`;
    })
    .join("\n");

  return `<div class="table-wrap"><table>
  <thead><tr><th>状態</th><th>チェック</th><th>対象</th><th>exit</th><th>時間</th><th>コマンド / 出力</th></tr></thead>
  <tbody>${rows}</tbody>
</table></div>`;
}

function changedFiles(result: SkillRunResult): string {
  if (result.changedFiles.length === 0) {
    return `<p class="muted">変更されたファイルはありません。</p>`;
  }
  return `<ul class="file-list">${result.changedFiles
    .map((file) => `<li><code>${escapeHtml(file)}</code></li>`)
    .join("")}</ul>`;
}

function timestamp(value: Date): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

export function buildSkillReport(input: SkillReportInput): string {
  const { skill, action, params, result, verification } = input;
  const generated = timestamp(input.generatedAt ?? new Date());
  const stderr = result.stderr.trim();
  const stdout = result.stdout.trim();
  const errorCode = result.errorCode
    ? `<div class="notice" data-status="failed"><strong>${escapeHtml(result.errorCode)}</strong></div>`
    : "";

  return `<!doctype html>
<html lang="ja" data-theme="light">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<title>${escapeHtml(skill.name)} / ${escapeHtml(action.description)}</title>
<style>
:root {
  --bg: #f4f3ef;
  --panel: #ffffff;
  --ink: #1f2422;
  --muted: #67706b;
  --line: #dcdcd4;
  --accent: #126d5a;
  --ok: #16704a;
  --ok-bg: #e4f3eb;
  --fail: #a33128;
  --fail-bg: #f9e7e4;
  --warn: #8a5b10;
  --warn-bg: #f8eed8;
  --muted-bg: #ecece7;
  --code: #f0efe9;
  --shadow: 0 18px 50px rgba(31, 36, 34, 0.08);
}
html[data-theme="dark"] {
  --bg: #151917;
  --panel: #1d2320;
  --ink: #edf1ee;
  --muted: #9ca8a1;
  --line: #38413c;
  --accent: #6fd0b4;
  --ok: #7cd6aa;
  --ok-bg: #183328;
  --fail: #ff9a8e;
  --fail-bg: #3a211e;
  --warn: #f0c477;
  --warn-bg: #3a2f1b;
  --muted-bg: #2a312d;
  --code: #141816;
  --shadow: 0 18px 50px rgba(0, 0, 0, 0.35);
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 48px 24px 64px;
  background: var(--bg);
  color: var(--ink);
  font-family: ui-sans-serif, system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;
  line-height: 1.6;
}
.report { max-width: 1080px; margin: 0 auto; }
.report-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 28px; }
.eyebrow { margin: 0 0 6px; color: var(--accent); font-size: 12px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; }
h1 { margin: 0; font-size: clamp(26px, 4vw, 40px); line-height: 1.15; letter-spacing: -0.02em; }
.lead { margin: 10px 0 0; color: var(--muted); max-width: 720px; }
.theme-toggle {
  flex: 0 0 auto; border: 1px solid var(--line); background: var(--panel); color: var(--ink);
  border-radius: 999px; padding: 8px 14px; font: inherit; font-size: 13px; cursor: pointer;
}
.theme-toggle:hover { border-color: var(--accent); color: var(--accent); }
.summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 20px; }
.summary-card { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; box-shadow: var(--shadow); }
.summary-label { display: block; color: var(--muted); font-size: 12px; margin-bottom: 4px; }
.summary-card strong { font-size: 18px; }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 18px; padding: 22px; margin-bottom: 18px; box-shadow: var(--shadow); }
.panel h2 { margin: 0 0 14px; font-size: 15px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.workflow { display: block; width: 100%; height: auto; overflow: visible; }
.wf-edge { fill: none; stroke: var(--line); stroke-width: 2; }
.arrow-head { fill: var(--muted); }
.wf-node rect { fill: var(--bg); stroke: var(--line); stroke-width: 1.5; }
.wf-node[data-status="ok"] rect, .wf-node[data-status="passed"] rect { stroke: var(--ok); }
.wf-node[data-status="failed"] rect, .wf-node[data-status="timeout"] rect { stroke: var(--fail); }
.wf-node[data-status="asked"] rect, .wf-node[data-status="blocked"] rect { stroke: var(--warn); }
.wf-step { fill: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; }
.wf-value { fill: var(--ink); font-size: 20px; font-weight: 700; }
.wf-sub { fill: var(--muted); font-size: 11px; }
.meta-grid { display: grid; grid-template-columns: max-content 1fr; gap: 8px 18px; margin: 0; }
.meta-grid dt { color: var(--muted); }
.meta-grid dd { margin: 0; }
dl.params { display: grid; grid-template-columns: max-content 1fr; gap: 10px 18px; margin: 0; }
dl.params dt { color: var(--muted); }
dl.params dd { margin: 0; min-width: 0; }
code { background: var(--code); border-radius: 5px; padding: 1px 5px; font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
pre { background: var(--code); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; overflow: auto; white-space: pre-wrap; word-break: break-word; font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 1.55; }
.inline-pre { margin: 0; border: 0; padding: 0; background: transparent; }
.output { margin-top: 12px; }
.output h3 { margin: 0 0 6px; font-size: 13px; color: var(--muted); }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; vertical-align: top; padding: 10px 12px; border-bottom: 1px solid var(--line); }
thead th { color: var(--muted); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
.status-pill { display: inline-block; border-radius: 999px; padding: 2px 9px; font-size: 11px; font-weight: 700; background: var(--muted-bg); color: var(--muted); }
.status-pill[data-status="ok"], .status-pill[data-status="passed"] { background: var(--ok-bg); color: var(--ok); }
.status-pill[data-status="failed"], .status-pill[data-status="timeout"] { background: var(--fail-bg); color: var(--fail); }
.status-pill[data-status="skipped"], .status-pill[data-status="blocked"] { background: var(--warn-bg); color: var(--warn); }
.file-list { margin: 0; padding-left: 20px; }
.muted { color: var(--muted); }
.notice { border-left: 4px solid var(--fail); background: var(--fail-bg); color: var(--fail); padding: 10px 14px; border-radius: 8px; margin-bottom: 14px; }
footer { color: var(--muted); font-size: 12px; text-align: center; margin-top: 28px; }
@media (max-width: 720px) {
  body { padding: 28px 14px 48px; }
  .report-head { flex-direction: column; }
  .wf-value { font-size: 16px; }
}
@media print {
  body { background: #fff; padding: 0; }
  .theme-toggle { display: none; }
  .panel, .summary-card { box-shadow: none; break-inside: avoid; }
}
</style>
</head>
<body>
<div class="report">
  <header class="report-head">
    <div>
      <p class="eyebrow">Right-Stuff Agent IDE / Skill Report</p>
      <h1>${escapeHtml(skill.name)} / ${escapeHtml(action.description)}</h1>
      <p class="lead">${escapeHtml(skill.description)}</p>
    </div>
    <button type="button" class="theme-toggle" id="theme-toggle" aria-label="テーマを切り替える">ダーク</button>
  </header>

  <section class="summary" aria-label="実行サマリー">
    ${summaryCard("ステータス", statusLabel(result.status), result.status)}
    ${summaryCard("判断", statusLabel(result.decision), result.decision)}
    ${summaryCard("実行時間", `${result.durationMs} ms`)}
    ${summaryCard("変更ファイル", `${result.changedFiles.length} 件`)}
    ${summaryCard("終了コード", result.exitCode === null ? "—" : String(result.exitCode))}
    ${summaryCard("監査 ID", `#${result.auditId}`)}
  </section>

  <section class="panel">
    <h2>実行フロー</h2>
    ${workflowSvg(input)}
  </section>

  <section class="panel">
    <h2>実行内容</h2>
    <dl class="meta-grid">
      <dt>スキル</dt><dd><code>${escapeHtml(skill.id)}</code> v${escapeHtml(skill.version)}</dd>
      <dt>アクション</dt><dd><code>${escapeHtml(action.id)}</code></dd>
      <dt>ハンドラ</dt><dd><code>${escapeHtml(action.handler)}</code></dd>
      <dt>リスク</dt><dd>${escapeHtml(action.risk)}</dd>
      <dt>実行 ID</dt><dd><code>${escapeHtml(result.runId)}</code></dd>
      <dt>生成日時</dt><dd>${escapeHtml(generated)}</dd>
    </dl>
    <div class="output">
      <h3>パラメータ</h3>
      <table>
        <tbody>${paramRows(params)}</tbody>
      </table>
    </div>
  </section>

  <section class="panel">
    <h2>変更ファイル</h2>
    ${changedFiles(result)}
  </section>

  <section class="panel">
    <h2>出力</h2>
    ${errorCode}
    <div class="output">
      <h3>stdout</h3>
      ${stdout ? `<pre>${escapeHtml(stdout)}</pre>` : `<p class="muted">出力はありません。</p>`}
    </div>
    <div class="output">
      <h3>stderr</h3>
      ${stderr ? `<pre>${escapeHtml(stderr)}</pre>` : `<p class="muted">出力はありません。</p>`}
    </div>
  </section>

  <section class="panel">
    <h2>検証</h2>
    ${verificationRows(verification)}
  </section>

  <footer>
    このレポートは Right-Stuff Agent IDE がローカルで生成しました。外部への送信は行っていません。
  </footer>
</div>
<script>
(function () {
  var root = document.documentElement;
  var button = document.getElementById("theme-toggle");
  function apply(theme) {
    root.dataset.theme = theme;
    button.textContent = theme === "dark" ? "ライト" : "ダーク";
  }
  var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  apply(prefersDark ? "dark" : "light");
  button.addEventListener("click", function () {
    apply(root.dataset.theme === "dark" ? "light" : "dark");
  });
})();
</script>
</body>
</html>
`;
}
