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
import { resolveFreshOAuthCreds, TokenRefreshError } from "./oauth-token-endpoint.js";
import { getOAuthProvider } from "../routes/oauth-token.js";

// OAuth connectors whose tools run as claw-auth-hosted stdio MCP servers. Their
// stored creds are an access/refresh-token pair, so resolution must hand back a
// FRESH access token (refresh + persist when stale) for the spawned server's
// env — not the raw encrypted blob. Same refresh path as /oauth/:provider/token.
import { OAUTH_SERVER_TYPES as STDIO_OAUTH_SERVER_TYPES } from "./oauth-server-types.js";

import { createLogger } from "../logger.js";
const log = createLogger("credentials-loader");

export interface EffectiveCredentials {
  source: "agent" | "user" | "global";
  connectionId: string;
  credentials: Record<string, unknown>;
  /** True iff the user owns this connection (admin/health code uses this to
   *  avoid mutating global creds on a per-user code path). False for both
   *  agent-pinned and global creds. */
  isUserOwned: boolean;
}

/**
 * Server types whose `source: "user"` is the AMBIENT operating credential of
 * every run (the user's Spaces session token), NOT a private third-party
 * credential the user personally connected. The admin "All Runs" ACL must NOT
 * hide a run merely for using these — virtually every spaces-agent run reads
 * Spaces, so counting it would hide almost everything and defeat the feature.
 */
const AMBIENT_USER_CREDENTIAL_SERVER_TYPES = new Set(["xyne-spaces"]);

/**
 * True when an effective credential is a PRIVATE per-user credential whose use
 * should hide the run from OTHER admins in "All Runs" — i.e. source is "user"
 * AND it isn't the ambient Spaces session (Google/Microsoft/Bitbucket and other
 * personally-connected connectors qualify; the baseline Spaces token does not).
 * Single source of truth for every markUsedUserToken call site.
 */
export function isPrivateUserCredential(serverType: string, source: EffectiveCredentials["source"]): boolean {
  return source === "user" && !AMBIENT_USER_CREDENTIAL_SERVER_TYPES.has(serverType);
}

export async function loadEffectiveCredentials(
  userId: string,
  serverType: string,
  agentSlug?: string,
  instanceSlug?: string,
): Promise<EffectiveCredentials | null> {
  // google / microsoft: per-user OAuth connectors (never agent-pinned or
  // global), executed as claw-auth-hosted stdio MCP servers. Resolve a fresh
  // access token up front so the runner injects a live token into the spawned
  // server's env. Short-circuits before the agent/user/global cascade since
  // these creds only ever live on the user's OAuth connection row.
  if (STDIO_OAUTH_SERVER_TYPES.has(serverType)) {
    const provider = getOAuthProvider(serverType);
    if (!provider) return null;
    try {
      const fresh = await resolveFreshOAuthCreds(provider, userId);
      if (!fresh) {
        log.info(`[creds-loader] ${serverType} userId=${userId} → no OAuth connection`);
        return null;
      }
      return {
        source: "user",
        connectionId: `oauth:${serverType}:${userId}`,
        credentials: { accessToken: fresh.accessToken },
        isUserOwned: true,
      };
    } catch (err) {
      const detail = err instanceof TokenRefreshError ? err.message : err instanceof Error ? err.message : String(err);
      log.error(`[creds-loader] ${serverType} userId=${userId} → token refresh failed: ${detail}`);
      return null;
    }
  }

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
      log.info(
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
  }

  // xyne-spaces-app-tools: empty credentialFields by design — there is no
  // per-user secret. The MCP server runs with the AGENT'S spacesAppToken
  // (each agent has its own bot identity, set when the agent was created).
  // We resolve using the agent in scope so cross-agent calls don't leak the
  // wrong bot's token. If no agentSlug is in context (admin / health-check
  // paths) we have no agent identity to act as — return null and let the
  // caller decide what to do.
  // research-agent-mcp: shared/global stdio proxy configured entirely by
  // environment. There is no user OAuth/login flow and no per-user secret; the
  // spawned MCP child receives RESEARCH_AGENT_MCP_API_KEY from CONFIG.
  if (serverType === "research-agent-mcp") {
    if (!CONFIG.researchAgentMcpApiKey) {
      log.info(`[creds-loader] research-agent-mcp userId=${userId} → RESEARCH_AGENT_MCP_API_KEY not set`);
      return null;
    }
    log.info(`[creds-loader] research-agent-mcp userId=${userId} → env hit`);
    return {
      source: "global",
      connectionId: "env:research-agent-mcp",
      credentials: {
        apiKey: CONFIG.researchAgentMcpApiKey,
        serverUrl: CONFIG.researchAgentBaseUrl,
      },
      isUserOwned: false,
    };
  }

  if (serverType === "xyne-spaces-app-tools") {
    if (!agentSlug) {
      log.info(`[creds-loader] xyne-spaces-app-tools userId=${userId} → no agentSlug in context; cannot resolve app_token`);
      return null;
    }
    const agent = await prisma.agent.findUnique({ where: { slug: agentSlug } });
    if (agent?.spacesAppToken) {
      const parts = agent.spacesAppToken.split(":");
      if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
        try {
          const appToken = decrypt(parts[0], parts[1], parts[2], CONFIG.encryptionKey);
          log.info(`[creds-loader] xyne-spaces-app-tools userId=${userId} agent=${agentSlug} → resolved app_token from agent row`);
          return {
            source: "agent",
            connectionId: `app-tools:${agent.id}`,
            credentials: { url: CONFIG.spacesInternalUrl, app_token: appToken },
            isUserOwned: false,
          };
        } catch {
          log.error(`[creds-loader] xyne-spaces-app-tools: failed to decrypt agent=${agentSlug} spacesAppToken`);
        }
      }
    }
    log.info(`[creds-loader] xyne-spaces-app-tools userId=${userId} agent=${agentSlug} → no spacesAppToken on agent; cannot resolve`);
    return null;
  }

  const userConn = await prisma.userMcpConnection.findFirst({
    where: { userId, mcpServer: { type: serverType } },
    include: { mcpServer: true },
  });

  log.info(`[creds-loader] enter ${serverType} userId=${userId} userConnFound=${!!userConn}`);

  if (userConn) {
    const credentials = await getFreshCredentials(
      userConn.id,
      userId,
      serverType,
      userConn.encryptedCreds,
      userConn.iv,
      userConn.authTag,
    );
    log.info(`[creds-loader] ${serverType} userId=${userId} → user-row hit (connId=${userConn.id})`);
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
