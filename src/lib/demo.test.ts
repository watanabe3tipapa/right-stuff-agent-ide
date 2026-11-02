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
