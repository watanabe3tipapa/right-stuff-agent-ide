import { create } from "zustand";

import type { DapAdapterInfo, DapStatus } from "../shared/types";

export interface DapThread {
  id: number;
  name: string;
}

export interface DapStackFrame {
  id: number;
  name: string;
  path: string | null;
  line: number;
  column: number;
}

export interface DapScope {
  name: string;
  variablesReference: number;
  expensive: boolean;
}

export interface DapVariable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
}

interface DapState {
  adapters: DapAdapterInfo[];
  adaptersLoaded: boolean;
  status: DapStatus;
  sessionId: string | null;
  adapter: string | null;
  program: string | null;
  root: string | null;
  threads: DapThread[];
  threadId: number | null;
  stack: DapStackFrame[];
  frameId: number | null;
  scopes: DapScope[];
  variables: Record<number, DapVariable[]>;
  breakpoints: Record<string, number[]>;
  output: string[];
  error: string | null;

  setAdapters: (adapters: DapAdapterInfo[]) => void;
  setStatus: (status: DapStatus) => void;
  beginSession: (session: {
    id: string;
    adapter: string;
    program: string | null;
    root: string;
  }) => void;
  endSession: () => void;
  setThreads: (threads: DapThread[], threadId: number | null) => void;
  setStack: (stack: DapStackFrame[], frameId: number | null) => void;
  setScopes: (scopes: DapScope[]) => void;
  setVariables: (reference: number, variables: DapVariable[]) => void;
  setBreakpoints: (breakpoints: Record<string, number[]>) => void;
  appendOutput: (text: string) => void;
  clearOutput: () => void;
  setError: (message: string | null) => void;
}

const MAX_OUTPUT_ENTRIES = 4000;

export const useDapStore = create<DapState>((set) => ({
  adapters: [],
  adaptersLoaded: false,
  status: "idle",
  sessionId: null,
  adapter: null,
  program: null,
  root: null,
  threads: [],
  threadId: null,
  stack: [],
  frameId: null,
  scopes: [],
  variables: {},
  breakpoints: {},
  output: [],
  error: null,

  setAdapters(adapters) {
    set({ adapters, adaptersLoaded: true });
  },

  setStatus(status) {
    set({ status });
  },

  beginSession(session) {
    set({
      status: "starting",
      sessionId: session.id,
      adapter: session.adapter,
      program: session.program,
      root: session.root,
      threads: [],
      threadId: null,
      stack: [],
      frameId: null,
      scopes: [],
      variables: {},
      output: [],
      error: null,
    });
  },

  endSession() {
    set({
      status: "stopped",
      sessionId: null,
      threads: [],
      threadId: null,
      stack: [],
      frameId: null,
      scopes: [],
      variables: {},
    });
  },

  setThreads(threads, threadId) {
    set({ threads, threadId });
  },

  setStack(stack, frameId) {
    set({ stack, frameId });
  },

  setScopes(scopes) {
    set({ scopes });
  },

  setVariables(reference, variables) {
    set((state) => ({
      variables: { ...state.variables, [reference]: variables },
    }));
  },

  setBreakpoints(breakpoints) {
    set({ breakpoints });
  },

  appendOutput(text) {
    if (!text) return;
    set((state) => {
      const output = [...state.output, text];
      if (output.length > MAX_OUTPUT_ENTRIES) {
        output.splice(0, output.length - MAX_OUTPUT_ENTRIES);
      }
      return { output };
    });
  },

  clearOutput() {
    set({ output: [] });
  },

  setError(message) {
    set({ error: message });
  },
}));

/** Add or remove a breakpoint on a workspace-relative path. */
export function toggleBreakpoint(path: string, line: number): number[] {
  const state = useDapStore.getState();
  const current = state.breakpoints[path] ?? [];
  const next = current.includes(line)
    ? current.filter((value) => value !== line)
    : [...current, line].sort((a, b) => a - b);
  state.setBreakpoints({ ...state.breakpoints, [path]: next });
  return next;
}

export function breakpointsFor(state: DapState, path: string): number[] {
  return state.breakpoints[path] ?? [];
}
