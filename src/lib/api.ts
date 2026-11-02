import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, type CloseRequestedEvent } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";

import type {
  AgentRunResult,
  AgentStatus,
  AppInfo,
  FileContent,
  FileEntry,
  LlmChatMessage,
  LlmConfig,
  LlmSettings,
  LlmStreamEvent,
  LlmTestResult,
  SaveResult,
  VersionContent,
  VersionSummary,
  WorkspaceInfo,
} from "../shared/types";
import { demoApi } from "./demo";

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args);
}

export const api = {
  isTauri,

  appInfo(): Promise<AppInfo> {
    return isTauri ? call<AppInfo>("app_info") : demoApi.appInfo();
  },

  /**
   * Ask the user to resolve unsaved changes before the window closes. The
   * handler must call `event.preventDefault()` when the close should be
   * cancelled. When allowed, the app quits through `api.quit()`.
   */
  async onCloseRequested(
    handler: (event: CloseRequestedEvent) => void | Promise<void>,
  ): Promise<() => void> {
    if (!isTauri) return () => {};
    return getCurrentWindow().onCloseRequested(handler);
  },

  /**
   * macOS Cmd+Q and the app menu Quit item are routed through this event so the
   * WebView can confirm unsaved changes first.
   */
  async onQuitRequested(handler: () => void): Promise<() => void> {
    if (!isTauri) return () => {};
    return listen("app://quit-requested", () => handler());
  },

  quit(): Promise<void> {
    return isTauri ? call<void>("app_quit") : Promise.resolve();
  },

  workspaceLast(): Promise<WorkspaceInfo | null> {
    return isTauri
      ? call<WorkspaceInfo | null>("workspace_last")
      : demoApi.workspaceLast();
  },

  workspaceOpen(path: string): Promise<WorkspaceInfo> {
    return isTauri
      ? call<WorkspaceInfo>("workspace_open", { path })
      : demoApi.workspaceOpen();
  },

  listFiles(): Promise<FileEntry[]> {
    return isTauri ? call<FileEntry[]>("workspace_list_files") : demoApi.listFiles();
  },

  readFile(path: string): Promise<FileContent> {
    return isTauri
      ? call<FileContent>("workspace_read_file", { path })
      : demoApi.readFile(path);
  },

  writeFile(path: string, content: string): Promise<SaveResult> {
    return isTauri
      ? call<SaveResult>("workspace_write_file", { path, content })
      : demoApi.writeFile(path, content);
  },

  createEntry(path: string, isDir: boolean): Promise<string> {
    return isTauri
      ? call<string>("workspace_create_entry", { path, isDir })
      : demoApi.createEntry(path, isDir);
  },

  renameEntry(from: string, to: string): Promise<string> {
    return isTauri
      ? call<string>("workspace_rename_entry", { from, to })
      : demoApi.renameEntry(from, to);
  },

  deleteEntry(path: string): Promise<string> {
    return isTauri
      ? call<string>("workspace_delete_entry", { path })
      : demoApi.deleteEntry(path);
  },

  history(path: string, limit = 30): Promise<VersionSummary[]> {
    return isTauri
      ? call<VersionSummary[]>("editor_history", { path, limit })
      : demoApi.history(path);
  },

  version(id: number): Promise<VersionContent> {
    return isTauri
      ? call<VersionContent>("editor_version", { id })
      : demoApi.version(id);
  },

  agentStatus(): Promise<AgentStatus> {
    return isTauri ? call<AgentStatus>("agent_status") : demoApi.agentStatus();
  },

  agentSnapshot(app?: string): Promise<AgentRunResult> {
    return isTauri
      ? call<AgentRunResult>("agent_snapshot", { app: app ?? null })
      : demoApi.agentSnapshot();
  },

  /**
   * The Rust command validates the action and its arguments, then shows a
   * native confirmation dialog for mutating actions before spawning the CLI.
   */
  agentRun(args: string[]): Promise<AgentRunResult> {
    return isTauri
      ? call<AgentRunResult>("agent_run", { args })
      : demoApi.agentSnapshot();
  },

  llmConfig(): Promise<LlmSettings> {
    return isTauri
      ? call<LlmSettings>("llm_config_get")
      : demoApi.llmConfig();
  },

  llmConfigSet(config: LlmConfig): Promise<LlmSettings> {
    return isTauri
      ? call<LlmSettings>("llm_config_set", { config })
      : demoApi.llmConfigSet();
  },

  llmKeySet(key: string): Promise<void> {
    return isTauri ? call<void>("llm_key_set", { key }) : demoApi.llmKeySet();
  },

  llmKeyDelete(): Promise<void> {
    return isTauri ? call<void>("llm_key_delete") : demoApi.llmKeyDelete();
  },

  llmTest(): Promise<LlmTestResult> {
    return isTauri ? call<LlmTestResult>("llm_test") : demoApi.llmTest();
  },

  /**
   * Streams the response through a Tauri channel. The API key never leaves
   * the Rust process: only the prompt messages cross the IPC boundary.
   */
  async llmChat(
    messages: LlmChatMessage[],
    onEvent: (event: LlmStreamEvent) => void,
  ): Promise<void> {
    if (!isTauri) {
      return demoApi.llmChat();
    }

    const channel = new Channel<LlmStreamEvent>();
    channel.onmessage = onEvent;
    await call<void>("llm_chat", { messages, onEvent: channel });
  },

  llmCancel(): Promise<void> {
    return isTauri ? call<void>("llm_cancel") : Promise.resolve();
  },

  async pickFolder(): Promise<string | null> {
    if (!isTauri) return "";
    const selected = await open({
      directory: true,
      multiple: false,
      title: "ワークスペースを開く",
    });
    return typeof selected === "string" ? selected : null;
  },
};

export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}
