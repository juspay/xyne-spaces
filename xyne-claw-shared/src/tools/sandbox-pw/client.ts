/**
 * Per-conversation cache of @playwright/mcp children that drive a
 * chromium-CDP running inside the user's sandbox.
 *
 * Architecture:
 *
 *   xyne-claw process
 *     │
 *     ├─ getOrSpawnSandboxPwClient(storeKey, ctx) — discovers session.id
 *     │   via getSandboxSession(storeKey), then via session.request('/services')
 *     │   learns the CDP port (9223 — TCP-forwarder bound on the sandbox pod's
 *     │   public IP, forwards loopback chromium :9222).
 *     │
 *     ├─ spawn `playwright-mcp --headless --isolated
 *     │       --cdp-endpoint http://<router>:8080
 *     │       --cdp-header "X-Sandbox-ID: <id>"
 *     │       --cdp-header "X-Sandbox-Namespace: <ns>"
 *     │       --cdp-header "X-Sandbox-Port: 9223"`
 *     │   over StdioClientTransport. playwright-mcp in turn dials the
 *     │   sandbox-router-test (WS-capable fork) which forwards CDP/WS to
 *     │   chromium running inside the user's sandbox pod.
 *     │
 *     └─ MCP RPC over the spawned child's stdio.
 *
 * Cache keyed by storeKey (`<conversationId>_<agentSlug>`). On stale-session
 * detection (cached.sessionId !== current session.id), we evict + respawn.
 *
 * Process exit: SIGTERM/SIGINT cleanup kills every cached child. We
 * deliberately do NOT register `uncaughtException`/`unhandledRejection`
 * handlers — the kata-sdk's earlier mistake of doing that destroyed every
 * live SandboxClaim on any unrelated rejection (e.g. a worktree git fetch),
 * causing minutes-long claim churn.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { getSandboxSession } from "../sandbox/tools.js";

interface SandboxPwCacheEntry {
  client: Client;
  transport: StdioClientTransport;
  sessionId: string;
  cdpPort: number;
}

const CACHE = new Map<string, SandboxPwCacheEntry>();

let signalHandlersInstalled = false;
function installSignalHandlersOnce(): void {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;
  const cleanup = (): void => {
    for (const [, entry] of CACHE) {
      try { void entry.client.close(); } catch { /* ignore */ }
      try { void entry.transport.close(); } catch { /* ignore */ }
    }
    CACHE.clear();
  };
  process.once("SIGTERM", cleanup);
  process.once("SIGINT", cleanup);
}

function evict(storeKey: string): void {
  const entry = CACHE.get(storeKey);
  if (!entry) return;
  try { void entry.client.close(); } catch { /* ignore */ }
  try { void entry.transport.close(); } catch { /* ignore */ }
  CACHE.delete(storeKey);
}

export type SandboxPwClientResult =
  | { ok: true; client: Client; sessionId: string }
  | { ok: false; error: string };

/**
 * Discover the CDP port via the sandbox's `/services` endpoint and spawn
 * (or return cached) an `@playwright/mcp` child wired to it through the
 * sandbox-router. Idempotent per storeKey; respawns if the underlying
 * sandbox session has changed.
 */
export async function getOrSpawnSandboxPwClient(
  storeKey: string,
  routerUrl: string,
): Promise<SandboxPwClientResult> {
  installSignalHandlersOnce();

  const session = getSandboxSession(storeKey);
  if (!session) {
    return { ok: false, error: "no sandbox session — call sandbox-repo-setup first" };
  }

  const cached = CACHE.get(storeKey);
  if (cached && cached.sessionId === session.id) {
    return { ok: true, client: cached.client, sessionId: session.id };
  }
  if (cached) {
    // Session changed — respawn against the new sandbox pod.
    evict(storeKey);
  }

  // Discover the CDP port via the kata-sdk's /services route.
  let cdpPort: number;
  try {
    const resp = await session.request("/services", { method: "GET" });
    if (!resp.ok) {
      return { ok: false, error: `/services returned HTTP ${resp.status}` };
    }
    const services = (await resp.json()) as {
      cdp?: { up?: boolean; port?: number | null };
    };
    if (!services.cdp?.up || !services.cdp.port) {
      return { ok: false, error: "chromium-CDP not yet ready in this sandbox; retry in ~10s" };
    }
    cdpPort = services.cdp.port;
  } catch (err) {
    return {
      ok: false,
      error: `failed to query /services: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Spawn @playwright/mcp wired to the sandbox-router. The playwright-mcp
  // bin is pre-installed globally in the xyne-claw image (see Dockerfile).
  const args = [
    "--headless",
    "--isolated",
    "--cdp-endpoint", routerUrl,
    "--cdp-header", `X-Sandbox-ID: ${session.id}`,
    "--cdp-header", `X-Sandbox-Namespace: ${session.namespace}`,
    "--cdp-header", `X-Sandbox-Port: ${cdpPort}`,
  ];

  const transport = new StdioClientTransport({
    command: "playwright-mcp",
    args,
    // playwright-mcp creates a `.playwright-mcp` state dir in cwd; spawning
    // from /app/xyne-claw fails with EACCES. /tmp is always writable.
    cwd: "/tmp",
  });
  // Surface the child's stderr so MCP-side errors aren't silent.
  transport.stderr?.on("data", (chunk: Buffer) => {
    const line = chunk.toString("utf8").trimEnd();
    if (line) console.warn(`[sandbox-pw:${session.id.slice(0, 8)}] ${line}`);
  });

  const client = new Client(
    { name: "xyne-claw-sandbox-pw", version: "1.0.0" },
    { capabilities: {} },
  );
  try {
    await client.connect(transport);
  } catch (err) {
    try { void transport.close(); } catch { /* ignore */ }
    return {
      ok: false,
      error: `failed to connect MCP: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  CACHE.set(storeKey, {
    client,
    transport,
    sessionId: session.id,
    cdpPort,
  });
  return { ok: true, client, sessionId: session.id };
}

/** Force-evict the cache for a storeKey (e.g. on stale-session error). */
export function evictSandboxPwClient(storeKey: string): void {
  evict(storeKey);
}
