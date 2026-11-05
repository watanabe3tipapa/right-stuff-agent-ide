import { useEffect, useRef, useState } from "react";

import { api } from "../lib/api";
import { searchWorkspaceSymbols, type WorkspaceSymbol } from "../lib/lsp";
import { symbolKindLabel } from "../lib/lspMapping";
import { useEditorStore } from "../stores/editorStore";
import { Icon } from "./Icon";

/**
 * Workspace symbol search backed by `workspace/symbol`. Results are merged
 * from every running language server, so the query spans Rust, TypeScript,
 * Python and the other registered languages at once.
 */
export function SymbolSearch({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WorkspaceSymbol[]>([]);
  const [loading, setLoading] = useState(false);
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!api.isTauri) return;
    const id = ++requestId.current;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void searchWorkspaceSymbols(query.trim())
        .then((next) => {
          if (requestId.current === id) setResults(next);
        })
        .finally(() => {
          if (requestId.current === id) setLoading(false);
        });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setIndex(0);
  }, [results]);

  const open = async (symbol: WorkspaceSymbol | undefined) => {
    if (!symbol) return;
    onClose();
    const store = useEditorStore.getState();
    await store.openFile(symbol.path);
    window.dispatchEvent(
      new CustomEvent("rsai:reveal", {
        detail: { path: symbol.path, range: symbol.range },
      }),
    );
  };

  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={onClose}>
      <div
        className="quick-open symbol-search"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="シンボル検索"
      >
        <div className="palette-input">
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            value={query}
            placeholder="ワークスペースのシンボルを検索…"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                setIndex((current) => (current + 1) % Math.max(results.length, 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setIndex(
                  (current) =>
                    (current - 1 + Math.max(results.length, 1)) %
                    Math.max(results.length, 1),
                );
              } else if (event.key === "Enter") {
                event.preventDefault();
                void open(results[index]);
              }
            }}
          />
          <kbd>ESC</kbd>
        </div>

        <div className="palette-list">
          {!api.isTauri && (
            <div className="palette-empty">
              ブラウザデモでは LSP のシンボル検索を利用できません。
            </div>
          )}
          {api.isTauri && loading && results.length === 0 && (
            <div className="palette-empty">シンボルを検索中…</div>
          )}
          {api.isTauri && !loading && results.length === 0 && (
            <div className="palette-empty">
              {query.trim()
                ? "一致するシンボルがありません"
                : "検索語を入力してください（Language Server が起動している必要があります）"}
            </div>
          )}
          {results.map((symbol, itemIndex) => (
            <button
              type="button"
              key={`${symbol.path}:${symbol.range.startLineNumber}:${symbol.range.startColumn}:${symbol.name}`}
              className={`palette-item quick-open-item${
                itemIndex === index ? " active" : ""
              }`}
              onMouseEnter={() => setIndex(itemIndex)}
              onClick={() => void open(symbol)}
            >
              <span className="palette-icon">
                <Icon name="command" size={14} />
              </span>
              <span className="palette-copy">
                <span className="palette-label">
                  {symbol.name}
                  {symbol.containerName && (
                    <span className="symbol-container"> · {symbol.containerName}</span>
                  )}
                </span>
                <span className="palette-hint">
                  {symbolKindLabel(symbol.kind)} — {symbol.path}:{symbol.range.startLineNumber}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
