import type { AgentMode, AppInfo } from "../shared/types";
import { isDirty, useEditorStore } from "../stores/editorStore";
import { useAgentStore } from "../stores/agentStore";
import { useGitStore } from "../stores/gitStore";
import { lspSummary, useLspStore } from "../stores/lspStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { Icon } from "./Icon";

const modeOrder: AgentMode[] = ["passive", "assistive", "autonomous"];

const modeLabels: Record<AgentMode, string> = {
  passive: "Passive",
  assistive: "Assistive",
  autonomous: "Autonomous",
};

export function StatusBar({ appInfo }: { appInfo: AppInfo | null }) {
  const info = useWorkspaceStore((state) => state.info);
  const selectedPath = useWorkspaceStore((state) => state.selectedPath);
  const files = useEditorStore((state) => state.files);
  const order = useEditorStore((state) => state.order);
  const activePath = useEditorStore((state) => state.activePath);
  const saving = useEditorStore((state) => state.saving);
  const mode = useAgentStore((state) => state.mode);
  const setMode = useAgentStore((state) => state.setMode);
  const status = useAgentStore((state) => state.status);
  const setPanelTab = useAgentStore((state) => state.setPanelTab);
  const gitStatus = useGitStore((state) => state.status);
  const lspStatuses = useLspStore((state) => state.statuses);

  const dirtyCount = order.filter((path) => {
    const file = files[path];
    return file ? isDirty(file) : false;
  }).length;

  const activeFile = activePath ? files[activePath] : undefined;
  const activeLsp = activeFile ? lspStatuses[activeFile.language] : undefined;
  const lsp = lspSummary(lspStatuses);
  const lspLabel = activeLsp
    ? activeLsp.status === "ready"
      ? activeLsp.label
      : activeLsp.status === "starting"
        ? `${activeLsp.label} 起動中`
        : activeLsp.status === "unsupported"
          ? "LSP なし"
          : "LSP エラー"
    : lsp.ready > 0
      ? `LSP ${lsp.ready}`
      : null;

  const cycleMode = () => {
    const index = modeOrder.indexOf(mode);
    setMode(modeOrder[(index + 1) % modeOrder.length]);
  };

  return (
    <footer className="statusbar">
      <div className="status-left">
        <button
          type="button"
          className="status-item status-branch"
          onClick={() => setPanelTab("git")}
          title="Git パネルを開く"
        >
          <Icon name="branch" size={12} /> {gitStatus?.branch ?? "no git"}
        </button>
        {info && <span className="status-item status-workspace">{info.name}</span>}
        {(activePath || selectedPath) && (
          <span className="status-item status-path" title={activePath ?? selectedPath ?? ""}>
            {activePath ?? selectedPath}
          </span>
        )}
        {saving && <span className="status-item status-saving">保存中…</span>}
      </div>

      <div className="status-right">
        {dirtyCount > 0 && (
          <span className="status-item status-dirty">{dirtyCount} 未保存</span>
        )}
        <span className="status-item">{activeFile?.language ?? "—"}</span>
        {lspLabel && (
          <span
            className={`status-item status-lsp ${activeLsp?.status ?? "ready"}`}
            title={activeLsp?.message ?? "Language Server"}
          >
            <span className="health-dot" />
            {lspLabel}
            {lsp.diagnostics > 0 && (
              <span className="status-lsp-count">{lsp.diagnostics}</span>
            )}
          </span>
        )}
        <span className="status-item">UTF-8</span>
        <span
          className={`status-item status-agent${status?.available ? " online" : ""}`}
          title={status?.message}
        >
          <span className="health-dot" />
          {status?.available ? "agent" : "agent off"}
        </span>
        <button
          type="button"
          className={`status-mode ${mode}`}
          onClick={cycleMode}
          title="エージェントモードを切り替え"
        >
          <span className="mode-dot" />
          {modeLabels[mode]}
        </button>
        <span className="status-item status-version">
          v{appInfo?.version ?? "0.3.1"}
        </span>
      </div>
    </footer>
  );
}
