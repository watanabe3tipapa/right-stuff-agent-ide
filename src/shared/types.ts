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

export type AgentPanelTab = "chat" | "plan" | "git" | "deploy" | "audit" | "runtime";

export type AgentPolicyDecision = "allow" | "ask" | "block";

export interface AgentPolicy {
  auditEnabled: boolean;
  auditRetentionDays: number;
  actions: Record<string, AgentPolicyDecision>;
}

export type AuditKind =
  | "plan_created"
  | "plan_approved"
  | "plan_rejected"
  | "plan_cancelled"
  | "action_run"
  | "action_blocked"
  | "action_cancelled"
  | "policy_updated";

export type AuditOutcome = "ok" | "error" | "blocked" | "cancelled";

export interface AuditEntry {
  id: number;
  createdAt: number;
  kind: AuditKind;
  mode: AgentMode | null;
  planId: string | null;
  stepId: string | null;
  title: string | null;
  command: string[] | null;
  outcome: AuditOutcome | null;
  detail: string | null;
}

export interface AuditInput {
  kind: AuditKind;
  mode?: AgentMode | null;
  planId?: string | null;
  stepId?: string | null;
  title?: string | null;
  command?: string[] | null;
  outcome?: AuditOutcome | null;
  detail?: string | null;
}

export interface AgentAuditMeta {
  planId?: string;
  stepId?: string;
  title?: string;
  mode?: AgentMode;
}

export type PlanStepRisk = "read" | "write";

export type PlanStepStatus =
  | "pending"
  | "approved"
  | "running"
  | "done"
  | "failed"
  | "skipped";

export type AgentPlanStatus =
  | "draft"
  | "approved"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface AgentPlanStep {
  id: string;
  title: string;
  /** Full CLI arguments, starting with the allowlisted action. */
  command: string[];
  action: string;
  risk: PlanStepRisk;
  rationale?: string;
  status: PlanStepStatus;
  output?: string;
  error?: string;
}

export interface AgentPlan {
  id: string;
  goal: string;
  steps: AgentPlanStep[];
  createdAt: number;
  status: AgentPlanStatus;
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent" | "system";
  text: string;
  createdAt: number;
  command?: string;
  /** Local UI notice that must not be sent back to the LLM. */
  local?: boolean;
}

export type LlmProvider = "openai" | "ollama" | "lmstudio" | "openrouter" | "custom";

export interface LlmConfig {
  provider: LlmProvider;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface LlmSettings extends LlmConfig {
  configured: boolean;
  keyConfigured: boolean;
}

export interface LlmTestResult {
  ok: boolean;
  status: number | null;
  message: string;
  models: string[];
}

export type LlmChatRole = "system" | "user" | "assistant";

export interface LlmChatMessage {
  role: LlmChatRole;
  content: string;
}

export type LlmStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; finishReason: string | null }
  | { type: "cancelled" }
  | { type: "error"; message: string };

export interface OpenShipConfig {
  baseUrl: string;
  organizationId: string;
  projectId: string;
  branch: string;
  cliPath: string;
}

export interface OpenShipSettings extends OpenShipConfig {
  tokenConfigured: boolean;
}

export interface OpenShipStatus {
  cliAvailable: boolean;
  cliPath: string | null;
  cliVersion: string | null;
  serverConfigured: boolean;
  serverReachable: boolean;
  serverMessage: string;
  tokenConfigured: boolean;
  baseUrl: string;
}

export interface OpenShipProject {
  id: string;
  name: string;
  slug: string | null;
}

export interface OpenShipDeployment {
  id: string;
  projectId: string | null;
  status: string;
  environment: string | null;
  branch: string | null;
  url: string | null;
  createdAt: number | null;
  commit: string | null;
}

export interface OpenShipDeployResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  command: string[];
  deployment: OpenShipDeployment | null;
}

export interface OpenShipLogs {
  deploymentId: string;
  ok: boolean;
  status: number | null;
  logs: string;
}

export interface GitFile {
  path: string;
  status: string;
}

export interface GitStatus {
  repo: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  staged: GitFile[];
  unstaged: GitFile[];
  untracked: GitFile[];
  clean: boolean;
  message: string | null;
}

export interface GitDiff {
  path: string;
  staged: boolean;
  diff: string;
  truncated: boolean;
}

export interface GitCommandResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  command: string[];
}

export interface GitCommit {
  hash: string;
  author: string;
  date: string;
  subject: string;
}

export interface TerminalStart {
  id: string;
  shell: string;
}

export interface TerminalOutput {
  id: string;
  data: number[];
}

export interface TerminalExit {
  id: string;
}
