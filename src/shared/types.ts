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

export type AgentPanelTab =
  | "chat"
  | "plan"
  | "skills"
  | "git"
  | "debug"
  | "deploy"
  | "audit"
  | "runtime";

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
  | "policy_updated"
  | "skill_run"
  | "skill_blocked"
  | "skill_cancelled"
  | "verification_run"
  | "skill_policy_updated";

export type AuditOutcome = "ok" | "error" | "blocked" | "cancelled";

export interface AuditEntry {
  id: number;
  createdAt: number;
  kind: AuditKind;
  mode: AgentMode | null;
  planId: string | null;
  stepId: string | null;
  skillId: string | null;
  actionId: string | null;
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
  skillId?: string | null;
  actionId?: string | null;
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

export type SkillCategory = "editor" | "git" | "terminal" | "debug";
export type SkillRisk = "read" | "write" | "destructive";
export type SkillParamType = "string" | "number" | "boolean" | "string[]";
export type SkillDecision = "allow" | "ask" | "block";

export interface SkillParamDef {
  type: SkillParamType;
  description: string;
  required?: boolean;
  maxLength?: number;
  maxItems?: number;
  enum?: (string | number | boolean)[];
  pattern?: string;
}

export interface SkillAction {
  id: string;
  handler: string;
  description: string;
  risk: SkillRisk;
  params: Record<string, SkillParamDef>;
  timeoutMs?: number;
  maxOutputChars?: number;
}

export interface SkillManifest {
  schemaVersion: number;
  id: string;
  name: string;
  description: string;
  version: string;
  category: SkillCategory;
  risk: SkillRisk;
  actions: SkillAction[];
  permissions: {
    paths: { read: string[]; write: string[] };
    commands: { program: string; args: string[] }[];
    env: string[];
  };
  approval: {
    default: SkillDecision | null;
    overrides: Record<string, SkillDecision>;
  };
  verification: {
    mode: "none" | "auto";
    checks: ("typecheck" | "lint" | "test")[];
    timeoutMs: number;
    stopOnFailure: boolean;
  };
  limits: {
    maxFiles: number;
    maxBytes: number;
    timeoutMs: number;
    maxOutputChars: number;
  };
}

export interface SkillWarning {
  file: string;
  message: string;
}

export interface SkillCatalog {
  skills: SkillManifest[];
  warnings: SkillWarning[];
}

export interface SkillPolicy {
  version: number;
  skills: Record<string, SkillDecision>;
  actions: Record<string, SkillDecision>;
  verification: {
    autoRun: boolean;
    allowChecks: ("typecheck" | "lint" | "test")[];
  };
  limits: {
    maxFiles: number;
    maxBytes: number;
    timeoutMs: number;
    maxOutputChars: number;
  };
}

export interface SkillDecisionResult {
  skillId: string;
  actionId: string;
  decision: SkillDecision;
  risk: SkillRisk;
}

export interface SkillPreviewResult {
  skillId: string;
  actionId: string;
  decision: SkillDecision;
  risk: SkillRisk;
  path: string | null;
  addedLines: number;
  removedLines: number;
  diff: string;
  warnings: string[];
}

export interface SkillRequest {
  skillId: string;
  actionId: string;
  params: Record<string, unknown>;
  planId?: string;
  stepId?: string;
  title?: string;
  mode?: AgentMode;
}

export type SkillRunStatus = "ok" | "blocked" | "cancelled" | "failed";

export interface SkillRunResult {
  runId: string;
  status: SkillRunStatus;
  decision: SkillDecision;
  changedFiles: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  auditId: number;
  errorCode?: string;
}

export type PlanStepRisk = "read" | "write" | "destructive";

export type PlanStepKind = "agent" | "skill";

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
  kind: PlanStepKind;
  title: string;
  /** Full CLI arguments, starting with the allowlisted action (agent steps). */
  command: string[];
  action: string;
  risk: PlanStepRisk;
  /** Skill steps: id of the manifest and action executed by `skill_run`. */
  skillId?: string;
  skillActionId?: string;
  params?: Record<string, unknown>;
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

export interface LspServerInfo {
  language: string;
  label: string;
  available: boolean;
  command: string[];
  install: string;
}

export interface LspStart {
  id: string;
  language: string;
  command: string[];
  root: string;
}

export interface LspMessage {
  id: string;
  message: unknown;
}

export interface LspLog {
  id: string;
  line: string;
}

export interface DapAdapterInfo {
  id: string;
  label: string;
  available: boolean;
  command: string[];
  install: string;
  languages: string[];
}

export interface DapStart {
  id: string;
  adapter: string;
  command: string[];
  program: string | null;
  root: string;
}

export interface DapMessage {
  id: string;
  message: unknown;
}

export interface DapLog {
  id: string;
  line: string;
}

export type DapStatus =
  | "idle"
  | "starting"
  | "running"
  | "paused"
  | "stopped"
  | "error";
