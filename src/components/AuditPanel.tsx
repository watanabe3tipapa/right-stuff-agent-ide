import { useEffect } from "react";

import type { AuditEntry } from "../shared/types";
import {
  AUDIT_KIND_LABELS,
  AUDIT_OUTCOME_LABELS,
} from "../lib/policy";
import { useAgentStore } from "../stores/agentStore";
import { Icon } from "./Icon";

function formatTimestamp(value: number): string {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(value);
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  return (
    <li className={`audit-row ${entry.kind}`}>
      <div className="audit-row-head">
        <span className="audit-time">{formatTimestamp(entry.createdAt)}</span>
        <span className={`audit-kind ${entry.kind}`}>
          {AUDIT_KIND_LABELS[entry.kind] ?? entry.kind}
        </span>
        {entry.outcome && (
          <span className={`audit-outcome ${entry.outcome}`}>
            {AUDIT_OUTCOME_LABELS[entry.outcome] ?? entry.outcome}
          </span>
        )}
        {entry.mode && <span className="audit-mode">{entry.mode}</span>}
      </div>

      {entry.title && <p className="audit-title">{entry.title}</p>}
      {entry.command && entry.command.length > 0 && (
        <code className="audit-command">{entry.command.join(" ")}</code>
      )}
      {entry.detail && <p className="audit-detail">{entry.detail}</p>}

      {(entry.planId || entry.stepId) && (
        <div className="audit-ids">
          {entry.planId && <span>plan: {entry.planId}</span>}
          {entry.stepId && <span>step: {entry.stepId}</span>}
        </div>
      )}
    </li>
  );
}

export function AuditPanel() {
  const policy = useAgentStore((state) => state.policy);
  const audit = useAgentStore((state) => state.audit);
  const auditLoading = useAgentStore((state) => state.auditLoading);
  const auditError = useAgentStore((state) => state.auditError);
  const auditHasMore = useAgentStore((state) => state.auditHasMore);
  const refreshAudit = useAgentStore((state) => state.refreshAudit);
  const loadMoreAudit = useAgentStore((state) => state.loadMoreAudit);
  const refreshPolicy = useAgentStore((state) => state.refreshPolicy);
  const openSettings = useAgentStore((state) => state.openSettings);

  useEffect(() => {
    void refreshAudit();
  }, [refreshAudit]);

  useEffect(() => {
    if (!policy) void refreshPolicy();
  }, [policy, refreshPolicy]);

  const disabled = policy?.auditEnabled === false;

  return (
    <div className="audit-panel">
      <div className="audit-summary">
        <div>
          <span className={`audit-dot${disabled ? " off" : ""}`} />
          {disabled ? "監査ログは無効" : "監査ログは有効"}
          {policy && (
            <span className="audit-retention">
              保持 {policy.auditRetentionDays} 日
            </span>
          )}
        </div>
        <div className="audit-summary-actions">
          <button
            type="button"
            className="btn small ghost"
            onClick={() => void refreshAudit()}
            disabled={auditLoading}
          >
            <Icon name="refresh" size={12} />
            更新
          </button>
          <button
            type="button"
            className="btn small ghost"
            onClick={openSettings}
          >
            <Icon name="gear" size={12} />
            設定
          </button>
        </div>
      </div>

      {disabled && (
        <div className="audit-notice">
          監査ログが無効のため、新しい操作は記録されません。設定タブから有効化できます。
        </div>
      )}

      {auditError && (
        <div className="plan-error">
          <div className="plan-error-head">
            <Icon name="alert" size={13} />
            監査ログを読み込めませんでした
          </div>
          <p>{auditError}</p>
        </div>
      )}

      {audit.length === 0 && !auditLoading && !auditError ? (
        <div className="plan-empty">
          <Icon name="history" size={18} />
          <p>
            承認・却下した計画、実行した操作、ポリシーの変更がここに記録されます。
          </p>
          <ul>
            <li>記録先: ローカルの SQLite（外部送信なし）</li>
            <li>保持期間を過ぎた記録は自動で削除されます</li>
            <li>最新 5,000 件まで保持します</li>
          </ul>
        </div>
      ) : (
        <ul className="audit-list">
          {audit.map((entry) => (
            <AuditRow entry={entry} key={entry.id} />
          ))}
        </ul>
      )}

      {auditLoading && (
        <div className="audit-loading">
          <span className="typing typing-inline">
            <span />
            <span />
            <span />
          </span>
          読み込み中…
        </div>
      )}

      {auditHasMore && !auditLoading && (
        <button
          type="button"
          className="btn small audit-more"
          onClick={() => void loadMoreAudit()}
        >
          さらに読み込む
        </button>
      )}

      {audit.length > 0 && !auditHasMore && (
        <p className="audit-end">これ以上の記録はありません。</p>
      )}
    </div>
  );
}
