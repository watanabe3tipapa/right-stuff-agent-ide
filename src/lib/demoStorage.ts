import type { SkillPolicy, VersionContent } from "../shared/types";

/**
 * Persistence for the browser demo workspace. The native app stores drafts in
 * the chosen folder, but the browser has no file system, so the demo keeps a
 * small snapshot in localStorage. The schema is versioned so a future change
 * can ignore old data instead of failing to boot.
 */

export const DEMO_STORAGE_KEY = "rsai.demo.workspace.v1";
export const DEMO_MAX_VERSIONS_PER_FILE = 100;

export interface DemoSnapshot {
  version: 1;
  files: Record<string, string>;
  dirs: string[];
  versions: VersionContent[];
  nextVersionId: number;
  modifiedAt: Record<string, number>;
  skillPolicy: SkillPolicy | null;
  savedAt: number;
}

export interface DemoStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Return localStorage when it is usable. Access can throw in private windows
 * or when storage is disabled, so every caller must tolerate null.
 */
export function getDemoStorage(): DemoStorageLike | null {
  try {
    if (typeof window === "undefined") return null;
    const storage = window.localStorage;
    if (!storage) return null;
    return storage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.startsWith("/") || value.includes("\\")) return false;
  return value
    .split("/")
    .every((part) => part.length > 0 && part !== "." && part !== "..");
}

function parseFiles(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(value)) {
    if (!isSafeRelativePath(path) || typeof content !== "string") return null;
    files[path] = content;
  }
  return files;
}

function parseDirs(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const dirs = value.filter(isSafeRelativePath);
  return dirs;
}

function parseVersions(value: unknown): VersionContent[] | null {
  if (!Array.isArray(value)) return null;
  const versions: VersionContent[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    const { id, path, content, createdAt } = entry;
    if (
      typeof id !== "number" ||
      !Number.isFinite(id) ||
      !isSafeRelativePath(path) ||
      typeof content !== "string" ||
      typeof createdAt !== "number" ||
      !Number.isFinite(createdAt)
    ) {
      return null;
    }
    versions.push({ id, path, content, createdAt });
  }
  return versions;
}

function parseModifiedAt(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const modifiedAt: Record<string, number> = {};
  for (const [path, timestamp] of Object.entries(value)) {
    if (!isSafeRelativePath(path)) continue;
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) continue;
    modifiedAt[path] = timestamp;
  }
  return modifiedAt;
}

export function pruneVersions(versions: VersionContent[]): VersionContent[] {
  const kept: VersionContent[] = [];
  const counts = new Map<string, number>();

  for (const version of [...versions].sort((a, b) => b.createdAt - a.createdAt)) {
    const count = counts.get(version.path) ?? 0;
    if (count >= DEMO_MAX_VERSIONS_PER_FILE) continue;
    counts.set(version.path, count + 1);
    kept.push(version);
  }

  return kept;
}

export function parseDemoSnapshot(raw: string | null): DemoSnapshot | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || parsed.version !== 1) return null;

  const files = parseFiles(parsed.files);
  const dirs = parseDirs(parsed.dirs ?? []);
  const versions = parseVersions(parsed.versions ?? []);
  const modifiedAt = parseModifiedAt(parsed.modifiedAt ?? {});
  if (!files || !dirs || !versions || !modifiedAt) return null;

  const skillPolicy =
    parsed.skillPolicy === null || parsed.skillPolicy === undefined
      ? null
      : (parsed.skillPolicy as SkillPolicy);

  const versionsPruned = pruneVersions(versions);
  const highestId = versionsPruned.reduce((max, entry) => Math.max(max, entry.id), 0);
  const requestedNext = parsed.nextVersionId;
  const nextVersionId =
    typeof requestedNext === "number" && Number.isFinite(requestedNext)
      ? Math.max(Math.floor(requestedNext), highestId + 1)
      : highestId + 1;

  const savedAt =
    typeof parsed.savedAt === "number" && Number.isFinite(parsed.savedAt)
      ? parsed.savedAt
      : Date.now();

  return {
    version: 1,
    files,
    dirs,
    versions: versionsPruned,
    nextVersionId,
    modifiedAt,
    skillPolicy,
    savedAt,
  };
}

export function serializeDemoSnapshot(snapshot: DemoSnapshot): string {
  return JSON.stringify(snapshot);
}

export function loadDemoSnapshot(storage = getDemoStorage()): DemoSnapshot | null {
  if (!storage) return null;
  try {
    return parseDemoSnapshot(storage.getItem(DEMO_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function saveDemoSnapshot(
  snapshot: DemoSnapshot,
  storage = getDemoStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(DEMO_STORAGE_KEY, serializeDemoSnapshot(snapshot));
    return true;
  } catch {
    return false;
  }
}

export function clearDemoSnapshot(storage = getDemoStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(DEMO_STORAGE_KEY);
  } catch {
    // Ignore: the in-memory demo still works without persistence.
  }
}
