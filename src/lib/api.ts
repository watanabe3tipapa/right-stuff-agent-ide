import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, type CloseRequestedEvent } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";

import type {
  AgentAuditMeta,
  AgentPolicy,
  AgentRunResult,
  AgentStatus,
  AppInfo,
  AuditEntry,
  AuditInput,
  FileContent,
  FileEntry,
  GitCommandResult,
  GitCommit,
  GitDiff,
  GitStatus,
  LlmChatMessage,
  LlmConfig,
  LlmSettings,
  LlmStreamEvent,
  LlmTestResult,
  OpenShipConfig,
  OpenShipDeployResult,
  OpenShipDeployment,
  OpenShipLogs,
  OpenShipProject,
  OpenShipSettings,
  OpenShipStatus,
  SaveResult,
  TerminalExit,
  TerminalOutput,
  TerminalStart,
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
   * The Rust command validates the action and its arguments, applies the
   * agent policy, then shows a native confirmation dialog when required.
   * `audit` links the execution to a plan step in the audit log.
   */
  agentRun(args: string[], audit?: AgentAuditMeta): Promise<AgentRunResult> {
    return isTauri
      ? call<AgentRunResult>("agent_run", { args, audit: audit ?? null })
      : demoApi.agentSnapshot();
  },

  agentPolicy(): Promise<AgentPolicy> {
    return isTauri ? call<AgentPolicy>("agent_policy_get") : demoApi.agentPolicy();
  },

  agentPolicySet(policy: AgentPolicy): Promise<AgentPolicy> {
    return isTauri
      ? call<AgentPolicy>("agent_policy_set", { policy })
      : demoApi.agentPolicySet();
  },

  auditLogAdd(input: AuditInput): Promise<void> {
    return isTauri ? call<void>("audit_log_add", { input }) : Promise.resolve();
  },

  auditLog(limit = 50, offset = 0): Promise<AuditEntry[]> {
    return isTauri
      ? call<AuditEntry[]>("audit_log_list", { limit, offset })
      : Promise.resolve([]);
  },

  openshipConfig(): Promise<OpenShipSettings> {
    return isTauri
      ? call<OpenShipSettings>("openship_config_get")
      : demoApi.openshipConfig();
  },

  openshipConfigSet(config: OpenShipConfig): Promise<OpenShipSettings> {
    return isTauri
      ? call<OpenShipSettings>("openship_config_set", { config })
      : demoApi.openshipConfigSet();
  },

  openshipTokenSet(token: string): Promise<void> {
    return isTauri
      ? call<void>("openship_token_set", { token })
      : demoApi.openshipTokenSet();
  },

  openshipTokenDelete(): Promise<void> {
    return isTauri
      ? call<void>("openship_token_delete")
      : demoApi.openshipTokenDelete();
  },

  openshipStatus(): Promise<OpenShipStatus> {
    return isTauri
      ? call<OpenShipStatus>("openship_status")
      : demoApi.openshipStatus();
  },

  openshipProjects(): Promise<OpenShipProject[]> {
    return isTauri
      ? call<OpenShipProject[]>("openship_projects")
      : Promise.resolve([]);
  },

  openshipDeployments(
    projectId?: string,
    limit = 20,
  ): Promise<OpenShipDeployment[]> {
    return isTauri
      ? call<OpenShipDeployment[]>("openship_deployments", {
          projectId: projectId ?? null,
          limit,
        })
      : Promise.resolve([]);
  },

  /**
   * Deploys through the Openship CLI when it is available, otherwise through
   * the REST API. Rust shows a native confirmation dialog before running.
   */
  openshipDeploy(projectId?: string): Promise<OpenShipDeployResult> {
    return isTauri
      ? call<OpenShipDeployResult>("openship_deploy", {
          projectId: projectId ?? null,
        })
      : demoApi.openshipDeploy();
  },

  openshipLogs(deploymentId: string): Promise<OpenShipLogs> {
    return isTauri
      ? call<OpenShipLogs>("openship_logs", { deploymentId })
      : demoApi.openshipLogs();
  },

  openshipRollback(deploymentId: string): Promise<OpenShipDeployResult> {
    return isTauri
      ? call<OpenShipDeployResult>("openship_rollback", { deploymentId })
      : demoApi.openshipRollback();
  },

  gitStatus(): Promise<GitStatus> {
    return isTauri ? call<GitStatus>("git_status") : demoApi.gitStatus();
  },

  gitInit(): Promise<GitCommandResult> {
    return isTauri ? call<GitCommandResult>("git_init") : demoApi.gitCommand();
  },

  gitDiff(path: string, staged: boolean): Promise<GitDiff> {
    return isTauri
      ? call<GitDiff>("git_diff", { path, staged })
      : demoApi.gitDiff();
  },

  gitStage(path: string): Promise<GitCommandResult> {
    return isTauri
      ? call<GitCommandResult>("git_stage", { path })
      : demoApi.gitCommand();
  },

  gitUnstage(path: string): Promise<GitCommandResult> {
    return isTauri
      ? call<GitCommandResult>("git_unstage", { path })
      : demoApi.gitCommand();
  },

  gitStageAll(): Promise<GitCommandResult> {
    return isTauri ? call<GitCommandResult>("git_stage_all") : demoApi.gitCommand();
  },

  gitUnstageAll(): Promise<GitCommandResult> {
    return isTauri ? call<GitCommandResult>("git_unstage_all") : demoApi.gitCommand();
  },

  gitCommit(message: string): Promise<GitCommandResult> {
    return isTauri
      ? call<GitCommandResult>("git_commit", { message })
      : demoApi.gitCommand();
  },

  gitLog(limit = 20): Promise<GitCommit[]> {
    return isTauri
      ? call<GitCommit[]>("git_log", { limit })
      : demoApi.gitLog();
  },

  terminalStart(cols: number, rows: number): Promise<TerminalStart> {
    if (!isTauri) return Promise.reject(new Error("ターミナルは Tauri 版でのみ利用できます。"));
    return call<TerminalStart>("terminal_start", { cols, rows });
  },

  terminalWrite(id: string, data: string): Promise<void> {
    return isTauri
      ? call<void>("terminal_write", { id, data })
      : Promise.resolve();
  },

  terminalResize(id: string, cols: number, rows: number): Promise<void> {
    return isTauri
      ? call<void>("terminal_resize", { id, cols, rows })
      : Promise.resolve();
  },

  terminalKill(id: string): Promise<void> {
    return isTauri ? call<void>("terminal_kill", { id }) : Promise.resolve();
  },

  onTerminalOutput(handler: (payload: TerminalOutput) => void): Promise<() => void> {
    if (!isTauri) return Promise.resolve(() => {});
    return listen<TerminalOutput>("terminal://output", (event) => handler(event.payload));
  },

  onTerminalExit(handler: (payload: TerminalExit) => void): Promise<() => void> {
    if (!isTauri) return Promise.resolve(() => {});
    return listen<TerminalExit>("terminal://exit", (event) => handler(event.payload));
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
