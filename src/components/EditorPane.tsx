import { Suspense, lazy, useState } from "react";

import Editor from "@monaco-editor/react";

import { defineThemes, monaco, monacoTheme } from "../lib/monaco";
import { isDirty, useEditorStore } from "../stores/editorStore";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";

const MarkdownPreview = lazy(() =>
  import("./MarkdownPreview").then((module) => ({ default: module.MarkdownPreview })),
);

const editorOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
  fontFamily: "'JetBrains Mono', 'SF Mono', Menlo, monospace",
  fontSize: 13,
  lineHeight: 22,
  fontLigatures: true,
  minimap: { enabled: false },
  padding: { top: 14, bottom: 24 },
  smoothScrolling: true,
  cursorBlinking: "smooth",
  cursorSmoothCaretAnimation: "on",
  renderLineHighlight: "all",
  scrollBeyondLastLine: false,
  automaticLayout: true,
  tabSize: 2,
  wordWrap: "off",
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  scrollbar: {
    verticalScrollbarSize: 10,
    horizontalScrollbarSize: 10,
    useShadows: false,
  },
  stickyScroll: { enabled: false },
  guides: { indentation: true, bracketPairs: false },
};

function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

function EmptyEditor() {
  return (
    <div className="editor-empty">
      <div className="editor-empty-mark">⌘</div>
      <h2>ファイルを選択</h2>
      <p>左のファイルツリーから開くか、コマンドパレットから新規ファイルを作成してください。</p>
      <div className="editor-empty-keys">
        <span><kbd>⌘</kbd><kbd>K</kbd> コマンド</span>
        <span><kbd>⌘</kbd><kbd>S</kbd> 保存</span>
        <span><kbd>⌘</kbd><kbd>⇧</kbd><kbd>S</kbd> すべて保存</span>
      </div>
    </div>
  );
}

export function EditorPane() {
  const files = useEditorStore((state) => state.files);
  const order = useEditorStore((state) => state.order);
  const activePath = useEditorStore((state) => state.activePath);
  const preview = useEditorStore((state) => state.preview);
  const saving = useEditorStore((state) => state.saving);
  const setActive = useEditorStore((state) => state.setActive);
  const closeFile = useEditorStore((state) => state.closeFile);
  const updateContent = useEditorStore((state) => state.updateContent);
  const saveFile = useEditorStore((state) => state.saveFile);
  const togglePreview = useEditorStore((state) => state.togglePreview);
  const loadHistory = useEditorStore((state) => state.loadHistory);

  const [pendingClose, setPendingClose] = useState<string | null>(null);

  const requestClose = (path: string) => {
    const target = useEditorStore.getState().files[path];
    if (target && isDirty(target)) {
      setPendingClose(path);
      return;
    }
    closeFile(path);
  };

  const file = activePath ? files[activePath] : undefined;
  const showPreview = Boolean(preview && file?.language === "markdown");
  const segments = activePath?.split("/") ?? [];

  return (
    <section className="editor-area">
      <div className="tabbar" role="tablist">
        <div className="tabbar-tabs">
          {order.map((path) => {
            const item = files[path];
            if (!item) return null;
            const active = activePath === path;
            return (
              <div
                key={path}
                className={`tab${active ? " active" : ""}`}
                onClick={() => setActive(path)}
                role="tab"
                aria-selected={active}
                title={path}
              >
                <span className="tab-name">{baseName(path)}</span>
                {isDirty(item) && <span className="tab-dirty" aria-label="未保存" />}
                <button
                  type="button"
                  className="tab-close"
                  aria-label={`${baseName(path)} を閉じる`}
                  onClick={(event) => {
                    event.stopPropagation();
                    requestClose(path);
                  }}
                >
                  <Icon name="x" size={12} />
                </button>
              </div>
            );
          })}
        </div>
        <div className="tabbar-tools">
          <button
            type="button"
            className="icon-btn"
            title="バージョン履歴"
            disabled={!activePath}
            onClick={() => activePath && void loadHistory(activePath)}
          >
            <Icon name="history" size={15} />
          </button>
          <button
            type="button"
            className={`icon-btn${showPreview ? " active" : ""}`}
            title="Markdown プレビュー"
            disabled={file?.language !== "markdown"}
            onClick={togglePreview}
          >
            <Icon name={showPreview ? "eye-off" : "eye"} size={15} />
          </button>
        </div>
      </div>

      {file ? (
        <>
          <div className="editor-toolbar">
            <div className="breadcrumbs">
              {segments.map((segment, index) => (
                <span key={`${segment}-${index}`} className="breadcrumb">
                  {index > 0 && <span className="breadcrumb-sep">/</span>}
                  <span className={index === segments.length - 1 ? "current" : ""}>
                    {segment}
                  </span>
                </span>
              ))}
            </div>
            <div className="editor-toolbar-actions">
              <span className={`language-badge lang-${file.language}`}>{file.language}</span>
              <span className="save-state">
                {isDirty(file) ? "未保存の変更" : "保存済み"}
              </span>
              <button
                type="button"
                className="btn small"
                disabled={!isDirty(file) || saving}
                onClick={() => void saveFile(file.path)}
              >
                <Icon name="save" size={13} />
                {saving ? "保存中…" : "保存"}
              </button>
            </div>
          </div>

          <div className={`editor-body${showPreview ? " split" : ""}`}>
            <div className="monaco-host">
              <Editor
                path={file.path}
                language={file.language}
                value={file.content}
                theme={monacoTheme}
                beforeMount={defineThemes}
                options={{
                  ...editorOptions,
                  wordWrap: file.language === "markdown" ? "on" : "off",
                }}
                onChange={(value) => updateContent(file.path, value ?? "")}
                loading={<div className="editor-loading">エディタを準備中…</div>}
              />
            </div>
            {showPreview && (
              <div className="preview-pane">
                <Suspense fallback={<div className="editor-loading">プレビューを準備中…</div>}>
                  <MarkdownPreview content={file.content} />
                </Suspense>
              </div>
            )}
          </div>
        </>
      ) : (
        <EmptyEditor />
      )}

      {pendingClose && (
        <ConfirmDialog
          title="未保存の変更"
          message={`${baseName(pendingClose)} には保存されていない変更があります。破棄して閉じますか？`}
          confirmLabel="破棄して閉じる"
          danger
          onCancel={() => setPendingClose(null)}
          onConfirm={() => {
            const path = pendingClose;
            setPendingClose(null);
            closeFile(path, true);
          }}
        />
      )}
    </section>
  );
}
