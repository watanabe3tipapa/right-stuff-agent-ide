import { create } from "zustand";

import type { VersionSummary } from "../shared/types";
import { api, errorMessage } from "../lib/api";

export interface OpenFile {
  path: string;
  content: string;
  savedContent: string;
  language: string;
  size: number;
  modified: number;
}

export function isDirty(file: OpenFile): boolean {
  return file.content !== file.savedContent;
}

interface EditorState {
  files: Record<string, OpenFile>;
  order: string[];
  activePath: string | null;
  saving: boolean;
  error: string | null;
  preview: boolean;
  historyPath: string | null;
  history: VersionSummary[];
  historyLoading: boolean;

  openFile: (path: string) => Promise<void>;
  closeFile: (path: string, force?: boolean) => void;
  closeAll: () => void;
  setActive: (path: string) => void;
  updateContent: (path: string, content: string) => void;
  saveFile: (path: string) => Promise<void>;
  saveActive: () => Promise<void>;
  saveAll: () => Promise<void>;
  togglePreview: () => void;
  renamePath: (from: string, to: string) => void;
  loadHistory: (path: string) => Promise<void>;
  closeHistory: () => void;
  clearError: () => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  files: {},
  order: [],
  activePath: null,
  saving: false,
  error: null,
  preview: false,
  historyPath: null,
  history: [],
  historyLoading: false,

  async openFile(path) {
    const existing = get().files[path];
    if (existing) {
      set({ activePath: path });
      return;
    }

    try {
      const content = await api.readFile(path);
      const file: OpenFile = {
        path: content.path,
        content: content.content,
        savedContent: content.content,
        language: content.language,
        size: content.size,
        modified: content.modified,
      };
      set((state) => ({
        files: { ...state.files, [path]: file },
        order: state.order.includes(path) ? state.order : [...state.order, path],
        activePath: path,
        error: null,
      }));
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },

  closeFile(path, force = false) {
    const file = get().files[path];
    if (!force && file && isDirty(file)) {
      return;
    }

    set((state) => {
      const index = state.order.indexOf(path);
      const order = state.order.filter((item) => item !== path);
      const files = { ...state.files };
      delete files[path];

      let activePath = state.activePath;
      if (activePath === path) {
        activePath = order[Math.min(index, order.length - 1)] ?? null;
      }

      return { files, order, activePath };
    });
  },

  closeAll() {
    set({
      files: {},
      order: [],
      activePath: null,
      historyPath: null,
      history: [],
    });
  },

  setActive(path) {
    set({ activePath: path });
  },

  updateContent(path, content) {
    set((state) => {
      const file = state.files[path];
      if (!file) return state;
      return {
        files: { ...state.files, [path]: { ...file, content } },
      };
    });
  },

  async saveFile(path) {
    const file = get().files[path];
    if (!file) return;

    set({ saving: true, error: null });
    try {
      const result = await api.writeFile(path, file.content);
      set((state) => {
        const current = state.files[path];
        if (!current) return { saving: false };
        return {
          saving: false,
          files: {
            ...state.files,
            [path]: {
              ...current,
              savedContent: current.content,
              size: result.size,
              modified: result.savedAt,
            },
          },
        };
      });
    } catch (error) {
      set({ saving: false, error: errorMessage(error) });
    }
  },

  async saveActive() {
    const active = get().activePath;
    if (active) await get().saveFile(active);
  },

  async saveAll() {
    const dirty = get().order.filter((path) => {
      const file = get().files[path];
      return file ? isDirty(file) : false;
    });
    for (const path of dirty) {
      await get().saveFile(path);
    }
  },

  togglePreview() {
    set((state) => ({ preview: !state.preview }));
  },

  renamePath(from, to) {
    const hasPath = get().order.some(
      (path) => path === from || path.startsWith(`${from}/`),
    );
    if (!hasPath) return;

    const mapPath = (path: string): string => {
      if (path === from) return to;
      if (path.startsWith(`${from}/`)) return `${to}${path.slice(from.length)}`;
      return path;
    };

    set((state) => {
      const files: Record<string, OpenFile> = {};
      for (const [path, file] of Object.entries(state.files)) {
        const nextPath = mapPath(path);
        files[nextPath] = nextPath === path ? file : { ...file, path: nextPath };
      }

      return {
        files,
        order: state.order.map(mapPath),
        activePath: state.activePath ? mapPath(state.activePath) : null,
        historyPath: state.historyPath ? mapPath(state.historyPath) : null,
      };
    });
  },

  async loadHistory(path) {
    set({ historyPath: path, historyLoading: true, history: [] });
    try {
      const history = await api.history(path);
      set({ history, historyLoading: false });
    } catch (error) {
      set({ historyLoading: false, error: errorMessage(error) });
    }
  },

  closeHistory() {
    set({ historyPath: null, history: [] });
  },

  clearError() {
    set({ error: null });
  },
}));
