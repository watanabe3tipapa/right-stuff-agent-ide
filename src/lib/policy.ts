import type {
  AgentPolicy,
  AgentPolicyDecision,
  AuditKind,
  AuditOutcome,
} from "../shared/types";
import { ALLOWED_ACTIONS, READ_ONLY_ACTIONS } from "./plan";

export const POLICY_DECISIONS: AgentPolicyDecision[] = ["allow", "ask", "block"];

export const POLICY_DECISION_LABELS: Record<AgentPolicyDecision, string> = {
  allow: "許可",
  ask: "確認",
  block: "禁止",
};

export const POLICY_DECISION_HELP: Record<AgentPolicyDecision, string> = {
  allow: "ネイティブ確認なしで実行",
  ask: "実行前にネイティブ確認",
  block: "実行を拒否",
};

export const AUDIT_KIND_LABELS: Record<AuditKind, string> = {
  plan_created: "計画作成",
  plan_approved: "計画承認",
  plan_rejected: "計画却下",
  plan_cancelled: "計画中止",
  action_run: "操作実行",
  action_blocked: "ポリシー拒否",
  action_cancelled: "操作キャンセル",
  policy_updated: "ポリシー更新",
  skill_run: "スキル実行",
  skill_blocked: "スキル拒否",
  skill_cancelled: "スキルキャンセル",
  verification_run: "検証実行",
  skill_policy_updated: "スキルポリシー更新",
};

export const AUDIT_OUTCOME_LABELS: Record<AuditOutcome, string> = {
  ok: "成功",
  error: "失敗",
  blocked: "拒否",
  cancelled: "中止",
};

export function isReadOnlyAction(action: string): boolean {
  return (READ_ONLY_ACTIONS as readonly string[]).includes(action);
}

export function defaultAgentPolicy(): AgentPolicy {
  const actions: Record<string, AgentPolicyDecision> = {};
  for (const action of ALLOWED_ACTIONS) {
    actions[action] = isReadOnlyAction(action) ? "allow" : "ask";
  }
  return {
    auditEnabled: true,
    auditRetentionDays: 30,
    actions,
  };
}

export function policyDecision(
  policy: AgentPolicy | null,
  action: string,
): AgentPolicyDecision {
  return policy?.actions[action] ?? (isReadOnlyAction(action) ? "allow" : "block");
}

/**
 * Mutating actions always keep the native OS confirmation. Only read-only
 * actions can be auto-allowed or forced to ask.
 */
export function allowedDecisions(action: string): AgentPolicyDecision[] {
  return isReadOnlyAction(action) ? POLICY_DECISIONS : ["ask", "block"];
}
