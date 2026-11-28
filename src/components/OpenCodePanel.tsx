import { useEffect, useRef, useState } from "react";

import type { ChatMessage, OpencodeStatus, OpencodeUpdate } from "../shared/types";
import { api, errorMessage } from "../lib/api";
import { useAgentStore } from "../stores/agentStore";
import { Icon } from "./Icon";

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function eventUpdate(payload: unknown): OpencodeUpdate | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as { method?: string; params?: OpencodeUpdate };
  if (value.method !== "session/update") return null;
  return value.params ?? null;
}

function errorUpdate(cause: unknown): string {
  const message = errorMessage(cause);
  if (/credit|billing|api key|authenticat|unauthori[sz]ed|401|403/i.test(message)) {
    return `${message}（上のモデル選択で、無料モデルなど利用可能なモデルに切り替えてください）`;
  }
  return message;
}

export function OpenCodePanel() {
  const mode = useAgentStore((state) => state.mode);
  const openSettings = useAgentStore((state) => state.openSettings);
  const [status, setStatus] = useState<OpencodeStatus | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [modelSaving, setModelSaving] = useState(false);
  const [error, setError] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void refresh();
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void api.onOpencodeEvent((payload) => {
      const method =
        payload && typeof payload === "object"
          ? (payload as { method?: string }).method
          : undefined;
      if (method === "session/closed") {
        setBusy(false);
        setStreamingText("");
        void refresh();
        return;
      }
      const update = eventUpdate(payload);
      if (!update) return;
      const kind = update.update?.sessionUpdate;
      if (kind === "agent_message_chunk" && update.update?.content?.text) {
        setStreamingText((current) => current + update.update?.content?.text);
      } else if (kind === "tool_call" || kind === "tool_call_update") {
        const label = update.update?.title || update.update?.toolName;
        if (label) {
          setMessages((current) => [
            ...current,
            {
              id: newId(),
              role: "system",
              text: `Tool: ${label}`,
              createdAt: Date.now(),
              local: true,
            },
          ]);
        }
      }
    }).then((unlisten) => {
      if (cancelled) unlisten();
      else dispose = unlisten;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  useEffect(() => {
    if (!status?.running) return;
    void api.opencodeSetMode(mode).catch((cause) => setError(errorMessage(cause)));
  }, [mode, status?.running]);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages.length, streamingText, busy]);

  async function refresh() {
    try {
      setStatus(await api.opencodeStatus());
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function start() {
    setStarting(true);
    setError("");
    try {
      setStatus(await api.opencodeStart(mode));
    } catch (cause) {
      setError(errorMessage(cause));
      await refresh();
    } finally {
      setStarting(false);
    }
  }

  async function changeModel(value: string) {
    if (!value || value === status?.model) return;
    setModelSaving(true);
    setError("");
    try {
      setStatus(await api.opencodeSetModel(value));
    } catch (cause) {
      setError(errorUpdate(cause));
      await refresh();
    } finally {
      setModelSaving(false);
    }
  }

  async function stop() {
    try {
      await api.opencodeStop();
      setError("");
    } catch (cause) {
      setError(errorMessage(cause));
    }
    setBusy(false);
    setStreamingText("");
    await refresh();
  }

  async function submit() {
    const value = draft.trim();
    if (!value || busy) return;
    setDraft("");
    setError("");
    setBusy(true);
    setStreamingText("");
    setMessages((current) => [
      ...current,
      { id: newId(), role: "user", text: value, createdAt: Date.now() },
    ]);
    try {
      const result = await api.opencodePrompt(value, mode);
      const reply = (result.text ?? "").trim();
      if (reply || result.stopReason !== "cancelled") {
        setMessages((current) => [
          ...current,
          {
            id: newId(),
            role: "agent",
            text: reply || "(応答なし)",
            createdAt: Date.now(),
          },
        ]);
      }
      setStreamingText("");
    } catch (cause) {
      setError(errorUpdate(cause));
      setStreamingText("");
    } finally {
      setBusy(false);
    }
  }

  const disabled = mode === "passive";

  return (
    <div className="opencode-panel">
      <div className={`opencode-status${status?.running ? " online" : ""}`}>
        <div>
          <strong>OpenCode</strong>
          <span>
            {status?.running
              ? `${status.model ? `${status.model} / ` : ""}${status.version ?? ""} / session ${status.sessionId?.slice(0, 8) ?? ""}`
              : status?.available
                ? `${status.version ?? ""} を検出`
                : "未検出"}
          </span>
        </div>
        {status?.running ? (
          <button type="button" className="chip" onClick={() => void stop()}>
            停止
          </button>
        ) : (
          <button
            type="button"
            className="chip"
            onClick={() => void start()}
            disabled={starting || disabled || !status?.available}
          >
            {starting ? "起動中…" : "セッション開始"}
          </button>
        )}
      </div>

      {status?.running && status.models.length > 0 && (
        <label className="opencode-model">
          <span>モデル</span>
          <select
            value={status.model ?? ""}
            disabled={modelSaving || disabled}
            onChange={(event) => void changeModel(event.target.value)}
          >
            {status.models.map((model) => (
              <option key={model.value} value={model.value}>
                {model.name}
              </option>
            ))}
          </select>
          {modelSaving && <em>切替中…</em>}
        </label>
      )}

      {status && !status.running && (
        <p className="opencode-note">{status.message}</p>
      )}
      {status && !status.running && !status.available && (
        <button
          type="button"
          className="link-button"
          onClick={() => openSettings("opencode")}
        >
          OpenCode の設定を開く
        </button>
      )}
      {disabled && (
        <p className="opencode-note">
          Passive モードでは OpenCode を起動・操作できません。Assistive か Autonomous に切り替えてください。
        </p>
      )}
      {error && <p className="opencode-error">{error}</p>}

      <div className="agent-messages" ref={scrollRef}>
        {messages.map((message) => (
          <div key={message.id} className={`message ${message.role}`}>
            {message.role !== "user" && (
              <div className="message-avatar">
                {message.role === "agent" ? (
                  <Icon name="sparkles" size={13} />
                ) : (
                  <Icon name="alert" size={13} />
                )}
              </div>
            )}
            <div className="message-body">
              <div className="msg-content" style={{ whiteSpace: "pre-wrap" }}>
                {message.text}
              </div>
              <time className="message-time">
                {new Intl.DateTimeFormat("ja-JP", {
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(message.createdAt)}
              </time>
            </div>
          </div>
        ))}
        {(busy || streamingText) && (
          <div className="message agent">
            <div className="message-avatar">
              <Icon name="sparkles" size={13} />
            </div>
            <div className="message-body">
              {streamingText ? (
                <div className="msg-content" style={{ whiteSpace: "pre-wrap" }}>
                  {streamingText}
                </div>
              ) : (
                <div className="typing typing-inline">
                  <span />
                  <span />
                  <span />
                </div>
              )}
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
            !status?.running
              ? "OpenCode のセッションを開始してください"
              : busy
                ? "OpenCode が応答中です…"
                : "デプロイやコードの相談を自然言語で入力… (Enter で送信)"
          }
          disabled={!status?.running || disabled}
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
              onClick={() => setDraft("いまのデプロイ状況を教えて")}
              disabled={!status?.running}
            >
              状況
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => setDraft("この変更をステージング環境にデプロイして")}
              disabled={!status?.running}
            >
              デプロイ
            </button>
          </div>
          <span className="composer-model">
            {status?.running ? "ACP / stdio" : "未接続"}
          </span>
          {busy ? (
            <button
              type="button"
              className="send-btn stop"
              onClick={() => void api.opencodeCancel()}
              aria-label="停止"
              title="停止"
            >
              <Icon name="stop" size={14} />
            </button>
          ) : (
            <button
              type="submit"
              className="send-btn"
              disabled={!draft.trim() || busy || !status?.running || disabled}
              aria-label="送信"
            >
              <Icon name="send" size={15} />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

