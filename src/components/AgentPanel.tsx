import { useEffect, useRef, useState } from "react";

import type { AgentMode, ChatMessage } from "../shared/types";
import { useAgentStore } from "../stores/agentStore";
import { Icon } from "./Icon";
import { PlanPanel } from "./PlanPanel";

const modeCopy: Record<AgentMode, { label: string; description: string }> = {
  passive: {
    label: "Passive",
    description: "読み取り専用。チャットとエージェント操作は無効です。",
  },
  assistive: {
    label: "Assistive",
    description: "チャット応答とファイル内の編集を支援します。",
  },
  autonomous: {
    label: "Autonomous",
    description: "承認した計画を連続実行します。変更操作はネイティブ承認ダイアログを経由します。",
  },
};

function MessageText({ text }: { text: string }) {
  const parts = text.split("```");

  return (
    <div className="msg-content">
      {parts.map((part, index) => {
        if (index % 2 === 1) {
          const lines = part.split("\n");
          const first = lines[0]?.trim() ?? "";
          const hasLanguage = /^[a-z0-9+#-]+$/i.test(first);
          const code = hasLanguage ? lines.slice(1).join("\n") : part;
          return (
            <pre className="msg-code" key={index}>
              <code>{code.trim()}</code>
            </pre>
          );
        }
        const value = part.trim();
        if (!value) return null;
        const inline = value.split("`");
        return (
          <div className="msg-text" key={index}>
            {inline.map((segment, segmentIndex) =>
              segmentIndex % 2 === 1 ? (
                <code className="msg-inline-code" key={segmentIndex}>
                  {segment}
                </code>
              ) : (
                <span key={segmentIndex}>{segment}</span>
              ),
            )}
          </div>
        );
      })}
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <div className={`message ${message.role}`}>
      {message.role !== "user" && (
        <div className="message-avatar">
          {message.role === "agent" ? <Icon name="sparkles" size={13} /> : <Icon name="alert" size={13} />}
        </div>
      )}
      <div className="message-body">
        {message.command && <code className="message-command">{message.command}</code>}
        {message.text ? (
          <MessageText text={message.text} />
        ) : (
          <div className="typing typing-inline">
            <span />
            <span />
            <span />
          </div>
        )}
        <time className="message-time">
          {new Intl.DateTimeFormat("ja-JP", {
            hour: "2-digit",
            minute: "2-digit",
          }).format(message.createdAt)}
        </time>
      </div>
    </div>
  );
}

function ChatView() {
  const messages = useAgentStore((state) => state.messages);
  const busy = useAgentStore((state) => state.busy);
  const streaming = useAgentStore((state) => state.streaming);
  const planLoading = useAgentStore((state) => state.planLoading);
  const executingStepId = useAgentStore((state) => state.executingStepId);
  const send = useAgentStore((state) => state.send);
  const stopStreaming = useAgentStore((state) => state.stopStreaming);
  const mode = useAgentStore((state) => state.mode);
  const llm = useAgentStore((state) => state.llm);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastTextLength =
    messages.length > 0 ? messages[messages.length - 1].text.length : 0;
  const blocked = busy || planLoading || executingStepId !== null;

  useEffect(() => {
    const element = scrollRef.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [messages.length, lastTextLength, busy, streaming]);

  const submit = async () => {
    const value = draft.trim();
    if (!value || blocked || streaming) return;
    setDraft("");
    await send(value);
  };

  return (
    <>
      <div className="agent-messages" ref={scrollRef}>
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {busy && !streaming && (
          <div className="message agent">
            <div className="message-avatar">
              <Icon name="sparkles" size={13} />
            </div>
            <div className="typing">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
      </div>

      <form
        className="agent-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <textarea
          value={draft}
          rows={3}
          placeholder={
            mode === "passive"
              ? "Passive モードではチャットできません"
              : streaming
                ? "応答を生成中… 停止してから次のメッセージを送信できます"
                : planLoading
                  ? "計画を生成中… Plan タブで停止できます"
                  : executingStepId
                    ? "計画の手順を実行中… 完了までお待ちください"
                    : "エージェントに指示する… (Enter で送信)"
          }
          disabled={mode === "passive"}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div className="composer-foot">
          <div className="composer-chips">
            <button
              type="button"
              className="chip"
              onClick={() => setDraft("/status")}
              disabled={mode === "passive"}
            >
              /status
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => setDraft("/snapshot")}
              disabled={mode === "passive"}
            >
              /snapshot
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => setDraft("/plan ")}
              disabled={mode === "passive"}
            >
              /plan
            </button>
          </div>
          <span className={`composer-model${llm?.configured ? "" : " unset"}`}>
            {llm?.configured ? llm.model : "LLM 未設定"}
          </span>
          {streaming ? (
            <button
              type="button"
              className="send-btn stop"
              onClick={() => void stopStreaming()}
              aria-label="生成を停止"
              title="生成を停止"
            >
              <Icon name="stop" size={14} />
            </button>
          ) : (
            <button
              type="submit"
              className="send-btn"
              disabled={!draft.trim() || busy || planLoading || executingStepId !== null || mode === "passive"}
              aria-label="送信"
            >
              <Icon name="send" size={15} />
            </button>
          )}
        </div>
      </form>
    </>
  );
}

function RuntimeView() {
  const status = useAgentStore((state) => state.status);
  const statusLoading = useAgentStore((state) => state.statusLoading);
  const refreshStatus = useAgentStore((state) => state.refreshStatus);
  const takeSnapshot = useAgentStore((state) => state.takeSnapshot);
  const snapshot = useAgentStore((state) => state.snapshot);
  const busy = useAgentStore((state) => state.busy);

  return (
    <div className="runtime">
      <div className={`runtime-card${status?.available ? " online" : ""}`}>
        <div className="runtime-card-head">
          <span className={`health-dot${status?.available ? " online" : ""}`} />
          <span>{status?.available ? "Agent Desktop 接続可能" : "Agent Desktop 未検出"}</span>
          <span className="runtime-platform">
            {status ? `${status.platform}/${status.arch}` : "—"}
          </span>
        </div>
        <p>{status?.message ?? "状態を確認しています…"}</p>
      </div>

      <dl className="runtime-meta">
        <div>
          <dt>バイナリ</dt>
          <dd>{status?.binary ?? "—"}</dd>
        </div>
        <div>
          <dt>バージョン</dt>
          <dd>{status?.version ?? "—"}</dd>
        </div>
        <div>
          <dt>最終スナップショット</dt>
          <dd>{snapshot ? (snapshot.ok ? "成功" : "失敗") : "未取得"}</dd>
        </div>
      </dl>

      <div className="runtime-actions">
        <button
          type="button"
          className="btn small"
          onClick={() => void refreshStatus()}
          disabled={statusLoading}
        >
          <Icon name="refresh" size={13} />
          再検出
        </button>
        <button
          type="button"
          className="btn small primary"
          onClick={() => void takeSnapshot()}
          disabled={busy}
        >
          <Icon name="sparkles" size={13} />
          スナップショット
        </button>
      </div>

      <div className="runtime-output">
        <div className="runtime-output-head">
          <span>snapshot --json</span>
          {snapshot?.command && <code>{snapshot.command.join(" ")}</code>}
        </div>
        <pre>
          {snapshot
            ? snapshot.stdout || snapshot.stderr || "(出力なし)"
            : "// スナップショットを取得するとここに JSON が表示されます"}
        </pre>
      </div>

      <p className="runtime-note">
        Agent Desktop CLI が PATH にない場合は、環境変数
        <code>AGENT_DESKTOP_BIN</code> に実行ファイルのパスを指定してください。
      </p>
    </div>
  );
}

export function AgentPanel() {
  const tab = useAgentStore((state) => state.panelTab);
  const setTab = useAgentStore((state) => state.setPanelTab);
  const mode = useAgentStore((state) => state.mode);
  const status = useAgentStore((state) => state.status);
  const plan = useAgentStore((state) => state.plan);
  const openSettings = useAgentStore((state) => state.openSettings);

  return (
    <aside className="agent-panel">
      <div className="agent-head">
        <div className="agent-head-top">
          <div className="agent-title">
            <span className="agent-mark">
              <Icon name="sparkles" size={14} />
            </span>
            Agent
            <span className={`agent-status-dot${status?.available ? " online" : ""}`} />
          </div>
          <div className="agent-head-tools">
            <div className="agent-tabs">
              <button
                type="button"
                className={tab === "chat" ? "active" : ""}
                onClick={() => setTab("chat")}
              >
                Chat
              </button>
              <button
                type="button"
                className={`${tab === "plan" ? "active" : ""}${
                  plan?.status === "draft" ? " has-plan" : ""
                }`}
                onClick={() => setTab("plan")}
              >
                Plan
              </button>
              <button
                type="button"
                className={tab === "runtime" ? "active" : ""}
                onClick={() => setTab("runtime")}
              >
                Runtime
              </button>
            </div>
            <button
              type="button"
              className="icon-btn"
              onClick={openSettings}
              aria-label="LLM 設定"
              title="LLM 設定"
            >
              <Icon name="gear" size={14} />
            </button>
          </div>
        </div>
        <div className={`agent-mode-note ${mode}`}>
          <span className="mode-dot" />
          <strong>{modeCopy[mode].label}</strong>
          <span>{modeCopy[mode].description}</span>
        </div>
      </div>

      {tab === "chat" ? (
        <ChatView />
      ) : tab === "plan" ? (
        <PlanPanel />
      ) : (
        <RuntimeView />
      )}
    </aside>
  );
}
