import { create } from "zustand";

import type {
  AgentMode,
  AgentRunResult,
  AgentStatus,
  ChatMessage,
  LlmSettings,
} from "../shared/types";
import { api, errorMessage } from "../lib/api";
import { toRequestMessages } from "../lib/llm";

const MODE_STORAGE_KEY = "rsai.agentMode";

function loadMode(): AgentMode {
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
  status: AgentStatus | null;
  statusLoading: boolean;
  messages: ChatMessage[];
  busy: boolean;
  snapshot: AgentRunResult | null;
  llm: LlmSettings | null;
  llmLoading: boolean;
  streaming: boolean;
  settingsOpen: boolean;
  setMode: (mode: AgentMode) => void;
  refreshStatus: () => Promise<void>;
  refreshLlm: () => Promise<void>;
  send: (text: string) => Promise<void>;
  stopStreaming: () => Promise<void>;
  takeSnapshot: () => Promise<void>;
  clearMessages: () => void;
  openSettings: () => void;
  closeSettings: () => void;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  mode: loadMode(),
  status: null,
  statusLoading: false,
  messages: [
    message(
      "agent",
      "こんにちは。Right-Stuff Agent IDE のエージェントパネルです。\nLLM を設定するとチャットが使えます。右上の歯車アイコンからプロバイダーとモデルを設定してください。\n`/status` — Agent Desktop の検出状態\n`/snapshot` — デスクトップのスナップショット取得",
      { local: true },
    ),
  ],
  busy: false,
  snapshot: null,
  llm: null,
  llmLoading: false,
  streaming: false,
  settingsOpen: false,

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
    if (!trimmed || get().busy || get().streaming) return;

    const isLocalCommand =
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
