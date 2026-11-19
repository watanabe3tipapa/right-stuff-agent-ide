import { describe, expect, it } from "vitest";

import type { VersionContent } from "../shared/types";
import {
  clearDemoSnapshot,
  DEMO_MAX_VERSIONS_PER_FILE,
  DEMO_STORAGE_KEY,
  loadDemoSnapshot,
  parseDemoSnapshot,
  pruneVersions,
  saveDemoSnapshot,
  serializeDemoSnapshot,
  type DemoSnapshot,
  type DemoStorageLike,
} from "./demoStorage";

function fakeStorage(initial: Record<string, string> = {}): DemoStorageLike & {
  values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function version(id: number, path = "README.md", createdAt = id): VersionContent {
  return { id, path, content: `version ${id}`, createdAt };
}

function snapshot(overrides: Partial<DemoSnapshot> = {}): DemoSnapshot {
  return {
    version: 1,
    files: { "README.md": "# Demo" },
    dirs: ["src"],
    versions: [version(1)],
    nextVersionId: 2,
    modifiedAt: { "README.md": 1_700_000_000_000 },
    skillPolicy: null,
    savedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe("demo snapshot serialization", () => {
  it("round-trips a snapshot", () => {
    const original = snapshot();
    const parsed = parseDemoSnapshot(serializeDemoSnapshot(original));

    expect(parsed).toMatchObject({
      version: 1,
      files: original.files,
      dirs: original.dirs,
      nextVersionId: original.nextVersionId,
      modifiedAt: original.modifiedAt,
      savedAt: original.savedAt,
    });
    expect(parsed?.versions).toEqual(original.versions);
  });

  it("rejects corrupt JSON and unknown schema versions", () => {
    expect(parseDemoSnapshot("{")).toBeNull();
    expect(parseDemoSnapshot(JSON.stringify({ version: 2, files: {} }))).toBeNull();
    expect(parseDemoSnapshot(null)).toBeNull();
  });

  it("rejects unsafe paths", () => {
    const raw = JSON.stringify(snapshot({ files: { "../outside.md": "x" } }));
    expect(parseDemoSnapshot(raw)).toBeNull();
  });

  it("raises nextVersionId above the highest stored id", () => {
    const parsed = parseDemoSnapshot(
      serializeDemoSnapshot(snapshot({ versions: [version(7)], nextVersionId: 2 })),
    );
    expect(parsed?.nextVersionId).toBe(8);
  });
});

describe("demo snapshot pruning", () => {
  it("keeps the newest versions per file", () => {
    const versions = Array.from(
      { length: DEMO_MAX_VERSIONS_PER_FILE + 10 },
      (_, index) => version(DEMO_MAX_VERSIONS_PER_FILE + 10 - index),
    );

    const pruned = pruneVersions(versions);
    expect(pruned).toHaveLength(DEMO_MAX_VERSIONS_PER_FILE);
    expect(pruned[0]?.id).toBe(DEMO_MAX_VERSIONS_PER_FILE + 10);
    expect(pruned[pruned.length - 1]?.id).toBe(11);
  });

  it("prunes each path independently", () => {
    const versions = [
      ...Array.from({ length: DEMO_MAX_VERSIONS_PER_FILE + 1 }, (_, index) =>
        version(index + 1, "a.md", index + 1),
      ),
      version(1, "b.md", 10_000),
    ];

    const pruned = pruneVersions(versions);
    const fromA = pruned.filter((entry) => entry.path === "a.md");
    const fromB = pruned.filter((entry) => entry.path === "b.md");
    expect(fromA).toHaveLength(DEMO_MAX_VERSIONS_PER_FILE);
    expect(fromB).toHaveLength(1);
  });
});

describe("demo storage adapter", () => {
  it("loads, saves and clears a snapshot", () => {
    const storage = fakeStorage();
    expect(loadDemoSnapshot(storage)).toBeNull();

    expect(saveDemoSnapshot(snapshot(), storage)).toBe(true);
    expect(storage.values.has(DEMO_STORAGE_KEY)).toBe(true);
    expect(loadDemoSnapshot(storage)?.files).toEqual({ "README.md": "# Demo" });

    clearDemoSnapshot(storage);
    expect(storage.values.has(DEMO_STORAGE_KEY)).toBe(false);
  });

  it("returns null or false when storage is unavailable", () => {
    expect(loadDemoSnapshot(null)).toBeNull();
    expect(saveDemoSnapshot(snapshot(), null)).toBe(false);
  });

  it("survives a storage implementation that throws", () => {
    const storage: DemoStorageLike = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("quota");
      },
      removeItem() {
        throw new Error("blocked");
      },
    };

    expect(loadDemoSnapshot(storage)).toBeNull();
    expect(saveDemoSnapshot(snapshot(), storage)).toBe(false);
    expect(() => clearDemoSnapshot(storage)).not.toThrow();
  });
});
