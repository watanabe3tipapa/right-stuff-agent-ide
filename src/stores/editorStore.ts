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

export interface EditorNotice {
  id: number;
  text: string;
}

export type UnsavedDecision = "save" | "discard" | "cancel";

export interface UnsavedPrompt {
  title: string;
  message: string;
}

/** Resolver for the currently visible unsaved-changes dialog. */
let pendingUnsaved: ((decision: UnsavedDecision) => void) | null = null;

interface EditorState {
  files: Record<string, OpenFile>;
  order: string[];
  activePath: string | null;
  saving: boolean;
  error: string | null;
  notice: EditorNotice | null;
  preview: boolean;
  historyPath: string | null;
  history: VersionSummary[];
  historyLoading: boolean;
  unsavedPrompt: UnsavedPrompt | null;

  openFile: (path: string) => Promise<void>;
  closeFile: (path: string, force?: boolean) => void;
  closeAll: () => void;
  closeAllWithConfirmation: () => Promise<void>;
  setActive: (path: string) => void;
  updateContent: (path: string, content: string) => void;
  saveFile: (path: string) => Promise<void>;
  saveActive: () => Promise<void>;
  saveAll: () => Promise<void>;
  dirtyPaths: () => string[];
  requestUnsavedDecision: (prompt: UnsavedPrompt) => Promise<UnsavedDecision>;
  resolveUnsavedDecision: (decision: UnsavedDecision) => void;
  togglePreview: () => void;
  renamePath: (from: string, to: string) => void;
  loadHistory: (path: string) => Promise<void>;
  closeHistory: () => void;
  clearError: () => void;
  clearNotice: () => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  files: {},
  order: [],
  activePath: null,
  saving: false,
  error: null,
  notice: null,
  preview: false,
  historyPath: null,
  history: [],
  historyLoading: false,
  unsavedPrompt: null,

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

  async closeAllWithConfirmation() {
    const allowed = await confirmUnsavedChanges({
      title: "すべてのタブを閉じる",
      message:
        "未保存の変更があるタブを閉じようとしています。保存してから閉じるか、変更を破棄してください。",
    });
    if (!allowed) return;
    get().closeAll();
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

    // Snapshot the content that is actually written. If the user keeps typing
    // while the write is in flight, the tab must stay dirty instead of being
    // marked as saved with content that never reached the disk.
    const content = file.content;

    set({ saving: true, error: null });
    try {
      const result = await api.writeFile(path, content);
      set((state) => {
        const current = state.files[path];
        if (!current) return { saving: false };
        return {
          saving: false,
          files: {
            ...state.files,
            [path]: {
              ...current,
              savedContent: content,
              size: result.size,
              modified: result.savedAt,
            },
          },
          notice: api.isTauri
            ? state.notice
            : {
                id: Date.now(),
                text: "デモモードのため、変更はページを再読み込みすると失われます（サーバーには送信されません）。",
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

  dirtyPaths() {
    return get().order.filter((path) => {
      const file = get().files[path];
      return file ? isDirty(file) : false;
    });
  },

  requestUnsavedDecision(prompt) {
    if (get().dirtyPaths().length === 0) {
      return Promise.resolve<UnsavedDecision>("discard");
    }

    // Only one dialog can be visible at a time. A newer request wins and the
    // previous caller is treated as cancelled.
    if (pendingUnsaved) {
      const previous = pendingUnsaved;
      pendingUnsaved = null;
      previous("cancel");
    }

    return new Promise<UnsavedDecision>((resolve) => {
      pendingUnsaved = resolve;
      set({ unsavedPrompt: prompt });
    });
  },

  resolveUnsavedDecision(decision) {
    const resolve = pendingUnsaved;
    pendingUnsaved = null;
    set({ unsavedPrompt: null });
    resolve?.(decision);
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

  clearNotice() {
    set({ notice: null });
  },
}));

/**
 * Ask the user how to handle unsaved tabs before an action that would discard
 * them. Returns false when the caller must abort (cancel or failed save).
 */
export async function confirmUnsavedChanges(prompt: UnsavedPrompt): Promise<boolean> {
  const editor = useEditorStore.getState();
  if (editor.dirtyPaths().length === 0) return true;

  const decision = await editor.requestUnsavedDecision(prompt);
  if (decision === "cancel") return false;

  if (decision === "save") {
    await editor.saveAll();
    if (useEditorStore.getState().dirtyPaths().length > 0) return false;
  }

  return true;
}
