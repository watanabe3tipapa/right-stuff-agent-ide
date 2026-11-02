import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SaveResult } from "../shared/types";

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  history: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  api: {
    isTauri: true,
    readFile: mocks.readFile,
    writeFile: mocks.writeFile,
    history: mocks.history,
  },
  errorMessage: (error: unknown) => String(error),
}));

import {
  confirmUnsavedChanges,
  isDirty,
  useEditorStore,
  type OpenFile,
} from "./editorStore";

const saved = (path: string, size = 1): SaveResult => ({
  path,
  versionId: 1,
  savedAt: 1_700_000_000_000,
  size,
});

function openFile(path: string, content: string): OpenFile {
  return {
    path,
    content,
    savedContent: content,
    language: "markdown",
    size: content.length,
    modified: 0,
  };
}

function resetStore() {
  useEditorStore.getState().resolveUnsavedDecision("cancel");
  useEditorStore.setState({
    files: {},
    order: [],
    activePath: null,
    saving: false,
    error: null,
    notice: null,
    preview: false,
    historyPath: null,
    history: [],
    historyLoading: false,
    unsavedPrompt: null,
  });
}

function seedDirty(path = "a.md", content = "edited") {
  const file: OpenFile = { ...openFile(path, content), savedContent: "" };
  useEditorStore.setState({
    files: { [path]: file },
    order: [path],
    activePath: path,
  });
  return file;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

describe("saveFile", () => {
  it("keeps a tab dirty when it changes while the save is in flight", async () => {
    seedDirty("a.md", "before");

    let resolveWrite!: (value: SaveResult) => void;
    mocks.writeFile.mockReturnValue(
      new Promise<SaveResult>((resolve) => {
        resolveWrite = resolve;
      }),
    );

    const saving = useEditorStore.getState().saveFile("a.md");
    useEditorStore.getState().updateContent("a.md", "typed during save");
    resolveWrite(saved("a.md", "before".length));
    await saving;

    const file = useEditorStore.getState().files["a.md"];
    expect(file.content).toBe("typed during save");
    expect(file.savedContent).toBe("before");
    expect(isDirty(file)).toBe(true);
    expect(useEditorStore.getState().dirtyPaths()).toEqual(["a.md"]);
  });

  it("clears dirty state when the content did not change during the save", async () => {
    seedDirty("a.md", "same");
    mocks.writeFile.mockResolvedValue(saved("a.md", "same".length));

    await useEditorStore.getState().saveFile("a.md");

    const file = useEditorStore.getState().files["a.md"];
    expect(isDirty(file)).toBe(false);
    expect(useEditorStore.getState().dirtyPaths()).toEqual([]);
  });
});

describe("unsaved changes guard", () => {
  it("returns false and keeps the tab when the user cancels", async () => {
    seedDirty();

    const result = confirmUnsavedChanges({ title: "切替", message: "未保存" });
    expect(useEditorStore.getState().unsavedPrompt).not.toBeNull();

    useEditorStore.getState().resolveUnsavedDecision("cancel");

    await expect(result).resolves.toBe(false);
    expect(useEditorStore.getState().files["a.md"]?.content).toBe("edited");
    expect(useEditorStore.getState().unsavedPrompt).toBeNull();
  });

  it("saves dirty tabs before continuing", async () => {
    seedDirty("a.md", "edited");
    mocks.writeFile.mockResolvedValue(saved("a.md", "edited".length));

    const result = confirmUnsavedChanges({ title: "切替", message: "未保存" });
    useEditorStore.getState().resolveUnsavedDecision("save");

    await expect(result).resolves.toBe(true);
    expect(mocks.writeFile).toHaveBeenCalledWith("a.md", "edited");
    expect(useEditorStore.getState().dirtyPaths()).toEqual([]);
  });

  it("aborts when saving fails", async () => {
    seedDirty("a.md", "edited");
    mocks.writeFile.mockRejectedValue(new Error("disk full"));

    const result = confirmUnsavedChanges({ title: "切替", message: "未保存" });
    useEditorStore.getState().resolveUnsavedDecision("save");

    await expect(result).resolves.toBe(false);
    expect(useEditorStore.getState().error).toBe("Error: disk full");
    expect(useEditorStore.getState().dirtyPaths()).toEqual(["a.md"]);
  });

  it("closes all tabs only after the user chooses discard", async () => {
    seedDirty();

    const closing = useEditorStore.getState().closeAllWithConfirmation();
    useEditorStore.getState().resolveUnsavedDecision("discard");
    await closing;

    expect(useEditorStore.getState().order).toEqual([]);
    expect(useEditorStore.getState().files).toEqual({});
  });
});
