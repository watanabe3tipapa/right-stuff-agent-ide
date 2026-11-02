import { create } from "zustand";

import type { AgentMode, AgentRunResult, AgentStatus, ChatMessage } from "../shared/types";
import { api, errorMessage } from "../lib/api";

const MODE_STORAGE_KEY = "rsai.agentMode";

function loadMode(): AgentMode {
  const stored = localStorage.getItem(MODE_STORAGE_KEY);
  if (stored === "passive" || stored === "assistive" || stored === "autonomous") {
    return stored;
  }
  return "assistive";
}

function message(role: ChatMessage["role"], text: string, command?: string): ChatMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    text,
    createdAt: Date.now(),
    command,
  };
}

interface AgentState {
  mode: AgentMode;
  status: AgentStatus | null;
  statusLoading: boolean;
  messages: ChatMessage[];
  busy: boolean;
  snapshot: AgentRunResult | null;
  setMode: (mode: AgentMode) => void;
  refreshStatus: () => Promise<void>;
  send: (text: string) => Promise<void>;
  takeSnapshot: () => Promise<void>;
  clearMessages: () => void;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  mode: loadMode(),
  status: null,
  statusLoading: false,
  messages: [
    message(
      "agent",
      "こんにちは。Right-Stuff Agent IDE のエージェントパネルです。\n現在は LLM 未接続のため、通常のチャットには応答できません。\n`/status` — Agent Desktop の検出状態\n`/snapshot` — デスクトップのスナップショット取得",
    ),
  ],
  busy: false,
  snapshot: null,

  setMode(mode) {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
    set({ mode });
  },

  async refreshStatus() {
    set({ statusLoading: true });
    try {
      const status = await api.agentStatus();
      set({ status, statusLoading: false });
    } catch (error) {
      set({ statusLoading: false, status: null });
      set((state) => ({
        messages: [...state.messages, message("system", errorMessage(error))],
      }));
    }
  },

  async send(text) {
    const trimmed = text.trim();
    if (!trimmed || get().busy) return;

    set((state) => ({ messages: [...state.messages, message("user", trimmed)] }));

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
          ),
        ],
      }));
      return;
    }

    if (trimmed === "/snapshot" || trimmed.includes("スナップショット")) {
      await get().takeSnapshot();
      return;
    }

    set((state) => ({
      messages: [
        ...state.messages,
        message(
          "agent",
          get().mode === "passive"
            ? "Passive モードではチャット応答は行いません。モードを Assistive 以上に切り替えてください。"
            : "LLM プロバイダーはまだ設定されていません。Phase 1 で OpenAI 互換 API / Ollama / Claude 等の接続を追加します。\n\n今すぐ試せるコマンド:\n`/status` — Agent Desktop の検出状態\n`/snapshot` — デスクトップのスナップショット取得",
        ),
      ],
    }));
  },

  async takeSnapshot() {
    if (get().busy) return;
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
            "agent-desktop snapshot --json",
          ),
        ],
      }));
    } catch (error) {
      set((state) => ({
        busy: false,
        messages: [
          ...state.messages,
          message("system", errorMessage(error)),
        ],
      }));
    }
  },

  clearMessages() {
    set({ messages: [] });
  },
}));
