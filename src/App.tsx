import { Suspense, lazy, useEffect, useRef, useState } from "react";

import type { AgentPanelTab, AppInfo, FileEntry } from "./shared/types";
import { api, errorMessage } from "./lib/api";
import { initDap } from "./lib/dap";
import { disposeLsp, initLsp, syncLspFiles } from "./lib/lsp";
import { useAgentStore } from "./stores/agentStore";
import { confirmUnsavedChanges, useEditorStore } from "./stores/editorStore";
import { useGitStore } from "./stores/gitStore";
import { useWorkspaceStore } from "./stores/workspaceStore";
import { AgentPanel } from "./components/AgentPanel";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { FileTree } from "./components/FileTree";
import { Icon } from "./components/Icon";
import { StatusBar } from "./components/StatusBar";
import { TopBar } from "./components/TopBar";
import { UnsavedChangesDialog } from "./components/UnsavedChangesDialog";
import { Welcome } from "./components/Welcome";

// Monaco, xterm and the Markdown renderer dominate the bundle. They are only
// needed once the user opens a file, the terminal or a preview, so keep them
// out of the startup payload.
const EditorPane = lazy(() =>
  import("./components/EditorPane").then((module) => ({ default: module.EditorPane })),
);
const TerminalDock = lazy(() =>
  import("./components/TerminalDock").then((module) => ({ default: module.TerminalDock })),
);
const CommandPalette = lazy(() =>
  import("./components/CommandPalette").then((module) => ({ default: module.CommandPalette })),
);
const QuickOpen = lazy(() =>
  import("./components/QuickOpen").then((module) => ({ default: module.QuickOpen })),
);
const SymbolSearch = lazy(() =>
  import("./components/SymbolSearch").then((module) => ({
    default: module.SymbolSearch,
  })),
);
const HistoryDialog = lazy(() =>
  import("./components/HistoryDialog").then((module) => ({ default: module.HistoryDialog })),
);
const SettingsDialog = lazy(() =>
  import("./components/SettingsDialog").then((module) => ({ default: module.SettingsDialog })),
);

function PanelFallback({ label }: { label: string }) {
  return (
    <div className="panel-fallback" role="status" aria-live="polite">
      <span className="boot-spinner" />
      {label}
    </div>
  );
}

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
  const historyPath = useEditorStore((state) => state.historyPath);
  const settingsOpen = useAgentStore((state) => state.settingsOpen);
  const refreshAgentStatus = useAgentStore((state) => state.refreshStatus);
  const refreshLlm = useAgentStore((state) => state.refreshLlm);
  const refreshPolicy = useAgentStore((state) => state.refreshPolicy);
  const refreshGit = useGitStore((state) => state.refresh);

  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [symbolOpen, setSymbolOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [storageWarning, setStorageWarning] = useState(false);
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
    if (api.isTauri) {
      void initLsp();
      void initDap();
    }
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
    if (api.isTauri) return;

    const params = new URLSearchParams(window.location.search);
    if (params.get("shot") === "1") {
      document.documentElement.dataset.shot = "true";
    }

    const requestedTab = params.get("tab");
    const tabs: AgentPanelTab[] = [
      "chat",
      "plan",
      "skills",
      "git",
      "debug",
      "deploy",
      "audit",
      "runtime",
    ];
    if (requestedTab && tabs.includes(requestedTab as AgentPanelTab)) {
      useAgentStore.getState().setPanelTab(requestedTab as AgentPanelTab);
    }

    const status = api.demoStorageStatus();
    if (status && !status.available) setStorageWarning(true);

    const onStorageError = () => setStorageWarning(true);
    window.addEventListener("rsai:demo-storage-error", onStorageError);
    return () => window.removeEventListener("rsai:demo-storage-error", onStorageError);
  }, []);

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

    const params = new URLSearchParams(window.location.search);
    const requested = params.get("file");
    const requestedEntry = requested
      ? findEntry(tree, (entry) => entry.path === requested)
      : null;
    const readme =
      requestedEntry && !requestedEntry.isDir
        ? requestedEntry
        : tree.find((entry) => !entry.isDir && entry.name.toLowerCase() === "readme.md") ??
          findEntry(tree, (entry) => entry.name.toLowerCase().endsWith(".md")) ??
          findEntry(tree, () => true);

    if (readme && !readme.isDir) {
      void useEditorStore
        .getState()
        .openFile(readme.path)
        .then(() => {
          if (params.get("preview") === "1" && !useEditorStore.getState().preview) {
            useEditorStore.getState().togglePreview();
          }
        });
    }
  }, [info?.root, tree]);

  useEffect(() => {
    if (!info?.root) return;
    void refreshGit();
  }, [info?.root, refreshGit]);

  useEffect(() => {
    if (!api.isTauri) return;
    return () => {
      void disposeLsp();
    };
  }, []);

  useEffect(() => {
    if (!api.isTauri) return;
    const root = info?.root ?? null;
    void syncLspFiles(root, useEditorStore.getState().files);
    return useEditorStore.subscribe((state, previous) => {
      if (state.files !== previous.files) {
        void syncLspFiles(root, state.files);
      }
    });
  }, [info?.root]);

  useEffect(() => {
    const openQuick = () => setQuickOpen(true);
    const openSymbols = () => setSymbolOpen(true);
    const toggleTerminal = () => setTerminalOpen((value) => !value);
    window.addEventListener("rsai:quick-open", openQuick);
    window.addEventListener("rsai:symbol-search", openSymbols);
    window.addEventListener("rsai:toggle-terminal", toggleTerminal);
    return () => {
      window.removeEventListener("rsai:quick-open", openQuick);
      window.removeEventListener("rsai:symbol-search", openSymbols);
      window.removeEventListener("rsai:toggle-terminal", toggleTerminal);
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(clearNotice, 6000);
    return () => window.clearTimeout(timer);
  }, [notice, clearNotice]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // macOS-only app: Command is the global modifier. Ctrl stays available
      // to the terminal and text fields.
      const mod = event.metaKey;
      const key = event.key.toLowerCase();

      if (mod && key === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
        return;
      }

      if (mod && key === "p") {
        event.preventDefault();
        if (event.shiftKey) {
          setPaletteOpen(true);
        } else {
          setQuickOpen((value) => !value);
        }
        return;
      }

      if (mod && key === "t") {
        event.preventDefault();
        setSymbolOpen((value) => !value);
        return;
      }

      if (mod && key === "j") {
        event.preventDefault();
        setTerminalOpen((value) => !value);
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
        setQuickOpen(false);
        setSymbolOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const error = workspaceError ?? editorError;

  const resetDemo = async () => {
    setResetConfirm(false);
    try {
      await api.demoReset();
      useEditorStore.getState().closeAll();
      await useWorkspaceStore.getState().refresh();
      await useAgentStore.getState().refreshSkills();
      await useAgentStore.getState().refreshSkillPolicy();
      setStorageWarning(false);
    } catch (resetError) {
      useEditorStore.setState({ error: errorMessage(resetError) });
    }
  };

  return (
    <div className="app">
      <TopBar onOpenPalette={() => setPaletteOpen(true)} />

      {!api.isTauri && (
        <div className={`demo-banner${storageWarning ? " warn" : ""}`} role="status">
          <Icon name="alert" size={13} />
          <span>
            <strong>ブラウザプレビュー</strong> —{" "}
            {storageWarning
              ? "このブラウザに保存できません。変更は再読み込みで失われます。"
              : "変更はこのブラウザに保存されます（サーバーには送信されません）。"}{" "}
            LLM・OS 操作・Git・ターミナルは Tauri 版のみです。
          </span>
          <button type="button" className="demo-reset" onClick={() => setResetConfirm(true)}>
            初期状態に戻す
          </button>
          <a href="/">LP に戻る</a>
        </div>
      )}

      <div className="workbench">
        <FileTree />
        <main className="main-area">
          {info ? (
            <Suspense fallback={<PanelFallback label="エディタを準備しています…" />}>
              <EditorPane />
            </Suspense>
          ) : (
            <Welcome />
          )}
          {terminalOpen && (
            <Suspense
              fallback={
                <div className="terminal-dock">
                  <PanelFallback label="ターミナルを準備しています…" />
                </div>
              }
            >
              <TerminalDock open onClose={() => setTerminalOpen(false)} />
            </Suspense>
          )}
        </main>
        <AgentPanel />
      </div>

      <StatusBar appInfo={appInfo} />

      {paletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette onClose={() => setPaletteOpen(false)} />
        </Suspense>
      )}
      {quickOpen && (
        <Suspense fallback={null}>
          <QuickOpen onClose={() => setQuickOpen(false)} />
        </Suspense>
      )}
      {symbolOpen && (
        <Suspense fallback={null}>
          <SymbolSearch onClose={() => setSymbolOpen(false)} />
        </Suspense>
      )}
      {historyPath && (
        <Suspense fallback={null}>
          <HistoryDialog />
        </Suspense>
      )}
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsDialog />
        </Suspense>
      )}
      <UnsavedChangesDialog />

      {resetConfirm && (
        <ConfirmDialog
          title="デモを初期状態に戻す"
          message="このブラウザに保存したファイル、編集履歴、スキルポリシーを削除して初期状態に戻します。この操作は取り消せません。"
          confirmLabel="初期状態に戻す"
          danger
          onCancel={() => setResetConfirm(false)}
          onConfirm={() => void resetDemo()}
        />
      )}

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
