import { useEffect, useRef, useState } from "react";

import type { DapStatus } from "../shared/types";
import { api } from "../lib/api";
import {
  continueDebug,
  initDap,
  loadVariables,
  selectFrame,
  startDebug,
  stepIn,
  stepOut,
  stepOver,
  stopDebug,
  toggleDebugBreakpoint,
} from "../lib/dap";
import { useDapStore } from "../stores/dapStore";
import { useEditorStore } from "../stores/editorStore";
import { Icon } from "./Icon";

const statusLabels: Record<DapStatus, string> = {
  idle: "待機中",
  starting: "起動中…",
  running: "実行中",
  paused: "停止中",
  stopped: "終了",
  error: "エラー",
};

function VariableList({
  reference,
  depth = 0,
}: {
  reference: number;
  depth?: number;
}) {
  const variables = useDapStore((state) => state.variables[reference]);
  if (!variables || depth > 3) return null;

  return (
    <ul className="debug-vars">
      {variables.map((variable) => (
        <li key={`${variable.name}-${variable.value}`}>
          <div className="debug-var">
            <span className="debug-var-name">{variable.name}</span>
            {variable.type && <span className="debug-var-type">{variable.type}</span>}
            <span className="debug-var-value" title={variable.value}>
              {variable.value}
            </span>
            {variable.variablesReference > 0 && (
              <button
                type="button"
                className="link-button"
                onClick={() => void loadVariables(variable.variablesReference)}
              >
                展開
              </button>
            )}
          </div>
          {variable.variablesReference > 0 && (
            <VariableList reference={variable.variablesReference} depth={depth + 1} />
          )}
        </li>
      ))}
    </ul>
  );
}

export function DebugPanel() {
  const adapters = useDapStore((state) => state.adapters);
  const adaptersLoaded = useDapStore((state) => state.adaptersLoaded);
  const status = useDapStore((state) => state.status);
  const sessionId = useDapStore((state) => state.sessionId);
  const root = useDapStore((state) => state.root);
  const threads = useDapStore((state) => state.threads);
  const threadId = useDapStore((state) => state.threadId);
  const stack = useDapStore((state) => state.stack);
  const frameId = useDapStore((state) => state.frameId);
  const scopes = useDapStore((state) => state.scopes);
  const breakpoints = useDapStore((state) => state.breakpoints);
  const output = useDapStore((state) => state.output);
  const error = useDapStore((state) => state.error);

  const activePath = useEditorStore((state) => state.activePath);
  const openFile = useEditorStore((state) => state.openFile);

  const [adapter, setAdapter] = useState("lldb-dap");
  const [program, setProgram] = useState("");
  const [busy, setBusy] = useState(false);
  const outputRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    void initDap();
  }, []);

  useEffect(() => {
    if (!adaptersLoaded || adapters.length === 0) return;
    const current = adapters.find((item) => item.id === adapter);
    if (current?.available) return;
    const fallback = adapters.find((item) => item.available);
    if (fallback) setAdapter(fallback.id);
  }, [adapters, adaptersLoaded, adapter]);

  useEffect(() => {
    const element = outputRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [output]);

  const running = sessionId !== null;
  const paused = status === "paused";
  const selectedAdapter = adapters.find((item) => item.id === adapter);
  const breakpointEntries = Object.entries(breakpoints).flatMap(([path, lines]) =>
    lines.map((line) => ({ path, line })),
  );

  const browse = async () => {
    const selected = await api.pickFile("デバッグ対象の実行ファイルを選択");
    if (selected) setProgram(selected);
  };

  const start = async () => {
    setBusy(true);
    try {
      await startDebug(adapter, program.trim() ? program.trim() : null);
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      await stopDebug();
    } finally {
      setBusy(false);
    }
  };

  const revealFrame = (path: string | null) => {
    if (path) void openFile(path);
  };

  return (
    <div className="debug-panel">
      <div className="skills-head">
        <div>
          <h3>デバッガ</h3>
          <p>
            lldb-dap / debugpy を固定レジストリから起動します。ブレークポイントは
            エディタの行番号左をクリックするか F9 で切り替えます。
          </p>
        </div>
        <span className={`debug-status ${status}`}>{statusLabels[status]}</span>
      </div>

      {!running && (
        <div className="debug-launch">
          <label className="field-label" htmlFor="debug-adapter">
            アダプター
          </label>
          <select
            id="debug-adapter"
            className="text-input"
            value={adapter}
            onChange={(event) => setAdapter(event.target.value)}
          >
            {adapters.map((item) => (
              <option key={item.id} value={item.id} disabled={!item.available}>
                {item.label}
                {item.available ? "" : "（未導入）"}
              </option>
            ))}
          </select>
          {selectedAdapter && !selectedAdapter.available && (
            <p className="field-help">
              {selectedAdapter.install} で導入してください。
            </p>
          )}

          <label className="field-label" htmlFor="debug-program">
            実行ファイル
          </label>
          <div className="key-row">
            <input
              id="debug-program"
              className="text-input"
              value={program}
              onChange={(event) => setProgram(event.target.value)}
              placeholder={activePath ? activePath : "target/debug/my-app"}
              spellCheck={false}
              autoComplete="off"
            />
            <button type="button" className="btn small" onClick={() => void browse()}>
              選択
            </button>
          </div>
          <p className="field-help">
            ワークスペース内の相対パス、または絶対パスを指定できます。
          </p>

          <button
            type="button"
            className="btn primary debug-start"
            onClick={() => void start()}
            disabled={busy || !selectedAdapter?.available}
          >
            <Icon name="play" size={13} />
            {busy ? "起動中…" : "デバッグ開始"}
          </button>
        </div>
      )}

      {running && (
        <>
          <div className="debug-controls">
            <button
              type="button"
              className="btn small"
              onClick={() => void continueDebug()}
              disabled={!paused}
            >
              <Icon name="play" size={12} /> 再開
            </button>
            <button
              type="button"
              className="btn small"
              onClick={() => void stepOver()}
              disabled={!paused}
            >
              ステップオーバー
            </button>
            <button
              type="button"
              className="btn small"
              onClick={() => void stepIn()}
              disabled={!paused}
            >
              ステップイン
            </button>
            <button
              type="button"
              className="btn small"
              onClick={() => void stepOut()}
              disabled={!paused}
            >
              ステップアウト
            </button>
            <button
              type="button"
              className="btn small"
              onClick={() => void stop()}
              disabled={busy}
            >
              <Icon name="stop" size={12} /> 停止
            </button>
          </div>

          <div className="debug-meta">
            <span>{root}</span>
            {threads.length > 0 && (
              <span>
                スレッド {threads.length}
                {threadId !== null ? ` / #${threadId}` : ""}
              </span>
            )}
          </div>

          <div className="debug-section">
            <h4>コールスタック</h4>
            {stack.length === 0 ? (
              <p className="field-help">{paused ? "取得中…" : "実行中は停止すると表示されます。"}</p>
            ) : (
              <ul className="debug-stack">
                {stack.map((frame) => (
                  <li key={frame.id}>
                    <button
                      type="button"
                      className={frame.id === frameId ? "active" : ""}
                      onClick={() => {
                        void selectFrame(frame.id);
                        revealFrame(frame.path);
                      }}
                    >
                      <span className="debug-frame-name">{frame.name}</span>
                      {frame.path && (
                        <span className="debug-frame-path">
                          {frame.path}:{frame.line}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {scopes.length > 0 && (
            <div className="debug-section">
              <h4>変数</h4>
              {scopes.map((scope) => (
                <div className="debug-scope" key={`${scope.name}-${scope.variablesReference}`}>
                  <h5>{scope.name}</h5>
                  <VariableList reference={scope.variablesReference} />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {breakpointEntries.length > 0 && (
        <div className="debug-section">
          <h4>ブレークポイント</h4>
          <ul className="debug-breakpoints">
            {breakpointEntries.map(({ path, line }) => (
              <li key={`${path}:${line}`}>
                <button
                  type="button"
                  className="debug-breakpoint-open"
                  onClick={() => void openFile(path)}
                >
                  {path}:{line}
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  title="ブレークポイントを削除"
                  onClick={() => toggleDebugBreakpoint(path, line)}
                >
                  <Icon name="x" size={12} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="dialog-error" role="alert">
          {error}
        </div>
      )}

      <div className="debug-section">
        <h4>出力</h4>
        <pre className="debug-output" ref={outputRef}>
          {output.join("") || "// デバッグ出力はここに表示されます"}
        </pre>
      </div>
    </div>
  );
}
