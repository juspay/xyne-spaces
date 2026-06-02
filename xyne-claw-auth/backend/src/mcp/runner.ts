import path from "node:path";
import { existsSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpAdapter, McpCallResult, McpServerTools, McpToolInfo } from "./types.js";
import { STATIC_ADAPTERS } from "./static-adapters.js";
import { resolveConnectorDefinition } from "./connector-definitions.js";
import { getSpacesAuthForUser } from "../lib/spaces-db.js";
import { provisionStdioCommand } from "./provision.js";

// Resolved once at module load — process.cwd() here is the running backend's
// dir. Logged so prod tells us if the path lands somewhere without
// node_modules/tsx (which is the failure mode we just fixed).
const TSX_ESM_PATH = path.join(process.cwd(), "node_modules", "tsx", "dist", "esm", "index.mjs");
const TSX_ESM_URL = `file://${TSX_ESM_PATH}`;
console.log(
  `[mcp/runner] tsx loader path=${TSX_ESM_PATH} exists=${existsSync(TSX_ESM_PATH)} cwd=${process.cwd()}`,
);

interface McpSession {
  client: Client;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
  /** Token the child process was spawned with. Tracked so we can detect
   *  drift between the freshly-resolved DB token and what's actually inside
   *  the cached child's env, and evict on mismatch. xyne-spaces uses this
   *  on every call; other server types currently only spawn once. */
  spawnedToken?: string;
  /** Wall-clock ms of the last getOrCreateSession() hit. Drives idle eviction
   *  so the cache (and its spawned child processes) doesn't grow unbounded —
   *  the leak that OOM'd claw-auth. Stamped on every create AND reuse. */
  lastUsedAt: number;
}

const sessions = new Map<string, McpSession>();

// Idle eviction. A cached session pins a child process (stdio) or an HTTP
// client plus its buffers in claw-auth's heap. Previously sessions were only
// dropped on token rotation / OAuth events / transport close — never on idle —
// so every (user × server) that ever ran a tool leaked forever. We now sweep
// idle sessions periodically; the next call simply respawns on demand.
const SESSION_IDLE_TTL_MS = Number(process.env["MCP_SESSION_IDLE_TTL_MS"] ?? 20 * 60 * 1000);
const SESSION_SWEEP_INTERVAL_MS = Number(process.env["MCP_SESSION_SWEEP_INTERVAL_MS"] ?? 5 * 60 * 1000);

function sessionKey(userId: string, serverType: string): string {
  return `${userId}:${serverType}`;
}

/** Close + drop sessions idle longer than the TTL. Best-effort; never throws. */
function sweepIdleSessions(): void {
  const now = Date.now();
  let evicted = 0;
  for (const [key, session] of sessions) {
    if (now - session.lastUsedAt <= SESSION_IDLE_TTL_MS) continue;
    sessions.delete(key);
    evicted++;
    // close() ends the child / HTTP client and reaps its memory. Its onclose
    // also calls sessions.delete(key) — harmless double-delete.
    session.transport.close().catch(() => {});
  }
  if (evicted > 0) {
    console.log(`[mcp/runner] idle sweep: evicted ${evicted} session(s) (${sessions.size} cached)`);
  }
}

const idleSweepTimer = setInterval(sweepIdleSessions, SESSION_SWEEP_INTERVAL_MS);
idleSweepTimer.unref(); // don't keep the process alive for the sweep

async function getOrCreateSession(
  userId: string,
  serverType: string,
  credentials: Record<string, unknown>,
): Promise<Client> {
  const key = sessionKey(userId, serverType);

  // For xyne-spaces: ALWAYS read fresh creds from the Spaces DB FIRST, before
  // any cache lookup. The cached child process has its token baked into env
  // at spawn time; we must compare that against the live token and evict the
  // session if Spaces' middleware has rotated the JWT. Without this, the
  // creds-loader's "live-first hit" is computed and then thrown away — the
  // child keeps calling Spaces with a stale env-baked token and 401s.
  if (serverType === "xyne-spaces") {
    const live = await getSpacesAuthForUser(userId, "mcp-runner");
    if (live) {
      credentials = {
        ...credentials,
        token: live.token,
        sessionId: live.sessionId,
        workspaceId: live.workspaceId,
        userId,
      };
    } else {
      credentials = { ...credentials, userId };
    }
  }

  // For xyne-spaces the rotating credential is `token`; for OAuth-based HTTP
  // adapters (customerio, honeycomb, egnyte, …) it is `accessToken`. Track
  // whichever is present so stale HTTP sessions are evicted after a refresh.
  const incomingToken =
    typeof credentials["token"] === "string"
      ? (credentials["token"] as string)
      : typeof credentials["accessToken"] === "string"
        ? (credentials["accessToken"] as string)
        : undefined;

  const existing = sessions.get(key);
  if (existing) {
    // For xyne-spaces, the token rotates frequently (refresh-flow) so the
    // child must be respawned with the new env every time the token changes.
    // For other server types, creds rarely change between calls — but if they
    // do (e.g. user re-enters Bitbucket token), the same eviction kicks in.
    if (incomingToken && existing.spawnedToken && existing.spawnedToken !== incomingToken) {
      console.log(`[mcp/runner] evicting stale cached session for ${key} (token rotated)`);
      sessions.delete(key);
      await existing.transport.close().catch(() => {});
    } else {
      console.log(`[mcp/runner] reusing cached session for ${key}`);
      existing.lastUsedAt = Date.now(); // keep alive — only idle sessions are swept
      return existing.client;
    }
  }

  const definition = await resolveConnectorDefinition(serverType);
  if (!definition) {
    throw new Error(`No connector definition for server type: ${serverType}`);
  }

  let transport: StdioClientTransport | StreamableHTTPClientTransport;

  if (definition.transport === "http") {
    // Remote MCP server — connect over Streamable HTTP
    const { url, headers } = definition.buildHttpConfig(credentials);
    if (!url) throw new Error(`Missing HTTP URL in connector definition for ${serverType}`);
    transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: {
        headers,
      },
    });
    console.log(`[mcp/runner] spawning HTTP session for ${key} url=${url}`);
  } else {
    // Local MCP server — spawn child process over stdio
    const { cmd, args, env } = definition.buildStdioCommand(credentials);
    if (!cmd) throw new Error(`Missing stdio command in connector definition for ${serverType}`);
    // Diagnostic: which auth-related env vars made it into the child? Just keys,
    // never values. Helps pinpoint stale-env vs missing-cred at runtime.
    // The child runs with cwd=/tmp (bb01cf92e6 — fixes permission-denied
    // attempts to write into the app dir). For TS-source MCPs (xyne-spaces,
    // juspay-internal-tools, query-routing) the launch is
    // `node --import tsx/esm <server.ts>`. Node's ESM resolver walks up from
    // cwd to find `node_modules/tsx`, which from /tmp/ never resolves and
    // the child crashes with `Cannot find package 'tsx' imported from /tmp/`.
    // NODE_PATH does NOT help here — Node ignores it for ESM resolution.
    // The fix is to substitute the bare `tsx/esm` specifier with an absolute
    // file:// URL pointing at the actual entry inside the parent's
    // node_modules. process.cwd() at this point is the running backend dir.
    const resolvedArgs = args.map((a) => (a === "tsx/esm" ? TSX_ESM_URL : a));
    // npx servers are routed through the hardened provisioner: installed once
    // into an isolated, atomically-published store and launched as
    // `node <entrypoint>` — never `npx` at spawn time. This removes the shared
    // mutable `~/.npm/_npx/<hash>` cache that races and rots into
    // `ERR_MODULE_NOT_FOUND` → `MCP error -32000: Connection closed`. Non-npx
    // commands pass through untouched; failures fall back to the original npx.
    const launch = await provisionStdioCommand(cmd, resolvedArgs);
    transport = new StdioClientTransport({
      command: launch.command,
      args: launch.args,
      env: { ...process.env, ...env } as Record<string, string>,
      cwd: "/tmp",
    });
  }

  const client = new Client({ name: "xyne-claw-auth", version: "0.1.0" });
  await client.connect(transport as Parameters<typeof client.connect>[0]);

  transport.onclose = () => {
    sessions.delete(key);
  };

  sessions.set(key, {
    client,
    transport,
    lastUsedAt: Date.now(),
    ...(incomingToken ? { spawnedToken: incomingToken } : {}),
  });
  return client;
}

export async function listToolsForUser(
  userId: string,
  serverType: string,
  serverName: string,
  credentials: Record<string, unknown>,
): Promise<McpServerTools> {
  const client = await getOrCreateSession(userId, serverType, credentials);
  const result = await client.listTools();

  const tools: McpToolInfo[] = result.tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    inputSchema: t.inputSchema as Record<string, unknown>,
  }));

  const definition = await resolveConnectorDefinition(serverType);
  const writeTools = definition?.writeTools ?? [];
  return { serverType, serverName, tools, writeTools };
}

export async function callTool(
  userId: string,
  serverType: string,
  credentials: Record<string, unknown>,
  tool: string,
  params: Record<string, unknown>,
): Promise<McpCallResult> {
  const client = await getOrCreateSession(userId, serverType, credentials);

  const result = await client.callTool({ name: tool, arguments: params });

  if ("content" in result && Array.isArray(result.content)) {
    const text = result.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n");

    if ("isError" in result && result.isError === true) {
      throw new Error(text || "MCP tool returned an error");
    }

    // MCP `_meta` is a free-form metadata field. Tools surface structured
    // citations there so we can attach them to the invocation record without
    // grepping the markdown body for IDs (Tier 1 citation propagation).
    const meta = (result as { _meta?: { citations?: unknown } })._meta;
    const citations = Array.isArray(meta?.citations) ? meta.citations as McpCallResult["citations"] : undefined;
    return citations && citations.length > 0
      ? { content: text, citations }
      : { content: text };
  }

  return { content: JSON.stringify(result) };
}

export async function evictSession(userId: string, serverType: string): Promise<void> {
  const key = sessionKey(userId, serverType);
  const session = sessions.get(key);
  if (session) {
    console.log(`[mcp/runner] evicting cached session for ${key}`);
    sessions.delete(key);
    await session.transport.close().catch(() => {});
  } else {
    console.log(`[mcp/runner] evictSession no-op for ${key} (not cached)`);
  }
}

export async function evictAllSessionsForUser(userId: string): Promise<void> {
  const prefix = `${userId}:`;
  const evictions: Promise<void>[] = [];
  for (const [key, session] of sessions) {
    if (key.startsWith(prefix)) {
      sessions.delete(key);
      evictions.push(session.transport.close().catch(() => {}));
    }
  }
  await Promise.all(evictions);
}

export function hasAdapter(serverType: string): boolean {
  return serverType in STATIC_ADAPTERS;
}

export function getAdapter(serverType: string): McpAdapter | undefined {
  return STATIC_ADAPTERS[serverType];
}

export function getAdapters(): Record<string, McpAdapter> {
  return STATIC_ADAPTERS;
}
