import { create } from "zustand";

import type {
  AgentAuditMeta,
  AgentMode,
  AgentPanelTab,
  AgentPlan,
  AgentPolicy,
  AgentRunResult,
  AgentStatus,
  AuditEntry,
  AuditInput,
  ChatMessage,
  LlmSettings,
} from "../shared/types";
import { api, errorMessage } from "../lib/api";
import { toRequestMessages } from "../lib/llm";
import {
  buildPlanMessages,
  materializePlanSteps,
  MAX_PLAN_INTENT_CHARS,
  parsePlan,
} from "../lib/plan";

const MODE_STORAGE_KEY = "rsai.agentMode";

function loadMode(): AgentMode {
  if (typeof window === "undefined") return "assistive";
  const stored = localStorage.getItem(MODE_STORAGE_KEY);
  if (stored === "passive" || stored === "assistive" || stored === "autonomous") {
    return stored;
  }
  return "assistive";
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function message(
  role: ChatMessage["role"],
  text: string,
  options: { command?: string; local?: boolean } = {},
): ChatMessage {
  return {
    id: newId(),
    role,
    text,
    createdAt: Date.now(),
    command: options.command,
    local: options.local,
  };
}

interface AgentState {
  mode: AgentMode;
  panelTab: AgentPanelTab;
  status: AgentStatus | null;
  statusLoading: boolean;
  messages: ChatMessage[];
  busy: boolean;
  snapshot: AgentRunResult | null;
  llm: LlmSettings | null;
  llmLoading: boolean;
  streaming: boolean;
  settingsOpen: boolean;
  plan: AgentPlan | null;
  planLoading: boolean;
  planRaw: string;
  planError: string | null;
  executingStepId: string | null;
  policy: AgentPolicy | null;
  policyLoading: boolean;
  policyError: string | null;
  audit: AuditEntry[];
  auditLoading: boolean;
  auditError: string | null;
  auditHasMore: boolean;
  setMode: (mode: AgentMode) => void;
  setPanelTab: (tab: AgentPanelTab) => void;
  refreshStatus: () => Promise<void>;
  refreshLlm: () => Promise<void>;
  send: (text: string) => Promise<void>;
  stopStreaming: () => Promise<void>;
  takeSnapshot: () => Promise<void>;
  clearMessages: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  generatePlan: (intent: string) => Promise<void>;
  cancelPlanGeneration: () => Promise<void>;
  approvePlan: () => void;
  rejectPlan: () => void;
  resetPlan: () => void;
  runPlanStep: (stepId: string) => Promise<void>;
  executePlan: () => Promise<void>;
  refreshPolicy: () => Promise<void>;
  savePolicy: (policy: AgentPolicy) => Promise<AgentPolicy>;
  refreshAudit: () => Promise<void>;
  loadMoreAudit: () => Promise<void>;
}

function appendLocal(
  set: (updater: (state: AgentState) => Partial<AgentState>) => void,
  text: string,
  options: { command?: string } = {},
) {
  set((state) => ({
    messages: [
      ...state.messages,
      message("agent", text, { ...options, local: true }),
    ],
  }));
}

function logAudit(input: AuditInput) {
  void api.auditLogAdd(input).catch(() => {
    // Audit writes are best-effort; never block the agent action on them.
  });
}

export const useAgentStore = create<AgentState>((set, get) => ({
  mode: loadMode(),
  panelTab: "chat",
  status: null,
  statusLoading: false,
  messages: [
    message(
      "agent",
      "こんにちは。Right-Stuff Agent IDE のエージェントパネルです。\nLLM を設定するとチャットと計画立案が使えます。右上の歯車アイコンからプロバイダーとモデルを設定してください。\n`/status` — Agent Desktop の検出状態\n`/snapshot` — デスクトップのスナップショット取得\n`/plan <意図>` — 実行計画の作成と承認",
      { local: true },
    ),
  ],
  busy: false,
  snapshot: null,
  llm: null,
  llmLoading: false,
  streaming: false,
  settingsOpen: false,
  plan: null,
  planLoading: false,
  planRaw: "",
  planError: null,
  executingStepId: null,
  policy: null,
  policyLoading: false,
  policyError: null,
  audit: [],
  auditLoading: false,
  auditError: null,
  auditHasMore: false,

  setMode(mode) {
    if (typeof window !== "undefined") {
      localStorage.setItem(MODE_STORAGE_KEY, mode);
    }
    set({ mode });
  },

  setPanelTab(tab) {
    set({ panelTab: tab });
  },

  async refreshStatus() {
    set({ statusLoading: true });
    try {
      const status = await api.agentStatus();
      set({ status, statusLoading: false });
    } catch (error) {
      set({ statusLoading: false, status: null });
      set((state) => ({
        messages: [
          ...state.messages,
          message("system", errorMessage(error), { local: true }),
        ],
      }));
    }
  },

  async refreshLlm() {
    set({ llmLoading: true });
    try {
      const llm = await api.llmConfig();
      set({ llm, llmLoading: false });
    } catch {
      set({ llmLoading: false });
    }
  },

  async send(text) {
    const trimmed = text.trim();
    if (
      !trimmed ||
      get().busy ||
      get().streaming ||
      get().planLoading ||
      get().executingStepId
    ) {
      return;
    }

    const isPlanCommand =
      trimmed === "/plan" || trimmed.startsWith("/plan ");
    const isLocalCommand =
      isPlanCommand ||
      trimmed === "/status" ||
      trimmed === "ステータス" ||
      trimmed === "/snapshot" ||
      trimmed.includes("スナップショット");

    set((state) => ({
      messages: [
        ...state.messages,
        message("user", trimmed, { local: isLocalCommand }),
      ],
    }));

    if (isPlanCommand) {
      const intent = trimmed.slice("/plan".length).trim();
      set({ panelTab: "plan" });
      if (!intent) {
        appendLocal(
          set,
          "計画したい内容を Plan タブに入力してください。例: `/plan Safari を開いて検索欄に調べたい語を入力`",
        );
        return;
      }
      await get().generatePlan(intent);
      return;
    }

    if (trimmed === "/status" || trimmed === "ステータス") {
      const status = await api.agentStatus();
      set((state) => ({
        status,
        messages: [
          ...state.messages,
          message(
            "agent",
            status.available
              ? `Agent Desktop: ${status.version ?? "version unknown"}\n${status.binary}\n${status.message}`
              : status.message,
            { command: "agent-desktop --version", local: true },
          ),
        ],
      }));
      return;
    }

    if (trimmed === "/snapshot" || trimmed.includes("スナップショット")) {
      await get().takeSnapshot();
      return;
    }

    if (get().mode === "passive") {
      set((state) => ({
        messages: [
          ...state.messages,
          message(
            "agent",
            "Passive モードではチャット応答は行いません。モードを Assistive 以上に切り替えてください。",
            { local: true },
          ),
        ],
      }));
      return;
    }

    if (!api.isTauri) {
      set((state) => ({
        messages: [
          ...state.messages,
          message(
            "agent",
            "ブラウザデモでは LLM を利用できません。`npm run tauri dev` で Tauri 版を起動し、設定画面でプロバイダーを登録してください。",
            { local: true },
          ),
        ],
      }));
      return;
    }

    let llm = get().llm;
    if (!llm) {
      try {
        llm = await api.llmConfig();
        set({ llm });
      } catch (error) {
        set((state) => ({
          messages: [
            ...state.messages,
            message("system", errorMessage(error), { local: true }),
          ],
        }));
        return;
      }
    }

    if (!llm.configured) {
      set((state) => ({
        messages: [
          ...state.messages,
          message(
            "agent",
            "LLM がまだ設定されていません。右上の歯車アイコンからプロバイダー・モデル・API キーを設定してください。",
            { local: true },
          ),
        ],
      }));
      return;
    }

    const payload = toRequestMessages(get().messages);
    const replyId = newId();
    let responseText = "";
    let cancelled = false;
    let failed = false;

    const updateReply = (updater: (reply: ChatMessage) => ChatMessage) => {
      set((state) => ({
        messages: state.messages.map((entry) =>
          entry.id === replyId ? updater(entry) : entry,
        ),
      }));
    };

    set((state) => ({
      streaming: true,
      messages: [
        ...state.messages,
        {
          id: replyId,
          role: "agent",
          text: "",
          createdAt: Date.now(),
        },
      ],
    }));

    try {
      await api.llmChat(payload, (event) => {
        switch (event.type) {
          case "delta":
            responseText += event.text;
            updateReply((reply) => ({ ...reply, text: responseText }));
            break;
          case "error":
            failed = true;
            updateReply((reply) => ({
              ...reply,
              text: `応答を取得できませんでした。\n\n${event.message}`,
              local: true,
            }));
            break;
          case "cancelled":
            cancelled = true;
            break;
          case "done":
            break;
        }
      });
    } catch (error) {
      failed = true;
      updateReply((reply) => ({
        ...reply,
        text: errorMessage(error),
        local: true,
      }));
    } finally {
      if (cancelled) {
        if (responseText) {
          updateReply((reply) => ({ ...reply, text: responseText }));
          set((state) => ({
            messages: [
              ...state.messages,
              message("agent", "生成を停止しました。", { local: true }),
            ],
          }));
        } else {
          updateReply((reply) => ({
            ...reply,
            text: "生成を停止しました。",
            local: true,
          }));
        }
      } else if (!failed && !responseText) {
        updateReply((reply) => ({
          ...reply,
          text: "応答が空でした。モデル名とプロバイダーの設定を確認してください。",
          local: true,
        }));
      }
      set({ streaming: false });
    }
  },

  async stopStreaming() {
    if (!get().streaming) return;
    try {
      await api.llmCancel();
    } catch {
      // The stream will end on its own even if cancellation fails.
    }
  },

  async takeSnapshot() {
    if (get().busy || get().streaming) return;
    set({ busy: true });
    try {
      const result = await api.agentSnapshot();
      set((state) => ({
        busy: false,
        snapshot: result,
        messages: [
          ...state.messages,
          message(
            "agent",
            result.ok
              ? `スナップショットを取得しました。\n\`\`\`json\n${result.stdout.slice(0, 4000)}\n\`\`\``
              : `スナップショットに失敗しました (exit ${result.code ?? "?"})。\n\`\`\`\n${result.stderr.slice(0, 2000)}\n\`\`\``,
            { command: "agent-desktop snapshot --json", local: true },
          ),
        ],
      }));
    } catch (error) {
      set((state) => ({
        busy: false,
        messages: [
          ...state.messages,
          message("system", errorMessage(error), { local: true }),
        ],
      }));
    }
  },

  async generatePlan(intent) {
    const trimmed = intent.trim().slice(0, MAX_PLAN_INTENT_CHARS);
    if (!trimmed) return;
    if (get().planLoading || get().streaming || get().executingStepId) return;

    const reject = (text: string) => {
      appendLocal(set, text);
    };

    if (get().mode === "passive") {
      reject("Passive モードでは計画を立案できません。Assistive 以上に切り替えてください。");
      return;
    }

    if (!api.isTauri) {
      reject(
        "ブラウザデモでは LLM を利用できません。`npm run tauri dev` で Tauri 版を起動し、設定画面でプロバイダーを登録してください。",
      );
      return;
    }

    let llm = get().llm;
    if (!llm) {
      try {
        llm = await api.llmConfig();
        set({ llm });
      } catch (error) {
        reject(errorMessage(error));
        return;
      }
    }

    if (!llm.configured) {
      reject(
        "LLM がまだ設定されていません。計画立案にはプロバイダー・モデル・API キーの設定が必要です。",
      );
      return;
    }

    set({
      panelTab: "plan",
      planLoading: true,
      planRaw: "",
      planError: null,
      plan: null,
    });

    let raw = "";
    let streamError: string | null = null;
    let cancelled = false;

    try {
      await api.llmChat(buildPlanMessages(trimmed), (event) => {
        switch (event.type) {
          case "delta":
            raw += event.text;
            set({ planRaw: raw.slice(-8_000) });
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
        set({ planLoading: false, planError: "計画の生成を停止しました。" });
        return;
      }
      if (streamError) {
        throw new Error(streamError);
      }
      if (!raw.trim()) {
        throw new Error("計画が空でした。モデル名とプロバイダーの設定を確認してください。");
      }

      const draft = parsePlan(raw, trimmed);
      const plan: AgentPlan = {
        id: newId(),
        goal: draft.goal,
        steps: materializePlanSteps(draft, newId),
        createdAt: Date.now(),
        status: "draft",
      };

      set({ plan, planLoading: false, planError: null, planRaw: "" });
      logAudit({
        kind: "plan_created",
        mode: get().mode,
        planId: plan.id,
        title: plan.goal,
        outcome: "ok",
        detail: `${plan.steps.length} 手順`,
      });
      appendLocal(
        set,
        `計画を作成しました (${plan.steps.length} 手順)。Plan タブで内容を確認し、承認してください。`,
      );
    } catch (error) {
      set({ planLoading: false, planError: errorMessage(error) });
    }
  },

  async cancelPlanGeneration() {
    if (!get().planLoading) return;
    try {
      await api.llmCancel();
    } catch {
      // The stream ends on its own even when cancellation is unavailable.
    }
  },

  approvePlan() {
    const plan = get().plan;
    if (!plan || plan.status !== "draft" || get().mode === "passive") return;
    set({
      plan: {
        ...plan,
        status: "approved",
        steps: plan.steps.map((step) =>
          step.status === "pending" ? { ...step, status: "approved" } : step,
        ),
      },
    });
    logAudit({
      kind: "plan_approved",
      mode: get().mode,
      planId: plan.id,
      title: plan.goal,
      outcome: "ok",
      detail: `${plan.steps.length} 手順を承認`,
    });
    appendLocal(set, "計画を承認しました。");
  },

  rejectPlan() {
    const plan = get().plan;
    if (!plan || plan.status === "cancelled") return;
    const kind = plan.status === "draft" ? "plan_rejected" : "plan_cancelled";
    set({
      plan: {
        ...plan,
        status: "cancelled",
        steps: plan.steps.map((step) =>
          step.status === "pending" || step.status === "approved"
            ? { ...step, status: "skipped" }
            : step,
        ),
      },
    });
    logAudit({
      kind,
      mode: get().mode,
      planId: plan.id,
      title: plan.goal,
      outcome: "cancelled",
    });
    appendLocal(set, "計画を却下しました。");
  },

  resetPlan() {
    if (get().executingStepId) return;
    set({ plan: null, planRaw: "", planError: null });
  },

  async runPlanStep(stepId) {
    const { plan, mode, executingStepId } = get();
    if (!plan || mode === "passive" || executingStepId) return;
    if (plan.status !== "approved" && plan.status !== "running") return;

    const step = plan.steps.find((entry) => entry.id === stepId);
    if (!step || step.status !== "approved") return;

    set({
      executingStepId: stepId,
      plan: {
        ...plan,
        status: "running",
        steps: plan.steps.map((entry) =>
          entry.id === stepId
            ? { ...entry, status: "running", output: undefined, error: undefined }
            : entry,
        ),
      },
    });

    const audit: AgentAuditMeta = {
      planId: plan.id,
      stepId: step.id,
      title: step.title,
      mode,
    };

    try {
      const result = await api.agentRun(step.command, audit);
      const output = [result.stdout.trim(), result.stderr.trim()]
        .filter(Boolean)
        .join("\n")
        .slice(0, 8_000);
      const errorText = result.ok
        ? ""
        : result.stderr.trim() || `終了コード ${result.code ?? "不明"}`;

      set((state) => {
        if (!state.plan) return { executingStepId: null };
        const steps = state.plan.steps.map((entry) =>
          entry.id === stepId
            ? {
                ...entry,
                status: result.ok ? ("done" as const) : ("failed" as const),
                output,
                error: errorText || undefined,
              }
            : entry,
        );
        const failed = steps.some((entry) => entry.status === "failed");
        const remaining = steps.some(
          (entry) => entry.status === "approved" || entry.status === "running",
        );
        return {
          executingStepId: null,
          plan: {
            ...state.plan,
            steps,
            status: failed ? "failed" : remaining ? "approved" : "completed",
          },
        };
      });
    } catch (error) {
      const messageText = errorMessage(error);
      set((state) => {
        if (!state.plan) return { executingStepId: null };
        return {
          executingStepId: null,
          plan: {
            ...state.plan,
            status: "failed",
            steps: state.plan.steps.map((entry) =>
              entry.id === stepId
                ? {
                    ...entry,
                    status: "failed",
                    error: messageText,
                    output: entry.output,
                  }
                : entry,
            ),
          },
        };
      });
    }
  },

  async executePlan() {
    const plan = get().plan;
    if (!plan || get().mode !== "autonomous") return;
    if (plan.status !== "approved" || get().executingStepId) return;

    set({ plan: { ...plan, status: "running" } });

    const ids = plan.steps
      .filter((step) => step.status === "approved")
      .map((step) => step.id);

    for (const stepId of ids) {
      const current = get().plan;
      if (
        !current ||
        (current.status !== "running" && current.status !== "approved")
      ) {
        break;
      }

      const step = current.steps.find((entry) => entry.id === stepId);
      if (!step || step.status !== "approved") break;

      await get().runPlanStep(stepId);

      const after = get().plan?.steps.find((entry) => entry.id === stepId);
      if (after?.status !== "done") break;
    }

    set((state) => {
      if (!state.plan || state.plan.status === "cancelled") return {};
      const failed = state.plan.steps.some((step) => step.status === "failed");
      const remaining = state.plan.steps.some(
        (step) => step.status === "approved" || step.status === "running",
      );
      return {
        plan: {
          ...state.plan,
          status: failed ? "failed" : remaining ? "approved" : "completed",
        },
      };
    });
  },

  async refreshPolicy() {
    set({ policyLoading: true, policyError: null });
    try {
      const policy = await api.agentPolicy();
      set({ policy, policyLoading: false });
    } catch (error) {
      set({ policyLoading: false, policyError: errorMessage(error) });
    }
  },

  async savePolicy(policy) {
    const saved = await api.agentPolicySet(policy);
    set({ policy: saved, policyError: null });
    return saved;
  },

  async refreshAudit() {
    set({ auditLoading: true, auditError: null });
    try {
      const audit = await api.auditLog(50, 0);
      set({
        audit,
        auditLoading: false,
        auditHasMore: audit.length === 50,
      });
    } catch (error) {
      set({ auditLoading: false, auditError: errorMessage(error) });
    }
  },

  async loadMoreAudit() {
    if (get().auditLoading || !get().auditHasMore) return;
    set({ auditLoading: true, auditError: null });
    try {
      const page = await api.auditLog(50, get().audit.length);
      set((state) => ({
        audit: [...state.audit, ...page],
        auditLoading: false,
        auditHasMore: page.length === 50,
      }));
    } catch (error) {
      set({ auditLoading: false, auditError: errorMessage(error) });
    }
  },

  clearMessages() {
    if (get().streaming) return;
    set({ messages: [] });
  },

  openSettings() {
    set({ settingsOpen: true });
  },

  closeSettings() {
    set({ settingsOpen: false });
  },
}));
