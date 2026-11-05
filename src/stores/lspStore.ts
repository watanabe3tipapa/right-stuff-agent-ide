import { create } from "zustand";

import type { LspServerInfo } from "../shared/types";
import { api, errorMessage } from "../lib/api";

export type LspStatus = "idle" | "starting" | "ready" | "error" | "unsupported";

export interface LspLanguageState {
  language: string;
  label: string;
  status: LspStatus;
  command: string[];
  message: string | null;
  diagnostics: number;
}

interface LspState {
  servers: LspServerInfo[];
  serversLoaded: boolean;
  statuses: Record<string, LspLanguageState>;
  refreshServers: () => Promise<void>;
  setStatus: (language: string, patch: Partial<LspLanguageState>) => void;
  setDiagnostics: (language: string, count: number) => void;
  reset: () => void;
}

export const useLspStore = create<LspState>((set, get) => ({
  servers: [],
  serversLoaded: false,
  statuses: {},

  async refreshServers() {
    try {
      const servers = await api.lspServers();
      set({ servers, serversLoaded: true });
    } catch (error) {
      set({ serversLoaded: true });
      const language = "unknown";
      get().setStatus(language, {
        language,
        label: "LSP",
        status: "error",
        command: [],
        message: errorMessage(error),
      });
    }
  },

  setStatus(language, patch) {
    set((state) => {
      const current = state.statuses[language] ?? {
        language,
        label: language,
        status: "idle" as LspStatus,
        command: [],
        message: null,
        diagnostics: 0,
      };
      return { statuses: { ...state.statuses, [language]: { ...current, ...patch } } };
    });
  },

  setDiagnostics(language, count) {
    set((state) => {
      const current = state.statuses[language];
      if (!current) return state;
      return {
        statuses: {
          ...state.statuses,
          [language]: { ...current, diagnostics: count },
        },
      };
    });
  },

  reset() {
    set({ statuses: {} });
  },
}));

export function lspSummary(statuses: Record<string, LspLanguageState>): {
  ready: number;
  diagnostics: number;
  hasError: boolean;
} {
  const values = Object.values(statuses);
  return {
    ready: values.filter((item) => item.status === "ready").length,
    diagnostics: values.reduce((sum, item) => sum + item.diagnostics, 0),
    hasError: values.some((item) => item.status === "error"),
  };
}
