import { describe, expect, it } from "vitest";

import {
  ALLOWED_ACTIONS,
  READ_ONLY_ACTIONS,
} from "./plan";
import {
  allowedDecisions,
  defaultAgentPolicy,
  policyDecision,
} from "./policy";

describe("defaultAgentPolicy", () => {
  it("covers every action and allows reads", () => {
    const policy = defaultAgentPolicy();

    expect(Object.keys(policy.actions)).toHaveLength(ALLOWED_ACTIONS.length);
    for (const action of READ_ONLY_ACTIONS) {
      expect(policy.actions[action]).toBe("allow");
    }
    expect(policy.actions.launch).toBe("ask");
    expect(policy.auditEnabled).toBe(true);
    expect(policy.auditRetentionDays).toBe(30);
  });
});

describe("policy decisions", () => {
  it("never auto-allows mutating actions", () => {
    expect(allowedDecisions("launch")).toEqual(["ask", "block"]);
    expect(allowedDecisions("clipboard-set")).toEqual(["ask", "block"]);
  });

  it("lets read-only actions be allowed, asked, or blocked", () => {
    expect(allowedDecisions("snapshot")).toEqual(["allow", "ask", "block"]);
  });

  it("falls back to safe defaults for a missing policy", () => {
    expect(policyDecision(null, "snapshot")).toBe("allow");
    expect(policyDecision(null, "launch")).toBe("block");
  });

  it("uses explicit decisions when present", () => {
    const policy = {
      ...defaultAgentPolicy(),
      actions: {
        ...defaultAgentPolicy().actions,
        snapshot: "ask" as const,
        launch: "block" as const,
      },
    };

    expect(policyDecision(policy, "snapshot")).toBe("ask");
    expect(policyDecision(policy, "launch")).toBe("block");
  });
});
