import { describe, expect, it } from "vitest";

import {
  SKILL_LIBRARY,
  categoryLabel,
  findLibraryEntry,
  manifestJson,
  riskLabel,
  skillPath,
} from "./skillLibrary";

describe("skill library", () => {
  it("has unique ids and valid categories", () => {
    const ids = SKILL_LIBRARY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of SKILL_LIBRARY) {
      expect(entry.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(["editor", "git", "terminal", "debug"]).toContain(entry.category);
      expect(entry.tags.length).toBeGreaterThan(0);
    }
  });

  it("only exposes manifests for ready entries", () => {
    for (const entry of SKILL_LIBRARY) {
      if (entry.status === "ready") {
        expect(entry.manifest).not.toBeNull();
      } else {
        expect(entry.manifest).toBeNull();
        expect(entry.note).toBeTruthy();
      }
    }
  });

  it("keeps every manifest internally consistent", () => {
    for (const entry of SKILL_LIBRARY) {
      const manifest = entry.manifest;
      if (!manifest) continue;
      expect(manifest.schemaVersion).toBe(1);
      expect(manifest.id).toBe(entry.id);
      expect(manifest.category).toBe(entry.category);
      expect(entry.name).toBe(manifest.name);
      expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(manifest.actions.length).toBeGreaterThan(0);
      const actionIds = manifest.actions.map((action) => action.id);
      expect(new Set(actionIds).size).toBe(actionIds.length);
      for (const action of manifest.actions) {
        expect(action.handler).toBeTruthy();
        expect(action.description).toBeTruthy();
        expect(["read", "write", "destructive"]).toContain(action.risk);
      }
    }
  });

  it("serializes manifests as trailing-newline JSON", () => {
    const entry = findLibraryEntry("code-edit");
    expect(entry).not.toBeNull();
    const json = manifestJson(entry!);
    expect(json.endsWith("\n")).toBe(true);
    expect(JSON.parse(json).id).toBe("code-edit");
    expect(manifestJson(findLibraryEntry("git-operation")!)).toBe("");
  });

  it("maps paths and labels", () => {
    const entry = findLibraryEntry("code-inspector")!;
    expect(skillPath(entry)).toBe(".agents/skills/code-inspector.json");
    expect(findLibraryEntry("missing")).toBeNull();
    expect(categoryLabel("debug")).toBe("デバッグ");
    expect(riskLabel("read")).toBe("読取");
    expect(riskLabel("write")).toBe("変更");
  });
});
