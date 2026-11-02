import { useEffect, useRef, useState } from "react";

import type { AppInfo, FileEntry } from "./shared/types";
import { api } from "./lib/api";
import { useAgentStore } from "./stores/agentStore";
import { useEditorStore } from "./stores/editorStore";
import { useWorkspaceStore } from "./stores/workspaceStore";
import { AgentPanel } from "./components/AgentPanel";
import { CommandPalette } from "./components/CommandPalette";
import { EditorPane } from "./components/EditorPane";
import { FileTree } from "./components/FileTree";
import { HistoryDialog } from "./components/HistoryDialog";
import { Icon } from "./components/Icon";
import { StatusBar } from "./components/StatusBar";
import { TopBar } from "./components/TopBar";
import { Welcome } from "./components/Welcome";

function findEntry(entries: FileEntry[], predicate: (entry: FileEntry) => boolean): FileEntry | null {
  for (const entry of entries) {
    if (!entry.isDir && predicate(entry)) return entry;
    if (entry.isDir) {
      const found = findEntry(entry.children, predicate);
      if (found) return found;
    }
  }
  return null;
}

export function App() {
  const initWorkspace = useWorkspaceStore((state) => state.init);
  const info = useWorkspaceStore((state) => state.info);
  const tree = useWorkspaceStore((state) => state.tree);
  const initializing = useWorkspaceStore((state) => state.initializing);
  const workspaceError = useWorkspaceStore((state) => state.error);
  const clearWorkspaceError = useWorkspaceStore((state) => state.clearError);
  const editorError = useEditorStore((state) => state.error);
  const clearEditorError = useEditorStore((state) => state.clearError);
  const notice = useEditorStore((state) => state.notice);
  const clearNotice = useEditorStore((state) => state.clearNotice);
  const refreshAgentStatus = useAgentStore((state) => state.refreshStatus);

  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const booted = useRef(false);
  const openedWorkspace = useRef<string | null>(null);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;

    void initWorkspace();
    void refreshAgentStatus();
    void api
      .appInfo()
      .then((next) => {
        setAppInfo(next);
        document.documentElement.dataset.platform = next.platform;
        document.documentElement.dataset.runtime = api.isTauri ? "tauri" : "browser";
      })
      .catch(() => {
        document.documentElement.dataset.runtime = api.isTauri ? "tauri" : "browser";
      });
  }, [initWorkspace, refreshAgentStatus]);

  useEffect(() => {
    const root = info?.root;
    if (!root || tree.length === 0 || openedWorkspace.current === root) return;
    openedWorkspace.current = root;
    if (useEditorStore.getState().activePath) return;

    const readme =
      tree.find((entry) => !entry.isDir && entry.name.toLowerCase() === "readme.md") ??
      findEntry(tree, (entry) => entry.name.toLowerCase().endsWith(".md")) ??
      findEntry(tree, () => true);

    if (readme && !readme.isDir) {
      void useEditorStore.getState().openFile(readme.path);
    }
  }, [info?.root, tree]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(clearNotice, 6000);
    return () => window.clearTimeout(timer);
  }, [notice, clearNotice]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (mod && key === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
        return;
      }

      if (mod && event.shiftKey && key === "p") {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }

      if (mod && key === "s") {
        event.preventDefault();
        if (event.shiftKey) {
          void useEditorStore.getState().saveAll();
        } else {
          void useEditorStore.getState().saveActive();
        }
        return;
      }

      if (event.key === "Escape") {
        setPaletteOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const error = workspaceError ?? editorError;

  return (
    <div className="app">
      <TopBar onOpenPalette={() => setPaletteOpen(true)} />

      {!api.isTauri && (
        <div className="demo-banner" role="status">
          <Icon name="alert" size={13} />
          <span>
            <strong>ブラウザデモ</strong> — 変更はメモリ上のみで、再読み込みすると失われます。
            LLM と Agent Desktop は動作しません。
          </span>
          <a href="/">LP に戻る</a>
        </div>
      )}

      <div className="workbench">
        <FileTree />
        <main className="main-area">
          {info ? <EditorPane /> : <Welcome />}
        </main>
        <AgentPanel />
      </div>

      <StatusBar appInfo={appInfo} />

      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
      <HistoryDialog />

      {notice && (
        <div className="toast info" role="status">
          <Icon name="alert" size={15} />
          <span>{notice.text}</span>
          <button
            type="button"
            className="icon-btn"
            onClick={clearNotice}
            aria-label="閉じる"
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      )}

      {error && (
        <div className="toast error" role="alert">
          <Icon name="alert" size={15} />
          <span>{error}</span>
          <button
            type="button"
            className="icon-btn"
            onClick={() => {
              clearWorkspaceError();
              clearEditorError();
            }}
            aria-label="閉じる"
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      )}

      {initializing && !info && (
        <div className="boot-hint" aria-live="polite">
          <span className="boot-spinner" />
          ワークスペースを確認しています…
        </div>
      )}
    </div>
  );
}
