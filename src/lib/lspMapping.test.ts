import { describe, expect, it } from "vitest";

import {
  applyTextEdits,
  codeActionsToMonaco,
  completionKind,
  completionToMonaco,
  definitionTargets,
  diagnosticsToMarkers,
  fileUri,
  hoverToMarkdown,
  prepareRenameRange,
  relativeFromUri,
  symbolKindLabel,
  symbolTargets,
  toLspPosition,
  toMonacoRange,
  toMonacoSeverity,
  workspaceEditFiles,
} from "./lspMapping";

describe("positions", () => {
  it("converts between 1-based Monaco and 0-based LSP positions", () => {
    expect(toLspPosition(3, 5)).toEqual({ line: 2, character: 4 });
    expect(toLspPosition(0, 0)).toEqual({ line: 0, character: 0 });
    expect(toMonacoRange({ start: { line: 0, character: 0 }, end: { line: 2, character: 3 } })).toEqual({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 3,
      endColumn: 4,
    });
  });
});

describe("file URIs", () => {
  it("encodes spaces and hashes", () => {
    const uri = fileUri("/Users/me/project", "src/my file#1.ts");
    expect(uri).toBe("file:///Users/me/project/src/my%20file%231.ts");
    expect(relativeFromUri("/Users/me/project", uri)).toBe("src/my file#1.ts");
  });

  it("rejects outside and malformed URIs", () => {
    expect(relativeFromUri("/Users/me/project", "file:///tmp/other.ts")).toBeNull();
    expect(relativeFromUri("/Users/me/project", "https://example.com/a.ts")).toBeNull();
    expect(relativeFromUri("/Users/me/project", "file:///%E0%A4%A")).toBeNull();
  });
});

describe("diagnostics", () => {
  it("maps severity and range", () => {
    const markers = diagnosticsToMarkers({
      uri: "file:///r/a.ts",
      diagnostics: [
        {
          range: { start: { line: 1, character: 2 }, end: { line: 1, character: 4 } },
          severity: 1,
          message: "boom",
          source: "ts",
          code: 42,
        },
      ],
    });

    expect(markers).toEqual([
      {
        startLineNumber: 2,
        startColumn: 3,
        endLineNumber: 2,
        endColumn: 5,
        severity: 8,
        message: "boom",
        source: "ts",
        code: "42",
      },
    ]);
  });

  it("defaults to information severity", () => {
    expect(toMonacoSeverity(undefined)).toBe(2);
    expect(toMonacoSeverity(4)).toBe(1);
  });
});

describe("completion", () => {
  it("maps LSP kinds", () => {
    expect(completionKind(3)).toBe(2); // Function
    expect(completionKind(22)).toBe(7); // Struct
    expect(completionKind(undefined)).toBe(0);
  });

  it("converts a text edit and documentation", () => {
    const item = completionToMonaco(
      {
        label: "print",
        kind: 3,
        detail: "fn",
        documentation: { kind: "markdown", value: "`print()`" },
        textEdit: {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } },
          newText: "print()",
        },
      },
      { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 3 },
    );

    expect(item).toMatchObject({
      label: "print",
      kind: 2,
      detail: "fn",
      insertText: "print()",
      documentation: { value: "`print()`" },
      range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 3 },
    });
  });

  it("handles insert/replace edits", () => {
    const item = completionToMonaco(
      {
        label: "x",
        textEdit: {
          insert: { start: { line: 1, character: 1 }, end: { line: 1, character: 3 } },
          replace: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } },
          newText: "x",
        },
      },
      { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
    );

    expect(item?.range).toEqual({
      startLineNumber: 2,
      startColumn: 1,
      endLineNumber: 2,
      endColumn: 5,
    });
  });
});

describe("hover and definitions", () => {
  it("joins hover contents", () => {
    expect(
      hoverToMarkdown([
        { language: "rust", value: "fn main()" },
        "Returns `()`",
      ]),
    ).toBe("```rust\nfn main()\n```\n\nReturns `()`");
  });

  it("accepts locations and location links", () => {
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
    expect(definitionTargets([{ uri: "file:///a.ts", range }])).toHaveLength(1);
    expect(
      definitionTargets([
        { targetUri: "file:///b.ts", targetSelectionRange: range },
      ]),
    ).toEqual([{ uri: "file:///b.ts", range }]);
    expect(definitionTargets(null)).toEqual([]);
  });
});

describe("rename and workspace edits", () => {
  const range = { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } };

  it("applies edits bottom-up without shifting offsets", () => {
    const text = "const a = 1;\nconst b = 2;\n";
    const next = applyTextEdits(text, [
      { range, newText: "alpha" },
      {
        range: { start: { line: 1, character: 6 }, end: { line: 1, character: 7 } },
        newText: "beta",
      },
      {
        range: { start: { line: 1, character: 10 }, end: { line: 1, character: 11 } },
        newText: "3",
      },
    ]);
    expect(next).toBe("const alpha = 1;\nconst beta = 3;\n");
  });

  it("handles ranges at the end of the document", () => {
    expect(
      applyTextEdits("abc", [
        { range: { start: { line: 0, character: 3 }, end: { line: 0, character: 9 } }, newText: "!" },
      ]),
    ).toBe("abc!");
  });

  it("parses changes and documentChanges", () => {
    const parsed = workspaceEditFiles(
      {
        changes: {
          "file:///root/a.ts": [{ range, newText: "alpha" }],
        },
        documentChanges: [
          {
            textDocument: { uri: "file:///root/src/b.ts" },
            edits: [{ range, newText: "beta" }],
          },
          { kind: "rename", oldUri: "file:///root/a.ts", newUri: "file:///root/c.ts" },
        ],
      },
      "/root",
    );

    expect(parsed.files).toEqual([
      { path: "a.ts", edits: [{ range, newText: "alpha" }] },
      { path: "src/b.ts", edits: [{ range, newText: "beta" }] },
    ]);
    expect(parsed.unsupported).toEqual(["rename"]);
  });

  it("ignores edits outside the workspace", () => {
    expect(
      workspaceEditFiles(
        { changes: { "file:///tmp/a.ts": [{ range, newText: "x" }] } },
        "/root",
      ).files,
    ).toEqual([]);
  });

  it("extracts prepareRename ranges", () => {
    expect(prepareRenameRange({ range, placeholder: "a" })).toEqual({
      startLineNumber: 1,
      startColumn: 7,
      endLineNumber: 1,
      endColumn: 8,
    });
    expect(prepareRenameRange({ start: range.start, end: range.end })).toEqual({
      startLineNumber: 1,
      startColumn: 7,
      endLineNumber: 1,
      endColumn: 8,
    });
    expect(prepareRenameRange(null)).toBeNull();
  });
});

describe("code actions", () => {
  const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };

  it("keeps edits and commands", () => {
    const actions = codeActionsToMonaco(
      [
        {
          title: "Fix import",
          kind: "quickfix",
          isPreferred: true,
          edit: { changes: { "file:///root/a.ts": [{ range, newText: "x" }] } },
        },
        {
          title: "Organize imports",
          kind: "source.organizeImports",
          command: { command: "rust-analyzer.organizeImports", arguments: [1] },
        },
        { title: "Disabled", disabled: { reason: "not ready" } },
        { title: "Empty" },
      ],
      "/root",
    );

    expect(actions).toHaveLength(2);
    expect(actions[0]).toMatchObject({
      title: "Fix import",
      kind: "quickfix",
      isPreferred: true,
      edits: [{ path: "a.ts", edits: [{ range, newText: "x" }] }],
    });
    expect(actions[1].command).toEqual({
      command: "rust-analyzer.organizeImports",
      arguments: [1],
    });
  });
});

describe("workspace symbols", () => {
  const range = { start: { line: 2, character: 4 }, end: { line: 2, character: 9 } };

  it("normalizes symbol locations", () => {
    expect(
      symbolTargets([
        {
          name: "main",
          kind: 12,
          containerName: "crate",
          location: { uri: "file:///root/src/main.rs", range },
        },
        { name: "broken" },
      ]),
    ).toEqual([
      {
        name: "main",
        kind: 12,
        containerName: "crate",
        uri: "file:///root/src/main.rs",
        range,
      },
    ]);
  });

  it("labels symbol kinds", () => {
    expect(symbolKindLabel(12)).toBe("Function");
    expect(symbolKindLabel(23)).toBe("Struct");
    expect(symbolKindLabel(99)).toBe("Symbol");
  });
});
