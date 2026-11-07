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
  OpenShipConfig,
  OpenShipDeployResult,
  OpenShipDeployment,
  OpenShipLogs,
  OpenShipSettings,
  OpenShipStatus,
  SkillCatalog,
  SkillPolicy,
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
  skills: SkillCatalog | null;
  skillsLoading: boolean;
  skillsError: string | null;
  skillPolicy: SkillPolicy | null;
  skillPolicyLoading: boolean;
  skillPolicyError: string | null;
  audit: AuditEntry[];
  auditLoading: boolean;
  auditError: string | null;
  auditHasMore: boolean;
  openship: OpenShipSettings | null;
  openshipStatus: OpenShipStatus | null;
  openshipDeployments: OpenShipDeployment[];
  openshipLogs: Record<string, OpenShipLogs>;
  openshipLoading: boolean;
  openshipBusy: boolean;
  openshipError: string | null;
  openshipNotice: string | null;
  openshipLastResult: OpenShipDeployResult | null;
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
  refreshSkills: () => Promise<void>;
  refreshSkillPolicy: () => Promise<void>;
  saveSkillPolicy: (policy: SkillPolicy) => Promise<SkillPolicy>;
  refreshAudit: () => Promise<void>;
  loadMoreAudit: () => Promise<void>;
  refreshOpenShip: () => Promise<void>;
  saveOpenShipConfig: (config: OpenShipConfig) => Promise<OpenShipSettings>;
  saveOpenShipToken: (token: string) => Promise<void>;
  deleteOpenShipToken: () => Promise<void>;
  refreshOpenShipDeployments: () => Promise<void>;
  deployOpenShip: (projectId?: string) => Promise<OpenShipDeployResult | null>;
  loadOpenShipLogs: (deploymentId: string) => Promise<OpenShipLogs | null>;
  rollbackOpenShip: (deploymentId: string) => Promise<OpenShipDeployResult | null>;
  clearOpenShipNotice: () => void;
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
      "こんにちは。Right-Stuff Agent IDE のエージェントパネルです。\nLLM を設定するとチャットと計画立案が使えます。右上の歯車アイコンからプロバイダーとモデルを設定してください。\n`/status` — Agent Desktop の検出状態\n`/snapshot` — デスクトップのスナップショット取得\n`/plan <意図>` — 実行計画の作成と承認\n`/ship` — Openship の接続状態\n`/deploy [projectId]` — Openship へデプロイ\n`/logs <deploymentId>` — デプロイログを表示\n`/rollback <deploymentId>` — デプロイをロールバック",
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
  skills: null,
  skillsLoading: false,
  skillsError: null,
  skillPolicy: null,
  skillPolicyLoading: false,
  skillPolicyError: null,
  audit: [],
  auditLoading: false,
  auditError: null,
  auditHasMore: false,
  openship: null,
  openshipStatus: null,
  openshipDeployments: [],
  openshipLogs: {},
  openshipLoading: false,
  openshipBusy: false,
  openshipError: null,
  openshipNotice: null,
  openshipLastResult: null,

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
    const isShipCommand = trimmed === "/ship" || trimmed === "/openship";
    const isDeployCommand =
      trimmed === "/deploy" || trimmed.startsWith("/deploy ");
    const isLogsCommand =
      trimmed === "/logs" || trimmed.startsWith("/logs ");
    const isRollbackCommand =
      trimmed === "/rollback" || trimmed.startsWith("/rollback ");
    const isLocalCommand =
      isPlanCommand ||
      isShipCommand ||
      isDeployCommand ||
      isLogsCommand ||
      isRollbackCommand ||
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

    if (isShipCommand) {
      set({ panelTab: "deploy" });
      await get().refreshOpenShip();
      const openshipStatus = get().openshipStatus;
      if (!openshipStatus) {
        appendLocal(
          set,
          get().openshipError ??
            "Openship の状態を取得できませんでした。設定を確認してください。",
        );
      } else {
        appendLocal(
          set,
          [
            `Openship CLI: ${
              openshipStatus.cliAvailable
                ? `${openshipStatus.cliVersion ?? "version unknown"} (${openshipStatus.cliPath})`
                : "未検出"
            }`,
            `サーバー: ${
              openshipStatus.serverConfigured
                ? openshipStatus.serverReachable
                  ? "接続可能"
                  : "接続できません"
                : "未設定"
            }`,
            openshipStatus.serverMessage,
          ].join("\n"),
          { command: "openship status" },
        );
      }
      return;
    }

    if (isDeployCommand) {
      const projectId = trimmed.slice("/deploy".length).trim();
      set({ panelTab: "deploy" });
      if (get().mode === "passive") {
        appendLocal(
          set,
          "Passive モードではデプロイできません。Assistive 以上に切り替えてください。",
        );
        return;
      }
      const result = await get().deployOpenShip(projectId || undefined);
      if (result) {
        appendLocal(
          set,
          result.ok
            ? `Openship デプロイを開始しました。${result.deployment ? `\nID: ${result.deployment.id} / status: ${result.deployment.status}` : ""}`
            : `Openship デプロイに失敗しました。\n${result.stderr || result.stdout || "詳細は Deploy タブを確認してください。"}`,
          { command: result.command.join(" ") },
        );
      }
      return;
    }

    if (isLogsCommand) {
      const deploymentId = trimmed.slice("/logs".length).trim();
      if (!deploymentId) {
        appendLocal(
          set,
          "Deployment ID を指定してください。例: `/logs dep_xxxxx`。Deploy タブの一覧からも表示できます。",
        );
        return;
      }
      const logs = await get().loadOpenShipLogs(deploymentId);
      if (logs) {
        appendLocal(
          set,
          logs.ok
            ? `\`\`\`\n${logs.logs.slice(0, 8_000)}\n\`\`\``
            : `ログを取得できませんでした (HTTP ${logs.status ?? "?"})。\n${logs.logs}`,
          { command: `openship logs ${deploymentId}` },
        );
      }
      return;
    }

    if (isRollbackCommand) {
      const deploymentId = trimmed.slice("/rollback".length).trim();
      if (!deploymentId) {
        appendLocal(
          set,
          "Deployment ID を指定してください。例: `/rollback dep_xxxxx`。Deploy タブの一覧からも実行できます。",
        );
        return;
      }
      if (get().mode === "passive") {
        appendLocal(
          set,
          "Passive モードではロールバックできません。Assistive 以上に切り替えてください。",
        );
        return;
      }
      const result = await get().rollbackOpenShip(deploymentId);
      if (result) {
        appendLocal(
          set,
          result.ok
            ? `ロールバックを開始しました (${deploymentId})。`
            : `ロールバックに失敗しました。\n${result.stderr || "詳細は Deploy タブを確認してください。"}`,
          { command: result.command.join(" ") },
        );
      }
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
              : `スナップショットに失敗しました (exit ${result.code ?? "?"})。\n\`\`\`\n${(result.stderr.trim() || result.stdout.trim()).slice(0, 2000)}\n\`\`\``,
            { command: "agent-desktop snapshot", local: true },
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

    let catalog: SkillCatalog | null = get().skills;
    try {
      catalog = await api.skillsList();
      set({ skills: catalog, skillsError: null });
    } catch {
      // A missing or broken catalog must not block agent-only plans.
    }

    try {
      await api.llmChat(buildPlanMessages(trimmed, catalog), (event) => {
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

      const draft = parsePlan(raw, trimmed, catalog);
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
      let ok: boolean;
      let output: string;
      let errorText: string;

      if (step.kind === "skill") {
        if (!step.skillId || !step.skillActionId) {
          throw new Error("スキル手順に skillId または actionId がありません。");
        }
        const result = await api.skillRun({
          skillId: step.skillId,
          actionId: step.skillActionId,
          params: step.params ?? {},
          planId: plan.id,
          stepId: step.id,
          title: step.title,
          mode,
        });
        ok = result.status === "ok";
        output = [
          result.stdout.trim(),
          result.changedFiles.length > 0
            ? `変更: ${result.changedFiles.join(", ")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n")
          .slice(0, 8_000);
        errorText = ok
          ? ""
          : result.stderr.trim() ||
            `スキルを実行できませんでした (${result.status})`;
      } else {
        const result = await api.agentRun(step.command, audit);
        ok = result.ok;
        output = [result.stdout.trim(), result.stderr.trim()]
          .filter(Boolean)
          .join("\n")
          .slice(0, 8_000);
        errorText = result.ok
          ? ""
          : result.stderr.trim() || `終了コード ${result.code ?? "不明"}`;
      }

      set((state) => {
        if (!state.plan) return { executingStepId: null };
        const steps = state.plan.steps.map((entry) =>
          entry.id === stepId
            ? {
                ...entry,
                status: ok ? ("done" as const) : ("failed" as const),
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

  async refreshSkills() {
    set({ skillsLoading: true, skillsError: null });
    try {
      const skills = await api.skillsList();
      set({ skills, skillsLoading: false });
    } catch (error) {
      set({ skillsLoading: false, skillsError: errorMessage(error) });
    }
  },

  async refreshSkillPolicy() {
    set({ skillPolicyLoading: true, skillPolicyError: null });
    try {
      const skillPolicy = await api.skillPolicy();
      set({ skillPolicy, skillPolicyLoading: false });
    } catch (error) {
      set({ skillPolicyLoading: false, skillPolicyError: errorMessage(error) });
    }
  },

  async saveSkillPolicy(policy) {
    const saved = await api.skillPolicySet(policy);
    set({ skillPolicy: saved, skillPolicyError: null });
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

  async refreshOpenShip() {
    set({ openshipLoading: true, openshipError: null });
    try {
      const [settings, status] = await Promise.all([
        api.openshipConfig(),
        api.openshipStatus(),
      ]);
      set({
        openship: settings,
        openshipStatus: status,
        openshipLoading: false,
      });
    } catch (error) {
      set({ openshipLoading: false, openshipError: errorMessage(error) });
    }
  },

  async saveOpenShipConfig(config) {
    const saved = await api.openshipConfigSet(config);
    set({ openship: saved, openshipError: null });
    return saved;
  },

  async saveOpenShipToken(token) {
    await api.openshipTokenSet(token);
    set((state) => ({
      openship: state.openship
        ? { ...state.openship, tokenConfigured: true }
        : state.openship,
      openshipError: null,
    }));
  },

  async deleteOpenShipToken() {
    await api.openshipTokenDelete();
    set((state) => ({
      openship: state.openship
        ? { ...state.openship, tokenConfigured: false }
        : state.openship,
      openshipError: null,
    }));
  },

  async refreshOpenShipDeployments() {
    const config = get().openship;
    if (!config?.baseUrl || !config.tokenConfigured) {
      set({ openshipDeployments: [] });
      return;
    }
    try {
      const deployments = await api.openshipDeployments(
        config.projectId || undefined,
        20,
      );
      set({ openshipDeployments: deployments, openshipError: null });
    } catch (error) {
      set({
        openshipDeployments: [],
        openshipError: errorMessage(error),
      });
    }
  },

  async deployOpenShip(projectId) {
    if (get().openshipBusy) return null;
    if (get().mode === "passive") {
      set({
        openshipError:
          "Passive モードではデプロイできません。Assistive 以上に切り替えてください。",
      });
      return null;
    }
    set({
      openshipBusy: true,
      openshipError: null,
      openshipNotice: null,
      openshipLastResult: null,
    });
    try {
      const result = await api.openshipDeploy(
        projectId || get().openship?.projectId || undefined,
      );
      set({
        openshipBusy: false,
        openshipLastResult: result,
        openshipNotice: result.ok ? "デプロイを開始しました。" : null,
        openshipError: result.ok
          ? null
          : result.stderr || result.stdout || "デプロイに失敗しました。",
      });
      await get().refreshOpenShipDeployments();
      return result;
    } catch (error) {
      set({ openshipBusy: false, openshipError: errorMessage(error) });
      return null;
    }
  },

  async loadOpenShipLogs(deploymentId) {
    set({ openshipBusy: true, openshipError: null });
    try {
      const logs = await api.openshipLogs(deploymentId);
      set((state) => ({
        openshipBusy: false,
        openshipLogs: { ...state.openshipLogs, [deploymentId]: logs },
        openshipError: logs.ok ? null : logs.logs,
      }));
      return logs;
    } catch (error) {
      set({ openshipBusy: false, openshipError: errorMessage(error) });
      return null;
    }
  },

  async rollbackOpenShip(deploymentId) {
    if (get().openshipBusy) return null;
    if (get().mode === "passive") {
      set({
        openshipError:
          "Passive モードではロールバックできません。Assistive 以上に切り替えてください。",
      });
      return null;
    }
    set({ openshipBusy: true, openshipError: null, openshipNotice: null });
    try {
      const result = await api.openshipRollback(deploymentId);
      set({
        openshipBusy: false,
        openshipLastResult: result,
        openshipNotice: result.ok ? "ロールバックを開始しました。" : null,
        openshipError: result.ok
          ? null
          : result.stderr || result.stdout || "ロールバックに失敗しました。",
      });
      await get().refreshOpenShipDeployments();
      return result;
    } catch (error) {
      set({ openshipBusy: false, openshipError: errorMessage(error) });
      return null;
    }
  },

  clearOpenShipNotice() {
    set({ openshipNotice: null, openshipError: null });
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
