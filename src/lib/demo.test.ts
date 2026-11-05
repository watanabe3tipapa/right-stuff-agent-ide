import { describe, expect, it } from "vitest";

import { demoApi } from "./demo";

describe("demo workspace", () => {
  it("exposes the sample tree", async () => {
    const tree = await demoApi.listFiles();
    const names = tree.map((entry) => entry.name);

    expect(names).toContain("README.md");
    expect(names).toContain("src");
    expect(tree.find((entry) => entry.name === "src")?.isDir).toBe(true);
  });

  it("reads a known file", async () => {
    const file = await demoApi.readFile("README.md");

    expect(file.content).toContain("Right-Stuff Agent IDE");
    expect(file.language).toBe("markdown");
  });

  it("rejects a missing file", async () => {
    await expect(demoApi.readFile("missing.md")).rejects.toThrow("見つかりません");
  });

  it("writes a file and records history", async () => {
    const path = "notes/demo-test.md";
    const saved = await demoApi.writeFile(path, "# hello");

    expect(saved.size).toBe(7);
    await expect(demoApi.readFile(path)).resolves.toMatchObject({ content: "# hello" });

    const history = await demoApi.history(path);
    expect(history[0]?.id).toBe(saved.versionId);

    const version = await demoApi.version(saved.versionId);
    expect(version.content).toBe("# hello");
  });

  it("creates, renames and deletes an entry", async () => {
    await demoApi.createEntry("tmp-dir", true);
    await demoApi.renameEntry("tmp-dir", "renamed-dir");

    let tree = await demoApi.listFiles();
    expect(tree.some((entry) => entry.name === "renamed-dir" && entry.isDir)).toBe(true);

    await demoApi.deleteEntry("renamed-dir");
    tree = await demoApi.listFiles();
    expect(tree.some((entry) => entry.name === "renamed-dir")).toBe(false);
  });

  it("reports that LLM access is unavailable in the browser demo", async () => {
    await expect(demoApi.llmChat()).rejects.toThrow("ブラウザデモでは LLM を利用できません");
  });
});

describe("demo skills", () => {
  it("lists the sample code-edit catalog", async () => {
    const catalog = await demoApi.skillsList();

    expect(catalog.warnings).toEqual([]);
    expect(catalog.skills).toHaveLength(1);
    expect(catalog.skills[0]?.id).toBe("code-edit");
    expect(catalog.skills[0]?.actions.map((action) => action.id)).toEqual([
      "editor.readFile",
      "editor.replaceText",
      "editor.createFile",
    ]);
  });

  it("previews a replace and reports a missing match", async () => {
    const preview = await demoApi.skillPreview(
      "code-edit",
      "editor.replaceText",
      { path: "README.md", oldText: "# Right-Stuff Agent IDE", newText: "# Demo" },
    );

    expect(preview.decision).toBe("ask");
    expect(preview.risk).toBe("write");
    expect(preview.path).toBe("README.md");
    expect(preview.diff).toContain("# Right-Stuff Agent IDE");

    await expect(
      demoApi.skillPreview("code-edit", "editor.replaceText", {
        path: "README.md",
        oldText: "not present",
        newText: "x",
      }),
    ).rejects.toThrow("ありません");
  });

  it("runs a replace and keeps the previous content in history", async () => {
    const path = "notes/skill-test.md";
    await demoApi.writeFile(path, "let value = 1;\n");
    const before = await demoApi.readFile(path);

    const result = await demoApi.skillRun({
      skillId: "code-edit",
      actionId: "editor.replaceText",
      params: { path, oldText: "let value = 1;", newText: "let value = 2;" },
    });

    expect(result.status).toBe("ok");
    expect(result.changedFiles).toEqual([path]);
    await expect(demoApi.readFile(path)).resolves.toMatchObject({
      content: "let value = 2;\n",
    });

    const history = await demoApi.history(path);
    const previous = history[0];
    expect(previous).toBeDefined();
    const version = await demoApi.version(previous!.id);
    expect(version.content).toBe(before.content);
  });

  it("creates a file and rejects an existing path", async () => {
    const path = "notes/skill-created.md";
    const result = await demoApi.skillRun({
      skillId: "code-edit",
      actionId: "editor.createFile",
      params: { path, content: "# created" },
    });

    expect(result.status).toBe("ok");
    expect(result.changedFiles).toEqual([path]);
    await expect(demoApi.readFile(path)).resolves.toMatchObject({
      content: "# created",
    });

    await expect(
      demoApi.skillPreview("code-edit", "editor.createFile", { path }),
    ).rejects.toThrow("既に存在");
  });

  it("blocks writes when the policy says block", async () => {
    const policy = await demoApi.skillPolicy();
    await demoApi.skillPolicySet({
      ...policy,
      actions: { ...policy.actions, "editor.replaceText": "block" },
    });

    const result = await demoApi.skillRun({
      skillId: "code-edit",
      actionId: "editor.replaceText",
      params: { path: "README.md", oldText: "a", newText: "b" },
    });

    expect(result.status).toBe("blocked");
    expect(result.decision).toBe("block");
    expect(result.errorCode).toBe("policy_blocked");

    await demoApi.skillPolicySet(policy);
  });
});
