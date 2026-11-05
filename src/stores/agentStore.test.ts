import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentPlan, AgentRunResult } from "../shared/types";
import { DEFAULT_LLM_CONFIG } from "../lib/llm";
import { defaultAgentPolicy } from "../lib/policy";
import { useAgentStore } from "./agentStore";

const mocks = vi.hoisted(() => ({
  llmChat: vi.fn(),
  llmConfig: vi.fn(),
  llmCancel: vi.fn(),
  agentRun: vi.fn(),
  auditLogAdd: vi.fn(),
  agentPolicy: vi.fn(),
  agentPolicySet: vi.fn(),
  auditLog: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  api: {
    isTauri: true,
    llmChat: mocks.llmChat,
    llmConfig: mocks.llmConfig,
    llmCancel: mocks.llmCancel,
    agentRun: mocks.agentRun,
    auditLogAdd: mocks.auditLogAdd,
    agentPolicy: mocks.agentPolicy,
    agentPolicySet: mocks.agentPolicySet,
    auditLog: mocks.auditLog,
  },
  errorMessage: (error: unknown) => String(error),
}));

const runResult = (ok: boolean, stdout = "", stderr = ""): AgentRunResult => ({
  ok,
  code: ok ? 0 : 1,
  stdout,
  stderr,
  command: [],
});

function plan(): AgentPlan {
  return {
    id: "plan-1",
    goal: "確認する",
    createdAt: 0,
    status: "approved",
    steps: [
      {
        id: "step-1",
        kind: "agent",
        title: "状態確認",
        command: ["snapshot", "--json"],
        action: "snapshot",
        risk: "read",
        status: "approved",
      },
      {
        id: "step-2",
        kind: "agent",
        title: "アプリを開く",
        command: ["launch", "Safari"],
        action: "launch",
        risk: "write",
        status: "approved",
      },
    ],
  };
}

function resetStore() {
  useAgentStore.setState({
    mode: "assistive",
    panelTab: "chat",
    plan: null,
    planLoading: false,
    planRaw: "",
    planError: null,
    executingStepId: null,
    streaming: false,
    busy: false,
    messages: [],
    policy: null,
    policyLoading: false,
    policyError: null,
    audit: [],
    auditLoading: false,
    auditError: null,
    auditHasMore: false,
    llm: {
      ...DEFAULT_LLM_CONFIG,
      configured: true,
      keyConfigured: true,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auditLogAdd.mockResolvedValue(undefined);
  resetStore();
});

describe("plan generation", () => {
  it("parses a streamed plan without executing it", async () => {
    mocks.llmChat.mockImplementation(
      async (
        _messages: unknown,
        onEvent: (event: Record<string, unknown>) => void,
      ) => {
        onEvent({
          type: "delta",
          text: '```json\n{"goal":"Safari を確認","steps":[{"title":"状態確認","command":["snapshot","--json"]}]}\n```',
        });
        onEvent({ type: "done", finishReason: "stop" });
      },
    );

    await useAgentStore.getState().generatePlan("Safari を確認");

    const state = useAgentStore.getState();
    expect(state.planLoading).toBe(false);
    expect(state.planError).toBeNull();
    expect(state.panelTab).toBe("plan");
    expect(state.plan?.status).toBe("draft");
    expect(state.plan?.steps[0]?.status).toBe("pending");
    expect(mocks.agentRun).not.toHaveBeenCalled();
    expect(mocks.auditLogAdd).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "plan_created", planId: state.plan?.id }),
    );
  });

  it("rejects a response with a disallowed action", async () => {
    mocks.llmChat.mockImplementation(
      async (
        _messages: unknown,
        onEvent: (event: Record<string, unknown>) => void,
      ) => {
        onEvent({
          type: "delta",
          text: JSON.stringify({
            goal: "削除",
            steps: [{ command: ["rm", "-rf", "/"] }],
          }),
        });
        onEvent({ type: "done", finishReason: "stop" });
      },
    );

    await useAgentStore.getState().generatePlan("削除する");

    const state = useAgentStore.getState();
    expect(state.plan).toBeNull();
    expect(state.planError).toMatch(/許可されていないアクション/);
  });

  it("does not call the LLM in passive mode", async () => {
    useAgentStore.setState({ mode: "passive" });

    await useAgentStore.getState().generatePlan("Safari を開く");

    expect(mocks.llmChat).not.toHaveBeenCalled();
    expect(useAgentStore.getState().plan).toBeNull();
  });
});

describe("plan approval and execution", () => {
  it("approves every pending step", () => {
    useAgentStore.setState({
      plan: {
        ...plan(),
        status: "draft",
        steps: plan().steps.map((step) => ({ ...step, status: "pending" })),
      },
    });

    useAgentStore.getState().approvePlan();

    const current = useAgentStore.getState().plan;
    expect(current?.status).toBe("approved");
    expect(current?.steps.map((step) => step.status)).toEqual([
      "approved",
      "approved",
    ]);
    expect(mocks.auditLogAdd).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "plan_approved", planId: "plan-1" }),
    );
  });

  it("does not approve a plan in passive mode", () => {
    useAgentStore.setState({
      mode: "passive",
      plan: {
        ...plan(),
        status: "draft",
        steps: plan().steps.map((step) => ({ ...step, status: "pending" })),
      },
    });

    useAgentStore.getState().approvePlan();

    expect(useAgentStore.getState().plan?.status).toBe("draft");
  });

  it("runs a single step in assistive mode", async () => {
    useAgentStore.setState({ plan: plan(), mode: "assistive" });
    mocks.agentRun.mockResolvedValue(runResult(true, "ok"));

    await useAgentStore.getState().runPlanStep("step-1");

    expect(mocks.agentRun).toHaveBeenCalledWith(
      ["snapshot", "--json"],
      expect.objectContaining({
        planId: "plan-1",
        stepId: "step-1",
        mode: "assistive",
      }),
    );
    const state = useAgentStore.getState();
    expect(state.executingStepId).toBeNull();
    expect(state.plan?.steps[0]?.status).toBe("done");
    expect(state.plan?.steps[0]?.output).toBe("ok");
    expect(state.plan?.steps[1]?.status).toBe("approved");
    expect(state.plan?.status).toBe("approved");
  });

  it("does not run all steps in assistive mode", async () => {
    useAgentStore.setState({ plan: plan(), mode: "assistive" });

    await useAgentStore.getState().executePlan();

    expect(mocks.agentRun).not.toHaveBeenCalled();
  });

  it("runs approved steps in order and stops on failure", async () => {
    useAgentStore.setState({ plan: plan(), mode: "autonomous" });
    mocks.agentRun
      .mockResolvedValueOnce(runResult(true, "first"))
      .mockResolvedValueOnce(runResult(false, "", "launch failed"));

    await useAgentStore.getState().executePlan();

    expect(mocks.agentRun).toHaveBeenCalledTimes(2);
    const state = useAgentStore.getState().plan;
    expect(state?.status).toBe("failed");
    expect(state?.steps[0]?.status).toBe("done");
    expect(state?.steps[1]?.status).toBe("failed");
    expect(state?.steps[1]?.error).toContain("launch failed");
  });

  it("marks the plan completed when every step succeeds", async () => {
    useAgentStore.setState({ plan: plan(), mode: "autonomous" });
    mocks.agentRun.mockResolvedValue(runResult(true, "ok"));

    await useAgentStore.getState().executePlan();

    const state = useAgentStore.getState().plan;
    expect(state?.status).toBe("completed");
    expect(state?.steps.every((step) => step.status === "done")).toBe(true);
  });

  it("skips pending steps when the plan is rejected", () => {
    useAgentStore.setState({
      plan: { ...plan(), status: "draft" },
    });

    useAgentStore.getState().rejectPlan();

    const state = useAgentStore.getState().plan;
    expect(state?.status).toBe("cancelled");
    expect(state?.steps.every((step) => step.status === "skipped")).toBe(true);
    expect(mocks.auditLogAdd).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "plan_rejected", planId: "plan-1" }),
    );
  });
});

describe("policy and audit", () => {
  it("loads and saves the agent policy", async () => {
    const policy = defaultAgentPolicy();
    mocks.agentPolicy.mockResolvedValue(policy);
    mocks.agentPolicySet.mockResolvedValue({
      ...policy,
      auditRetentionDays: 7,
    });

    await useAgentStore.getState().refreshPolicy();
    expect(useAgentStore.getState().policy).toEqual(policy);

    await useAgentStore.getState().savePolicy({
      ...policy,
      auditRetentionDays: 7,
    });

    const state = useAgentStore.getState();
    expect(state.policy?.auditRetentionDays).toBe(7);
    expect(mocks.agentPolicySet).toHaveBeenCalledWith(
      expect.objectContaining({ auditRetentionDays: 7 }),
    );
  });

  it("loads audit entries and the next page", async () => {
    const first = Array.from({ length: 50 }, (_, index) => ({
      id: 100 - index,
      createdAt: 0,
      kind: "action_run" as const,
      mode: "assistive" as const,
      planId: null,
      stepId: null,
      title: null,
      command: null,
      outcome: "ok" as const,
      detail: null,
    }));
    mocks.auditLog
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce([{ ...first[0], id: 1 }]);

    await useAgentStore.getState().refreshAudit();
    expect(useAgentStore.getState().audit).toHaveLength(50);
    expect(useAgentStore.getState().auditHasMore).toBe(true);

    await useAgentStore.getState().loadMoreAudit();
    const state = useAgentStore.getState();
    expect(state.audit).toHaveLength(51);
    expect(state.auditHasMore).toBe(false);
    expect(mocks.auditLog).toHaveBeenLastCalledWith(50, 50);
  });
});
