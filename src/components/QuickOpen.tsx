import { useEffect, useMemo, useRef, useState } from "react";

import type { FileEntry } from "../shared/types";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { Icon } from "./Icon";

function flatten(entries: FileEntry[], out: FileEntry[] = []): FileEntry[] {
  for (const entry of entries) {
    if (entry.isDir) {
      flatten(entry.children, out);
    } else {
      out.push(entry);
    }
  }
  return out;
}

function score(path: string, query: string): number {
  const lower = path.toLowerCase();
  const name = lower.split("/").pop() ?? lower;
  const index = lower.indexOf(query);
  if (index === -1) return -1;
  let value = 100 - Math.min(index, 60);
  if (name.startsWith(query)) value += 40;
  if (name === query) value += 60;
  return value - Math.min(path.length, 120) * 0.1;
}

export function QuickOpen({ onClose }: { onClose: () => void }) {
  const tree = useWorkspaceStore((state) => state.tree);
  const select = useWorkspaceStore((state) => state.select);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const files = useMemo(() => flatten(tree), [tree]);
  const normalized = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!normalized) return files.slice(0, 60);
    return files
      .map((file) => ({ file, value: score(file.path, normalized) }))
      .filter((entry) => entry.value >= 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 60)
      .map((entry) => entry.file);
  }, [files, normalized]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setIndex(0);
  }, [normalized]);

  const open = (file: FileEntry | undefined) => {
    if (!file) return;
    onClose();
    select(file.path);
  };

  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={onClose}>
      <div
        className="quick-open"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="ファイルを開く"
      >
        <div className="palette-input">
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            value={query}
            placeholder="ファイル名で検索…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                setIndex((current) => (current + 1) % Math.max(filtered.length, 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setIndex(
                  (current) =>
                    (current - 1 + Math.max(filtered.length, 1)) %
                    Math.max(filtered.length, 1),
                );
              } else if (event.key === "Enter") {
                event.preventDefault();
                open(filtered[index]);
              }
            }}
          />
          <kbd>ESC</kbd>
        </div>

        <div className="palette-list">
          {filtered.length === 0 && (
            <div className="palette-empty">一致するファイルがありません</div>
          )}
          {filtered.map((file, itemIndex) => {
            const parts = file.path.split("/");
            const name = parts.pop() ?? file.path;
            const dir = parts.join("/");
            return (
              <button
                type="button"
                key={file.path}
                className={`palette-item quick-open-item${
                  itemIndex === index ? " active" : ""
                }`}
                onMouseEnter={() => setIndex(itemIndex)}
                onClick={() => open(file)}
              >
                <span className="palette-icon">
                  <Icon name="file" size={14} />
                </span>
                <span className="palette-copy">
                  <span className="palette-label">{name}</span>
                  {dir && <span className="palette-hint">{dir}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
