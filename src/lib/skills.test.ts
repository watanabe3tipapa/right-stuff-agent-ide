import { describe, expect, it } from "vitest";

import type { SkillCatalog, SkillManifest } from "../shared/types";
import {
  DEFAULT_SKILL_POLICY,
  describeSkillCatalog,
  findSkill,
  findSkillAction,
  skillCommandLabel,
  skillRiskLabel,
  validateSkillParams,
} from "./skills";

function manifest(overrides: Partial<SkillManifest> = {}): SkillManifest {
  return {
    schemaVersion: 1,
    id: "code-edit",
    name: "Code Edit",
    description: "テスト用",
    version: "0.1.0",
    category: "editor",
    risk: "write",
    actions: [
      {
        id: "editor.readFile",
        handler: "editor.readFile",
        description: "読み取る",
        risk: "read",
        params: {
          path: { type: "string", description: "パス", required: true },
        },
      },
      {
        id: "editor.replaceText",
        handler: "editor.replaceText",
        description: "置換する",
        risk: "write",
        params: {
          path: { type: "string", description: "パス", required: true },
          oldText: {
            type: "string",
            description: "置換前",
            required: true,
            maxLength: 10,
          },
          newText: { type: "string", description: "置換後", required: true },
          tags: { type: "string[]", description: "タグ", maxItems: 2 },
        },
      },
    ],
    permissions: { paths: { read: ["**/*"], write: ["**/*"] }, commands: [], env: [] },
    approval: { default: null, overrides: {} },
    verification: {
      mode: "auto",
      checks: ["typecheck", "lint", "test"],
      timeoutMs: 300_000,
      stopOnFailure: true,
    },
    limits: {
      maxFiles: 20,
      maxBytes: 1_048_576,
      timeoutMs: 300_000,
      maxOutputChars: 50_000,
    },
    ...overrides,
  };
}

function catalog(skills: SkillManifest[] = [manifest()]): SkillCatalog {
  return { skills, warnings: [] };
}

describe("skill catalog helpers", () => {
  it("finds skills and actions", () => {
    const data = catalog();
    expect(findSkill(data, "code-edit")?.name).toBe("Code Edit");
    expect(findSkill(data, "missing")).toBeNull();
    expect(findSkillAction(data, "code-edit", "editor.readFile")?.risk).toBe(
      "read",
    );
    expect(findSkillAction(data, "code-edit", "editor.unknown")).toBeNull();
    expect(findSkill(null, "code-edit")).toBeNull();
  });

  it("labels risks", () => {
    expect(skillRiskLabel("read")).toBe("読取");
    expect(skillRiskLabel("write")).toBe("変更");
    expect(skillRiskLabel("destructive")).toBe("破壊");
  });

  it("describes the catalog for the planning prompt", () => {
    expect(describeSkillCatalog(null)).toBe("");
    const summary = describeSkillCatalog(catalog());
    expect(summary).toContain("code-edit.editor.replaceText");
    expect(summary).toContain("[write]");
    expect(summary).toContain("path: string (required)");
  });

  it("has a default policy that never allows writes", () => {
    const policy = DEFAULT_SKILL_POLICY();
    expect(policy.verification.autoRun).toBe(false);
    expect(policy.verification.allowChecks).not.toContain("test");
    expect(policy.actions).toEqual({});
  });

  it("builds a readable command label", () => {
    expect(skillCommandLabel("code-edit", "editor.readFile")).toBe(
      "skill code-edit editor.readFile",
    );
  });
});

describe("validateSkillParams", () => {
  const action = manifest().actions[1]!;

  it("accepts a valid parameter set", () => {
    expect(
      validateSkillParams(action, {
        path: "app.ts",
        oldText: "a",
        newText: "b",
        tags: ["x", "y"],
      }),
    ).toBeNull();
  });

  it("rejects unknown and non-object params", () => {
    expect(validateSkillParams(action, null)).toMatch(/オブジェクト/);
    expect(validateSkillParams(action, ["x"])).toMatch(/オブジェクト/);
    expect(
      validateSkillParams(action, { path: "a", oldText: "a", newText: "b", extra: 1 }),
    ).toMatch(/extra/);
  });

  it("rejects missing required params", () => {
    expect(validateSkillParams(action, { path: "a" })).toMatch(/必須/);
    expect(
      validateSkillParams(action, { path: "a", oldText: "a", newText: null }),
    ).toMatch(/必須/);
  });

  it("rejects wrong types, lengths, and counts", () => {
    expect(
      validateSkillParams(action, { path: 1, oldText: "a", newText: "b" }),
    ).toMatch(/型/);
    expect(
      validateSkillParams(action, {
        path: "a",
        oldText: "01234567890",
        newText: "b",
      }),
    ).toMatch(/10 文字/);
    expect(
      validateSkillParams(action, {
        path: "a",
        oldText: "a",
        newText: "b",
        tags: ["1", "2", "3"],
      }),
    ).toMatch(/2 件/);
    expect(
      validateSkillParams(action, {
        path: "a",
        oldText: "a",
        newText: "b",
        tags: ["1", 2],
      }),
    ).toMatch(/型/);
  });
});
