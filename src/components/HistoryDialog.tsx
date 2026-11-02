import { useEffect, useState } from "react";

import type { VersionContent } from "../shared/types";
import { api, errorMessage } from "../lib/api";
import { useEditorStore } from "../stores/editorStore";
import { Icon } from "./Icon";

function formatDate(value: number): string {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function HistoryDialog() {
  const historyPath = useEditorStore((state) => state.historyPath);
  const history = useEditorStore((state) => state.history);
  const historyLoading = useEditorStore((state) => state.historyLoading);
  const closeHistory = useEditorStore((state) => state.closeHistory);
  const updateContent = useEditorStore((state) => state.updateContent);

  const [selected, setSelected] = useState<VersionContent | null>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelected(null);
    setError(null);
  }, [historyPath]);

  useEffect(() => {
    if (!historyPath) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeHistory();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [historyPath, closeHistory]);

  useEffect(() => {
    if (!historyPath || history.length === 0) return;
    let cancelled = false;
    const latest = history[0];

    setLoadingId(latest.id);
    setError(null);
    api
      .version(latest.id)
      .then((version) => {
        if (!cancelled) setSelected(version);
      })
      .catch((caught) => {
        if (!cancelled) setError(errorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setLoadingId(null);
      });

    return () => {
      cancelled = true;
    };
  }, [historyPath, history]);

  if (!historyPath) return null;

  const preview = async (id: number) => {
    setLoadingId(id);
    setError(null);
    try {
      const version = await api.version(id);
      setSelected(version);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={closeHistory}>
      <div
        className="modal history-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="バージョン履歴"
      >
        <div className="modal-head">
          <div>
            <h3>バージョン履歴</h3>
            <p className="modal-sub">{historyPath}</p>
          </div>
          <button type="button" className="icon-btn" onClick={closeHistory} aria-label="閉じる">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="history-body">
          <div className="history-list">
            {historyLoading && <div className="history-empty">読み込み中…</div>}
            {!historyLoading && history.length === 0 && (
              <div className="history-empty">
                まだ履歴がありません。保存するとここに版が記録されます。
              </div>
            )}
            {history.map((version) => (
              <button
                type="button"
                key={version.id}
                className={`history-item${selected?.id === version.id ? " active" : ""}`}
                onClick={() => void preview(version.id)}
              >
                <span className="history-date">{formatDate(version.createdAt)}</span>
                <span className="history-meta">
                  #{version.id} · {formatSize(version.size)}
                </span>
                {loadingId === version.id && <span className="history-loading" />}
              </button>
            ))}
          </div>

          <div className="history-preview">
            {error && <div className="history-error">{error}</div>}
            {!selected && !error && (
              <div className="history-empty">
                左の版を選択すると内容をプレビューできます。
              </div>
            )}
            {selected && (
              <>
                <div className="history-preview-head">
                  <span>{formatDate(selected.createdAt)} の版</span>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => {
                      updateContent(historyPath, selected.content);
                      closeHistory();
                    }}
                  >
                    この版を復元
                  </button>
                </div>
                <pre className="history-code">{selected.content || "(空のファイル)"}</pre>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
