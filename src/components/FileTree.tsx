import { useState } from "react";

import type { FileEntry } from "../shared/types";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import { PromptDialog } from "./PromptDialog";

const glyphColors: Record<string, string> = {
  ts: "#58a6ff",
  tsx: "#58a6ff",
  js: "#d29922",
  jsx: "#d29922",
  json: "#d29922",
  md: "#8b949e",
  rs: "#ffa657",
  py: "#58a6ff",
  css: "#d2a8ff",
  scss: "#d2a8ff",
  html: "#ffa657",
  toml: "#ff7b72",
  yml: "#3fb950",
  yaml: "#3fb950",
  sh: "#3fb950",
  lock: "#484f58",
};

function findEntry(entries: FileEntry[], path: string): FileEntry | undefined {
  for (const entry of entries) {
    if (entry.path === path) return entry;
    if (entry.isDir) {
      const found = findEntry(entry.children, path);
      if (found) return found;
    }
  }
  return undefined;
}

function parentOf(path: string): string {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}

function FileGlyph({ entry }: { entry: FileEntry }) {
  if (entry.isDir) {
    return <Icon name="folder" size={15} className="glyph-folder" />;
  }

  const extension = entry.name.includes(".")
    ? (entry.name.split(".").pop() ?? "").toLowerCase()
    : "";
  const color = glyphColors[extension] ?? "#8b949e";
  const label = extension ? extension.slice(0, 2).toUpperCase() : "·";

  return (
    <span className="glyph-file" style={{ color }} aria-hidden="true">
      {label}
    </span>
  );
}

interface DialogState {
  mode: "file" | "dir" | "rename";
  parentPath: string;
  entry?: FileEntry;
}

function TreeRow({ entry, depth }: { entry: FileEntry; depth: number }) {
  const selectedPath = useWorkspaceStore((state) => state.selectedPath);
  const expanded = useWorkspaceStore((state) => state.expanded[entry.path] ?? false);
  const select = useWorkspaceStore((state) => state.select);
  const toggleExpanded = useWorkspaceStore((state) => state.toggleExpanded);
  const renameEntry = useWorkspaceStore((state) => state.renameEntry);
  const deleteEntry = useWorkspaceStore((state) => state.deleteEntry);
  const [renaming, setRenaming] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);

  const isSelected = selectedPath === entry.path;

  return (
    <>
      <div
        className={`tree-row${isSelected ? " selected" : ""}`}
        style={{ paddingLeft: 8 + depth * 13 }}
        onClick={() => {
          select(entry.path);
          if (entry.isDir) toggleExpanded(entry.path);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            select(entry.path);
            if (entry.isDir) toggleExpanded(entry.path);
          }
        }}
        role="button"
        tabIndex={0}
        title={entry.path}
      >
        <span className={`tree-chevron${entry.isDir ? "" : " invisible"}`}>
          <Icon name={expanded ? "chevron-down" : "chevron-right"} size={12} />
        </span>
        <FileGlyph entry={entry} />
        <span className="tree-name">{entry.name}</span>
        <span className="tree-row-actions">
          <button
            type="button"
            className="tree-action"
            title="名前を変更"
            onClick={(event) => {
              event.stopPropagation();
              setRenaming(true);
            }}
          >
            <Icon name="pencil" size={12} />
          </button>
          <button
            type="button"
            className="tree-action danger"
            title="削除 (ゴミ箱へ)"
            onClick={(event) => {
              event.stopPropagation();
              setPendingDelete(true);
            }}
          >
            <Icon name="trash" size={12} />
          </button>
        </span>
      </div>

      {entry.isDir && expanded && entry.children.length > 0 && (
        <div className="tree-children">
          {entry.children.map((child) => (
            <TreeRow key={child.path} entry={child} depth={depth + 1} />
          ))}
        </div>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={entry.isDir ? "フォルダを削除" : "ファイルを削除"}
          message={`${entry.path} をゴミ箱へ移動します。この操作はあとから復元できます。`}
          confirmLabel="削除"
          danger
          onCancel={() => setPendingDelete(false)}
          onConfirm={() => {
            setPendingDelete(false);
            void deleteEntry(entry.path);
          }}
        />
      )}

      {renaming && (
        <PromptDialog
          title="名前を変更"
          label={entry.path}
          initialValue={entry.name}
          confirmLabel="変更"
          onCancel={() => setRenaming(false)}
          onSubmit={(value) => {
            const path = entry.path;
            const next = parentOf(path) ? `${parentOf(path)}/${value}` : value;
            setRenaming(false);
            void renameEntry(path, next);
          }}
        />
      )}
    </>
  );
}

export function FileTree() {
  const tree = useWorkspaceStore((state) => state.tree);
  const info = useWorkspaceStore((state) => state.info);
  const selectedPath = useWorkspaceStore((state) => state.selectedPath);
  const loading = useWorkspaceStore((state) => state.loading);
  const openWorkspace = useWorkspaceStore((state) => state.openWorkspace);
  const refresh = useWorkspaceStore((state) => state.refresh);
  const createEntry = useWorkspaceStore((state) => state.createEntry);
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const targetDirectory = () => {
    if (!selectedPath) return "";
    const entry = findEntry(tree, selectedPath);
    if (!entry) return "";
    return entry.isDir ? entry.path : parentOf(entry.path);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <button
          type="button"
          className="workspace-switch"
          onClick={() => void openWorkspace()}
          title={info?.root ?? "フォルダを開く"}
        >
          <span className="workspace-name">{info?.name ?? "ワークスペース"}</span>
          <Icon name="chevron-down" size={12} />
        </button>
        <div className="sidebar-actions">
          <button
            type="button"
            className="icon-btn"
            title="新しいファイル"
            onClick={() => setDialog({ mode: "file", parentPath: targetDirectory() })}
          >
            <Icon name="file-plus" size={15} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="新しいフォルダ"
            onClick={() => setDialog({ mode: "dir", parentPath: targetDirectory() })}
          >
            <Icon name="folder-plus" size={15} />
          </button>
          <button
            type="button"
            className={`icon-btn${loading ? " spinning" : ""}`}
            title="更新"
            onClick={() => void refresh()}
          >
            <Icon name="refresh" size={15} />
          </button>
        </div>
      </div>

      <div className="tree-scroll">
        {tree.length === 0 ? (
          <div className="tree-empty">
            {loading ? "読み込み中…" : "ファイルがありません"}
          </div>
        ) : (
          tree.map((entry) => <TreeRow key={entry.path} entry={entry} depth={0} />)
        )}
      </div>

      <div className="sidebar-foot">
        <span className="sidebar-foot-item">
          <Icon name="branch" size={12} /> main
        </span>
        <span className="sidebar-foot-item">{tree.length} items</span>
      </div>

      {dialog && (
        <PromptDialog
          title={
            dialog.mode === "file"
              ? "新しいファイル"
              : dialog.mode === "dir"
                ? "新しいフォルダ"
                : "名前を変更"
          }
          label={
            dialog.parentPath
              ? `作成先: ${dialog.parentPath}/`
              : "作成先: ワークスペース直下"
          }
          placeholder={dialog.mode === "dir" ? "components" : "example.ts"}
          onCancel={() => setDialog(null)}
          onSubmit={(value) => {
            const parentPath = dialog.parentPath;
            const isDir = dialog.mode === "dir";
            setDialog(null);
            void createEntry(parentPath, value, isDir);
          }}
        />
      )}
    </aside>
  );
}
