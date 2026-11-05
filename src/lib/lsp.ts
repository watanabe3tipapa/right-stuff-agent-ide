import type { OpenFile } from "../stores/editorStore";
import { useEditorStore } from "../stores/editorStore";
import { useLspStore } from "../stores/lspStore";
import { api, errorMessage } from "./api";
import { monaco } from "./monaco";
import {
  applyTextEdits,
  codeActionsToMonaco,
  completionToMonaco,
  definitionTargets,
  diagnosticsToMarkers,
  fileUri,
  hoverToMarkdown,
  prepareRenameRange,
  relativeFromUri,
  symbolTargets,
  toLspPosition,
  toMonacoRange,
  workspaceEditFiles,
  type LspRange,
  type MonacoRangeLike,
  type WorkspaceFileEdit,
} from "./lspMapping";

const REQUEST_TIMEOUT_MS = 20_000;
const CHANGE_DEBOUNCE_MS = 300;
const MARKER_OWNER = "right-stuff-lsp";
const APPLY_ACTION_COMMAND = "rsai.lsp.applyCodeAction";

const PROVIDER_LANGUAGES = [
  "rust",
  "typescript",
  "javascript",
  "typescriptreact",
  "javascriptreact",
  "python",
  "go",
  "c",
  "cpp",
  "objective-c",
  "objective-cpp",
  "swift",
  "lua",
];

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: number;
}

interface RpcMessage {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

function modelPath(model: monaco.editor.ITextModel): string {
  const path = model.uri.path || model.uri.toString();
  return path.replace(/^\/+/, "");
}

function markerRange(model: monaco.editor.ITextModel, position: monaco.Position): MonacoRangeLike {
  const word = model.getWordUntilPosition(position);
  return {
    startLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endLineNumber: position.lineNumber,
    endColumn: word.endColumn,
  };
}

function toLspSeverity(severity: number): number {
  if (severity === monaco.MarkerSeverity.Error) return 1;
  if (severity === monaco.MarkerSeverity.Warning) return 2;
  if (severity === monaco.MarkerSeverity.Info) return 3;
  return 4;
}

/**
 * Apply a parsed `WorkspaceEdit` through the editor store so unopened files
 * gain a tab and every change stays reviewable (and undoable via the tab).
 */
async function applyWorkspaceEdits(files: WorkspaceFileEdit[]): Promise<number> {
  let changed = 0;
  for (const file of files) {
    const store = useEditorStore.getState();
    if (!store.files[file.path]) {
      await store.openFile(file.path);
    }
    const current = useEditorStore.getState().files[file.path];
    if (!current) continue;
    const next = applyTextEdits(current.content, file.edits);
    if (next === current.content) continue;
    useEditorStore.getState().updateContent(file.path, next);
    changed += 1;
  }
  return changed;
}

class LspClient {
  readonly id: string;
  readonly language: string;
  readonly root: string;
  readonly command: string[];

  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly versions = new Map<string, number>();
  private readonly diagnostics = new Map<string, number>();
  private initialized = false;
  private disposed = false;
  private lastLog = "";

  constructor(id: string, language: string, root: string, command: string[]) {
    this.id = id;
    this.language = language;
    this.root = root;
    this.command = command;
  }

  async initialize(): Promise<void> {
    const rootUri = fileUri(this.root, "").replace(/\/$/, "");
    await this.request("initialize", {
      processId: null,
      clientInfo: { name: "right-stuff-agent-ide", version: "0.3.3" },
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: rootUri.split("/").pop() ?? "workspace" }],
      capabilities: {
        workspace: {
          workspaceFolders: true,
          configuration: false,
          symbol: {},
        },
        textDocument: {
          synchronization: { dynamicRegistration: false, didSave: true },
          completion: {
            dynamicRegistration: false,
            completionItem: {
              snippetSupport: true,
              documentationFormat: ["markdown", "plaintext"],
            },
          },
          hover: { dynamicRegistration: false, contentFormat: ["markdown", "plaintext"] },
          definition: { dynamicRegistration: false },
          references: { dynamicRegistration: false },
          rename: { dynamicRegistration: false, prepareSupport: true },
          codeAction: {
            dynamicRegistration: false,
            codeActionLiteralSupport: {
              codeActionKind: {
                valueSet: [
                  "quickfix",
                  "refactor",
                  "refactor.extract",
                  "refactor.inline",
                  "refactor.rewrite",
                  "source",
                  "source.organizeImports",
                  "source.fixAll",
                ],
              },
            },
          },
          publishDiagnostics: { relatedInformation: true },
        },
      },
    });
    this.initialized = true;
    this.notify("initialized", {});
  }

  openFile(path: string, languageId: string, text: string): void {
    if (this.disposed || !this.initialized) return;
    this.versions.set(path, 1);
    this.notify("textDocument/didOpen", {
      textDocument: {
        uri: fileUri(this.root, path),
        languageId,
        version: 1,
        text,
      },
    });
  }

  changeFile(path: string, languageId: string, text: string): void {
    if (this.disposed || !this.initialized) return;
    const version = (this.versions.get(path) ?? 0) + 1;
    this.versions.set(path, version);
    this.notify("textDocument/didChange", {
      textDocument: { uri: fileUri(this.root, path), version },
      contentChanges: [{ text }],
    });
    if (languageId !== this.language) {
      // The server was started for a different language id; keep the file open
      // but do not mislabel it in didOpen.
      return;
    }
  }

  saveFile(path: string, text: string): void {
    if (this.disposed || !this.initialized) return;
    this.notify("textDocument/didSave", {
      textDocument: { uri: fileUri(this.root, path) },
      text,
    });
  }

  closeFile(path: string): void {
    if (this.disposed) return;
    this.versions.delete(path);
    this.clearDiagnostics(path);
    if (!this.initialized) return;
    this.notify("textDocument/didClose", {
      textDocument: { uri: fileUri(this.root, path) },
    });
  }

  async request(method: string, params: unknown): Promise<unknown> {
    if (this.disposed) throw new Error("LSP セッションは終了しています。");
    const id = this.nextId++;
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP リクエストがタイムアウトしました: ${method}`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
    });
    void api.lspSend(this.id, { jsonrpc: "2.0", id, method, params });
    return promise;
  }

  notify(method: string, params: unknown): void {
    if (this.disposed) return;
    void api.lspSend(this.id, { jsonrpc: "2.0", method, params });
  }

  respond(id: number | string, result: unknown): void {
    if (this.disposed) return;
    void api.lspSend(this.id, { jsonrpc: "2.0", id, result });
  }

  handleMessage(raw: unknown): void {
    const message = raw as RpcMessage;
    if (message.method) {
      if (message.id !== undefined) {
        this.handleServerRequest(message);
      } else {
        this.handleNotification(message);
      }
      return;
    }
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      window.clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new Error(message.error.message));
      } else {
        pending.resolve(message.result);
      }
    }
  }

  private handleServerRequest(message: RpcMessage): void {
    const method = message.method ?? "";
    if (method === "workspace/configuration") {
      const items = (message.params as { items?: unknown[] } | undefined)?.items ?? [];
      this.respond(message.id!, items.map(() => null));
      return;
    }
    if (method === "workspace/applyEdit") {
      void this.applyServerWorkspaceEdit(message.id!, message.params);
      return;
    }
    // Unknown server→client requests must still be answered, otherwise a
    // server can block waiting for a response it will never receive.
    this.respond(message.id!, null);
  }

  private async applyServerWorkspaceEdit(id: number | string, params: unknown): Promise<void> {
    const edit = (params as { edit?: unknown } | undefined)?.edit;
    const { files, unsupported } = workspaceEditFiles(edit, this.root);
    if (unsupported.length > 0 || files.length === 0) {
      this.respond(id, { applied: false, failureReason: "未対応のワークスペース編集です。" });
      return;
    }
    const changed = await applyWorkspaceEdits(files);
    this.respond(id, { applied: changed > 0 });
  }

  private handleNotification(message: RpcMessage): void {
    const method = message.method ?? "";
    if (method === "textDocument/publishDiagnostics") {
      this.publishDiagnostics(message.params);
      return;
    }
    if (method === "window/logMessage") {
      const text = (message.params as { message?: string } | undefined)?.message;
      if (text) this.lastLog = text;
    }
  }

  private publishDiagnostics(params: unknown): void {
    const payload = params as { uri?: string; diagnostics?: unknown[] } | undefined;
    if (!payload?.uri) return;
    const path = relativeFromUri(this.root, payload.uri);
    if (path === null) return;

    const model = monaco.editor.getModel(monaco.Uri.parse(path));
    const markers = diagnosticsToMarkers(payload);
    if (model) {
      monaco.editor.setModelMarkers(
        model,
        MARKER_OWNER,
        markers as monaco.editor.IMarkerData[],
      );
    }

    this.diagnostics.set(path, markers.length);
    const total = [...this.diagnostics.values()].reduce((sum, count) => sum + count, 0);
    useLspStore.getState().setDiagnostics(this.language, total);
  }

  private clearDiagnostics(path: string): void {
    if (!this.diagnostics.has(path)) return;
    this.diagnostics.delete(path);
    const model = monaco.editor.getModel(monaco.Uri.parse(path));
    if (model) monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
    const total = [...this.diagnostics.values()].reduce((sum, count) => sum + count, 0);
    useLspStore.getState().setDiagnostics(this.language, total);
  }

  lastMessage(): string {
    return this.lastLog;
  }

  noteLog(line: string): void {
    this.lastLog = line;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timer);
      pending.reject(new Error("LSP セッションを終了しました。"));
    }
    this.pending.clear();
    await api.lspStop(this.id);
  }
}

interface TrackedFile {
  language: string;
  text: string;
  saved: string;
}

let initialized: Promise<void> | null = null;
let root: string | null = null;
let disposed = false;

const clients = new Map<string, LspClient>();
const clientsByLanguage = new Map<string, LspClient>();
const starting = new Map<string, Promise<LspClient | null>>();
const tracked = new Map<string, TrackedFile>();
const changeTimers = new Map<string, number>();
const listeners: Array<() => void> = [];
let providersRegistered = false;

function clientForLanguage(language: string): LspClient | undefined {
  return clientsByLanguage.get(language);
}

function registerProviders(): void {
  if (providersRegistered) return;
  providersRegistered = true;

  monaco.editor.registerCommand(
    APPLY_ACTION_COMMAND,
    (
      _accessor,
      payload:
        | {
            files?: WorkspaceFileEdit[];
            command?: { command: string; arguments?: unknown[] };
            clientId?: string;
          }
        | undefined,
    ) => {
      void (async () => {
        if (payload?.files && payload.files.length > 0) {
          await applyWorkspaceEdits(payload.files);
        }
        if (payload?.command && payload.clientId) {
          const client = clients.get(payload.clientId);
          if (client) {
            try {
              await client.request("workspace/executeCommand", payload.command);
            } catch (error) {
              useLspStore.getState().setStatus(client.language, {
                message: errorMessage(error),
              });
            }
          }
        }
      })();
    },
  );

  for (const language of PROVIDER_LANGUAGES) {
    monaco.languages.registerCompletionItemProvider(language, {
      triggerCharacters: [".", ":", "/", "@", "<", '"', "'"],
      provideCompletionItems: async (model, position) => {
        const client = clientForLanguage(model.getLanguageId());
        if (!client) return null;
        try {
          const result = (await client.request("textDocument/completion", {
            textDocument: { uri: fileUri(client.root, modelPath(model)) },
            position: toLspPosition(position.lineNumber, position.column),
          })) as { items?: unknown[] } | unknown[] | null;
          const items = Array.isArray(result) ? result : (result?.items ?? []);
          const range = markerRange(model, position);
          const suggestions = items
            .map((item) => completionToMonaco(item, range))
            .filter(
              (item): item is NonNullable<ReturnType<typeof completionToMonaco>> =>
                item !== null,
            )
            .map((item) => item as monaco.languages.CompletionItem);
          return { suggestions };
        } catch {
          return null;
        }
      },
    });

    monaco.languages.registerDefinitionProvider(language, {
      provideDefinition: async (model, position) => {
        const client = clientForLanguage(model.getLanguageId());
        if (!client) return null;
        try {
          const result = await client.request("textDocument/definition", {
            textDocument: { uri: fileUri(client.root, modelPath(model)) },
            position: toLspPosition(position.lineNumber, position.column),
          });
          return definitionTargets(result)
            .map((target) => {
              const path = relativeFromUri(client.root, target.uri);
              if (path === null) return null;
              return {
                uri: monaco.Uri.parse(path),
                range: toMonacoRange(target.range) as monaco.IRange,
              };
            })
            .filter((location): location is monaco.languages.Location => location !== null);
        } catch {
          return null;
        }
      },
    });

    monaco.languages.registerHoverProvider(language, {
      provideHover: async (model, position) => {
        const client = clientForLanguage(model.getLanguageId());
        if (!client) return null;
        try {
          const result = (await client.request("textDocument/hover", {
            textDocument: { uri: fileUri(client.root, modelPath(model)) },
            position: toLspPosition(position.lineNumber, position.column),
          })) as { contents?: unknown } | null;
          const value = hoverToMarkdown(result?.contents);
          if (!value) return null;
          return { contents: [{ value }] };
        } catch {
          return null;
        }
      },
    });

    monaco.languages.registerReferenceProvider(language, {
      provideReferences: async (model, position, context) => {
        const client = clientForLanguage(model.getLanguageId());
        if (!client) return null;
        try {
          const result = await client.request("textDocument/references", {
            textDocument: { uri: fileUri(client.root, modelPath(model)) },
            position: toLspPosition(position.lineNumber, position.column),
            context: { includeDeclaration: context.includeDeclaration },
          });
          return definitionTargets(result)
            .map((target) => {
              const path = relativeFromUri(client.root, target.uri);
              if (path === null) return null;
              return {
                uri: monaco.Uri.parse(path),
                range: toMonacoRange(target.range) as monaco.IRange,
              };
            })
            .filter((location): location is monaco.languages.Location => location !== null);
        } catch {
          return null;
        }
      },
    });

    monaco.languages.registerRenameProvider(language, {
      resolveRenameLocation: async (model, position) => {
        const client = clientForLanguage(model.getLanguageId());
        if (!client) return null;
        try {
          const result = await client.request("textDocument/prepareRename", {
            textDocument: { uri: fileUri(client.root, modelPath(model)) },
            position: toLspPosition(position.lineNumber, position.column),
          });
          const range = prepareRenameRange(result);
          if (!range) {
            return {
              range: markerRange(model, position) as monaco.IRange,
              text: model.getWordAtPosition(position)?.word ?? "",
              rejectReason: "この位置は名前変更できません。",
            };
          }
          const placeholder =
            typeof (result as { placeholder?: unknown } | null)?.placeholder === "string"
              ? String((result as { placeholder: string }).placeholder)
              : model.getWordAtPosition(position)?.word ?? "";
          return { range: range as monaco.IRange, text: placeholder };
        } catch {
          return null;
        }
      },
      provideRenameEdits: async (model, position, newName) => {
        const client = clientForLanguage(model.getLanguageId());
        if (!client) return { edits: [], rejectReason: "LSP が利用できません。" };
        try {
          const result = await client.request("textDocument/rename", {
            textDocument: { uri: fileUri(client.root, modelPath(model)) },
            position: toLspPosition(position.lineNumber, position.column),
            newName,
          });
          const { files, unsupported } = workspaceEditFiles(result, client.root);
          if (unsupported.length > 0) {
            return {
              edits: [],
              rejectReason: `未対応のワークスペース編集です: ${unsupported.join(", ")}`,
            };
          }
          const changed = await applyWorkspaceEdits(files);
          if (changed === 0) {
            return { edits: [], rejectReason: "変更はありませんでした。" };
          }
          // The store already holds the new text, so Monaco must not apply the
          // edit a second time.
          return { edits: [] };
        } catch (error) {
          return { edits: [], rejectReason: errorMessage(error) };
        }
      },
    });

    monaco.languages.registerCodeActionProvider(language, {
      provideCodeActions: async (model, range, context) => {
        const client = clientForLanguage(model.getLanguageId());
        if (!client) return { actions: [], dispose: () => {} };
        try {
          const result = await client.request("textDocument/codeAction", {
            textDocument: { uri: fileUri(client.root, modelPath(model)) },
            range: {
              start: toLspPosition(range.startLineNumber, range.startColumn),
              end: toLspPosition(range.endLineNumber, range.endColumn),
            },
            context: {
              diagnostics: context.markers.map((marker) => ({
                range: {
                  start: toLspPosition(marker.startLineNumber, marker.startColumn),
                  end: toLspPosition(marker.endLineNumber, marker.endColumn),
                },
                severity: toLspSeverity(marker.severity),
                message: marker.message,
                ...(marker.source ? { source: marker.source } : {}),
                ...(marker.code ? { code: marker.code } : {}),
              })),
              triggerKind: 1,
            },
          });

          const actions: monaco.languages.CodeAction[] = codeActionsToMonaco(
            result,
            client.root,
          )
            .filter((action) => !action.disabled)
            .map((action) => ({
              title: action.title,
              ...(action.kind ? { kind: action.kind } : {}),
              ...(action.isPreferred ? { isPreferred: true } : {}),
              command: {
                id: APPLY_ACTION_COMMAND,
                title: action.title,
                arguments: [
                  {
                    files: action.edits,
                    ...(action.command ? { command: action.command } : {}),
                    clientId: client.id,
                  },
                ],
              },
            }));

          return { actions, dispose: () => {} };
        } catch {
          return { actions: [], dispose: () => {} };
        }
      },
    });
  }
}

async function setup(): Promise<void> {
  listeners.push(
    await api.onLspMessage((payload) => {
      clients.get(payload.id)?.handleMessage(payload.message);
    }),
  );
  listeners.push(
    await api.onLspExit((payload) => {
      const client = clients.get(payload.id);
      if (!client) return;
      clients.delete(payload.id);
      if (clientsByLanguage.get(client.language) === client) {
        clientsByLanguage.delete(client.language);
      }
      if (disposed) return;
      useLspStore.getState().setStatus(client.language, {
        status: "error",
        message:
          client.lastMessage() ||
          "Language Server が終了しました。ワークスペースを開き直すと再起動します。",
      });
    }),
  );
  listeners.push(
    await api.onLspLog((payload) => {
      const client = clients.get(payload.id);
      if (client && payload.line.trim()) client.noteLog(payload.line);
    }),
  );
  registerProviders();
  await useLspStore.getState().refreshServers();
}

export function initLsp(): Promise<void> {
  initialized ??= setup();
  return initialized;
}

function serverFor(language: string) {
  return useLspStore.getState().servers.find((server) => server.language === language);
}

async function ensureClient(language: string): Promise<LspClient | null> {
  const existing = clientsByLanguage.get(language);
  if (existing) return existing;

  const pending = starting.get(language);
  if (pending) return pending;

  const promise = (async () => {
    const server = serverFor(language);
    if (!server) {
      useLspStore.getState().setStatus(language, {
        language,
        label: language,
        status: "unsupported",
        message: "この言語の Language Server は未対応です。",
        command: [],
      });
      return null;
    }
    if (!server.available) {
      useLspStore.getState().setStatus(language, {
        language,
        label: server.label,
        status: "unsupported",
        message: `${server.label} が見つかりません。${server.install} で導入してください。`,
        command: server.command,
      });
      return null;
    }

    useLspStore.getState().setStatus(language, {
      language,
      label: server.label,
      status: "starting",
      message: null,
      command: server.command,
    });

    try {
      const start = await api.lspStart(language);
      const client = new LspClient(start.id, language, start.root, start.command);
      clients.set(start.id, client);
      clientsByLanguage.set(language, client);
      await client.initialize();
      useLspStore.getState().setStatus(language, {
        language,
        label: server.label,
        status: "ready",
        message: null,
        command: start.command,
      });
      return client;
    } catch (error) {
      useLspStore.getState().setStatus(language, {
        language,
        label: server.label,
        status: "error",
        message: errorMessage(error),
        command: server.command,
      });
      return null;
    } finally {
      starting.delete(language);
    }
  })();

  starting.set(language, promise);
  return promise;
}

function openTracked(path: string, file: OpenFile): void {
  const previous = tracked.get(path);
  if (previous?.language !== file.language) {
    const previousClient = clientForLanguage(previous?.language ?? "");
    previousClient?.closeFile(path);
  }
  tracked.set(path, {
    language: file.language,
    text: file.content,
    saved: file.savedContent,
  });

  void ensureClient(file.language).then((client) => {
    if (!client || disposed) return;
    const current = tracked.get(path);
    if (!current || current.language !== file.language) return;
    client.openFile(path, file.language, file.content);
  });
}

function changeTracked(path: string, file: OpenFile): void {
  const current = tracked.get(path);
  if (!current) {
    openTracked(path, file);
    return;
  }
  current.text = file.content;

  const existing = changeTimers.get(path);
  if (existing !== undefined) window.clearTimeout(existing);
  const timer = window.setTimeout(() => {
    changeTimers.delete(path);
    const entry = tracked.get(path);
    if (!entry) return;
    clientForLanguage(entry.language)?.changeFile(path, entry.language, entry.text);
  }, CHANGE_DEBOUNCE_MS);
  changeTimers.set(path, timer);
}

function closeTracked(path: string): void {
  const entry = tracked.get(path);
  const timer = changeTimers.get(path);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    changeTimers.delete(path);
  }
  if (!entry) return;
  tracked.delete(path);
  clientForLanguage(entry.language)?.closeFile(path);

  const stillUsed = [...tracked.values()].some((item) => item.language === entry.language);
  if (!stillUsed) {
    const client = clientsByLanguage.get(entry.language);
    if (client) {
      clientsByLanguage.delete(entry.language);
      clients.delete(client.id);
      void client.dispose();
    }
  }
}

async function disposeAll(): Promise<void> {
  for (const timer of changeTimers.values()) window.clearTimeout(timer);
  changeTimers.clear();
  tracked.clear();
  const active = [...clients.values()];
  clients.clear();
  clientsByLanguage.clear();
  starting.clear();
  await Promise.all(active.map((client) => client.dispose()));
}

/** Switch to a new workspace (or null) and stop servers bound to the old one. */
export async function setLspRoot(nextRoot: string | null): Promise<void> {
  await initLsp();
  if (root === nextRoot) return;
  root = nextRoot;
  await disposeAll();
  useLspStore.getState().reset();
  await useLspStore.getState().refreshServers();
}

/** Mirror the editor's open tabs into LSP didOpen/didChange/didClose calls. */
export async function syncLspFiles(
  nextRoot: string | null,
  files: Record<string, OpenFile>,
): Promise<void> {
  await initLsp();
  if (disposed) return;
  if (!nextRoot) {
    await setLspRoot(null);
    return;
  }
  if (root !== nextRoot) await setLspRoot(nextRoot);

  const paths = new Set(Object.keys(files));
  for (const [path, file] of Object.entries(files)) {
    const entry = tracked.get(path);
    if (!entry || entry.language !== file.language) {
      openTracked(path, file);
      continue;
    }
    if (entry.text !== file.content) {
      changeTracked(path, file);
    }
    if (entry.saved !== file.savedContent) {
      entry.saved = file.savedContent;
      clientForLanguage(entry.language)?.saveFile(path, file.content);
    }
  }
  for (const path of [...tracked.keys()]) {
    if (!paths.has(path)) closeTracked(path);
  }
}

export interface WorkspaceSymbol {
  name: string;
  kind: number;
  containerName?: string;
  path: string;
  range: MonacoRangeLike;
}

/**
 * Query every running language server for workspace symbols. Results from
 * different languages are merged and de-duplicated by location.
 */
export async function searchWorkspaceSymbols(query: string): Promise<WorkspaceSymbol[]> {
  await initLsp();
  if (disposed || !root) return [];

  const activePath = useEditorStore.getState().activePath;
  const activeLanguage = activePath
    ? useEditorStore.getState().files[activePath]?.language
    : undefined;
  if (activeLanguage) await ensureClient(activeLanguage);

  const responses = await Promise.all(
    [...clients.values()].map(async (client) => {
      try {
        const result = await client.request("workspace/symbol", { query });
        return symbolTargets(result).flatMap((symbol): WorkspaceSymbol[] => {
          const path = relativeFromUri(client.root, symbol.uri);
          if (path === null) return [];
          return [
            {
              name: symbol.name,
              kind: symbol.kind,
              ...(symbol.containerName ? { containerName: symbol.containerName } : {}),
              path,
              range: toMonacoRange(symbol.range as LspRange),
            },
          ];
        });
      } catch {
        return [];
      }
    }),
  );

  const seen = new Set<string>();
  return responses.flat().filter((symbol) => {
    const key = `${symbol.path}:${symbol.range.startLineNumber}:${symbol.range.startColumn}:${symbol.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function notifyLspSaved(path: string): void {
  const entry = tracked.get(path);
  if (!entry) return;
  clientForLanguage(entry.language)?.saveFile(path, entry.text);
}

/** Touch a file after saving so the server sees the on-disk text. */
export function refreshLspAfterSave(path: string): void {
  const entry = tracked.get(path);
  if (!entry) return;
  clientForLanguage(entry.language)?.saveFile(path, entry.text);
}

export async function disposeLsp(): Promise<void> {
  disposed = true;
  for (const listener of listeners) listener();
  listeners.length = 0;
  await disposeAll();
  initialized = null;
}
