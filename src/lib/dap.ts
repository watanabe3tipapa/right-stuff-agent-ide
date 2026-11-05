import { useDapStore, type DapVariable } from "../stores/dapStore";
import { api, errorMessage } from "./api";

const REQUEST_TIMEOUT_MS = 20_000;
const LAUNCH_TIMEOUT_MS = 60_000;

interface DapResponse {
  seq?: number;
  type: "response";
  request_seq?: number;
  success?: boolean;
  command?: string;
  message?: string;
  body?: Record<string, unknown>;
}

interface DapEvent {
  type: "event";
  event?: string;
  body?: Record<string, unknown>;
}

interface DapRequest {
  type: "request";
  seq?: number;
  command?: string;
}

type DapMessage = DapResponse | DapEvent | DapRequest;

interface PendingRequest {
  resolve: (body: Record<string, unknown>) => void;
  reject: (reason: unknown) => void;
  timer: number;
}

function absolutePath(root: string, path: string): string {
  return `${root.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function relativePath(root: string, absolute: string): string | null {
  const normalized = root.replace(/\/+$/, "");
  if (absolute === normalized) return "";
  if (!absolute.startsWith(`${normalized}/`)) return null;
  return absolute.slice(normalized.length + 1);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function mapVariables(value: unknown): DapVariable[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const item = asRecord(raw);
    return {
      name: String(item.name ?? ""),
      value: String(item.value ?? ""),
      ...(typeof item.type === "string" ? { type: item.type } : {}),
      variablesReference:
        typeof item.variablesReference === "number" ? item.variablesReference : 0,
    };
  });
}

class DapClient {
  readonly id: string;
  readonly root: string;
  readonly adapter: string;

  onEvent: (event: string, body: Record<string, unknown>) => void = () => {};
  onClosed: () => void = () => {};

  private nextSeq = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private closed = false;

  constructor(id: string, root: string, adapter: string) {
    this.id = id;
    this.root = root;
    this.adapter = adapter;
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      clientID: "right-stuff-agent-ide",
      clientName: "Right-Stuff Agent IDE",
      adapterID: this.adapter,
      pathFormat: "path",
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsVariableType: true,
      supportsRunInTerminalRequest: false,
    });
  }

  /** Fire the launch request without awaiting it; adapters answer after the
   * debuggee stops or exits, which can be much later than the request. */
  launch(program: string): void {
    void this.request(
      "launch",
      {
        program,
        cwd: this.root,
        stopOnEntry: false,
      },
      LAUNCH_TIMEOUT_MS,
    ).catch((error) => {
      if (this.closed) return;
      useDapStore.getState().setError(errorMessage(error));
    });
  }

  request(
    command: string,
    args: Record<string, unknown> = {},
    timeout = REQUEST_TIMEOUT_MS,
  ): Promise<Record<string, unknown>> {
    const seq = this.nextSeq++;
    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`DAP リクエストがタイムアウトしました: ${command}`));
      }, timeout);
      this.pending.set(seq, { resolve, reject, timer });
    });

    void api
      .dapSend(this.id, { seq, type: "request", command, arguments: args })
      .catch((error) => {
        const pending = this.pending.get(seq);
        if (!pending) return;
        this.pending.delete(seq);
        window.clearTimeout(pending.timer);
        pending.reject(error);
      });

    return promise;
  }

  handleMessage(raw: unknown): void {
    const message = raw as DapMessage;
    if (!message || typeof message !== "object") return;

    if (message.type === "response") {
      const response = message as DapResponse;
      if (typeof response.request_seq !== "number") return;
      const pending = this.pending.get(response.request_seq);
      if (!pending) return;
      this.pending.delete(response.request_seq);
      window.clearTimeout(pending.timer);
      if (response.success === false) {
        pending.reject(new Error(response.message ?? `DAP ${response.command ?? ""} が失敗しました。`));
      } else {
        pending.resolve(asRecord(response.body));
      }
      return;
    }

    if (message.type === "event") {
      const event = message as DapEvent;
      this.onEvent(event.event ?? "", asRecord(event.body));
      return;
    }

    if (message.type === "request") {
      // The IDE does not expose runInTerminal or other client features yet.
      const request = message as DapRequest;
      if (typeof request.seq === "number") {
        void api.dapSend(this.id, {
          seq: this.nextSeq++,
          type: "response",
          request_seq: request.seq,
          success: false,
          command: request.command ?? "",
          message: "この要求はサポートされていません。",
        });
      }
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    try {
      await this.request("disconnect", { terminateDebuggee: true }, 3000);
    } catch {
      // The adapter may already be gone.
    }
    this.closed = true;
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timer);
      pending.reject(new Error("デバッグセッションを終了しました。"));
    }
    this.pending.clear();
    await api.dapStop(this.id);
    this.onClosed();
  }
}

let active: DapClient | null = null;
let initialized: Promise<void> | null = null;

async function setup(): Promise<void> {
  await api.onDapMessage((payload) => {
    if (active?.id === payload.id) active.handleMessage(payload.message);
  });
  await api.onDapExit((payload) => {
    if (active?.id !== payload.id) return;
    const client = active;
    active = null;
    useDapStore.getState().endSession();
    useDapStore.getState().appendOutput("\n[debug] デバッグセッションが終了しました。\n");
    void api.dapStop(client.id).catch(() => undefined);
  });
  await api.onDapLog((payload) => {
    if (active?.id !== payload.id) return;
    const line = payload.line.trim();
    if (line) useDapStore.getState().setError(line);
  });
  await refreshDapAdapters();
}

export function initDap(): Promise<void> {
  initialized ??= setup();
  return initialized;
}

export async function refreshDapAdapters(): Promise<void> {
  try {
    const adapters = await api.dapAdapters();
    useDapStore.getState().setAdapters(adapters);
  } catch (error) {
    useDapStore.getState().setError(errorMessage(error));
  }
}

async function pushBreakpoints(
  client: DapClient,
  path: string,
  lines: number[],
): Promise<void> {
  try {
    await client.request("setBreakpoints", {
      source: { path: absolutePath(client.root, path) },
      breakpoints: lines.map((line) => ({ line })),
      lines,
      sourceModified: false,
    });
  } catch (error) {
    useDapStore.getState().setError(errorMessage(error));
  }
}

async function pushAllBreakpoints(client: DapClient): Promise<void> {
  const breakpoints = useDapStore.getState().breakpoints;
  await Promise.all(
    Object.entries(breakpoints).map(([path, lines]) =>
      pushBreakpoints(client, path, lines),
    ),
  );
}

async function refreshScopes(client: DapClient, frameId: number): Promise<void> {
  try {
    const body = await client.request("scopes", { frameId });
    const scopes = Array.isArray(body.scopes)
      ? body.scopes.map((raw) => {
          const item = asRecord(raw);
          return {
            name: String(item.name ?? ""),
            variablesReference:
              typeof item.variablesReference === "number" ? item.variablesReference : 0,
            expensive: item.expensive === true,
          };
        })
      : [];
    useDapStore.getState().setScopes(scopes);

    await Promise.all(
      scopes
        .filter((scope) => scope.variablesReference > 0)
        .map(async (scope) => {
          try {
            const variables = await client.request("variables", {
              variablesReference: scope.variablesReference,
            });
            useDapStore.getState().setVariables(
              scope.variablesReference,
              mapVariables(variables.variables),
            );
          } catch {
            // A scope can expire while the program keeps running.
          }
        }),
    );
  } catch (error) {
    useDapStore.getState().setError(errorMessage(error));
  }
}

async function refreshStack(client: DapClient, threadId: number): Promise<void> {
  try {
    const body = await client.request("stackTrace", {
      threadId,
      startFrame: 0,
      levels: 50,
    });
    const frames = Array.isArray(body.stackFrames)
      ? body.stackFrames.map((raw) => {
          const frame = asRecord(raw);
          const source = asRecord(frame.source);
          const absolute = typeof source.path === "string" ? source.path : null;
          return {
            id: typeof frame.id === "number" ? frame.id : 0,
            name: String(frame.name ?? ""),
            path: absolute ? relativePath(client.root, absolute) : null,
            line: typeof frame.line === "number" ? frame.line : 1,
            column: typeof frame.column === "number" ? frame.column : 1,
          };
        })
      : [];
    const frameId = frames[0]?.id ?? null;
    useDapStore.getState().setStack(frames, frameId);
    if (frameId !== null) await refreshScopes(client, frameId);
  } catch (error) {
    useDapStore.getState().setError(errorMessage(error));
  }
}

async function refreshThreads(client: DapClient, preferred?: number): Promise<void> {
  try {
    const body = await client.request("threads", {});
    const threads = Array.isArray(body.threads)
      ? body.threads.map((raw) => {
          const thread = asRecord(raw);
          return {
            id: typeof thread.id === "number" ? thread.id : 0,
            name: String(thread.name ?? ""),
          };
        })
      : [];
    const threadId =
      preferred ?? threads.find((thread) => thread.id > 0)?.id ?? null;
    useDapStore.getState().setThreads(threads, threadId);
    if (threadId !== null) await refreshStack(client, threadId);
  } catch (error) {
    useDapStore.getState().setError(errorMessage(error));
  }
}

async function handleEvent(
  client: DapClient,
  event: string,
  body: Record<string, unknown>,
): Promise<void> {
  if (active !== client) return;
  const store = useDapStore.getState();

  if (event === "initialized") {
    await pushAllBreakpoints(client);
    try {
      await client.request("configurationDone", {});
    } catch (error) {
      store.setError(errorMessage(error));
    }
    if (active === client) store.setStatus("running");
    return;
  }

  if (event === "stopped") {
    store.setStatus("paused");
    const threadId =
      typeof body.threadId === "number" ? body.threadId : undefined;
    await refreshThreads(client, threadId);
    return;
  }

  if (event === "continued") {
    store.setStatus("running");
    store.setStack([], null);
    store.setScopes([]);
    return;
  }

  if (event === "output") {
    const text = typeof body.output === "string" ? body.output : "";
    if (text) store.appendOutput(text);
    return;
  }

  if (event === "terminated" || event === "exited") {
    if (event === "exited" && typeof body.exitCode === "number") {
      store.appendOutput(`\n[debug] 終了コード ${body.exitCode}\n`);
    }
    store.setStatus("stopped");
    return;
  }
}

export async function startDebug(
  adapter: string,
  program: string | null,
): Promise<void> {
  await initDap();
  const store = useDapStore.getState();
  if (active) await stopDebug();

  store.setStatus("starting");
  store.setError(null);
  store.clearOutput();

  try {
    const start = await api.dapStart(adapter, program);
    const client = new DapClient(start.id, start.root, adapter);
    active = client;
    client.onEvent = (event, body) => {
      void handleEvent(client, event, body);
    };
    client.onClosed = () => {
      if (active === client) active = null;
    };

    useDapStore.getState().beginSession({
      id: start.id,
      adapter,
      program: start.program,
      root: start.root,
    });

    await client.initialize();
    if (!start.program) {
      throw new Error(
        "起動するプログラムを指定してください（デバッグ対象の実行ファイルを選択）。",
      );
    }
    client.launch(start.program);
  } catch (error) {
    useDapStore.getState().setStatus("error");
    useDapStore.getState().setError(errorMessage(error));
    const client = active;
    active = null;
    if (client) await client.close();
  }
}

export async function stopDebug(): Promise<void> {
  const client = active;
  active = null;
  if (!client) {
    useDapStore.getState().endSession();
    return;
  }
  await client.close();
  useDapStore.getState().endSession();
}

export function toggleDebugBreakpoint(path: string, line: number): void {
  const state = useDapStore.getState();
  const current = state.breakpoints[path] ?? [];
  const lines = current.includes(line)
    ? current.filter((value) => value !== line)
    : [...current, line].sort((a, b) => a - b);
  state.setBreakpoints({ ...state.breakpoints, [path]: lines });
  if (active) void pushBreakpoints(active, path, lines);
}

export async function selectFrame(frameId: number): Promise<void> {
  const client = active;
  if (!client) return;
  const state = useDapStore.getState();
  state.setStack(state.stack, frameId);
  await refreshScopes(client, frameId);
}

export async function loadVariables(reference: number): Promise<void> {
  const client = active;
  if (!client) return;
  const state = useDapStore.getState();
  if (state.variables[reference]) return;
  try {
    const body = await client.request("variables", {
      variablesReference: reference,
    });
    state.setVariables(reference, mapVariables(body.variables));
  } catch (error) {
    state.setError(errorMessage(error));
  }
}

async function sendControl(command: string, label: string): Promise<void> {
  const client = active;
  if (!client) return;
  const state = useDapStore.getState();
  if (state.threadId === null) {
    state.setError("停止中のスレッドがありません。");
    return;
  }
  try {
    await client.request(command, { threadId: state.threadId });
    if (command === "continue" || command === "next" || command === "stepIn" || command === "stepOut") {
      state.setStatus("running");
    }
  } catch (error) {
    state.setError(`${label}に失敗しました: ${errorMessage(error)}`);
  }
}

export function continueDebug(): Promise<void> {
  return sendControl("continue", "再開");
}

export function stepOver(): Promise<void> {
  return sendControl("next", "ステップオーバー");
}

export function stepIn(): Promise<void> {
  return sendControl("stepIn", "ステップイン");
}

export function stepOut(): Promise<void> {
  return sendControl("stepOut", "ステップアウト");
}
