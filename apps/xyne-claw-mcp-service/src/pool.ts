/**
 * Session pool: starts stdio MCP servers or connects to HTTP ones, keeps one
 * session per key, and passes tools/list and tools/call through.
 */
import path from "node:path";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { childBaseEnv } from "./child-env.js";
import { resolveStdioCommand } from "./installed.js";
import { createLogger } from "xyne-claw-shared";
import { builtinServerPath } from "./servers/index.js";
import type { McpCallResult } from "xyne-claw-mcp-common/client";
import {
  BUILTIN_SERVER_CMD,
  evictMatches,
  LaunchRequiredError,
  MCP_REQUEST_TIMEOUT_MS,
  type EvictRequest, type LaunchSpec, type SessionTarget, type ToolDescriptor } from "xyne-claw-mcp-common/protocol";

const log = createLogger("mcp-pool");

/**
 * No-op validator for MCP tool output schemas. Client.listTools() compiles a
 * validator per tool with an outputSchema on every list; with Ajv that grew the
 * heap without bound (XYNE-65482). Callers only read `result.content`, so output
 * validation protects nothing here.
 */
const passThroughSchemaValidator: Pick<AjvJsonSchemaValidator, "getValidator"> = {
  getValidator: () => (input: unknown) => ({ valid: true as const, data: input as never, errorMessage: undefined }),
};

// Absolute file:// URL of this process's tsx loader, used in place of the bare
// `tsx/esm` specifier (children run with cwd=/tmp).
const TSX_ESM_PATH = path.join(process.cwd(), "node_modules", "tsx", "dist", "esm", "index.mjs");
const TSX_ESM_URL = `file://${TSX_ESM_PATH}`;
log.info(`[mcp-pool] tsx loader path=${TSX_ESM_PATH} exists=${existsSync(TSX_ESM_PATH)} cwd=${process.cwd()}`);

/** Per-request ceiling for tools/call and tools/list (10 minutes). */

/** `initialize` handshake timeout. */
const MCP_CONNECT_TIMEOUT_MS = Number(process.env["MCP_CONNECT_TIMEOUT_MS"] ?? 180_000);

const SESSION_IDLE_TTL_MS = Number(process.env["MCP_SESSION_IDLE_TTL_MS"] ?? 20 * 60 * 1000);
const SESSION_SWEEP_INTERVAL_MS = Number(process.env["MCP_SESSION_SWEEP_INTERVAL_MS"] ?? 5 * 60 * 1000);

/** Cap on live sessions in one process; the oldest idle one is closed first. */
const MAX_SESSIONS = Number(process.env["MCP_MAX_SESSIONS"] ?? 0);

interface PoolSession {
  client: Client;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
  serverType: string;
  fingerprint: string;
  lastUsedAt: number;
  /** Per-session dir holding launch files (e.g. a key file); removed on close. */
  filesDir?: string;
}

function removeDir(dir: string | undefined): void {
  if (!dir) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

/** Write launch files 0600 into a fresh dir and swap `{{file:<name>}}` for their paths. */
function materialiseFiles(launch: Extract<LaunchSpec, { transport: "stdio" }>): {
  args: string[];
  env: Record<string, string>;
  dir?: string;
} {
  const files = Object.entries(launch.files ?? {});
  if (files.length === 0) return { args: launch.args, env: launch.env };
  const dir = mkdtempSync(path.join(tmpdir(), "mcp-files-"));
  const paths = new Map<string, string>();
  for (const [name, content] of files) {
    const filePath = path.join(dir, path.basename(name));
    writeFileSync(filePath, content, { mode: 0o600 });
    paths.set(name, filePath);
  }
  const swap = (v: string) => v.replace(/\{\{file:([^}]+)\}\}/g, (m, name: string) => paths.get(name) ?? m);
  return {
    args: launch.args.map(swap),
    env: Object.fromEntries(Object.entries(launch.env).map(([k, v]) => [k, swap(v)])),
    dir,
  };
}

/** The service has no usable session for this key and needs the launch spec. */

const sessions = new Map<string, PoolSession>();
// Starts in progress, by session key, with the fingerprint they started with.
const inflight = new Map<string, { fingerprint: string; start: Promise<PoolSession> }>();

function closeSession(key: string, session: PoolSession, reason: string): Promise<void> {
  if (sessions.get(key) === session) sessions.delete(key);
  log.info(`[mcp-pool] closing ${key} (${reason})`);
  return session.transport.close().catch(() => {}).finally(() => removeDir(session.filesDir));
}

function sweepIdleSessions(): void {
  const now = Date.now();
  let evicted = 0;
  for (const [key, session] of sessions) {
    if (now - session.lastUsedAt <= SESSION_IDLE_TTL_MS) continue;
    evicted++;
    void closeSession(key, session, "idle");
  }
  if (evicted > 0) log.info(`[mcp-pool] idle sweep: evicted ${evicted} session(s) (${sessions.size} cached)`);
}

const idleSweepTimer = setInterval(sweepIdleSessions, SESSION_SWEEP_INTERVAL_MS);
idleSweepTimer.unref();

function enforceCap(): void {
  if (!MAX_SESSIONS || sessions.size < MAX_SESSIONS) return;
  let oldest: [string, PoolSession] | undefined;
  for (const entry of sessions) {
    if (!oldest || entry[1].lastUsedAt < oldest[1].lastUsedAt) oldest = entry;
  }
  if (oldest) void closeSession(oldest[0], oldest[1], "session cap");
}

async function startSession(target: SessionTarget, launch: LaunchSpec): Promise<PoolSession> {
  let transport: StdioClientTransport | StreamableHTTPClientTransport;
  let filesDir: string | undefined;
  if (launch.transport === "http") {
    if (!launch.url) throw new Error(`Missing HTTP URL for ${target.serverType}`);
    transport = new StreamableHTTPClientTransport(new URL(launch.url), { requestInit: { headers: launch.headers } });
    log.info(`[mcp-pool] connecting HTTP session for ${target.key}`);
  } else {
    if (!launch.cmd) throw new Error(`Missing stdio command for ${target.serverType}`);
    const prepared = materialiseFiles(launch);
    filesDir = prepared.dir;
    // `xyne-mcp-server <name>` runs src/servers/<name>.ts with node + tsx.
    const builtin = launch.cmd === BUILTIN_SERVER_CMD;
    const cmd = builtin ? "node" : launch.cmd;
    const args = builtin ? ["--import", "tsx/esm", builtinServerPath(prepared.args[0] ?? "")] : prepared.args;
    const resolvedArgs = args.map((a) => (a === "tsx/esm" ? TSX_ESM_URL : a));
    // npx/uvx launches run the package installed in the image (installed.ts).
    let started: { command: string; args: string[] };
    try {
      started = resolveStdioCommand(cmd, resolvedArgs);
    } catch (err) {
      removeDir(filesDir);
      throw err;
    }
    transport = new StdioClientTransport({
      command: started.command,
      args: started.args,
      // Only harmless parent variables, then the server's own.
      env: { ...childBaseEnv(), ...prepared.env, ...(builtin ? { LOG_STREAM: "stderr" } : {}) },
      cwd: "/tmp",
    });
    log.info(`[mcp-pool] spawning stdio session for ${target.key}`);
  }

  const client = new Client(
    { name: "xyne-claw-mcp", version: "0.1.0" },
    { jsonSchemaValidator: passThroughSchemaValidator, capabilities: { tasks: {} } },
  );
  try {
    await client.connect(transport as Parameters<typeof client.connect>[0], { timeout: MCP_CONNECT_TIMEOUT_MS });
  } catch (err) {
    // Closes the transport when connect fails.
    await transport.close().catch(() => {});
    removeDir(filesDir);
    throw err;
  }

  enforceCap();
  const session: PoolSession = {
    client,
    transport,
    serverType: target.serverType,
    fingerprint: target.fingerprint,
    lastUsedAt: Date.now(),
    ...(filesDir ? { filesDir } : {}),
  };
  transport.onclose = () => {
    if (sessions.get(target.key) === session) sessions.delete(target.key);
    removeDir(session.filesDir);
  };
  sessions.set(target.key, session);
  return session;
}

/**
 * Live session for `target`, started from `target.launch` when needed.
 * Throws LaunchRequiredError when a start is needed and no launch was sent.
 */
async function getSession(target: SessionTarget): Promise<PoolSession> {
  const existing = sessions.get(target.key);
  if (existing) {
    const stale = Boolean(target.fingerprint && existing.fingerprint && existing.fingerprint !== target.fingerprint);
    if (!stale) {
      existing.lastUsedAt = Date.now();
      return existing;
    }
  }

  const pending = inflight.get(target.key);
  if (pending) {
    // Joins a start with the same fingerprint; waits out one with another
    // fingerprint, then looks the session up again.
    if (!(target.fingerprint && pending.fingerprint && pending.fingerprint !== target.fingerprint)) return pending.start;
    await pending.start.catch(() => undefined);
    return getSession(target);
  }
  if (!target.launch) throw new LaunchRequiredError(target.key);

  // Registers the start, which first closes a stale session, before any await.
  const launch = target.launch;
  const start = (async () => {
    if (existing) await closeSession(target.key, existing, "credentials changed");
    return startSession(target, launch);
  })().finally(() => inflight.delete(target.key));
  inflight.set(target.key, { fingerprint: target.fingerprint, start });
  return start;
}

export async function poolListTools(target: SessionTarget): Promise<ToolDescriptor[]> {
  const { client } = await getSession(target);
  // Sets both timeout and signal; the SDK default timeout is 60 s.
  const result = await client.listTools(undefined, {
    timeout: MCP_REQUEST_TIMEOUT_MS,
    signal: AbortSignal.timeout(MCP_REQUEST_TIMEOUT_MS),
  });
  return result.tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    inputSchema: t.inputSchema as Record<string, unknown>,
  }));
}

export type PoolCallResult = McpCallResult;

async function invokeToolCall(
  client: Client,
  serverType: string,
  args: Parameters<Client["callTool"]>[0],
): Promise<PoolCallResult> {
  const options = { timeout: MCP_REQUEST_TIMEOUT_MS, signal: AbortSignal.timeout(MCP_REQUEST_TIMEOUT_MS) };
  const serverTasks = Boolean(client.getServerCapabilities()?.tasks?.requests?.tools?.call);
  if (!serverTasks) return client.callTool(args, undefined, options);

  let taskId: string | undefined;
  try {
    for await (const message of client.experimental.tasks.callToolStream(args, undefined, options)) {
      if (message.type === "taskCreated") {
        taskId = message.task.taskId;
        log.info(`[mcp/task] server=${serverType} tool=${args.name} created task=${taskId} status=${message.task.status}`);
      } else if (message.type === "taskStatus") {
        log.info(`[mcp/task] server=${serverType} tool=${args.name} task=${message.task.taskId} status=${message.task.status}`);
      } else if (message.type === "result") {
        return message.result;
      } else if (message.type === "error") {
        throw message.error;
      }
    }
    throw new Error(`MCP task for ${serverType}/${args.name} ended without a result`);
  } catch (err) {
    if (taskId) await client.experimental.tasks.cancelTask(taskId).catch(() => undefined);
    throw err;
  }
}

/** Raw MCP tools/call result; the caller interprets content, isError and _meta. */
export async function poolCallTool(
  target: SessionTarget,
  tool: string,
  args: Record<string, unknown>,
  meta?: Record<string, unknown>,
): Promise<PoolCallResult> {
  const { client } = await getSession(target);
  return invokeToolCall(client, target.serverType, { name: tool, arguments: args, ...(meta ? { _meta: meta } : {}) });
}

export async function poolEvict(req: EvictRequest): Promise<number> {
  const closing: Promise<void>[] = [];
  for (const [key, session] of [...sessions]) {
    if (evictMatches(key, req)) closing.push(closeSession(key, session, "evicted"));
  }
  await Promise.all(closing);
  return closing.length;
}

export async function poolRestart(serverType?: string): Promise<number> {
  const closing: Promise<void>[] = [];
  for (const [key, session] of [...sessions]) {
    if (serverType && session.serverType !== serverType) continue;
    closing.push(closeSession(key, session, "restart"));
  }
  await Promise.all(closing);
  return closing.length;
}

export function poolStats(): { sessions: number; starting: number } {
  return { sessions: sessions.size, starting: inflight.size };
}

/** Close everything (graceful shutdown). */
export async function poolCloseAll(): Promise<void> {
  await poolRestart();
}
