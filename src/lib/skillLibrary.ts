import type {
  SkillCategory,
  SkillManifest,
  SkillRisk,
} from "../shared/types";

/**
 * A curated, human-readable layer on top of the raw skill manifests. The
 * manifest itself is what the runtime executes; the extra fields exist to
 * explain the skill in the showcase window.
 */
export interface SkillLibraryEntry {
  id: string;
  name: string;
  tagline: string;
  description: string;
  category: SkillCategory;
  status: "ready" | "planned";
  tags: string[];
  useCases: string[];
  examples: { title: string; prompt: string }[];
  manifest: SkillManifest | null;
  note?: string;
}

type ManifestInput = Omit<
  SkillManifest,
  "schemaVersion" | "approval" | "permissions" | "verification" | "limits"
> & {
  approval?: SkillManifest["approval"];
  permissions?: SkillManifest["permissions"];
  verification?: SkillManifest["verification"];
  limits?: SkillManifest["limits"];
};

/** Fill the optional manifest sections so installed files are always valid. */
export function buildManifest(input: ManifestInput): SkillManifest {
  return {
    schemaVersion: 1,
    ...input,
    permissions: input.permissions ?? {
      paths: { read: ["**/*"], write: ["**/*"] },
      commands: [],
      env: [],
    },
    approval: input.approval ?? { default: "ask", overrides: {} },
    verification: input.verification ?? {
      mode: "none",
      checks: [],
      timeoutMs: 300_000,
      stopOnFailure: true,
    },
    limits: input.limits ?? {
      maxFiles: 20,
      maxBytes: 1_048_576,
      timeoutMs: 300_000,
      maxOutputChars: 50_000,
    },
  };
}

const pathParam = {
  type: "string" as const,
  description: "ワークスペースからの相対パス",
  required: true,
  maxLength: 1024,
};

const codeEdit = buildManifest({
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
      params: { path: pathParam },
      timeoutMs: 5000,
    },
    {
      id: "editor.replaceText",
      handler: "editor.replaceText",
      description: "一意に一致する文字列を置換する",
      risk: "write",
      params: {
        path: pathParam,
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
        path: pathParam,
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
  verification: {
    mode: "auto",
    checks: ["typecheck", "lint", "test"],
    timeoutMs: 300_000,
    stopOnFailure: true,
  },
});

const docWriter = buildManifest({
  id: "doc-writer",
  name: "Doc Writer",
  description: "Markdown の下書きを作成し、決まった見出しや文言を置換する",
  version: "0.1.0",
  category: "editor",
  risk: "write",
  actions: [
    {
      id: "editor.createFile",
      handler: "editor.createFile",
      description: "新しい Markdown ファイルを作成する",
      risk: "write",
      params: {
        path: pathParam,
        content: {
          type: "string",
          description: "初期内容（Markdown）",
          required: false,
          maxLength: 100_000,
        },
      },
      timeoutMs: 30_000,
    },
    {
      id: "editor.replaceText",
      handler: "editor.replaceText",
      description: "テンプレートの見出しや定型文を置換する",
      risk: "write",
      params: {
        path: pathParam,
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
  ],
});

const codeInspector = buildManifest({
  id: "code-inspector",
  name: "Code Inspector",
  description: "変更を加えずにファイルを読み取り、内容を確認する",
  version: "0.1.0",
  category: "editor",
  risk: "read",
  actions: [
    {
      id: "editor.readFile",
      handler: "editor.readFile",
      description: "ファイルを読み取る（読み取り専用）",
      risk: "read",
      params: { path: pathParam },
      timeoutMs: 5000,
    },
  ],
  permissions: {
    paths: { read: ["**/*"], write: [] },
    commands: [],
    env: [],
  },
});

const gitOperation = buildManifest({
  id: "git-operation",
  name: "Git Operation",
  description: "Git の状態確認、差分取得、ステージ、ブランチ一覧、コミットを行う",
  version: "0.1.0",
  category: "git",
  risk: "write",
  actions: [
    {
      id: "git.status",
      handler: "git.status",
      description: "作業ツリーの状態と現在のブランチを取得する",
      risk: "read",
      params: {},
      timeoutMs: 10_000,
    },
    {
      id: "git.diff",
      handler: "git.diff",
      description: "指定ファイルの差分を取得する",
      risk: "read",
      params: {
        path: pathParam,
        staged: {
          type: "boolean",
          description: "ステージ済みの差分を取得する",
          required: false,
        },
      },
      timeoutMs: 30_000,
    },
    {
      id: "git.branches",
      handler: "git.branches",
      description: "ローカルブランチの一覧を取得する",
      risk: "read",
      params: {},
      timeoutMs: 10_000,
    },
    {
      id: "git.stage",
      handler: "git.stage",
      description: "指定ファイルをステージする",
      risk: "write",
      params: { path: pathParam },
      timeoutMs: 30_000,
    },
    {
      id: "git.stageAll",
      handler: "git.stageAll",
      description: "すべての変更をステージする",
      risk: "write",
      params: {},
      timeoutMs: 30_000,
    },
    {
      id: "git.commit",
      handler: "git.commit",
      description: "ステージ済みの変更をコミットする",
      risk: "write",
      params: {
        message: {
          type: "string",
          description: "コミットメッセージ",
          required: true,
          maxLength: 4_000,
        },
      },
      timeoutMs: 60_000,
    },
  ],
  permissions: {
    paths: { read: ["**/*"], write: [] },
    commands: [],
    env: [],
  },
  approval: {
    default: "ask",
    overrides: {
      "git.status": "allow",
      "git.diff": "allow",
      "git.branches": "allow",
    },
  },
  limits: {
    maxFiles: 20,
    maxBytes: 1_048_576,
    timeoutMs: 60_000,
    maxOutputChars: 50_000,
  },
});

const terminalCommand = buildManifest({
  id: "terminal-command",
  name: "Terminal Command",
  description: "許可されたプログラムをシェル文字列なしで直接実行する",
  version: "0.1.0",
  category: "terminal",
  risk: "write",
  actions: [
    {
      id: "terminal.run",
      handler: "terminal.run",
      description: "許可リストのプログラムを引数付きで実行する",
      risk: "write",
      params: {
        program: {
          type: "string",
          description: "実行するプログラム",
          required: true,
          maxLength: 64,
          enum: [
            "npm",
            "pnpm",
            "yarn",
            "cargo",
            "node",
            "python3",
            "pytest",
            "make",
          ],
        },
        args: {
          type: "string[]",
          description: "プログラムに渡す引数。シェル展開は行わない",
          required: false,
          maxItems: 32,
        },
      },
      timeoutMs: 300_000,
      maxOutputChars: 50_000,
    },
  ],
  permissions: {
    paths: { read: [], write: [] },
    commands: [
      { program: "npm", args: [] },
      { program: "pnpm", args: [] },
      { program: "yarn", args: [] },
      { program: "cargo", args: [] },
      { program: "node", args: [] },
      { program: "python3", args: [] },
      { program: "pytest", args: [] },
      { program: "make", args: [] },
    ],
    env: [],
  },
  limits: {
    maxFiles: 20,
    maxBytes: 1_048_576,
    timeoutMs: 300_000,
    maxOutputChars: 50_000,
  },
});

const debugControl = buildManifest({
  id: "debug-control",
  name: "Debug Control",
  description:
    "DAP デバッガの開始、停止、再開、ステップ実行、ブレークポイント、式評価を行う",
  version: "0.1.0",
  category: "debug",
  risk: "write",
  actions: [
    {
      id: "debug.start",
      handler: "debug.start",
      description: "デバッガを起動して対象プログラムを実行する",
      risk: "write",
      params: {
        adapter: {
          type: "string",
          description: "使用する DAP アダプター",
          required: true,
          maxLength: 64,
          enum: ["lldb-dap", "debugpy"],
        },
        program: {
          type: "string",
          description: "デバッグ対象の実行ファイル (ワークスペース相対または絶対パス)",
          required: true,
          maxLength: 1_024,
        },
      },
      timeoutMs: 60_000,
    },
    {
      id: "debug.stop",
      handler: "debug.stop",
      description: "デバッグセッションを終了する",
      risk: "write",
      params: {
        sessionId: {
          type: "string",
          description: "debug.start が返したセッション ID",
          required: true,
          maxLength: 128,
        },
      },
      timeoutMs: 10_000,
    },
    {
      id: "debug.continue",
      handler: "debug.continue",
      description: "停止中のスレッドを再開する",
      risk: "write",
      params: {
        sessionId: {
          type: "string",
          description: "デバッグセッション ID",
          required: true,
          maxLength: 128,
        },
        threadId: {
          type: "number",
          description: "再開するスレッド ID",
          required: true,
        },
      },
      timeoutMs: 10_000,
    },
    {
      id: "debug.next",
      handler: "debug.next",
      description: "次の行までステップオーバーする",
      risk: "write",
      params: {
        sessionId: {
          type: "string",
          description: "デバッグセッション ID",
          required: true,
          maxLength: 128,
        },
        threadId: {
          type: "number",
          description: "ステップするスレッド ID",
          required: true,
        },
      },
      timeoutMs: 10_000,
    },
    {
      id: "debug.stepIn",
      handler: "debug.stepIn",
      description: "関数の内部へステップインする",
      risk: "write",
      params: {
        sessionId: {
          type: "string",
          description: "デバッグセッション ID",
          required: true,
          maxLength: 128,
        },
        threadId: {
          type: "number",
          description: "ステップするスレッド ID",
          required: true,
        },
      },
      timeoutMs: 10_000,
    },
    {
      id: "debug.pause",
      handler: "debug.pause",
      description: "実行中のスレッドを一時停止する",
      risk: "write",
      params: {
        sessionId: {
          type: "string",
          description: "デバッグセッション ID",
          required: true,
          maxLength: 128,
        },
        threadId: {
          type: "number",
          description: "停止するスレッド ID",
          required: true,
        },
      },
      timeoutMs: 10_000,
    },
    {
      id: "debug.setBreakpoint",
      handler: "debug.setBreakpoint",
      description: "指定ファイルの行にブレークポイントを設定する",
      risk: "write",
      params: {
        sessionId: {
          type: "string",
          description: "デバッグセッション ID",
          required: true,
          maxLength: 128,
        },
        path: pathParam,
        line: {
          type: "number",
          description: "1 始まりの行番号",
          required: true,
        },
      },
      timeoutMs: 10_000,
    },
    {
      id: "debug.evaluate",
      handler: "debug.evaluate",
      description: "停止中のフレームで式を評価する",
      risk: "read",
      params: {
        sessionId: {
          type: "string",
          description: "デバッグセッション ID",
          required: true,
          maxLength: 128,
        },
        expression: {
          type: "string",
          description: "評価する式",
          required: true,
          maxLength: 4_000,
        },
        frameId: {
          type: "number",
          description: "対象フレーム ID",
          required: false,
        },
        context: {
          type: "string",
          description: "評価コンテキスト",
          required: false,
          maxLength: 32,
          enum: ["repl", "watch", "hover"],
        },
      },
      timeoutMs: 10_000,
    },
  ],
  permissions: {
    paths: { read: ["**/*"], write: [] },
    commands: [],
    env: [],
  },
  limits: {
    maxFiles: 20,
    maxBytes: 1_048_576,
    timeoutMs: 60_000,
    maxOutputChars: 50_000,
  },
});

export const SKILL_LIBRARY: SkillLibraryEntry[] = [
  {
    id: "code-edit",
    name: "Code Edit",
    tagline: "読む → 置換する → 検証する",
    description:
      "エージェントによるコード編集の最小単位です。対象ファイルを読み取り、1 回だけ一致する文字列を置換し、typecheck / lint / test で結果を確かめます。",
    category: "editor",
    status: "ready",
    tags: ["編集", "置換", "検証", "Rust ハンドラ"],
    useCases: [
      "設定値や文言を安全に置き換える",
      "新しいファイルの雛形を作る",
      "変更後に型検査とテストを自動で流す",
    ],
    examples: [
      {
        title: "バージョン表記を更新",
        prompt: "README.md の v0.3.3 を v0.3.4 に置き換えて",
      },
      {
        title: "小さなユーティリティを追加",
        prompt: "src/lib/slug.ts を作り、slugify 関数の雛形を書いて",
      },
    ],
    manifest: codeEdit,
  },
  {
    id: "doc-writer",
    name: "Doc Writer",
    tagline: "下書きをつくる、定型文を整える",
    description:
      "Markdown の作成と置換だけに絞ったライティング向けスキルです。コードを触らず、ドキュメントの追加やテンプレートの更新に使います。",
    category: "editor",
    status: "ready",
    tags: ["Markdown", "ドキュメント", "テンプレート"],
    useCases: [
      "リリースノートの下書きを作る",
      "議事録テンプレートの見出しを差し替える",
      "README の定型セクションを更新する",
    ],
    examples: [
      {
        title: "リリースノート",
        prompt: "docs/releases/v0.3.4.md を作り、変更点の見出しを入れて",
      },
    ],
    manifest: docWriter,
  },
  {
    id: "code-inspector",
    name: "Code Inspector",
    tagline: "読むだけ。変更しない",
    description:
      "読み取り専用のスキルです。Passive モードでも実行でき、ファイルの内容をエージェントに渡す前に人間が確認する用途に向きます。",
    category: "editor",
    status: "ready",
    tags: ["読み取り専用", "Passive", "安全"],
    useCases: [
      "変更前のファイル内容を確認する",
      "レビュー対象のコードを読み込む",
      "破壊的操作なしでエージェントに文脈を渡す",
    ],
    examples: [
      {
        title: "設定を確認",
        prompt: "src-tauri/tauri.conf.json を読んで、CSP の設定を説明して",
      },
    ],
    manifest: codeInspector,
  },
  {
    id: "git-operation",
    name: "Git Operation",
    tagline: "状態確認からコミットまで",
    description:
      "Git の状態確認・差分・ブランチ一覧・ステージ・コミットを Rust の固定ハンドラで実行します。読み取り系は承認なし、書き込み系は承認ダイアログを挟みます。",
    category: "git",
    status: "ready",
    tags: ["Git", "コミット", "差分", "ローカル"],
    useCases: [
      "変更内容を確認してからコミットする",
      "意図しないファイルをステージしない",
      "現在のブランチと差分をまとめて確認する",
    ],
    examples: [
      {
        title: "変更を整理",
        prompt: "変更を確認して、関連するファイルだけステージしてコミットして",
      },
      {
        title: "差分を確認",
        prompt: "src/App.tsx のステージ済み差分を見せて",
      },
    ],
    manifest: gitOperation,
    note: "Git の実行結果はローカルにのみ保存されます。push / reset --hard はハンドラに含めていません。",
  },
  {
    id: "terminal-command",
    name: "Terminal Command",
    tagline: "コマンドを安全に組み立てる",
    description:
      "許可リストのプログラムを、シェル文字列ではなく program + args で直接実行します。独立プロセスグループ・タイムアウト・出力上限を適用し、失敗はスキル実行の失敗として返します。",
    category: "terminal",
    status: "ready",
    tags: ["ターミナル", "コマンド", "許可リスト", "タイムアウト"],
    useCases: [
      "テストやビルドをエージェントから実行する",
      "出力を上限付きで取得して要約する",
      "シェルを介さずに引数を安全に渡す",
    ],
    examples: [
      {
        title: "テストを実行",
        prompt: "npm test を実行して、失敗したテストを要約して",
      },
      {
        title: "型検査を実行",
        prompt: "cargo check を実行して結果を要約して",
      },
    ],
    manifest: terminalCommand,
    note: "実行できるのは npm / pnpm / yarn / cargo / node / python3 / pytest / make のみです。シェル展開やパイプは使いません。",
  },
  {
    id: "debug-control",
    name: "Debug Control",
    tagline: "停止・再開・ブレークポイント",
    description:
      "lldb-dap / debugpy のセッションを開始し、停止・再開・ステップ実行・ブレークポイント・式評価を DAP の request/response で行います。Debug タブと同じセッションを共有します。",
    category: "debug",
    status: "ready",
    tags: ["DAP", "デバッグ", "ブレークポイント", "LLDB", "debugpy"],
    useCases: [
      "失敗したテストの停止位置を調べる",
      "スキルから変数を評価して原因を絞る",
      "実行中のプロセスを一時停止して状態を確認する",
    ],
    examples: [
      {
        title: "停止位置を確認",
        prompt: "失敗するテストをデバッグ実行して、停止した変数を要約して",
      },
      {
        title: "式を評価",
        prompt: "デバッグ中のフレームで items.length を評価して",
      },
    ],
    manifest: debugControl,
    note: "debug.start は initialize → launch → initialized → configurationDone の順でハンドシェイクします。セッションは Debug タブと共有されます。",
  },
];

export function findLibraryEntry(id: string): SkillLibraryEntry | null {
  return SKILL_LIBRARY.find((entry) => entry.id === id) ?? null;
}

export function manifestJson(entry: SkillLibraryEntry): string {
  if (!entry.manifest) return "";
  return `${JSON.stringify(entry.manifest, null, 2)}\n`;
}

export function skillPath(entry: SkillLibraryEntry): string {
  return `.agents/skills/${entry.id}.json`;
}

export function riskLabel(risk: SkillRisk): string {
  switch (risk) {
    case "read":
      return "読取";
    case "write":
      return "変更";
    case "destructive":
      return "破壊";
  }
}

export function categoryLabel(category: SkillCategory): string {
  switch (category) {
    case "editor":
      return "エディタ";
    case "git":
      return "Git";
    case "terminal":
      return "ターミナル";
    case "debug":
      return "デバッグ";
  }
}
