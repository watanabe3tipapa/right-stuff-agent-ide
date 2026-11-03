import { useEffect, useRef, useState } from "react";

import type { AppInfo, FileEntry } from "./shared/types";
import { api, errorMessage } from "./lib/api";
import { useAgentStore } from "./stores/agentStore";
import { confirmUnsavedChanges, useEditorStore } from "./stores/editorStore";
import { useWorkspaceStore } from "./stores/workspaceStore";
import { AgentPanel } from "./components/AgentPanel";
import { CommandPalette } from "./components/CommandPalette";
import { EditorPane } from "./components/EditorPane";
import { FileTree } from "./components/FileTree";
import { HistoryDialog } from "./components/HistoryDialog";
import { Icon } from "./components/Icon";
import { SettingsDialog } from "./components/SettingsDialog";
import { StatusBar } from "./components/StatusBar";
import { TopBar } from "./components/TopBar";
import { UnsavedChangesDialog } from "./components/UnsavedChangesDialog";
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
  const refreshLlm = useAgentStore((state) => state.refreshLlm);
  const refreshPolicy = useAgentStore((state) => state.refreshPolicy);

  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const booted = useRef(false);
  const openedWorkspace = useRef<string | null>(null);
  const quitting = useRef(false);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;

    void initWorkspace();
    void refreshAgentStatus();
    void refreshLlm();
    void refreshPolicy();
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
  }, [initWorkspace, refreshAgentStatus, refreshLlm, refreshPolicy]);

  useEffect(() => {
    if (!api.isTauri) return;

    let disposed = false;
    const unlisteners: Array<() => void> = [];

    const register = (registration: Promise<() => void>) => {
      void registration
        .then((unlisten) => {
          if (disposed) {
            unlisten();
          } else {
            unlisteners.push(unlisten);
          }
        })
        .catch((error) => {
          useEditorStore.setState({ error: errorMessage(error) });
        });
    };

    const requestQuit = async () => {
      if (quitting.current) return;
      quitting.current = true;
      try {
        const allowed = await confirmUnsavedChanges({
          title: "アプリを終了する",
          message:
            "未保存の変更があります。保存してから終了するか、変更を破棄してください。",
        });
        if (!allowed) return;
        await api.quit();
      } catch (error) {
        useEditorStore.setState({ error: errorMessage(error) });
      } finally {
        quitting.current = false;
      }
    };

    register(
      api.onCloseRequested(async (event) => {
        // Always cancel the native close first. The app exits through
        // `api.quit()` only after the unsaved-changes dialog is resolved.
        event.preventDefault();
        await requestQuit();
      }),
    );

    register(
      api.onQuitRequested(() => {
        void requestQuit();
      }),
    );

    return () => {
      disposed = true;
      for (const unlisten of unlisteners) unlisten();
    };
  }, []);

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
      <SettingsDialog />
      <UnsavedChangesDialog />

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
