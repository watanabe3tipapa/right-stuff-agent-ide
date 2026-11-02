export interface WorkspaceInfo {
  root: string;
  name: string;
}

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: number | null;
  children: FileEntry[];
}

export interface FileContent {
  path: string;
  content: string;
  language: string;
  size: number;
  modified: number;
}

export interface SaveResult {
  path: string;
  versionId: number;
  savedAt: number;
  size: number;
}

export interface VersionSummary {
  id: number;
  path: string;
  size: number;
  createdAt: number;
}

export interface VersionContent {
  id: number;
  path: string;
  content: string;
  createdAt: number;
}

export interface AgentStatus {
  available: boolean;
  binary: string | null;
  version: string | null;
  platform: string;
  arch: string;
  message: string;
}

export interface AgentRunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  command: string[];
}

export interface AppInfo {
  name: string;
  version: string;
  tauriVersion: string;
  platform: string;
  arch: string;
}

export type AgentMode = "passive" | "assistive" | "autonomous";

export interface ChatMessage {
  id: string;
  role: "user" | "agent" | "system";
  text: string;
  createdAt: number;
  command?: string;
}
