import type {
  AgentPlanStep,
  LlmChatMessage,
  PlanStepKind,
  PlanStepRisk,
  SkillCatalog,
} from "../shared/types";
import {
  describeSkillCatalog,
  findSkillAction,
  skillCommandLabel,
  validateSkillParams,
} from "./skills";

/**
 * Planning support for the agent panel.
 *
 * The LLM only proposes commands; every step is validated here with the same
 * shape rules as the Rust `agent_run` command. Mutating steps still go through
 * the native confirmation dialog when they are executed.
 */

export const MAX_PLAN_STEPS = 12;
export const MAX_PLAN_INTENT_CHARS = 4_000;

const MAX_ARG_COUNT = 12;
const MAX_ARG_CHARS = 16_384;
const MAX_TOTAL_ARG_CHARS = 32_768;
const MAX_TITLE_CHARS = 160;
const MAX_RATIONALE_CHARS = 500;

/** Keep in sync with `ALLOWED_ACTIONS` in `src-tauri/src/commands/agent.rs`. */
export const ALLOWED_ACTIONS = [
  "snapshot",
  "click",
  "type",
  "set-value",
  "press",
  "scroll",
  "list-apps",
  "list-windows",
  "focus-window",
  "launch",
  "close-app",
  "clipboard-get",
  "clipboard-set",
  "list-notifications",
  "dismiss-notification",
  "session",
  "trace",
  "--version",
  "--help",
] as const;

/** Keep in sync with `READ_ONLY_ACTIONS` in `src-tauri/src/commands/agent.rs`. */
export const READ_ONLY_ACTIONS = [
  "snapshot",
  "list-apps",
  "list-windows",
  "list-notifications",
  "--version",
  "--help",
] as const;

export type AgentAction = (typeof ALLOWED_ACTIONS)[number];

export interface PlanDraftStep {
  kind: PlanStepKind;
  title: string;
  command: string[];
  action: string;
  risk: PlanStepRisk;
  skillId?: string;
  skillActionId?: string;
  params?: Record<string, unknown>;
  rationale?: string;
}

export interface PlanDraft {
  goal: string;
  steps: PlanDraftStep[];
}

export class PlanParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanParseError";
  }
}

export function isAllowedAction(value: string): value is AgentAction {
  return (ALLOWED_ACTIONS as readonly string[]).includes(value);
}

export function actionRisk(action: string): PlanStepRisk {
  return (READ_ONLY_ACTIONS as readonly string[]).includes(action)
    ? "read"
    : "write";
}

export function buildPlanMessages(
  intent: string,
  catalog: SkillCatalog | null = null,
): LlmChatMessage[] {
  const skills = describeSkillCatalog(catalog);
  return [
    {
      role: "system",
      content: skills
        ? `${PLAN_SYSTEM_PROMPT}\n\n利用可能なスキル:\n${skills}`
        : PLAN_SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: `次の意図を実行可能な計画にしてください。\n\n${intent.trim()}`,
    },
  ];
}

export const PLAN_SYSTEM_PROMPT = [
  "あなたは Right-Stuff Agent IDE の計画立案担当です。",
  "ユーザーの意図を、Agent Desktop CLI で実行できる小さな手順に分解してください。",
  "各手順の command は CLI にそのまま渡す引数配列です。先頭要素は必ず許可アクションにしてください。",
  "シェルは介しません。パイプ、リダイレクト、`sh -c`、複数コマンドの連結は使えません。",
  "読み取り専用の手順を先に置き、変更操作は必要最小限にしてください。",
  "確認できないアプリ名や対象を推測しないでください。情報が足りない場合は、snapshot や list-apps で確認する手順にしてください。",
  "最大 12 手順です。",
  "スキルを使う手順は kind を \"skill\" にし、skillId、actionId、params を指定してください。",
  "スキルを使わない手順は kind を \"agent\" にし、command に CLI 引数を指定してください。",
  "",
  "許可アクション:",
  ALLOWED_ACTIONS.join(", "),
  "",
  "次の JSON オブジェクトだけを出力してください。説明、前置き、Markdown のコードフェンスは不要です。",
  '{"goal":"計画の目的","steps":[{"kind":"agent","title":"短い手順名","command":["snapshot"],"rationale":"この手順が必要な理由"}]}',
  '{"goal":"コードを直す","steps":[{"kind":"skill","title":"型を修正","skillId":"code-edit","actionId":"editor.replaceText","params":{"path":"src/App.tsx","oldText":"const value: string = 1;","newText":"const value: number = 1;"},"rationale":"型エラーを解消する"}]}',
  "steps が空の計画は無効です。",
].join("\n");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

/**
 * Extract the JSON object from a model reply. Models sometimes wrap JSON in a
 * fenced block or add a short sentence before it.
 */
function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new PlanParseError("計画の JSON が見つかりませんでした。");
  }
  return candidate.slice(start, end + 1);
}

function validateCommand(value: unknown, index: number): {
  command: string[];
  action: AgentAction;
  risk: PlanStepRisk;
} {
  if (!Array.isArray(value) || value.length === 0) {
    throw new PlanParseError(`手順 ${index + 1} に command がありません。`);
  }

  if (!value.every((item): item is string => typeof item === "string")) {
    throw new PlanParseError(`手順 ${index + 1} の command は文字列の配列にしてください。`);
  }

  const command = value as string[];
  const action = command[0];

  if (!isAllowedAction(action)) {
    throw new PlanParseError(
      `手順 ${index + 1} に許可されていないアクションが含まれています: ${action}`,
    );
  }

  if (command.length > MAX_ARG_COUNT) {
    throw new PlanParseError(
      `手順 ${index + 1} の引数が多すぎます (上限 ${MAX_ARG_COUNT} 個)。`,
    );
  }

  let totalChars = 0;
  for (const arg of command) {
    if (arg.includes("\0")) {
      throw new PlanParseError(`手順 ${index + 1} の引数に NUL 文字があります。`);
    }
    if (arg.length > MAX_ARG_CHARS) {
      throw new PlanParseError(`手順 ${index + 1} の引数が長すぎます。`);
    }
    totalChars += arg.length;
  }
  if (totalChars > MAX_TOTAL_ARG_CHARS) {
    throw new PlanParseError(`手順 ${index + 1} の引数が全体で長すぎます。`);
  }

  switch (action) {
    case "launch":
    case "close-app": {
      if (command.length !== 2) {
        throw new PlanParseError(`${action} にはアプリ名を 1 つ指定してください。`);
      }
      const name = command[1].trim();
      if (
        !name ||
        name.startsWith("-") ||
        name.includes("/") ||
        name.includes("\\") ||
        name.includes("..")
      ) {
        throw new PlanParseError(`${action} のアプリ名が不正です。`);
      }
      break;
    }
    case "type":
    case "set-value":
    case "clipboard-set":
      if (command.length < 2 || !command[1]?.trim()) {
        throw new PlanParseError(`${action} には書き込む内容が必要です。`);
      }
      break;
    case "click":
    case "press":
    case "scroll":
    case "focus-window":
    case "dismiss-notification":
      if (command.length < 2) {
        throw new PlanParseError(`${action} には対象が必要です。`);
      }
      break;
    default:
      break;
  }

  return { command, action, risk: actionRisk(action) };
}

function parseStep(
  value: unknown,
  index: number,
  catalog: SkillCatalog | null,
): PlanDraftStep {
  if (!isRecord(value)) {
    throw new PlanParseError(`手順 ${index + 1} がオブジェクトではありません。`);
  }

  const rawTitle =
    typeof value.title === "string" ? value.title.trim() : "";
  const rawRationale =
    typeof value.rationale === "string" ? value.rationale.trim() : "";
  const rationale = rawRationale
    ? truncate(rawRationale, MAX_RATIONALE_CHARS)
    : undefined;

  const kind =
    value.kind === "skill" || (value.kind !== "agent" && typeof value.skillId === "string")
      ? "skill"
      : "agent";

  if (kind === "skill") {
    const skillId =
      typeof value.skillId === "string" ? value.skillId.trim() : "";
    const actionId =
      typeof value.actionId === "string" ? value.actionId.trim() : "";
    if (!skillId || !actionId) {
      throw new PlanParseError(
        `手順 ${index + 1} のスキルに skillId または actionId がありません。`,
      );
    }

    const action = findSkillAction(catalog, skillId, actionId);
    if (!action) {
      throw new PlanParseError(
        `手順 ${index + 1} のスキルがカタログにありません: ${skillId} / ${actionId}`,
      );
    }

    const params = value.params === undefined ? {} : value.params;
    const paramsError = validateSkillParams(action, params);
    if (paramsError) {
      throw new PlanParseError(`手順 ${index + 1}: ${paramsError}`);
    }

    return {
      kind: "skill",
      title: rawTitle
        ? truncate(rawTitle, MAX_TITLE_CHARS)
        : truncate(`${skillId} / ${actionId}`, MAX_TITLE_CHARS),
      command: [skillCommandLabel(skillId, actionId)],
      action: actionId,
      risk: action.risk,
      skillId,
      skillActionId: actionId,
      params: params as Record<string, unknown>,
      rationale,
    };
  }

  let commandValue = value.command;
  if (!Array.isArray(commandValue) && Array.isArray(value.args)) {
    const action = typeof value.action === "string" ? value.action : null;
    commandValue =
      action && value.args[0] !== action ? [action, ...value.args] : value.args;
  }

  const { command, action, risk } = validateCommand(commandValue, index);

  return {
    kind: "agent",
    title: rawTitle
      ? truncate(rawTitle, MAX_TITLE_CHARS)
      : truncate(command.join(" "), MAX_TITLE_CHARS),
    command,
    action,
    risk,
    rationale,
  };
}

/**
 * Parse and validate a model-generated plan. Throws `PlanParseError` with a
 * user-facing message when the response cannot be executed safely.
 */
export function parsePlan(
  raw: string,
  fallbackGoal: string,
  catalog: SkillCatalog | null = null,
): PlanDraft {
  let payload: unknown;
  try {
    payload = JSON.parse(extractJson(raw));
  } catch (error) {
    if (error instanceof PlanParseError) throw error;
    throw new PlanParseError("計画の JSON を解析できませんでした。");
  }

  if (!isRecord(payload)) {
    throw new PlanParseError("計画の形式が不正です。");
  }

  if (!Array.isArray(payload.steps) || payload.steps.length === 0) {
    throw new PlanParseError("計画に実行手順が含まれていません。");
  }

  if (payload.steps.length > MAX_PLAN_STEPS) {
    throw new PlanParseError(
      `手順が多すぎます (上限 ${MAX_PLAN_STEPS} 手順)。`,
    );
  }

  const goal =
    typeof payload.goal === "string" && payload.goal.trim()
      ? truncate(payload.goal.trim(), MAX_TITLE_CHARS)
      : truncate(fallbackGoal.trim(), MAX_TITLE_CHARS);

  return {
    goal,
    steps: payload.steps.map((step, index) =>
      parseStep(step, index, catalog),
    ),
  };
}

export function materializePlanSteps(
  draft: PlanDraft,
  createId: () => string,
): AgentPlanStep[] {
  return draft.steps.map((step) => ({
    ...step,
    id: createId(),
    status: "pending",
  }));
}
