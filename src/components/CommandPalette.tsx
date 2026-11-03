import { useEffect, useRef, useState } from "react";

import type { AgentMode } from "../shared/types";
import { useAgentStore } from "../stores/agentStore";
import { useEditorStore } from "../stores/editorStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { Icon, type IconName } from "./Icon";
import { PromptDialog } from "./PromptDialog";

interface PaletteCommand {
  id: string;
  label: string;
  hint: string;
  icon: IconName;
  shortcut?: string;
  keywords?: string;
  keepOpen?: boolean;
  run: () => void;
}

const modeOrder: AgentMode[] = ["passive", "assistive", "autonomous"];

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [createParent, setCreateParent] = useState<{ parent: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const openWorkspace = useWorkspaceStore((state) => state.openWorkspace);
  const refresh = useWorkspaceStore((state) => state.refresh);
  const createEntry = useWorkspaceStore((state) => state.createEntry);
  const selectedPath = useWorkspaceStore((state) => state.selectedPath);
  const tree = useWorkspaceStore((state) => state.tree);

  const activePath = useEditorStore((state) => state.activePath);
  const saveActive = useEditorStore((state) => state.saveActive);
  const saveAll = useEditorStore((state) => state.saveAll);
  const closeAllWithConfirmation = useEditorStore(
    (state) => state.closeAllWithConfirmation,
  );
  const togglePreview = useEditorStore((state) => state.togglePreview);
  const loadHistory = useEditorStore((state) => state.loadHistory);

  const mode = useAgentStore((state) => state.mode);
  const setMode = useAgentStore((state) => state.setMode);
  const takeSnapshot = useAgentStore((state) => state.takeSnapshot);
  const refreshStatus = useAgentStore((state) => state.refreshStatus);
  const clearMessages = useAgentStore((state) => state.clearMessages);
  const openSettings = useAgentStore((state) => state.openSettings);
  const setPanelTab = useAgentStore((state) => state.setPanelTab);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const findEntry = (path: string): { isDir: boolean } | undefined => {
    const walk = (entries: typeof tree): { isDir: boolean } | undefined => {
      for (const entry of entries) {
        if (entry.path === path) return entry;
        if (entry.isDir) {
          const found = walk(entry.children);
          if (found) return found;
        }
      }
      return undefined;
    };
    return walk(tree);
  };

  const createFile = () => {
    const entry = selectedPath ? findEntry(selectedPath) : undefined;
    const parent = selectedPath
      ? entry?.isDir
        ? selectedPath
        : selectedPath.split("/").slice(0, -1).join("/")
      : "";
    setCreateParent({ parent });
  };

  const commands: PaletteCommand[] = [
    {
      id: "workspace:open",
      label: "フォルダを開く",
      hint: "ワークスペースを切り替え",
      icon: "folder",
      shortcut: "⌘O",
      keywords: "open workspace folder",
      run: () => void openWorkspace(),
    },
    {
      id: "workspace:refresh",
      label: "ファイルツリーを更新",
      hint: "ディスクの変更を再読み込み",
      icon: "refresh",
      keywords: "refresh reload tree",
      run: () => void refresh(),
    },
    {
      id: "file:new",
      label: "新規ファイル",
      hint: "選択中のフォルダに作成",
      icon: "file-plus",
      keywords: "new create file",
      keepOpen: true,
      run: createFile,
    },
    {
      id: "file:save",
      label: "保存",
      hint: activePath ?? "開いているファイルがありません",
      icon: "save",
      shortcut: "⌘S",
      keywords: "save write",
      run: () => void saveActive(),
    },
    {
      id: "file:save-all",
      label: "すべて保存",
      hint: "未保存のタブをまとめて保存",
      icon: "save",
      shortcut: "⌘⇧S",
      keywords: "save all",
      run: () => void saveAll(),
    },
    {
      id: "editor:close-all",
      label: "すべてのタブを閉じる",
      hint: "未保存の変更は確認します",
      icon: "x",
      keywords: "close all tabs",
      run: () => void closeAllWithConfirmation(),
    },
    {
      id: "editor:preview",
      label: "Markdown プレビュー切替",
      hint: "エディタを分割してプレビュー",
      icon: "eye",
      keywords: "markdown preview split",
      run: togglePreview,
    },
    {
      id: "editor:history",
      label: "バージョン履歴を開く",
      hint: activePath ?? "ファイルを開いてください",
      icon: "history",
      keywords: "history version restore",
      run: () => {
        if (activePath) void loadHistory(activePath);
      },
    },
    {
      id: "agent:snapshot",
      label: "スナップショットを取得",
      hint: "agent-desktop snapshot --json",
      icon: "sparkles",
      keywords: "snapshot agent desktop",
      run: () => void takeSnapshot(),
    },
    {
      id: "agent:status",
      label: "Agent Desktop の状態を確認",
      hint: "CLI の検出状態を再チェック",
      icon: "play",
      keywords: "agent status detect",
      run: () => void refreshStatus(),
    },
    {
      id: "agent:plan",
      label: "計画を立案",
      hint: "LLM に実行計画を作らせる",
      icon: "sparkles",
      keywords: "plan planning steps approve 計画 承認",
      run: () => setPanelTab("plan"),
    },
    {
      id: "agent:audit",
      label: "監査ログを開く",
      hint: "計画の承認と操作の実行履歴",
      icon: "history",
      keywords: "audit log history 監査 履歴",
      run: () => setPanelTab("audit"),
    },
    {
      id: "agent:settings",
      label: "設定を開く",
      hint: "プロバイダー・モデル・API キー",
      icon: "gear",
      keywords: "llm openai ollama model api key settings",
      run: openSettings,
    },
    {
      id: "agent:mode",
      label: "エージェントモードを切り替え",
      hint: `現在: ${mode}`,
      icon: "gear",
      keywords: "mode passive assistive autonomous",
      run: () => {
        const current = modeOrder.indexOf(mode);
        setMode(modeOrder[(current + 1) % modeOrder.length]);
      },
    },
    {
      id: "agent:clear",
      label: "チャットをクリア",
      hint: "会話履歴を消去",
      icon: "x",
      keywords: "clear chat messages",
      run: clearMessages,
    },
  ];

  const normalized = query.trim().toLowerCase();
  const filtered = commands.filter((command) => {
    if (!normalized) return true;
    return `${command.label} ${command.hint} ${command.keywords ?? ""}`
      .toLowerCase()
      .includes(normalized);
  });

  useEffect(() => {
    setIndex(0);
  }, [query]);

  const execute = (command: PaletteCommand) => {
    if (!command.keepOpen) onClose();
    command.run();
  };

  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={onClose}>
      <div
        className="command-palette"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="コマンドパレット"
      >
        <div className="palette-input">
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            value={query}
            placeholder="コマンドを検索…"
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
                const command = filtered[index];
                if (command) execute(command);
              }
            }}
          />
          <kbd>ESC</kbd>
        </div>

        <div className="palette-list">
          {filtered.length === 0 && (
            <div className="palette-empty">一致するコマンドがありません</div>
          )}
          {filtered.map((command, itemIndex) => (
            <button
              type="button"
              key={command.id}
              className={`palette-item${itemIndex === index ? " active" : ""}`}
              onMouseEnter={() => setIndex(itemIndex)}
              onClick={() => execute(command)}
            >
              <span className="palette-icon">
                <Icon name={command.icon} size={15} />
              </span>
              <span className="palette-copy">
                <span className="palette-label">{command.label}</span>
                <span className="palette-hint">{command.hint}</span>
              </span>
              {command.shortcut && <kbd>{command.shortcut}</kbd>}
            </button>
          ))}
        </div>
      </div>

      {createParent && (
        <div onMouseDown={(event) => event.stopPropagation()}>
          <PromptDialog
            title="新規ファイル"
            label={
              createParent.parent
                ? `作成先: ${createParent.parent}/`
                : "作成先: ワークスペース直下"
            }
            initialValue="untitled.md"
            placeholder="example.ts"
            onCancel={() => setCreateParent(null)}
            onSubmit={(value) => {
              const parent = createParent.parent;
              setCreateParent(null);
              onClose();
              void createEntry(parent, value, false);
            }}
          />
        </div>
      )}
    </div>
  );
}
