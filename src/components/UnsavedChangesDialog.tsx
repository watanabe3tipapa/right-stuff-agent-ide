import { useEffect } from "react";

import { isDirty, useEditorStore } from "../stores/editorStore";

/** Keep the dialog compact even when many tabs are dirty. */
const MAX_LISTED_FILES = 6;

/**
 * Three-way confirmation shown before an action that would discard unsaved
 * tabs (switching workspace, closing all tabs). The store owns the pending
 * promise so the caller can wait for the user's decision.
 */
export function UnsavedChangesDialog() {
  const prompt = useEditorStore((state) => state.unsavedPrompt);
  const files = useEditorStore((state) => state.files);
  const order = useEditorStore((state) => state.order);
  const resolve = useEditorStore((state) => state.resolveUnsavedDecision);

  useEffect(() => {
    if (!prompt) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        resolve("cancel");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [prompt, resolve]);

  if (!prompt) return null;

  const dirty = order.filter((path) => {
    const file = files[path];
    return file ? isDirty(file) : false;
  });
  const visible = dirty.slice(0, MAX_LISTED_FILES);
  const remaining = dirty.length - visible.length;

  return (
    <div className="modal-backdrop" onMouseDown={() => resolve("cancel")}>
      <div
        className="modal confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={prompt.title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <h3>{prompt.title}</h3>
        </div>
        <p className="confirm-message">{prompt.message}</p>

        {dirty.length > 0 && (
          <ul className="unsaved-list">
            {visible.map((path) => (
              <li key={path}>
                <code>{path}</code>
              </li>
            ))}
            {remaining > 0 && <li className="unsaved-more">ほか {remaining} 件</li>}
          </ul>
        )}

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={() => resolve("cancel")}>
            キャンセル
          </button>
          <button type="button" className="btn danger" onClick={() => resolve("discard")}>
            保存せず続行
          </button>
          <button type="button" className="btn primary" onClick={() => resolve("save")} autoFocus>
            保存して続行
          </button>
        </div>
      </div>
    </div>
  );
}
