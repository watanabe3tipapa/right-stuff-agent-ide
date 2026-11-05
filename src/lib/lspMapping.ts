/**
 * Pure conversions between LSP payloads and Monaco's shapes. Monaco is not
 * imported here so these functions can be unit tested without a DOM.
 */

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface MonacoRangeLike {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export interface MarkerLike {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  severity: number;
  message: string;
  source: string;
  code?: string;
}

export interface LocationTarget {
  uri: string;
  range: LspRange;
}

export interface MonacoCompletionLike {
  label: string;
  kind: number;
  detail?: string;
  documentation?: { value: string };
  insertText: string;
  range: MonacoRangeLike;
  insertTextRules?: number;
  sortText?: string;
  filterText?: string;
  additionalTextEdits?: Array<{ range: MonacoRangeLike; text: string }>;
}

/** LSP `DiagnosticSeverity` values mapped to Monaco `MarkerSeverity` values. */
const SEVERITY: Record<number, number> = {
  1: 8, // Error
  2: 4, // Warning
  3: 2, // Information
  4: 1, // Hint
};

/** LSP `CompletionItemKind` values mapped to Monaco `CompletionItemKind`. */
const COMPLETION_KIND: Record<number, number> = {
  1: 0, // Text
  2: 1, // Method
  3: 2, // Function
  4: 3, // Constructor
  5: 4, // Field
  6: 5, // Variable
  7: 6, // Class
  8: 8, // Interface
  9: 9, // Module
  10: 10, // Property
  11: 13, // Unit
  12: 14, // Value
  13: 16, // Enum
  14: 18, // Keyword
  15: 19, // Snippet
  16: 20, // Color
  17: 21, // File
  18: 22, // Reference
  19: 23, // Folder
  20: 17, // EnumMember
  21: 15, // Constant
  22: 7, // Struct
  23: 11, // Event
  24: 12, // Operator
  25: 24, // TypeParameter
};

export function toLspPosition(lineNumber: number, column: number): LspPosition {
  return { line: Math.max(0, lineNumber - 1), character: Math.max(0, column - 1) };
}

export function toMonacoRange(range: LspRange): MonacoRangeLike {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  };
}

export function toMonacoSeverity(severity: number | undefined): number {
  return SEVERITY[severity ?? 3] ?? 2;
}

export function completionKind(kind: number | undefined): number {
  return COMPLETION_KIND[kind ?? 1] ?? 0;
}

/** Build a `file://` URI, encoding each path segment so spaces and `#` survive. */
export function fileUri(root: string, relativePath: string): string {
  const absolute = `${root.replace(/\/+$/, "")}/${relativePath.replace(/^\/+/, "")}`;
  const encoded = absolute
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `file://${encoded}`;
}

/** Convert a `file://` URI back to a workspace-relative path, or null. */
export function relativeFromUri(root: string, uri: string): string | null {
  if (!uri.startsWith("file://")) return null;
  let path: string;
  try {
    path = decodeURIComponent(uri.slice("file://".length));
  } catch {
    return null;
  }
  const normalizedRoot = root.replace(/\/+$/, "");
  if (path === normalizedRoot) return "";
  if (!path.startsWith(`${normalizedRoot}/`)) return null;
  return path.slice(normalizedRoot.length + 1);
}

export function diagnosticsToMarkers(
  params: { uri?: string; diagnostics?: unknown[] },
  label = "lsp",
): MarkerLike[] {
  if (!params.uri) return [];
  const diagnostics = Array.isArray(params.diagnostics) ? params.diagnostics : [];
  return diagnostics.map((raw) => {
    const diagnostic = raw as {
      range?: LspRange;
      severity?: number;
      message?: string;
      source?: string;
      code?: string | number;
    };
    const range = diagnostic.range ?? {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    };
    return {
      ...toMonacoRange(range),
      severity: toMonacoSeverity(diagnostic.severity),
      message: diagnostic.message ?? "",
      source: diagnostic.source ?? label,
      ...(diagnostic.code !== undefined ? { code: String(diagnostic.code) } : {}),
    };
  });
}

function documentationText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((entry) =>
        typeof entry === "string" ? entry : (entry as { value?: string })?.value ?? "",
      )
      .filter(Boolean)
      .join("\n\n");
  }
  if (value && typeof value === "object" && "value" in value) {
    return String((value as { value: unknown }).value ?? "");
  }
  return undefined;
}

export function hoverToMarkdown(contents: unknown): string {
  if (Array.isArray(contents)) {
    return contents
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object" && "language" in entry) {
          const code = entry as { language: string; value: string };
          return `\`\`\`${code.language}\n${code.value}\n\`\`\``;
        }
        return documentationText(entry) ?? "";
      })
      .filter(Boolean)
      .join("\n\n");
  }
  return documentationText(contents) ?? "";
}

function isLocation(value: unknown): value is { uri: string; range: LspRange } {
  return Boolean(value && typeof value === "object" && "uri" in value && "range" in value);
}

export function definitionTargets(result: unknown): LocationTarget[] {
  if (!result) return [];
  if (Array.isArray(result)) {
    return result.flatMap((entry) => definitionTargets(entry));
  }
  if (isLocation(result)) {
    return [{ uri: result.uri, range: result.range }];
  }
  if (typeof result === "object" && "targetUri" in result) {
    const link = result as {
      targetUri: string;
      targetSelectionRange?: LspRange;
      targetRange?: LspRange;
    };
    const range = link.targetSelectionRange ?? link.targetRange;
    return range ? [{ uri: link.targetUri, range }] : [];
  }
  return [];
}

/** Convert an LSP completion item into the shape Monaco expects. */
export function completionToMonaco(
  raw: unknown,
  defaultRange: MonacoRangeLike,
): MonacoCompletionLike | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const labelValue = item.label;
  const label =
    typeof labelValue === "string"
      ? labelValue
      : (labelValue as { label?: string } | undefined)?.label;
  if (!label) return null;

  const textEdit = item.textEdit as
    | { range?: LspRange; newText?: string; insert?: LspRange; replace?: LspRange }
    | undefined;
  const range = textEdit?.range
    ? toMonacoRange(textEdit.range)
    : textEdit?.insert && textEdit?.replace
      ? {
          startLineNumber: Math.min(
            textEdit.insert.start.line,
            textEdit.replace.start.line,
          ) + 1,
          startColumn: Math.min(
            textEdit.insert.start.character,
            textEdit.replace.start.character,
          ) + 1,
          endLineNumber: Math.max(
            textEdit.insert.end.line,
            textEdit.replace.end.line,
          ) + 1,
          endColumn: Math.max(
            textEdit.insert.end.character,
            textEdit.replace.end.character,
          ) + 1,
        }
      : defaultRange;

  const documentation = documentationText(item.documentation);
  const detail =
    typeof item.detail === "string"
      ? item.detail
      : (labelValue as { detail?: string } | undefined)?.detail;

  const additional = Array.isArray(item.additionalTextEdits)
    ? item.additionalTextEdits
        .map((edit) => {
          const typed = edit as { range?: LspRange; newText?: string };
          if (!typed.range || typeof typed.newText !== "string") return null;
          return { range: toMonacoRange(typed.range), text: typed.newText };
        })
        .filter((edit): edit is { range: MonacoRangeLike; text: string } => edit !== null)
    : undefined;

  const insertText =
    textEdit?.newText ??
    (typeof item.insertText === "string" ? item.insertText : label);

  return {
    label,
    kind: completionKind(typeof item.kind === "number" ? item.kind : undefined),
    detail,
    ...(documentation ? { documentation: { value: documentation } } : {}),
    insertText,
    range,
    ...(item.insertTextFormat === 2 ? { insertTextRules: 4 } : {}),
    ...(typeof item.sortText === "string" ? { sortText: item.sortText } : {}),
    ...(typeof item.filterText === "string" ? { filterText: item.filterText } : {}),
    ...(additional && additional.length > 0 ? { additionalTextEdits: additional } : {}),
  };
}
