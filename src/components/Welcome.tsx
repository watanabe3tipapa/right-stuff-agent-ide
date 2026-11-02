import { useWorkspaceStore } from "../stores/workspaceStore";
import { Icon } from "./Icon";

export function Welcome() {
  const openWorkspace = useWorkspaceStore((state) => state.openWorkspace);
  const loading = useWorkspaceStore((state) => state.loading);
  const initializing = useWorkspaceStore((state) => state.initializing);

  return (
    <div className="welcome">
      <div className="welcome-glow" />
      <div className="welcome-inner">
        <span className="welcome-kicker">RIGHT-STUFF × AGENT DESKTOP</span>
        <h1>
          書く、動かす、確かめる。
          <br />
          <span className="welcome-accent">ひとつのワークベンチで。</span>
        </h1>
        <p className="welcome-lead">
          Right-Stuff Editor の執筆体験と、Agent Desktop の OS レベル操作能力を統合。
          エージェントが UI を直接扱い、ファイル・ターミナル・外部アプリを横断します。
        </p>

        <div className="welcome-actions">
          <button
            type="button"
            className="btn primary lg"
            onClick={() => void openWorkspace()}
            disabled={loading}
          >
            <Icon name="folder" size={16} />
            {loading ? "読み込み中…" : "フォルダを開く"}
          </button>
          <span className="welcome-hint">
            {initializing
              ? "前回のワークスペースを確認しています…"
              : "Markdown もコードも、同じワークスペースから。"}
          </span>
        </div>

        <div className="welcome-grid">
          <article className="welcome-card">
            <div className="welcome-card-icon"><Icon name="pencil" size={16} /></div>
            <h2>執筆体験</h2>
            <p>Markdown をそのまま書き、プレビューし、バージョン履歴から復元。</p>
            <span className="welcome-tag">Phase 0</span>
          </article>
          <article className="welcome-card">
            <div className="welcome-card-icon green"><Icon name="sparkles" size={16} /></div>
            <h2>エージェント操作</h2>
            <p>snapshot → action → verify のループで、操作を検証しながら進める。</p>
            <span className="welcome-tag">Phase 1</span>
          </article>
          <article className="welcome-card">
            <div className="welcome-card-icon amber"><Icon name="terminal" size={16} /></div>
            <h2>IDE 機能</h2>
            <p>Monaco、ターミナル、Git、LSP を段階的に統合していく。</p>
            <span className="welcome-tag">Phase 2</span>
          </article>
        </div>

        <div className="welcome-keys">
          <span><kbd>⌘</kbd><kbd>K</kbd> コマンド</span>
          <span><kbd>⌘</kbd><kbd>S</kbd> 保存</span>
          <span><kbd>⌘</kbd><kbd>⇧</kbd><kbd>S</kbd> すべて保存</span>
        </div>
      </div>
    </div>
  );
}
