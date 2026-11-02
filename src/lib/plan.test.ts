import { describe, expect, it } from "vitest";

import {
  actionRisk,
  ALLOWED_ACTIONS,
  buildPlanMessages,
  parsePlan,
  PLAN_SYSTEM_PROMPT,
  PlanParseError,
} from "./plan";

function plan(steps: unknown[]): string {
  return JSON.stringify({ goal: "テスト", steps });
}

describe("parsePlan", () => {
  it("parses a fenced JSON response", () => {
    const raw = [
      "計画は次のとおりです。",
      "```json",
      plan([
        { title: "状態確認", command: ["snapshot", "--json"] },
        {
          title: "Safari を開く",
          command: ["launch", "Safari"],
          rationale: "確認のため",
        },
      ]),
      "```",
    ].join("\n");

    const result = parsePlan(raw, "フォールバック");

    expect(result.goal).toBe("テスト");
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]).toMatchObject({
      title: "状態確認",
      action: "snapshot",
      risk: "read",
      command: ["snapshot", "--json"],
    });
    expect(result.steps[1]).toMatchObject({
      action: "launch",
      risk: "write",
      rationale: "確認のため",
    });
  });

  it("falls back to the intent when goal is missing", () => {
    const result = parsePlan(
      JSON.stringify({ steps: [{ command: ["list-apps"] }] }),
      "アプリを一覧する",
    );

    expect(result.goal).toBe("アプリを一覧する");
    expect(result.steps[0]?.title).toBe("list-apps");
  });

  it("accepts args plus action as a compatibility shape", () => {
    const result = parsePlan(
      plan([{ title: "入力", action: "type", args: ["type", "hello"] }]),
      "入力",
    );

    expect(result.steps[0]?.command).toEqual(["type", "hello"]);
  });

  it("rejects unknown actions", () => {
    expect(() =>
      parsePlan(plan([{ command: ["rm", "-rf", "/"] }]), "削除"),
    ).toThrow(PlanParseError);
  });

  it("rejects malformed launch arguments", () => {
    expect(() =>
      parsePlan(plan([{ command: ["launch", "/Applications/Safari.app"] }]), "起動"),
    ).toThrow(/アプリ名/);
    expect(() =>
      parsePlan(plan([{ command: ["launch", "Safari", "extra"] }]), "起動"),
    ).toThrow(/アプリ名/);
  });

  it("rejects missing required arguments", () => {
    expect(() => parsePlan(plan([{ command: ["type"] }]), "入力")).toThrow(
      /書き込む内容/,
    );
    expect(() => parsePlan(plan([{ command: ["click"] }]), "クリック")).toThrow(
      /対象/,
    );
  });

  it("rejects NUL bytes and oversized commands", () => {
    expect(() =>
      parsePlan(plan([{ command: ["type", "hello\0world"] }]), "入力"),
    ).toThrow(/NUL/);
    expect(() =>
      parsePlan(
        plan([{ command: ["snapshot", ...Array.from({ length: 12 }, () => "x")] }]),
        "確認",
      ),
    ).toThrow(/引数が多すぎます/);
  });

  it("rejects empty and oversized plans", () => {
    expect(() => parsePlan(plan([]), "空")).toThrow(/実行手順/);
    expect(() =>
      parsePlan(
        plan(
          Array.from({ length: 13 }, () => ({
            command: ["snapshot", "--json"],
          })),
        ),
        "多すぎ",
      ),
    ).toThrow(/手順が多すぎます/);
  });

  it("rejects a response without JSON", () => {
    expect(() => parsePlan("計画できませんでした", "意図")).toThrow(
      /JSON/,
    );
  });
});

describe("plan prompt", () => {
  it("lists every allowlisted action and asks for raw JSON", () => {
    for (const action of ALLOWED_ACTIONS) {
      expect(PLAN_SYSTEM_PROMPT).toContain(action);
    }
    expect(PLAN_SYSTEM_PROMPT).toContain("JSON");
    expect(PLAN_SYSTEM_PROMPT).not.toContain("```");
  });

  it("builds a system and user message", () => {
    const messages = buildPlanMessages("  Safari を開く  ");

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({
      role: "system",
      content: PLAN_SYSTEM_PROMPT,
    });
    expect(messages[1]?.content).toContain("Safari を開く");
  });
});

describe("actionRisk", () => {
  it("marks read-only actions and everything else separately", () => {
    expect(actionRisk("snapshot")).toBe("read");
    expect(actionRisk("list-apps")).toBe("read");
    expect(actionRisk("launch")).toBe("write");
    expect(actionRisk("clipboard-set")).toBe("write");
  });
});
