import { create } from "zustand";

import type { FileEntry, WorkspaceInfo } from "../shared/types";
import { api, errorMessage } from "../lib/api";
import { confirmUnsavedChanges, useEditorStore } from "./editorStore";

interface WorkspaceState {
  info: WorkspaceInfo | null;
  tree: FileEntry[];
  loading: boolean;
  error: string | null;
  selectedPath: string | null;
  expanded: Record<string, boolean>;
  initializing: boolean;

  init: () => Promise<void>;
  openWorkspace: () => Promise<void>;
  refresh: () => Promise<void>;
  select: (path: string | null) => void;
  toggleExpanded: (path: string) => void;
  createEntry: (parentPath: string, name: string, isDir: boolean) => Promise<void>;
  renameEntry: (from: string, to: string) => Promise<void>;
  deleteEntry: (path: string) => Promise<void>;
  clearError: () => void;
}

const defaultExpanded = {
  src: true,
  "src/components": true,
  docs: true,
};

function findEntry(entries: FileEntry[], path: string): FileEntry | undefined {
  for (const entry of entries) {
    if (entry.path === path) return entry;
    if (entry.isDir) {
      const found = findEntry(entry.children, path);
      if (found) return found;
    }
  }
  return undefined;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  info: null,
  tree: [],
  loading: false,
  error: null,
  selectedPath: null,
  expanded: defaultExpanded,
  initializing: true,

  async init() {
    set({ loading: true });
    try {
      const info = await api.workspaceLast();
      if (info) {
        set({ info, selectedPath: null });
        await get().refresh();
        set({ expanded: defaultExpanded });
      }
    } catch (error) {
      set({ error: errorMessage(error) });
    } finally {
      set({ loading: false, initializing: false });
    }
  },

  async openWorkspace() {
    const allowed = await confirmUnsavedChanges({
      title: "ワークスペースを切り替える",
      message:
        "未保存の変更があります。保存してから切り替えるか、変更を破棄してください。",
    });
    if (!allowed) return;

    set({ loading: true, error: null });
    try {
      const folder = await api.pickFolder();
      if (folder === null) return;
      const info = await api.workspaceOpen(folder || "/demo/right-stuff-agent-ide");
      useEditorStore.getState().closeAll();
      set({
        info,
        selectedPath: null,
        expanded: defaultExpanded,
      });
      await get().refresh();
    } catch (error) {
      set({ error: errorMessage(error) });
    } finally {
      set({ loading: false });
    }
  },

  async refresh() {
    if (!get().info) return;
    try {
      const tree = await api.listFiles();
      set({ tree });
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },

  select(path) {
    set({ selectedPath: path });
    if (!path) return;
    const entry = findEntry(get().tree, path);
    if (!entry?.isDir) {
      void useEditorStore.getState().openFile(path);
    }
  },

  toggleExpanded(path) {
    set((state) => ({
      expanded: { ...state.expanded, [path]: !state.expanded[path] },
    }));
  },

  async createEntry(parentPath, name, isDir) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const path = parentPath ? `${parentPath}/${trimmed}` : trimmed;
    set({ error: null });
    try {
      await api.createEntry(path, isDir);
      await get().refresh();
      if (parentPath) {
        set((state) => ({ expanded: { ...state.expanded, [parentPath]: true } }));
      }
      if (!isDir) {
        await useEditorStore.getState().openFile(path);
      }
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },

  async renameEntry(from, to) {
    const trimmed = to.trim();
    if (!trimmed || trimmed === from) return;
    set({ error: null });
    try {
      const next = await api.renameEntry(from, trimmed);
      await get().refresh();
      useEditorStore.getState().renamePath(from, next);
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },

  async deleteEntry(path) {
    set({ error: null });
    try {
      await api.deleteEntry(path);
      const editor = useEditorStore.getState();
      for (const openPath of editor.order) {
        if (openPath === path || openPath.startsWith(`${path}/`)) {
          editor.closeFile(openPath, true);
        }
      }
      await get().refresh();
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },

  clearError() {
    set({ error: null });
  },
}));
