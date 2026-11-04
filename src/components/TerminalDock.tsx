import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { api, errorMessage } from "../lib/api";
import { Icon } from "./Icon";

type TerminalStatus = "starting" | "running" | "exited" | "error" | "unsupported";

const theme = {
  background: "#0f1115",
  foreground: "#d7dae0",
  cursor: "#6ea8fe",
  selectionBackground: "#33415c",
  black: "#1b1f27",
  red: "#ff6b6b",
  green: "#7ee787",
  yellow: "#e3b341",
  blue: "#6ea8fe",
  magenta: "#d2a8ff",
  cyan: "#56d4dd",
  white: "#d7dae0",
  brightBlack: "#6e7681",
  brightRed: "#ff8f8f",
  brightGreen: "#a5f3a5",
  brightYellow: "#f0cc6b",
  brightBlue: "#9ec1ff",
  brightMagenta: "#e2c5ff",
  brightCyan: "#8be9ef",
  brightWhite: "#ffffff",
};

const statusLabels: Record<TerminalStatus, string> = {
  starting: "起動中…",
  running: "実行中",
  exited: "終了",
  error: "エラー",
  unsupported: "Tauri 版のみ",
};

function TerminalSession({ onClose }: { onClose: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const idRef = useRef<string | null>(null);
  const [status, setStatus] = useState<TerminalStatus>(
    api.isTauri ? "starting" : "unsupported",
  );
  const [shell, setShell] = useState("");
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!api.isTauri) return;
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let id: string | null = null;
    const unlisteners: Array<() => void> = [];
    const cleanups: Array<() => void> = [];

    const term = new Terminal({
      cursorBlink: true,
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      fontSize: 12.5,
      lineHeight: 1.2,
      scrollback: 5000,
      theme,
      allowProposedApi: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);

    const fitNow = () => {
      try {
        fit.fit();
      } catch {
        // The host can be zero-sized during layout transitions.
      }
    };
    fitNow();

    const boot = async () => {
      try {
        // Register before starting the PTY: the shell prints its prompt
        // immediately, and those bytes must not be dropped while the start
        // command is still resolving.
        const pending: Array<{ id: string; data: number[] }> = [];
        let exitedEarly = false;

        unlisteners.push(
          await api.onTerminalOutput((payload) => {
            if (id === null) {
              pending.push({ id: payload.id, data: payload.data });
              return;
            }
            if (payload.id === id) {
              term.write(new Uint8Array(payload.data));
            }
          }),
        );
        if (disposed) return;
        unlisteners.push(
          await api.onTerminalExit((payload) => {
            if (id === null) {
              exitedEarly = true;
              return;
            }
            if (payload.id !== id) return;
            setStatus("exited");
            term.writeln("\r\n\x1b[2m[プロセスが終了しました]\x1b[0m");
          }),
        );
        if (disposed) return;

        const start = await api.terminalStart(term.cols, term.rows);
        if (disposed) {
          void api.terminalKill(start.id);
          return;
        }
        id = start.id;
        idRef.current = start.id;
        setShell(start.shell);
        setStatus(exitedEarly ? "exited" : "running");
        fitNow();
        term.focus();
        if (pending.length > 0) {
          for (const chunk of pending) {
            if (chunk.id === id) {
              term.write(new Uint8Array(chunk.data));
            }
          }
          pending.length = 0;
        }
        void api.terminalResize(id, term.cols, term.rows);

        const onData = term.onData((data) => {
          if (id) void api.terminalWrite(id, data);
        });
        cleanups.push(() => onData.dispose());

        const observer = new ResizeObserver(() => {
          fitNow();
          if (id) void api.terminalResize(id, term.cols, term.rows);
        });
        observer.observe(host);
        cleanups.push(() => observer.disconnect());
      } catch (error) {
        if (disposed) return;
        setStatus("error");
        term.writeln(`\x1b[31m${errorMessage(error)}\x1b[0m`);
      }
    };

    void boot();

    return () => {
      disposed = true;
      for (const unlisten of unlisteners) unlisten();
      for (const cleanup of cleanups) cleanup();
      if (id) void api.terminalKill(id);
      idRef.current = null;
      term.dispose();
    };
  }, [generation]);

  const clear = () => {
    if (idRef.current) {
      void api.terminalWrite(idRef.current, "\x0c");
    }
  };

  return (
    <div className="terminal-inner">
      <div className="terminal-head">
        <span className="terminal-title">
          <Icon name="terminal" size={13} />
          Terminal
        </span>
        <span className={`terminal-status ${status}`}>{statusLabels[status]}</span>
        {shell && <span className="terminal-shell">{shell}</span>}
        <div className="terminal-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setGeneration((value) => value + 1)}
            aria-label="ターミナルを再起動"
            title="再起動"
            disabled={!api.isTauri}
          >
            <Icon name="refresh" size={13} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={clear}
            aria-label="ターミナルをクリア"
            title="クリア"
            disabled={!api.isTauri}
          >
            <Icon name="x" size={13} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="ターミナルを閉じる"
            title="閉じる"
          >
            <Icon name="x" size={13} />
          </button>
        </div>
      </div>
      {api.isTauri ? (
        <div className="terminal-host" ref={hostRef} />
      ) : (
        <div className="terminal-empty">
          統合ターミナルは Tauri 版でのみ利用できます。`npm run tauri dev` で起動してください。
        </div>
      )}
    </div>
  );
}

export function TerminalDock({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="terminal-dock">
      <TerminalSession onClose={onClose} />
    </div>
  );
}
