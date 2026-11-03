import type {
  AgentPolicy,
  AgentRunResult,
  AgentStatus,
  AppInfo,
  FileContent,
  FileEntry,
  LlmSettings,
  LlmTestResult,
  OpenShipDeployResult,
  OpenShipLogs,
  OpenShipSettings,
  OpenShipStatus,
  SaveResult,
  VersionContent,
  VersionSummary,
  WorkspaceInfo,
} from "../shared/types";
import { DEFAULT_LLM_CONFIG } from "./llm";
import { defaultAgentPolicy } from "./policy";

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
  "version": "0.1.1",
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
  const id = versions.length + 1;
  versions.unshift({
    id,
    path,
    content,
    createdAt: Date.now(),
  });
  return id;
}

export const demoApi = {
  async appInfo(): Promise<AppInfo> {
    return {
      name: "Right-Stuff Agent IDE",
      version: "0.1.1-demo",
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
