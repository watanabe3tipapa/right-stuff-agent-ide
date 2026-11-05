import type {
  PlanStepRisk,
  SkillAction,
  SkillCatalog,
  SkillDecision,
  SkillManifest,
  SkillParamDef,
  SkillPolicy,
} from "../shared/types";

/**
 * Helpers shared by the skill catalog UI and the plan parser. The Rust
 * commands validate everything again; these checks only keep obviously bad
 * input from reaching the native dialog.
 */

export const DEFAULT_SKILL_POLICY = (): SkillPolicy => ({
  version: 1,
  skills: {},
  actions: {},
  verification: {
    autoRun: false,
    allowChecks: ["typecheck", "lint"],
  },
  limits: {
    maxFiles: 20,
    maxBytes: 1_048_576,
    timeoutMs: 300_000,
    maxOutputChars: 50_000,
  },
});

export const SKILL_DECISION_LABELS: Record<SkillDecision, string> = {
  allow: "許可",
  ask: "確認",
  block: "禁止",
};

export function skillRiskLabel(risk: PlanStepRisk): string {
  switch (risk) {
    case "read":
      return "読取";
    case "write":
      return "変更";
    case "destructive":
      return "破壊";
  }
}

export function findSkill(
  catalog: SkillCatalog | null,
  skillId: string,
): SkillManifest | null {
  return catalog?.skills.find((skill) => skill.id === skillId) ?? null;
}

export function findSkillAction(
  catalog: SkillCatalog | null,
  skillId: string,
  actionId: string,
): SkillAction | null {
  return (
    findSkill(catalog, skillId)?.actions.find(
      (action) => action.id === actionId,
    ) ?? null
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function matchesParamType(definition: SkillParamDef, value: unknown): boolean {
  switch (definition.type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "string[]":
      return (
        Array.isArray(value) &&
        value.every((item): item is string => typeof item === "string")
      );
  }
}

/**
 * Validate skill parameters against a manifest action. Returns an error
 * message suitable for the plan panel, or `null` when the shape is usable.
 */
export function validateSkillParams(
  action: SkillAction,
  params: unknown,
): string | null {
  if (!isRecord(params)) return "params はオブジェクトにしてください。";

  for (const name of Object.keys(params)) {
    if (!(name in action.params)) {
      return `${name} は ${action.id} のパラメータではありません。`;
    }
  }

  for (const [name, definition] of Object.entries(action.params)) {
    const value = params[name];
    const missing = value === undefined || value === null;
    if (missing) {
      if (definition.required) return `必須パラメータがありません: ${name}`;
      continue;
    }
    if (!matchesParamType(definition, value)) {
      return `${name} の型が不正です (${definition.type})。`;
    }
    if (
      definition.type === "string" &&
      typeof value === "string" &&
      definition.maxLength !== undefined &&
      value.length > definition.maxLength
    ) {
      return `${name} は ${definition.maxLength} 文字以内にしてください。`;
    }
    if (
      definition.type === "string[]" &&
      Array.isArray(value) &&
      definition.maxItems !== undefined &&
      value.length > definition.maxItems
    ) {
      return `${name} は ${definition.maxItems} 件以内にしてください。`;
    }
  }

  return null;
}

/** One-line summary used in the planning prompt. */
export function describeSkillCatalog(catalog: SkillCatalog | null): string {
  if (!catalog || catalog.skills.length === 0) return "";
  return catalog.skills
    .flatMap((skill) =>
      skill.actions.map((action) => {
        const params = Object.entries(action.params)
          .map(
            ([name, definition]) =>
              `${name}: ${definition.type}${definition.required ? " (required)" : ""}`,
          )
          .join(", ");
        return `- ${skill.id}.${action.id} [${action.risk}] ${action.description}${
          params ? ` (${params})` : ""
        }`;
      }),
    )
    .join("\n");
}

/** Display string for a skill plan step. */
export function skillCommandLabel(skillId: string, actionId: string): string {
  return `skill ${skillId} ${actionId}`;
}
