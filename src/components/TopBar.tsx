import type { AgentMode } from "../shared/types";
import { api } from "../lib/api";
import { useAgentStore } from "../stores/agentStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { Icon } from "./Icon";

const modeLabels: Record<AgentMode, string> = {
  passive: "Passive",
  assistive: "Assistive",
  autonomous: "Autonomous",
};

const modeOrder: AgentMode[] = ["passive", "assistive", "autonomous"];

export function TopBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const openWorkspace = useWorkspaceStore((state) => state.openWorkspace);
  const mode = useAgentStore((state) => state.mode);
  const setMode = useAgentStore((state) => state.setMode);
  const takeSnapshot = useAgentStore((state) => state.takeSnapshot);
  const busy = useAgentStore((state) => state.busy);
  const status = useAgentStore((state) => state.status);

  const cycleMode = () => {
    const index = modeOrder.indexOf(mode);
    setMode(modeOrder[(index + 1) % modeOrder.length]);
  };

  return (
    <header className="topbar">
      <div className="topbar-brand" data-tauri-drag-region>
        <span className="brand-mark">RS</span>
        <span className="brand-name">
          Right-Stuff <b>Agent IDE</b>
        </span>
      </div>

      <button type="button" className="command-trigger" onClick={onOpenPalette}>
        <Icon name="search" size={13} />
        <span>コマンドを検索</span>
        <kbd>⌘ K</kbd>
      </button>

      <div className="topbar-spacer" data-tauri-drag-region />

      <div className="topbar-actions">
        {!api.isTauri && <span className="demo-pill">DEMO</span>}

        <span
          className={`agent-health${status?.available ? " online" : ""}`}
          title={status?.message ?? "Agent Desktop の状態を確認中"}
        >
          <span className="health-dot" />
          {status?.available ? "Agent ready" : "Agent offline"}
        </span>

        <button
          type="button"
          className={`mode-pill ${mode}`}
          onClick={cycleMode}
          title="クリックでエージェントモードを切り替え"
        >
          <span className="mode-dot" />
          {modeLabels[mode]}
        </button>

        <button
          type="button"
          className={`icon-btn${busy ? " spinning" : ""}`}
          onClick={() => void takeSnapshot()}
          title="スナップショットを取得"
          disabled={busy}
        >
          <Icon name="sparkles" size={16} />
        </button>

        <button
          type="button"
          className="icon-btn"
          onClick={() => void openWorkspace()}
          title="フォルダを開く"
        >
          <Icon name="folder" size={16} />
        </button>
      </div>
    </header>
  );
}
