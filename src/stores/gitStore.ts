import { create } from "zustand";

import type { GitCommit, GitDiff, GitStatus } from "../shared/types";
import { api, errorMessage } from "../lib/api";

interface GitState {
  status: GitStatus | null;
  loading: boolean;
  error: string | null;
  diff: GitDiff | null;
  diffLoading: boolean;
  log: GitCommit[];
  logLoading: boolean;
  committing: boolean;
  acting: string | null;
  notice: string | null;

  refresh: () => Promise<void>;
  initRepo: () => Promise<void>;
  openDiff: (path: string, staged: boolean) => Promise<void>;
  closeDiff: () => void;
  stage: (path: string) => Promise<void>;
  unstage: (path: string) => Promise<void>;
  stageAll: () => Promise<void>;
  unstageAll: () => Promise<void>;
  commit: (message: string) => Promise<boolean>;
  loadLog: () => Promise<void>;
  clearNotice: () => void;
  clearError: () => void;
}

async function runAction(
  set: (partial: Partial<GitState>) => void,
  label: string,
  action: () => Promise<{ ok: boolean; stderr: string; stdout: string }>,
): Promise<boolean> {
  set({ acting: label, error: null, notice: null });
  try {
    const result = await action();
    if (!result.ok) {
      set({
        acting: null,
        error:
          result.stderr.trim() ||
          result.stdout.trim() ||
          "Git コマンドが失敗しました。",
      });
      return false;
    }
    set({ acting: null });
    return true;
  } catch (error) {
    set({ acting: null, error: errorMessage(error) });
    return false;
  }
}

export const useGitStore = create<GitState>((set, get) => ({
  status: null,
  loading: false,
  error: null,
  diff: null,
  diffLoading: false,
  log: [],
  logLoading: false,
  committing: false,
  acting: null,
  notice: null,

  async refresh() {
    set({ loading: true, error: null });
    try {
      const status = await api.gitStatus();
      set({ status, loading: false });
    } catch (error) {
      set({ loading: false, error: errorMessage(error) });
    }
  },

  async initRepo() {
    const ok = await runAction(set, "init", () => api.gitInit());
    if (ok) {
      set({ notice: "Git リポジトリを初期化しました。" });
      await get().refresh();
    }
  },

  async openDiff(path, staged) {
    set({ diffLoading: true, error: null });
    try {
      const diff = await api.gitDiff(path, staged);
      set({ diff, diffLoading: false });
    } catch (error) {
      set({ diffLoading: false, error: errorMessage(error) });
    }
  },

  closeDiff() {
    set({ diff: null });
  },

  async stage(path) {
    const ok = await runAction(set, `stage:${path}`, () => api.gitStage(path));
    if (ok) await get().refresh();
  },

  async unstage(path) {
    const ok = await runAction(set, `unstage:${path}`, () => api.gitUnstage(path));
    if (ok) await get().refresh();
  },

  async stageAll() {
    const ok = await runAction(set, "stage-all", () => api.gitStageAll());
    if (ok) await get().refresh();
  },

  async unstageAll() {
    const ok = await runAction(set, "unstage-all", () => api.gitUnstageAll());
    if (ok) await get().refresh();
  },

  async commit(message) {
    if (get().committing) return false;
    set({ committing: true, error: null, notice: null });
    try {
      const result = await api.gitCommit(message);
      if (!result.ok) {
        set({
          committing: false,
          error:
            result.stderr.trim() ||
            result.stdout.trim() ||
            "コミットに失敗しました。",
        });
        return false;
      }
      set({
        committing: false,
        notice: "コミットしました。",
        diff: null,
      });
      await get().refresh();
      await get().loadLog();
      return true;
    } catch (error) {
      set({ committing: false, error: errorMessage(error) });
      return false;
    }
  },

  async loadLog() {
    set({ logLoading: true });
    try {
      const log = await api.gitLog(20);
      set({ log, logLoading: false });
    } catch (error) {
      set({ logLoading: false, error: errorMessage(error) });
    }
  },

  clearNotice() {
    set({ notice: null });
  },

  clearError() {
    set({ error: null });
  },
}));
