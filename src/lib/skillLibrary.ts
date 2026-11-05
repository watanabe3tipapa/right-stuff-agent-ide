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
      "Git の状態確認・差分・ステージ・コミットを宣言するスキルです。実行ハンドラは v0.4 で追加予定で、現在は設計カードとして表示しています。",
    category: "git",
    status: "planned",
    tags: ["Git", "コミット", "予定"],
    useCases: [
      "変更内容を確認してからコミットする",
      "意図しないファイルをステージしない",
    ],
    examples: [
      {
        title: "変更を整理",
        prompt: "変更を確認して、関連するファイルだけステージしてコミットして",
      },
    ],
    manifest: null,
    note: "Git ハンドラは v0.4 で実装予定です。現在の Git 操作は Git パネルから実行してください。",
  },
  {
    id: "terminal-command",
    name: "Terminal Command",
    tagline: "コマンドを安全に組み立てる",
    description:
      "統合ターミナルで実行するコマンドを宣言するスキルです。シェル文字列ではなく program + args で渡す設計で、v0.4 以降にハンドラを追加します。",
    category: "terminal",
    status: "planned",
    tags: ["ターミナル", "コマンド", "予定"],
    useCases: ["テストやビルドをエージェントから実行する"],
    examples: [
      {
        title: "テストを実行",
        prompt: "npm test を実行して、失敗したテストを要約して",
      },
    ],
    manifest: null,
    note: "ターミナルの直接操作は v0.4 の検証ループで実装予定です。",
  },
  {
    id: "debug-control",
    name: "Debug Control",
    tagline: "停止・再開・ブレークポイント",
    description:
      "DAP デバッガの操作を宣言するスキルです。v0.3.1 で IDE の Debug タブとして実装済みで、スキルからの操作は v0.4 以降の対象です。",
    category: "debug",
    status: "planned",
    tags: ["DAP", "デバッグ", "予定"],
    useCases: ["失敗したテストの停止位置を調べる"],
    examples: [
      {
        title: "停止位置を確認",
        prompt: "失敗するテストをデバッグ実行して、停止した変数を要約して",
      },
    ],
    manifest: null,
    note: "スキルから DAP を操作する機能は未実装です。Debug タブから利用してください。",
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
