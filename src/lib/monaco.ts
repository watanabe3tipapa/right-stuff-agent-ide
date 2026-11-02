import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";

import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

type WorkerConstructor = new () => Worker;

const workerMap: Record<string, WorkerConstructor> = {
  json: jsonWorker,
  css: cssWorker,
  scss: cssWorker,
  less: cssWorker,
  html: htmlWorker,
  handlebars: htmlWorker,
  razor: htmlWorker,
  typescript: tsWorker,
  javascript: tsWorker,
};

(globalThis as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker(_moduleId: string, label: string): Worker {
    const WorkerClass = workerMap[label] ?? editorWorker;
    return new WorkerClass();
  },
};

loader.config({ monaco });

export const monacoTheme = "rsai-dark";

export function defineThemes(instance: typeof monaco) {
  instance.editor.defineTheme(monacoTheme, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "8b949e", fontStyle: "italic" },
      { token: "keyword", foreground: "ff7b72" },
      { token: "string", foreground: "a5d6ff" },
      { token: "number", foreground: "79c0ff" },
      { token: "type", foreground: "ffa657" },
      { token: "function", foreground: "d2a8ff" },
      { token: "variable", foreground: "e6edf3" },
      { token: "constant", foreground: "79c0ff" },
      { token: "tag", foreground: "7ee787" },
      { token: "attribute.name", foreground: "79c0ff" },
      { token: "delimiter", foreground: "c9d1d9" },
    ],
    colors: {
      "editor.background": "#0d1117",
      "editor.foreground": "#e6edf3",
      "editor.lineHighlightBackground": "#161b22",
      "editor.selectionBackground": "#264f78",
      "editor.inactiveSelectionBackground": "#1f3a57",
      "editorCursor.foreground": "#58a6ff",
      "editorLineNumber.foreground": "#484f58",
      "editorLineNumber.activeForeground": "#8b949e",
      "editorIndentGuide.background1": "#21262d",
      "editorIndentGuide.activeBackground1": "#30363d",
      "editorWidget.background": "#161b22",
      "editorWidget.border": "#30363d",
      "editorSuggestWidget.background": "#161b22",
      "editorSuggestWidget.selectedBackground": "#1f6feb33",
      "editorGutter.background": "#0d1117",
      "scrollbarSlider.background": "#484f5866",
      "scrollbarSlider.hoverBackground": "#8b949e66",
      "minimap.background": "#0d1117",
    },
  });
}

export { monaco };
