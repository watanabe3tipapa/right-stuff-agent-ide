import { useEffect } from "react";

import { api } from "../lib/api";
import { initDap, refreshDapAdapters } from "../lib/dap";
import { useDapStore } from "../stores/dapStore";
import { useLspStore } from "../stores/lspStore";
import { Icon } from "./Icon";

export function ToolsSettings() {
  const servers = useLspStore((state) => state.servers);
  const serversLoaded = useLspStore((state) => state.serversLoaded);
  const adapters = useDapStore((state) => state.adapters);
  const adaptersLoaded = useDapStore((state) => state.adaptersLoaded);

  useEffect(() => {
    void useLspStore.getState().refreshServers();
    void initDap().then(() => refreshDapAdapters());
  }, []);

  const refresh = () => {
    void useLspStore.getState().refreshServers();
    void refreshDapAdapters();
  };

  // The registry repeats one server per language; group them for display.
  const serverGroups = servers.reduce<
    Array<{ label: string; available: boolean; command: string[]; install: string; languages: string[] }>
  >((groups, server) => {
    const existing = groups.find((group) => group.label === server.label);
    if (existing) {
      existing.languages.push(server.language);
      return groups;
    }
    groups.push({
      label: server.label,
      available: server.available,
      command: server.command,
      install: server.install,
      languages: [server.language],
    });
    return groups;
  }, []);

  return (
    <div className="settings-body">
      <div className="settings-section-head">
        <div>
          <h4>ツール</h4>
          <p>
            言語サーバーとデバッグアダプターは固定レジストリから検出します。任意のコマンドを
            実行することはできません。検出と起動は macOS 上で完結します。
          </p>
        </div>
        <button type="button" className="btn small" onClick={refresh}>
          <Icon name="refresh" size={12} />
          再検出
        </button>
      </div>

      <h5 className="tools-heading">Language Server</h5>
      {!serversLoaded && <p className="field-help">検出中…</p>}
      {serversLoaded && serverGroups.length === 0 && (
        <p className="field-help">利用できる言語サーバーはありません。</p>
      )}
      <ul className="tools-list">
        {serverGroups.map((server) => (
          <li key={server.label} className="tools-row">
            <div className="tools-row-main">
              <span className={`tools-dot${server.available ? " on" : ""}`} />
              <div>
                <strong>{server.label}</strong>
                <span className="tools-langs">{server.languages.join(" / ")}</span>
              </div>
            </div>
            <div className="tools-row-side">
              {server.available ? (
                <>
                  <span className="tools-badge ok">検出済み</span>
                  <code className="tools-command">{server.command.join(" ")}</code>
                </>
              ) : (
                <>
                  <span className="tools-badge">未導入</span>
                  <code className="tools-command">{server.install}</code>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      <h5 className="tools-heading">デバッグアダプター</h5>
      {!adaptersLoaded && <p className="field-help">検出中…</p>}
      <ul className="tools-list">
        {adapters.map((adapter) => (
          <li key={adapter.id} className="tools-row">
            <div className="tools-row-main">
              <span className={`tools-dot${adapter.available ? " on" : ""}`} />
              <div>
                <strong>{adapter.label}</strong>
                <span className="tools-langs">{adapter.languages.join(" / ")}</span>
              </div>
            </div>
            <div className="tools-row-side">
              {adapter.available ? (
                <>
                  <span className="tools-badge ok">検出済み</span>
                  <code className="tools-command">{adapter.command.join(" ")}</code>
                </>
              ) : (
                <>
                  <span className="tools-badge">未導入</span>
                  <code className="tools-command">{adapter.install}</code>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      {!api.isTauri && (
        <div className="dialog-note warn" role="note">
          ブラウザデモではツール検出を実行できません。
        </div>
      )}
    </div>
  );
}
