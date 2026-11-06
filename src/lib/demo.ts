import type {
  AgentPolicy,
  AgentRunResult,
  AgentStatus,
  AppInfo,
  FileContent,
  FileEntry,
  GitCommandResult,
  GitCommit,
  GitDiff,
  GitStatus,
  LlmSettings,
  LlmTestResult,
  OpenShipDeployResult,
  OpenShipLogs,
  OpenShipSettings,
  OpenShipStatus,
  SaveResult,
  SkillCatalog,
  SkillDecisionResult,
  SkillPolicy,
  SkillPreviewResult,
  SkillRequest,
  SkillRunResult,
  VerificationCheckName,
  VerificationResult,
  VersionContent,
  VersionSummary,
  WorkspaceInfo,
} from "../shared/types";
import { DEFAULT_LLM_CONFIG } from "./llm";
import { defaultAgentPolicy } from "./policy";
import { DEFAULT_SKILL_POLICY } from "./skills";

/**
 * In-browser fallback used by `npm run dev` when the app is not running inside
 * Tauri. It keeps a small virtual workspace in memory so the whole UI can be
 * reviewed without the native shell.
 */

const ROOT = "/demo/right-stuff-agent-ide";
const ROOT_NAME = "right-stuff-agent-ide";
const startedAt = Date.now();

const initialFiles: Record<string, string> = {
  "README.md": `# Right-Stuff Agent IDE

Right-Stuff Editor の執筆体験と Agent Desktop の OS レベル操作能力を統合した、
エージェント駆動型 IDE です。

## 現在のフェーズ

- [x] Tauri 2.0 + React 18 の基盤
- [x] ワークスペース / ファイルツリー
- [x] Monaco エディタ + Markdown プレビュー
- [x] バージョン履歴 (SQLite)
- [x] Agent Desktop ブリッジ
- [x] OpenAI 互換 LLM チャット (Tauri 版のみ)
- [x] 計画立案と計画単位の承認 (Tauri 版のみ)

## 開発

\`\`\`bash
npm install
npm run tauri dev
\`\`\`
`,
  "package.json": `{
  "name": "right-stuff-agent-ide",
  "private": true,
  "version": "0.3.7",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "tauri": "tauri"
  }
}
`,
  "src/App.tsx": `import { useWorkspaceStore } from "./stores/workspaceStore";

export function App() {
  const root = useWorkspaceStore((state) => state.info?.root);

  return (
    <main className="app">
      <h1>Right-Stuff Agent IDE</h1>
      <p>{root ?? "ワークスペースを開いてください"}</p>
    </main>
  );
}
`,
  "src/components/AgentPanel.tsx": `import { useState } from "react";
import { useAgentStore } from "../stores/agentStore";

export function AgentPanel() {
  const [draft, setDraft] = useState("");
  const send = useAgentStore((state) => state.send);

  return (
    <form
      className="agent-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (!draft.trim()) return;
        void send(draft);
        setDraft("");
      }}
    >
      <textarea value={draft} onChange={(event) => setDraft(event.target.value)} />
      <button type="submit">送信</button>
    </form>
  );
}
`,
  "src-tauri/src/lib.rs": `mod commands;
mod db;
mod error;
mod paths;
mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            app.manage(AppState::new(app.handle())?);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running right-stuff-agent-ide");
}
`,
  "docs/ARCHITECTURE.md": `# Architecture

## Layers

1. **Presentation** — React 18 + Vite + TypeScript
2. **Agent Bridge** — Tauri commands wrapping the Agent Desktop CLI
3. **Core Engine** — Workspace I/O, SQLite history, path validation
4. **OS Integration** — Agent Desktop native binary

## Design principles

- ワークスペース外へのパスはバックエンドで拒否する
- すべての保存は atomic write + バージョン履歴
- エージェントの操作は snapshot → action → verify のループで検証する
`,
  ".agents/skills/code-edit.json": `{
  "name": "code-edit",
  "description": "エディタ内でのコード編集操作",
  "actions": [
    "editor.openFile",
    "editor.editRange",
    "editor.insertText",
    "editor.deleteRange",
    "editor.saveFile",
    "editor.runCommand"
  ],
  "verification": "snapshot_after_action"
}
`,
};

const files = new Map<string, string>(Object.entries(initialFiles));
const dirs = new Set<string>([
  "src",
  "src/components",
  "src-tauri",
  "src-tauri/src",
  "docs",
  ".agents",
  ".agents/skills",
]);
const versions: VersionContent[] = [];
let nextVersionId = 1;
const deleted = new Map<string, string>();

function demoRoot(): WorkspaceInfo {
  return { root: ROOT, name: ROOT_NAME };
}

function isDirPath(path: string): boolean {
  if (path === "") return true;
  if (dirs.has(path)) return true;
  const prefix = `${path}/`;
  for (const key of files.keys()) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

function entryFor(path: string): FileEntry {
  const name = path.split("/").pop() ?? path;
  const dir = isDirPath(path);
  return {
    name,
    path,
    isDir: dir,
    size: dir ? 0 : new Blob([files.get(path) ?? ""]).size,
    modified: startedAt,
    children: dir ? buildChildren(path) : [],
  };
}

function buildChildren(parent: string): FileEntry[] {
  const prefix = parent === "" ? "" : `${parent}/`;
  const names = new Set<string>();

  for (const dir of dirs) {
    if (!dir.startsWith(prefix) || dir === parent) continue;
    const [head] = dir.slice(prefix.length).split("/");
    if (head) names.add(head);
  }

  for (const key of files.keys()) {
    if (!key.startsWith(prefix)) continue;
    const [head] = key.slice(prefix.length).split("/");
    if (head) names.add(head);
  }

  return [...names]
    .map((name) => entryFor(prefix ? `${prefix}${name}` : name))
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

function ensureParent(path: string) {
  const parts = path.split("/");
  parts.pop();
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    dirs.add(current);
  }
}

function record(path: string, content: string): number {
  // 履歴は新しい順に保持する。ID は配列の長さではなく単調増加カウンタで
  // 採番し、将来履歴を間引いても既存 ID と衝突しないようにする。
  const id = nextVersionId++;
  versions.unshift({
    id,
    path,
    content,
    createdAt: Date.now(),
  });
  return id;
}

function demoSkillCatalog(): SkillCatalog {
  return {
    warnings: [],
    skills: [
      {
        schemaVersion: 1,
        id: "code-edit",
        name: "Code Edit",
        description: "ワークスペース内のファイルを読み取り、文字列を置換して保存する",
        version: "0.1.0",
        category: "editor",
        risk: "write",
        actions: [
          {
            id: "editor.readFile",
            handler: "editor.readFile",
            description: "ファイルを読み取る",
            risk: "read",
            params: {
              path: {
                type: "string",
                description: "ワークスペースからの相対パス",
                required: true,
                maxLength: 1024,
              },
            },
            timeoutMs: 5_000,
          },
          {
            id: "editor.replaceText",
            handler: "editor.replaceText",
            description: "一意に一致する文字列を置換する",
            risk: "write",
            params: {
              path: {
                type: "string",
                description: "ワークスペースからの相対パス",
                required: true,
                maxLength: 1024,
              },
              oldText: {
                type: "string",
                description: "置換前の文字列。ファイル内で 1 回だけ一致すること",
                required: true,
                maxLength: 100_000,
              },
              newText: {
                type: "string",
                description: "置換後の文字列",
                required: true,
                maxLength: 100_000,
              },
            },
            timeoutMs: 30_000,
          },
          {
            id: "editor.createFile",
            handler: "editor.createFile",
            description: "存在しないファイルを作成する",
            risk: "write",
            params: {
              path: {
                type: "string",
                description: "ワークスペースからの相対パス",
                required: true,
                maxLength: 1024,
              },
              content: {
                type: "string",
                description: "初期内容",
                required: false,
                maxLength: 100_000,
              },
            },
            timeoutMs: 30_000,
          },
        ],
        permissions: {
          paths: { read: ["**/*"], write: ["**/*"] },
          commands: [],
          env: [],
        },
        approval: { default: null, overrides: {} },
        verification: {
          mode: "auto",
          checks: ["typecheck", "lint", "test"],
          timeoutMs: 300_000,
          stopOnFailure: true,
        },
        limits: {
          maxFiles: 20,
          maxBytes: 1_048_576,
          timeoutMs: 300_000,
          maxOutputChars: 50_000,
        },
      },
    ],
  };
}

let demoSkillPolicy = DEFAULT_SKILL_POLICY();

function demoSkillDecision(skillId: string, actionId: string): SkillDecisionResult {
  const catalog = demoSkillCatalog();
  const action = catalog.skills
    .find((skill) => skill.id === skillId)
    ?.actions.find((entry) => entry.id === actionId);
  if (!action) {
    throw new Error(`スキルが見つかりません: ${skillId} / ${actionId}`);
  }
  const requested =
    demoSkillPolicy.actions[actionId] ??
    demoSkillPolicy.skills[skillId] ??
    (action.risk === "read" ? "allow" : "ask");
  const decision =
    requested === "allow" && action.risk !== "read" ? "ask" : requested;
  return { skillId, actionId, decision, risk: action.risk };
}

function demoSkillPreview(
  skillId: string,
  actionId: string,
  params: Record<string, unknown>,
): SkillPreviewResult {
  const decision = demoSkillDecision(skillId, actionId);
  const path = typeof params.path === "string" ? params.path : null;
  const result: SkillPreviewResult = {
    skillId,
    actionId,
    decision: decision.decision,
    risk: decision.risk,
    path,
    addedLines: 0,
    removedLines: 0,
    diff: "",
    warnings: [],
  };

  if (actionId === "editor.readFile") {
    if (!path || !files.has(path)) throw new Error(`見つかりません: ${path ?? ""}`);
    return result;
  }

  if (actionId === "editor.replaceText") {
    if (!path) throw new Error("path が必要です。");
    const content = files.get(path);
    if (content === undefined) throw new Error(`見つかりません: ${path}`);
    const oldText = typeof params.oldText === "string" ? params.oldText : "";
    const newText = typeof params.newText === "string" ? params.newText : "";
    const first = content.indexOf(oldText);
    if (!oldText || first < 0) throw new Error("置換前の文字列がファイル内にありません。");
    if (content.indexOf(oldText, first + 1) >= 0) {
      throw new Error("置換前の文字列がファイル内で複数一致します。");
    }
    result.diff = `-${oldText}\n+${newText}`;
    result.removedLines = oldText ? oldText.split("\n").length : 0;
    result.addedLines = newText ? newText.split("\n").length : 0;
    return result;
  }

  if (actionId === "editor.createFile") {
    if (!path) throw new Error("path が必要です。");
    if (files.has(path)) throw new Error(`既に存在します: ${path}`);
    const content = typeof params.content === "string" ? params.content : "";
    result.diff = content;
    result.addedLines = content ? content.split("\n").length : 0;
    return result;
  }

  throw new Error(`ブラウザデモでは未対応のアクションです: ${actionId}`);
}

export const demoApi = {
  async appInfo(): Promise<AppInfo> {
    return {
      name: "Right-Stuff Agent IDE",
      version: "0.3.7-demo",
      tauriVersion: "browser",
      platform: "browser",
      arch: "web",
    };
  },

  async workspaceLast(): Promise<WorkspaceInfo | null> {
    return demoRoot();
  },

  async workspaceOpen(): Promise<WorkspaceInfo> {
    return demoRoot();
  },

  async listFiles(): Promise<FileEntry[]> {
    return buildChildren("");
  },

  async readFile(path: string): Promise<FileContent> {
    const content = files.get(path);
    if (content === undefined) {
      throw new Error(`見つかりません: ${path}`);
    }
    return {
      path,
      content,
      language: path.endsWith(".md") ? "markdown" : path.endsWith(".json") ? "json" : "plaintext",
      size: content.length,
      modified: startedAt,
    };
  },

  async writeFile(path: string, content: string): Promise<SaveResult> {
    ensureParent(path);
    files.set(path, content);
    const versionId = record(path, content);
    return { path, versionId, savedAt: Date.now(), size: content.length };
  },

  async createEntry(path: string, isDir: boolean): Promise<string> {
    if (isDir) {
      ensureParent(path);
      dirs.add(path);
    } else {
      ensureParent(path);
      files.set(path, "");
      record(path, "");
    }
    return path;
  },

  async renameEntry(from: string, to: string): Promise<string> {
    const movingDirs = [...dirs].filter(
      (dir) => dir === from || dir.startsWith(`${from}/`),
    );
    const movingFiles = [...files.entries()].filter(
      ([key]) => key === from || key.startsWith(`${from}/`),
    );
    if (movingDirs.length === 0 && movingFiles.length === 0) {
      throw new Error(`見つかりません: ${from}`);
    }

    for (const dir of movingDirs) {
      dirs.delete(dir);
      dirs.add(dir === from ? to : `${to}${dir.slice(from.length)}`);
    }
    for (const [key, value] of movingFiles) {
      files.delete(key);
      files.set(key === from ? to : `${to}${key.slice(from.length)}`, value);
    }
    return to;
  },

  async deleteEntry(path: string): Promise<string> {
    for (const dir of [...dirs]) {
      if (dir === path || dir.startsWith(`${path}/`)) dirs.delete(dir);
    }
    const movingFiles = [...files.entries()].filter(
      ([key]) => key === path || key.startsWith(`${path}/`),
    );
    for (const [key, value] of movingFiles) {
      files.delete(key);
      deleted.set(key, value);
    }
    return `.right-stuff/trash/${Date.now()}/${path}`;
  },

  async history(path: string): Promise<VersionSummary[]> {
    return versions
      .filter((version) => version.path === path)
      .map((version) => ({
        id: version.id,
        path: version.path,
        size: version.content.length,
        createdAt: version.createdAt,
      }));
  },

  async version(id: number): Promise<VersionContent> {
    const found = versions.find((version) => version.id === id);
    if (!found) throw new Error(`履歴が見つかりません: ${id}`);
    return found;
  },

  async agentStatus(): Promise<AgentStatus> {
    return {
      available: false,
      binary: null,
      version: null,
      platform: "browser",
      arch: "web",
      message:
        "ブラウザデモでは Agent Desktop CLI を呼び出せません。`npm run tauri dev` で起動してください。",
    };
  },

  async agentSnapshot(): Promise<AgentRunResult> {
    throw new Error(
      "ブラウザデモではスナップショットを取得できません。`npm run tauri dev` で起動してください。",
    );
  },

  async agentRun(): Promise<AgentRunResult> {
    throw new Error(
      "ブラウザデモではエージェントを実行できません。`npm run tauri dev` で起動してください。",
    );
  },

  async agentPolicy(): Promise<AgentPolicy> {
    return defaultAgentPolicy();
  },

  async agentPolicySet(): Promise<AgentPolicy> {
    throw new Error(
      "ブラウザデモではエージェントポリシーを保存できません。`npm run tauri dev` で起動してください。",
    );
  },

  async openshipConfig(): Promise<OpenShipSettings> {
    return {
      baseUrl: "",
      organizationId: "",
      projectId: "",
      branch: "main",
      cliPath: "",
      tokenConfigured: false,
    };
  },

  async openshipConfigSet(): Promise<OpenShipSettings> {
    throw new Error(
      "ブラウザデモでは Openship 設定を保存できません。`npm run tauri dev` で起動してください。",
    );
  },

  async openshipTokenSet(): Promise<void> {
    throw new Error(
      "ブラウザデモでは Openship トークンを保存できません。`npm run tauri dev` で起動してください。",
    );
  },

  async openshipTokenDelete(): Promise<void> {
    throw new Error(
      "ブラウザデモでは Openship トークンを削除できません。`npm run tauri dev` で起動してください。",
    );
  },

  async openshipStatus(): Promise<OpenShipStatus> {
    return {
      cliAvailable: false,
      cliPath: null,
      cliVersion: null,
      serverConfigured: false,
      serverReachable: false,
      serverMessage:
        "ブラウザデモでは Openship CLI / API を利用できません。`npm run tauri dev` で起動してください。",
      tokenConfigured: false,
      baseUrl: "",
    };
  },

  async openshipDeploy(): Promise<OpenShipDeployResult> {
    throw new Error(
      "ブラウザデモでは Openship へデプロイできません。`npm run tauri dev` で起動してください。",
    );
  },

  async openshipLogs(): Promise<OpenShipLogs> {
    throw new Error(
      "ブラウザデモでは Openship のログを取得できません。`npm run tauri dev` で起動してください。",
    );
  },

  async openshipRollback(): Promise<OpenShipDeployResult> {
    throw new Error(
      "ブラウザデモでは Openship をロールバックできません。`npm run tauri dev` で起動してください。",
    );
  },

  async gitStatus(): Promise<GitStatus> {
    return {
      repo: false,
      branch: null,
      ahead: 0,
      behind: 0,
      staged: [],
      unstaged: [],
      untracked: [],
      clean: true,
      message:
        "ブラウザデモでは Git を利用できません。`npm run tauri dev` で起動してください。",
    };
  },

  async gitDiff(): Promise<GitDiff> {
    throw new Error(
      "ブラウザデモでは Git の差分を表示できません。`npm run tauri dev` で起動してください。",
    );
  },

  async gitCommand(): Promise<GitCommandResult> {
    throw new Error(
      "ブラウザデモでは Git を操作できません。`npm run tauri dev` で起動してください。",
    );
  },

  async gitLog(): Promise<GitCommit[]> {
    return [];
  },

  async skillsList(): Promise<SkillCatalog> {
    return demoSkillCatalog();
  },

  async skillPolicy(): Promise<SkillPolicy> {
    return demoSkillPolicy;
  },

  async skillPolicySet(policy: SkillPolicy): Promise<SkillPolicy> {
    demoSkillPolicy = { ...DEFAULT_SKILL_POLICY(), ...policy, version: 1 };
    return demoSkillPolicy;
  },

  async skillDecision(
    skillId: string,
    actionId: string,
  ): Promise<SkillDecisionResult> {
    return demoSkillDecision(skillId, actionId);
  },

  async skillPreview(
    skillId: string,
    actionId: string,
    params: Record<string, unknown>,
  ): Promise<SkillPreviewResult> {
    return demoSkillPreview(skillId, actionId, params);
  },

  async skillRun(request: SkillRequest): Promise<SkillRunResult> {
    const started = Date.now();
    const decision = demoSkillDecision(request.skillId, request.actionId);
    if (decision.decision === "block") {
      return {
        runId: `demo-${started}`,
        status: "blocked",
        decision: decision.decision,
        changedFiles: [],
        stdout: "",
        stderr: "ポリシーによりブロックされました。",
        exitCode: null,
        durationMs: Date.now() - started,
        auditId: 0,
        errorCode: "policy_blocked",
      };
    }

    const preview = demoSkillPreview(
      request.skillId,
      request.actionId,
      request.params,
    );
    let stdout = "";
    const changedFiles: string[] = [];
    const path = typeof request.params.path === "string" ? request.params.path : "";

    if (request.actionId === "editor.readFile") {
      stdout = files.get(path) ?? "";
    } else if (request.actionId === "editor.replaceText") {
      const content = files.get(path) ?? "";
      const oldText =
        typeof request.params.oldText === "string" ? request.params.oldText : "";
      const newText =
        typeof request.params.newText === "string" ? request.params.newText : "";
      const index = content.indexOf(oldText);
      record(path, content);
      files.set(
        path,
        `${content.slice(0, index)}${newText}${content.slice(index + oldText.length)}`,
      );
      changedFiles.push(path);
      stdout = `${path} を更新しました (+${preview.addedLines} / -${preview.removedLines} 行)`;
    } else if (request.actionId === "editor.createFile") {
      const content =
        typeof request.params.content === "string" ? request.params.content : "";
      ensureParent(path);
      record(path, "");
      files.set(path, content);
      changedFiles.push(path);
      stdout = `${path} を作成しました`;
    }

    return {
      runId: `demo-${started}`,
      status: "ok",
      decision: decision.decision,
      changedFiles,
      stdout,
      stderr: "",
      exitCode: null,
      durationMs: Date.now() - started,
      auditId: 0,
    };
  },

  async skillVerify(
    _skillId: string,
    _actionId: string,
    checks?: VerificationCheckName[],
  ): Promise<VerificationResult> {
    return {
      status: "skipped",
      checks: (checks ?? ["typecheck", "lint", "test"]).map((name) => ({
        name,
        ecosystem: "demo",
        status: "skipped" as const,
        command: [],
        exitCode: null,
        output: "ブラウザデモでは検証コマンドを実行しません。",
        durationMs: 0,
      })),
    };
  },

  async llmConfig(): Promise<LlmSettings> {
    return {
      ...DEFAULT_LLM_CONFIG,
      configured: false,
      keyConfigured: false,
    };
  },

  async llmConfigSet(): Promise<LlmSettings> {
    throw new Error(
      "ブラウザデモでは LLM 設定を保存できません。`npm run tauri dev` で起動してください。",
    );
  },

  async llmKeySet(): Promise<void> {
    throw new Error(
      "ブラウザデモでは API キーを保存できません。`npm run tauri dev` で起動してください。",
    );
  },

  async llmKeyDelete(): Promise<void> {
    throw new Error(
      "ブラウザデモでは API キーを削除できません。`npm run tauri dev` で起動してください。",
    );
  },

  async llmTest(): Promise<LlmTestResult> {
    throw new Error(
      "ブラウザデモでは LLM に接続できません。`npm run tauri dev` で起動してください。",
    );
  },

  async llmChat(): Promise<void> {
    throw new Error(
      "ブラウザデモでは LLM を利用できません。`npm run tauri dev` で起動してください。",
    );
  },
};
