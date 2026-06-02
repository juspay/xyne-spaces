/**
 * Effective MCP credential resolution. Resolution order (first hit wins):
 *
 *   1. agent  — AgentMcpConnection pinned by the agent owner. The agent
 *               wins because pasting creds on an agent is a deliberate
 *               operator contract ("this agent talks to THIS Grafana").
 *               Only consulted when caller passes `agentSlug`.
 *               When caller also passes `instanceSlug`, the lookup is
 *               narrowed to that specific instance. Without it we pick
 *               the row keyed by slug='default' if present, otherwise
 *               the oldest instance — matches single-instance behaviour.
 *   2. user   — UserMcpConnection. Per-user creds, classic fallback.
 *   3. global — GlobalMcpCredentials when McpServer.allowGlobalFallback.
 *
 * Most callers should use
 *   `loadEffectiveCredentials(userId, serverType, agentSlug?, instanceSlug?)`
 * instead of querying connection tables directly. The returned `connectionId`
 * is a stable string usable for cache keys / logging — `agent:<connId>`,
 * `<userConn cuid>`, or `global:<mcpServerId>` depending on the hit.
 *
 * Token refresh (OAuth) only runs for the user-level path: we don't try to
 * refresh agent or global creds because there's no per-row writer to persist
 * a new token, and these are typically API keys / static secrets anyway.
 */

import { prisma } from "../db.js";
import { decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { getFreshCredentials } from "./credentials-refresh.js";
import { getSpacesAuthForUser } from "./spaces-db.js";

export interface EffectiveCredentials {
  source: "agent" | "user" | "global";
  connectionId: string;
  credentials: Record<string, unknown>;
  /** True iff the user owns this connection (admin/health code uses this to
   *  avoid mutating global creds on a per-user code path). False for both
   *  agent-pinned and global creds. */
  isUserOwned: boolean;
}

export async function loadEffectiveCredentials(
  userId: string,
  serverType: string,
  agentSlug?: string,
  instanceSlug?: string,
): Promise<EffectiveCredentials | null> {
  // 1. Agent-pinned creds win when present. Only checked if the caller
  //    provided an agentSlug (i.e. the call is happening inside an agent's
  //    session — direct admin/health calls pass undefined and skip this).
  if (agentSlug) {
    // Multi-instance lookup. When `instanceSlug` is set, we narrow to that
    // specific row (the runner uses this when spawning per-instance MCP
    // processes — see mcp/runner.ts). Without it we fall back to the
    // 'default' slug (single-instance / pre-migration semantics) and then
    // to the oldest row, so legacy callers keep working until they're
    // explicitly migrated to pass instance slugs.
    let agentConn = null;
    if (instanceSlug) {
      agentConn = await prisma.agentMcpConnection.findFirst({
        where: {
          agent: { slug: agentSlug },
          mcpServer: { type: serverType },
          slug: instanceSlug,
        },
      });
    } else {
      agentConn = await prisma.agentMcpConnection.findFirst({
        where: {
          agent: { slug: agentSlug },
          mcpServer: { type: serverType },
          slug: "default",
        },
      });
      if (!agentConn) {
        agentConn = await prisma.agentMcpConnection.findFirst({
          where: { agent: { slug: agentSlug }, mcpServer: { type: serverType } },
          orderBy: { createdAt: "asc" },
        });
      }
    }
    if (agentConn) {
      const decrypted = decrypt(
        agentConn.encryptedCreds,
        agentConn.iv,
        agentConn.authTag,
        CONFIG.encryptionKey,
      );
      console.log(
        `[creds-loader] ${serverType} userId=${userId} agent=${agentSlug} instance=${agentConn.slug} → agent hit (connId=${agentConn.id})`,
      );
      return {
        source: "agent",
        connectionId: agentConn.id,
        credentials: JSON.parse(decrypted) as Record<string, unknown>,
        isUserOwned: false,
      };
    }
  }

  // xyne-spaces priority order: live Spaces DB FIRST, cached
  // userMcpConnection SECOND, global last. Rationale: the cached row in
  // userMcpConnection goes stale every time Spaces' middleware refreshes
  // the user's JWT, and that drift is the dominant 401 root cause. The
  // live read either returns a hit or auto-refreshes via Spaces'
  // /api/auth/refresh-session before returning. Falling through to the
  // cached path only happens when SPACES_DB_URL is unset, the user has
  // no active session, or the refresh hop itself failed — at which point
  // the cached creds are no worse than nothing.
  if (serverType === "xyne-spaces") {
    const live = await getSpacesAuthForUser(userId, "mcp-runner");
    if (live) {
      console.log(`[creds-loader] xyne-spaces userId=${userId} → live-first hit (sessionId=${live.sessionId} workspaceId=${live.workspaceId} tokenLen=${live.token.length})`);
      return {
        source: "user",
        connectionId: `spaces-live:${userId}`,
        credentials: {
          url: CONFIG.spacesInternalUrl,
          token: live.token,
          sessionId: live.sessionId,
          workspaceId: live.workspaceId,
        },
        isUserOwned: true,
      };
    }
    console.log(`[creds-loader] xyne-spaces userId=${userId} → live read returned null, falling through to cached`);
  }

  const userConn = await prisma.userMcpConnection.findFirst({
    where: { userId, mcpServer: { type: serverType } },
    include: { mcpServer: true },
  });

  console.log(`[creds-loader] enter ${serverType} userId=${userId} userConnFound=${!!userConn}`);

  if (userConn) {
    const credentials = await getFreshCredentials(
      userConn.id,
      userId,
      serverType,
      userConn.encryptedCreds,
      userConn.iv,
      userConn.authTag,
    );
    console.log(`[creds-loader] ${serverType} userId=${userId} → user-row hit (connId=${userConn.id})`);
    return { source: "user", connectionId: userConn.id, credentials, isUserOwned: true };
  }

  const server = await prisma.mcpServer.findUnique({
    where: { type: serverType },
    include: { globalCredentials: true },
  });

  if (!server || !server.allowGlobalFallback || !server.globalCredentials) {
    // xyne-spaces already had its live-first chance above, so reaching here
    // means both the live read and the cached userMcpConnection failed.
    // Other server types just fall through.
    return null;
  }

  const decrypted = decrypt(
    server.globalCredentials.encryptedCreds,
    server.globalCredentials.iv,
    server.globalCredentials.authTag,
    CONFIG.encryptionKey,
  );
  return {
    source: "global",
    connectionId: `global:${server.id}`,
    credentials: JSON.parse(decrypted) as Record<string, unknown>,
    isUserOwned: false,
  };
}
