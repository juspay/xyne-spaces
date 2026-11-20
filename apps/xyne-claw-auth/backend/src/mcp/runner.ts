import { errMsg } from "../lib/errors.js";
import { createHash } from "node:crypto";
import type { McpAdapter, McpCallResult, McpServerTools, McpToolInfo } from "./types.js";
import { extForMime, fileNameFromResource } from "./attachment-filename.js";
import { STATIC_ADAPTERS } from "./static-adapters.js";
import { resolveConnectorDefinition, effectiveWriteTools } from "./connector-definitions.js";
import { resolveAgentSpacesAuth } from "../surfaces/spaces/user-auth.js";
import { spacesUserIdForClawUser } from "../lib/users-jit.js";
import { SPACES_SESSION_CREDENTIAL_SERVER_TYPES } from "../lib/spaces-session-server-types.js";
import { prisma } from "../db.js";
import { CONFIG } from "../config.js";
import { redisService } from "../redis.js";
import { createLogger } from "../logger.js";
import { recordKnownMcpTools } from "../lib/mcp-tool-name-index.js";
import { PER_CALL_AUTH_SERVER_TYPES, spacesCallAuthMeta } from "xyne-claw-mcp-common/spaces-call-auth";
import { getAgentBotAuth, type AgentBotAuth } from "../lib/spaces-bot.js";
import { EXTRA_CONNECTORS } from "./extra-connectors.js";
import { mcpExecutor, mcpServiceConfigured, type McpCallRaw, type McpSessionRef } from "./executor.js";
import type { LaunchSpec } from "xyne-claw-mcp-common/protocol";

/*
 * Builds session keys, credential fingerprints and launch specs, keeps tool-list
 * caches and post-processes results. MCP calls go through mcp/executor.ts.
 */

const log = createLogger("runner");

/**
 * Bot token for a run whose user is the agent's own bot (no person behind it):
 * a 10-minute agent token for the bot API (lib/spaces-bot.ts), re-resolved on
 * every call so a rotated token respawns the child (see incomingToken below).
 * Only when `userId` IS the agent's bot — the principal's bot user, or the
 * legacy app bot user on the agent row — never for a person without a session.
 */
async function resolveBotTokenForAgentUser(
  userId: string,
  clawAgentId: string | undefined,
  workspaceId: string | null | undefined,
): Promise<AgentBotAuth | null> {
  try {
    let agentId = clawAgentId;
    let legacyBotUser = false;
    if (!agentId) {
      const row = await prisma.agent.findFirst({ where: { spacesAppUserId: userId }, select: { id: true } });
      agentId = row?.id;
      legacyBotUser = !!row;
    }
    if (!agentId) return null;
    const bot = await getAgentBotAuth(agentId, workspaceId ?? null);
    if (!bot) return null;
    if (!legacyBotUser && bot.botUserId !== userId) return null;
    return bot;
  } catch (err) {
    log.warn(`[mcp/runner] bot token resolve failed for user ${userId}: ${errMsg(err)}`);
    return null;
  }
}

function spawnIdentity(credentials: Record<string, unknown>): string {
  const { sessionId: _sessionId, ...rest } = credentials;
  return credentialFingerprint(rest);
}

/**
 * Server types whose spawned MCP server runs with credentials bound to a
 * specific agent (not the user). For these, the cache key MUST include the
 * agent slug, otherwise the first agent to warm the cache (e.g. xyne-doctor)
 * leaks its app token to every subsequent call from any other agent owned by
 * the same user (e.g. harry) — observed cross-attribution bug.
 *
 * Anything not in this set keeps the legacy per-user keying.
 */
const PER_AGENT_SERVER_TYPES = new Set<string>(["xyne-spaces-app-tools"]);

/**
 * Which caller family a session belongs to. `"app"` is a Spaces artifact app
 * calling through routes/app-connectors-internal.ts with the VIEWER's own
 * credential; everything else (agent runs, health, tool sync) is the default
 * lane.
 *
 * The lanes never share a session. Keys are otherwise `${userId}:${serverType}`
 * and a cached session is only replaced when token/accessToken/botToken/apiKey
 * changes — so without this an app call could reuse a session an agent opened
 * with its PINNED credential (e.g. a username/password connector, or the same
 * token against a different url) and run as the agent. A suffix, not a
 * prefix, so evictAllSessionsForUser's `${userId}:` sweep still covers it.
 */
export type SessionLane = "app";

const APP_LANE_SUFFIX = "::app";

/**
 * Server types whose spawned child is bound to ONE Spaces workspace — its
 * session token and workspace-scoped Spaces id live in the child's env. A
 * two-workspace user still has ONE canonical Claw id, so keying by userId
 * alone would let a run in workspace B reuse workspace A's cached child (and
 * act with A's token and Spaces id — e.g. a ticket lands in the wrong
 * tenant) or, when runs alternate, keep evicting the sibling workspace's
 * in-flight child. These keys therefore carry the loaded workspaceId.
 */
const SPACES_WORKSPACE_SCOPED_SERVER_TYPES = new Set<string>([
  ...SPACES_SESSION_CREDENTIAL_SERVER_TYPES,
  "xyne-spaces-app-tools",
]);

function sessionKey(
  userId: string,
  serverType: string,
  agentSlug?: string,
  credentials?: Record<string, unknown>,
  lane?: SessionLane,
  instance?: string,
): string {
  const suffix = lane === "app" ? APP_LANE_SUFFIX : "";
  const instanceSegment = instance && instance !== "default" ? `:inst:${instance}` : "";
  const credsWorkspaceId = credentials?.["workspaceId"];
  const wsSegment =
    SPACES_WORKSPACE_SCOPED_SERVER_TYPES.has(serverType) && typeof credsWorkspaceId === "string" && credsWorkspaceId.trim()
      ? `:ws:${credsWorkspaceId.trim()}`
      : "";
  // An agent-token child acts as ONE agent (Spaces principal) for the user:
  // agent A's child must never serve agent B, so the principal is in the key.
  const credsPrincipalId = credentials?.["principalId"];
  const principalSegment =
    SPACES_WORKSPACE_SCOPED_SERVER_TYPES.has(serverType) && typeof credsPrincipalId === "string" && credsPrincipalId.trim()
      ? `:pr:${credsPrincipalId.trim()}`
      : "";
  // Slack credentials can be supplied by the workspace that dispatched a
  // surface run. Keep each team's env-bound child process isolated.
  const slackTeamId = credentials?.["teamId"];
  if (serverType === "slack" && typeof slackTeamId === "string" && slackTeamId) {
    return `${userId}:${serverType}:team:${slackTeamId}${instanceSegment}${wsSegment}${suffix}`;
  }
  if (PER_AGENT_SERVER_TYPES.has(serverType) && agentSlug) {
    return `${userId}:${serverType}:${agentSlug}${instanceSegment}${wsSegment}${principalSegment}${suffix}`;
  }
  return `${userId}:${serverType}${instanceSegment}${wsSegment}${principalSegment}${suffix}`;
}

async function resolveSession(
  userId: string,
  serverType: string,
  credentials: Record<string, unknown>,
  agentSlug?: string,
  lane?: SessionLane,
  instance?: string,
): Promise<{ ref: McpSessionRef; credentials: Record<string, unknown> }> {
  if (SPACES_SESSION_CREDENTIAL_SERVER_TYPES.has(serverType)) {
    // Benchmark lane: the onyx-ask-ai agent ALWAYS routes to the benchmark Vespa
    // cluster, regardless of whether a live login session exists. The agent's
    // bot token is resolved so the spaces tools authenticate via the bot API
    // (no user session needed).
    if (agentSlug === "onyx-ask-ai") {
      if (!CONFIG.onyxVespaEndpoint.trim()) {
        throw new Error("[mcp/runner] onyx dispatch but ONYX_EVAL_VESPA_ENDPOINT is unset — refusing to spawn (no prod fallback).");
      }
      const benchAgentId = typeof credentials["clawAgentId"] === "string" ? (credentials["clawAgentId"] as string) : undefined;
      const bot = await resolveBotTokenForAgentUser(userId, benchAgentId, CONFIG.onyxWorkspaceId);
      const appToken = bot?.token ?? null;
      log.info(`[mcp/runner] onyx-routing for bench agent (slug=${agentSlug}, user=${userId}) → ${CONFIG.onyxVespaEndpoint} (botToken=${appToken ? "resolved" : "missing"})`);
      credentials = {
        ...credentials,
        authMode: "app",
        userId,
        workspaceId: CONFIG.onyxWorkspaceId,
        directVespa: "true",
        vespaEndpoint: CONFIG.onyxVespaEndpoint,
        url: CONFIG.spacesBackendUrl,
        ...(appToken ? { token: appToken } : {}),
      };
    } else {
      // Scope the identity resolution with the workspace the credentials
      // were loaded for (a two-workspace user otherwise hits the ambiguity
      // guard in resolveSpacesIdentity and silently gets null).
      const credsWorkspaceId = typeof credentials["workspaceId"] === "string" && credentials["workspaceId"].trim()
        ? (credentials["workspaceId"] as string).trim()
        : undefined;
      // Spaces auth is the run's agent acting for this user: the loader stamps
      // `clawAgentId` on the credentials, and the token is re-resolved here on
      // every call (in-memory cached; Spaces tokens last 10 min) so a stale
      // child is evicted below when it rotates. No agent / Spaces refuses →
      // the non-agent fallbacks below, never a stale token.
      const clawAgentId = typeof credentials["clawAgentId"] === "string" ? (credentials["clawAgentId"] as string) : undefined;
      const live = clawAgentId
        ? await resolveAgentSpacesAuth({ clawAgentId, userId, workspaceId: credsWorkspaceId ?? null, caller: "mcp-runner" })
        : null;
      if (!live) {
        const { agentToken: _a, principalId: _p, clawAgentId: _c, ...rest } = credentials;
        credentials = rest;
      }
      if (live) {
        // The child's ctx.userId powers Spaces-facing headers
        // (x-user-id / x-xyne-acting-user-id), createdBy, whoami and every
        // Vespa ACL filter — all keyed by the workspace-scoped Spaces id.
        // A canonical Claw id is a guaranteed miss in Spaces' users table, so
        // hand the child the Spaces id; the Claw-canonical `userId` argument
        // still keys the session cache and every Claw-side lookup.
        const spacesUserId = await spacesUserIdForClawUser(userId, live.workspaceId).catch(() => userId);
        const { token: _t, sessionId: _s, ...rest } = credentials;
        credentials = {
          ...rest,
          agentToken: live.agentToken,
          principalId: live.principalId,
          workspaceId: live.workspaceId,
          userId: spacesUserId,
        };
      } else {
        // No person behind this userId: if it is the agent's own bot, run the
        // spaces tools in APP MODE on the bot API with a bot token.
        const bot = await resolveBotTokenForAgentUser(userId, clawAgentId, credsWorkspaceId ?? null);
        if (bot) {
          log.info(`[mcp/runner] xyne-spaces app-mode for agent bot ${userId} (bot token, workspace ${bot.workspaceId})`);
          credentials = { ...credentials, token: bot.token, authMode: "app", userId, workspaceId: bot.workspaceId };
        } else {
          // Cached-credentials path (no live session): same Claw→Spaces id
          // translation as the live branch so the child's Spaces-facing
          // identity stays correct.
          const spacesUserId = await spacesUserIdForClawUser(userId, credsWorkspaceId).catch(() => userId);
          credentials = { ...credentials, userId: spacesUserId };
        }
      }
    }
  }

  // Compute the session key AFTER the credential enrichment above so the
  // loaded workspaceId (live session, app token, or bench route) lands in the
  // key — the Spaces-family sessions are keyes per (user × server ×
  // workspace); keying on the pre-enrichment creds would collapse two
  // workspaces back into one shared child process.
  const key = sessionKey(userId, serverType, agentSlug, credentials, lane, instance);

  // For xyne-spaces the rotating credential is `token`; for OAuth-based HTTP
  // adapters (customerio, honeycomb, egnyte, …) it is `accessToken`; for
  // header/apiKey adapters (e.g. expense-prod's `Authorization: Basic
  // {{apiKey}}`) it is `apiKey`. Track whichever is present so stale HTTP
  // sessions are evicted after the credential changes.
  //
  // BUG THIS FIXES: apiKey was NOT considered here, so when a user swapped an
  // apiKey-based connector's token, `incomingToken` stayed undefined, the
  // eviction check below was skipped, and the runner reused a session pinned to
  // the OLD key forever → every call through it timed out (-32001) even though
  // creds-loader had already resolved the new key. Seen on expense-prod.
  const incomingToken =
    typeof credentials["agentToken"] === "string" && credentials["agentToken"]
      ? (credentials["agentToken"] as string)
      : typeof credentials["token"] === "string"
      ? (credentials["token"] as string)
      : typeof credentials["accessToken"] === "string"
        ? (credentials["accessToken"] as string)
        : typeof credentials["app_token"] === "string" && credentials["app_token"]
          ? (credentials["app_token"] as string)
        : typeof credentials["botToken"] === "string"
          ? (credentials["botToken"] as string)
        : typeof credentials["apiKey"] === "string"
          ? (credentials["apiKey"] as string)
          : undefined;

  // Fingerprint of the session's credentials: the Spaces identity for per-call
  // auth servers, a hash of the rotating token for others, else empty.
  const perCallAuth = PER_CALL_AUTH_SERVER_TYPES.has(serverType);
  const fingerprint = perCallAuth
    ? `id:${spawnIdentity(credentials)}`
    : incomingToken
      ? `tok:${createHash("sha256").update(incomingToken).digest("hex").slice(0, 32)}`
      : "";

  const launchCredentials = credentials;
  return {
    ref: { key, serverType, fingerprint, launch: () => buildLaunchSpec(serverType, launchCredentials) },
    credentials,
  };
}

/** Launch spec for a session: the command or URL plus the user's credentials. */
async function buildLaunchSpec(serverType: string, credentials: Record<string, unknown>): Promise<LaunchSpec> {
  const definition = await resolveConnectorDefinition(serverType);
  if (!definition) {
    throw new Error(`No connector definition for server type: ${serverType}`);
  }
  if (definition.transport === "http") {
    const { url, headers } = definition.buildHttpConfig(credentials);
    if (!url) throw new Error(`Missing HTTP URL in connector definition for ${serverType}`);
    return { transport: "http", url, headers };
  }
  const { cmd, args, env, files } = definition.buildStdioCommand(credentials);
  if (!cmd) throw new Error(`Missing stdio command in connector definition for ${serverType}`);
  return { transport: "stdio", cmd, args: [...args], env, ...(files ? { files } : {}) };
}

const SHARED_TOOL_LIST_SERVER_TYPES = new Set<string>([
  "xyne-spaces",
  "xyne-spaces-app-tools",
  "xyne-dashboard",
  "google",
  "microsoft",
  "jenkins",
  "reddit",
  "twitter",
  "x-news",
  "linkedin-rapidapi",
  ...EXTRA_CONNECTORS.sharedToolListTypes,
]);
const toolListCache = new Map<string, { tools: McpToolInfo[]; at: number }>();
const toolListInflight = new Map<string, Promise<McpToolInfo[]>>();

const userToolListCache = new Map<string, { tools: McpToolInfo[]; at: number }>();
const userToolListInflight = new Map<string, Promise<McpToolInfo[]>>();

const MCP_LIST_TOOLS_CUTOFF_MS = Number(process.env["MCP_LIST_TOOLS_CUTOFF_MS"] ?? 1_000);
const MCP_LIST_TOOLS_BACKOFF_MS = Number(process.env["MCP_LIST_TOOLS_BACKOFF_MS"] ?? 300_000);
const toolListSkipUntil = new Map<string, number>();

export function clearToolListCache(): void {
  toolListCache.clear();
  toolListInflight.clear();
  userToolListCache.clear();
  userToolListInflight.clear();
  toolListSkipUntil.clear();
}

const ROTATING_CREDENTIAL_FIELD = /token|secret|password|expires|refresh|cookie/i;

function credentialFingerprint(credentials: Record<string, unknown>): string {
  const stable = Object.keys(credentials)
    .filter((k) => !ROTATING_CREDENTIAL_FIELD.test(k))
    .sort()
    .map((k) => [k, typeof credentials[k] === "object" ? JSON.stringify(credentials[k]) : String(credentials[k])]);
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex").slice(0, 16);
}

function dropUserToolLists(matches: (key: string) => boolean): void {
  for (const key of [...userToolListCache.keys()]) if (matches(key)) userToolListCache.delete(key);
  for (const key of [...userToolListInflight.keys()]) if (matches(key)) userToolListInflight.delete(key);
  for (const key of [...toolListSkipUntil.keys()]) if (matches(key)) toolListSkipUntil.delete(key);
}

type ToolListCache = Map<string, { tools: McpToolInfo[]; at: number }>;

function refreshToolList(
  cache: ToolListCache,
  inflightMap: Map<string, Promise<McpToolInfo[]>>,
  key: string,
  fetchTools: () => Promise<McpToolInfo[]>,
): Promise<McpToolInfo[]> {
  const inflight = inflightMap.get(key);
  if (inflight) return inflight;
  const started = fetchTools()
    .then((tools) => {
      if (tools.length > 0 && inflightMap.get(key) === started) cache.set(key, { tools, at: Date.now() });
      return tools;
    })
    .finally(() => {
      if (inflightMap.get(key) === started) inflightMap.delete(key);
    });
  inflightMap.set(key, started);
  return started;
}

function cachedToolList(
  cache: ToolListCache,
  inflightMap: Map<string, Promise<McpToolInfo[]>>,
  key: string,
  fetchTools: () => Promise<McpToolInfo[]>,
): Promise<McpToolInfo[]> {
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached.tools);
  return refreshToolList(cache, inflightMap, key, fetchTools);
}

function userToolList(key: string, fetchTools: () => Promise<McpToolInfo[]>): Promise<McpToolInfo[]> {
  return cachedToolList(userToolListCache, userToolListInflight, key, fetchTools);
}

function sharedToolList(serverType: string, fetchTools: () => Promise<McpToolInfo[]>): Promise<McpToolInfo[]> {
  return cachedToolList(toolListCache, toolListInflight, serverType, fetchTools);
}

const MISSING_TOOL_ERROR = /unknown tool|tool\b.*\bnot found|no such tool/i;

function forgetToolList(
  userId: string,
  serverType: string,
  agentSlug: string | undefined,
  credentials: Record<string, unknown>,
  lane: SessionLane | undefined,
): void {
  toolListCache.delete(serverType);
  toolListInflight.delete(serverType);
  const prefix = `${sessionKey(userId, serverType, agentSlug, credentials, lane)}#`;
  dropUserToolLists((key) => key.startsWith(prefix));
}

export async function listToolsForUser(
  userId: string,
  serverType: string,
  serverName: string,
  credentials: Record<string, unknown>,
  agentSlug?: string,
  options: { fresh?: boolean; lane?: SessionLane; cutoff?: boolean } = {},
): Promise<McpServerTools> {
  const fetchTools = () => fetchToolsFromServer(userId, serverType, credentials, agentSlug, options.lane);
  let tools: McpToolInfo[];
  if (options.fresh) {
    tools = await fetchTools();
  } else {
    const shared = SHARED_TOOL_LIST_SERVER_TYPES.has(serverType);
    const key = shared
      ? serverType
      : `${sessionKey(userId, serverType, agentSlug, credentials, options.lane)}#${credentialFingerprint(credentials)}`;
    const list = () => (shared ? sharedToolList(key, fetchTools) : userToolList(key, fetchTools));
    tools = options.cutoff ? await withListCutoff(serverType, key, list) : await list();
  }
  void recordKnownMcpTools(userId, serverType, tools);

  const definition = await resolveConnectorDefinition(serverType);
  const writeTools = definition?.writePolicy
    ? effectiveWriteTools(definition.writePolicy, tools.map((t) => t.name))
    : (definition?.writeTools ?? []);
  return { serverType, serverName, tools, writeTools };
}

export class McpToolListUnavailableError extends Error {}

function cachedListFor(key: string): McpToolInfo[] | undefined {
  return (toolListCache.get(key) ?? userToolListCache.get(key))?.tools;
}

async function withListCutoff(
  serverType: string,
  key: string,
  list: () => Promise<McpToolInfo[]>,
): Promise<McpToolInfo[]> {
  const cached = cachedListFor(key);
  if (cached) return cached;
  const skipUntil = toolListSkipUntil.get(key);
  if (skipUntil && skipUntil > Date.now()) {
    throw new McpToolListUnavailableError(`${serverType} skipped: tool listing failed or timed out recently`);
  }
  const listing = list();
  listing.then(
    () => toolListSkipUntil.delete(key),
    () => toolListSkipUntil.set(key, Date.now() + MCP_LIST_TOOLS_BACKOFF_MS),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cutoff = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      toolListSkipUntil.set(key, Date.now() + MCP_LIST_TOOLS_BACKOFF_MS);
      reject(new McpToolListUnavailableError(`${serverType} tool listing exceeded ${MCP_LIST_TOOLS_CUTOFF_MS}ms; continuing without it`));
    }, MCP_LIST_TOOLS_CUTOFF_MS);
  });
  try {
    return await Promise.race([listing, cutoff]);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchToolsFromServer(
  userId: string,
  serverType: string,
  credentials: Record<string, unknown>,
  agentSlug?: string,
  lane?: SessionLane,
): Promise<McpToolInfo[]> {
  const { ref } = await resolveSession(userId, serverType, credentials, agentSlug, lane);
  return mcpExecutor().listTools(ref);
}

// Servers whose tools' binary output should be forwarded to the user as a file
// attachment instead of being dropped (the default keeps only text).
//
// Primary source is the DB: the SERVER-level `mcpServer.forwardFiles` flag
// (admin-toggleable, surfaced via the resolved connector definition). It's
// server-level rather than per-tool because the extractor only ever lifts
// BINARY content (EmbeddedResource blob / image / audio) — a text/data tool on
// the same server returns text and is unaffected. The hardcoded set is a
// bootstrap fallback (covers a server before its row is configured).
const FILE_FORWARDING_SERVERS = new Set<string>([
  "q-analytics-mcp",
]);

// Small TTL cache so a rapid tool-call loop doesn't re-resolve the definition.
const FORWARD_FLAG_TTL_MS = 60_000;
const forwardFlagCache = new Map<string, { val: boolean; at: number }>();

async function shouldForwardFiles(serverType: string): Promise<boolean> {
  // Fast path / bootstrap: code-level allowlist.
  if (FILE_FORWARDING_SERVERS.has(serverType)) return true;
  // DB-driven: the server's forwardFiles flag (via the connector definition).
  const cached = forwardFlagCache.get(serverType);
  if (cached && Date.now() - cached.at < FORWARD_FLAG_TTL_MS) return cached.val;
  let val = false;
  try {
    const def = await resolveConnectorDefinition(serverType);
    val = def?.forwardFiles === true;
  } catch {
    val = false; // best-effort: on error, don't forward (text-only fallback)
  }
  forwardFlagCache.set(serverType, { val, at: Date.now() });
  return val;
}

/**
 * Many file-fetching MCP tools (e.g. bitbucket-mcp-server's get_file_content)
 * return the fetched file as a STRING field nested inside a JSON envelope —
 * `{"file_path":...,"branch":...,"content":"<file>"}` — via JSON.stringify,
 * because MCP's wire format only allows a tool to return one text string, and
 * this is the only way to pack file text plus metadata (path/branch/line
 * info) into that single string. But JSON strings can't contain literal
 * newlines, so every "\n" in the source file gets escaped to the two
 * characters \ + n, collapsing a multi-thousand-line file into ONE physical
 * line. Downstream, both promoteIfOversized's spill-to-file (tool-output.ts)
 * and pi's line-based `read` tool (truncate.js) choke on that single
 * oversized line. This isn't specific to any one tool — any MCP tool that
 * wraps file text this way hits the same failure, so we detect the SHAPE
 * (a `file_path` string alongside a `content` string) rather than an
 * allowlist of tool names, so every such tool benefits automatically.
 *
 * Gating on `file_path` + `content` together (not `content` alone) avoids
 * misfiring on unrelated tools that legitimately return a short `content`
 * string alongside other fields the model needs (e.g. a "ticket created"
 * confirmation) — those aren't file-fetch responses and must pass through
 * untouched.
 */
function unwrapFileContentEnvelope(text: string): string {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const body = parsed["content"];
    if (typeof parsed["file_path"] !== "string" || typeof body !== "string") return text;
    const header = [`File: ${parsed["file_path"]}${typeof parsed["branch"] === "string" ? ` (branch: ${parsed["branch"]})` : ""}`];
    const lineInfo = parsed["line_info"] as { message?: string } | undefined;
    if (lineInfo?.message) header.push(`[${lineInfo.message}]`);
    return `${header.join("\n")}\n\n${body}`;
  } catch {
    return text; // not JSON, or not the file-fetch shape — pass through untouched
  }
}

/**
 * Pull binary files out of an MCP result's content array:
 *   • EmbeddedResource ({type:"resource", resource:{blob, mimeType, uri}}) → file
 *     (download name is taken from the resource `uri`; see fileNameFromResource)
 *   • ImageContent / AudioContent ({type:"image"|"audio", data, mimeType}) → file
 * Returns base64 attachments; ignores text items (incl. base64 text fallbacks).
 */
function extractAttachments(
  items: Array<Record<string, unknown>>,
  tool: string,
): Array<{ fileName: string; mimeType: string; data: string }> {
  const out: Array<{ fileName: string; mimeType: string; data: string }> = [];
  let idx = 0;
  for (const c of items) {
    const type = c["type"];
    if (type === "resource" && c["resource"] && typeof c["resource"] === "object") {
      const res = c["resource"] as Record<string, unknown>;
      if (typeof res["blob"] === "string") {
        const mime = typeof res["mimeType"] === "string" ? res["mimeType"] : "application/octet-stream";
        out.push({ fileName: fileNameFromResource(res["uri"], mime, tool, ++idx), mimeType: mime, data: res["blob"] });
      }
    } else if ((type === "image" || type === "audio") && typeof c["data"] === "string") {
      const mime = typeof c["mimeType"] === "string"
        ? c["mimeType"]
        : type === "image" ? "image/png" : "audio/mpeg";
      out.push({ fileName: `${tool}-${++idx}.${extForMime(mime)}`, mimeType: mime, data: c["data"] });
    }
  }
  return out;
}

export async function callTool(
  userId: string,
  serverType: string,
  credentials: Record<string, unknown>,
  tool: string,
  params: Record<string, unknown>,
  agentSlug?: string,
  lane?: SessionLane,
  instance?: string,
): Promise<McpCallResult> {
  const { ref, credentials: resolved } = await resolveSession(userId, serverType, credentials, agentSlug, lane, instance);
  const callMeta = PER_CALL_AUTH_SERVER_TYPES.has(serverType) ? spacesCallAuthMeta(resolved) : undefined;

  const result: McpCallRaw = await mcpExecutor()
    .callTool(ref, tool, params, callMeta)
    .catch((err: unknown) => {
      if (MISSING_TOOL_ERROR.test(err instanceof Error ? err.message : String(err))) {
        forgetToolList(userId, serverType, agentSlug, credentials, lane);
      }
      throw err;
    });

  if ("content" in result && Array.isArray(result.content)) {
    const items = result.content as Array<Record<string, unknown>>;

    // File forwarding: for allowlisted tools, lift binary content (EmbeddedResource
    // blobs / image / audio) into `attachments` so it reaches the user as a real
    // file instead of being dropped. The default path below keeps only text.
    const forwardEnabled = await shouldForwardFiles(serverType);
    const binaryItems = extractAttachments(items, tool);
    const attachments = forwardEnabled ? binaryItems : undefined;

    const text = items
      .filter((c): c is { type: "text"; text: string } => c["type"] === "text" && typeof c["text"] === "string")
      .map((c) => c.text)
      .join("\n");

    if ("isError" in result && result.isError === true) {
      if (MISSING_TOOL_ERROR.test(text)) forgetToolList(userId, serverType, agentSlug, credentials, lane);
      const error = new Error(text || "MCP tool returned an error") as Error & { httpStatus?: number };
      // Tools may report the upstream HTTP status in `_meta.httpStatus`
      // (see withToolErrors in xyne-spaces-tools.ts); carry it so callers
      // like /flow-action can classify the failure without parsing text.
      const httpStatus = (result as { _meta?: { httpStatus?: unknown } })._meta?.httpStatus;
      if (typeof httpStatus === "number") error.httpStatus = httpStatus;
      throw error;
    }

    // MCP `_meta` is a free-form metadata field. Tools surface structured
    // citations there so we can attach them to the invocation record without
    // grepping the markdown body for IDs (Tier 1 citation propagation).
    // Same channel is used by spaces-search to carry the Vespa YQL debug
    // payload under `_meta.debug` — strictly metadata, never enters `content`.
    const meta = (result as { _meta?: { citations?: unknown; debug?: unknown } })._meta;
    const citations = Array.isArray(meta?.citations) ? meta.citations as McpCallResult["citations"] : undefined;
    const debug = meta?.debug && typeof meta.debug === "object"
      ? meta.debug as Record<string, unknown>
      : undefined;

    // When we forwarded file(s), suppress the (often huge, base64-chunked) text
    // body — the file goes to the user; the model only needs a short confirmation.
    let content = attachments && attachments.length > 0
      ? `Generated and forwarded ${attachments.length} file(s) to the user: ${attachments.map((a) => a.fileName).join(", ")}.`
      : unwrapFileContentEnvelope(text);

    // Binary returned but forwarding is OFF: before 2026-07-16 this dropped the
    // file SILENTLY — the model saw empty text and confidently told the user
    // "the file should be attached" (credit-data-doctor / TestCreditDataGenie
    // Excel export). Tell the model the truth so it reports the real state, and
    // log it so the failure is findable.
    if (!forwardEnabled && binaryItems.length > 0) {
      log.warn(
        `[mcp/runner] dropped ${binaryItems.length} binary file(s) from ${serverType}/${tool} — forwardFiles is disabled for this server (user=${userId} agent=${agentSlug ?? "-"})`,
      );
      content =
        (content ? `${content}\n\n` : "") +
        `[NOTE: this tool returned ${binaryItems.length} binary file(s) (${binaryItems.map((a) => a.fileName).join(", ")}) but file-forwarding is DISABLED for the "${serverType}" connector, so the file was NOT delivered to the user. Do NOT tell the user a file is attached. Ask an admin to enable file-forwarding (forwardFiles) for this connector, or use a tool that returns the data as text.]`;
    }

    return {
      content,
      ...(citations && citations.length > 0 ? { citations } : {}),
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
      ...(debug ? { debug } : {}),
    };
  }

  return { content: JSON.stringify(result) };
}

export const MCP_EVICT_CHANNEL = "claw:mcp:evict";

export async function evictSession(userId: string, serverType: string, agentSlug?: string): Promise<void> {
  try {
    await evictSessionLocal(userId, serverType, agentSlug);
  } finally {
    await redisService
      .getConnection()
      .publish(MCP_EVICT_CHANNEL, JSON.stringify({ userId, serverType, ...(agentSlug ? { agentSlug } : {}) }))
      .then(() => {}, () => {});
  }
}

export async function evictSessionLocal(userId: string, serverType: string, agentSlug?: string): Promise<void> {
  const key = sessionKey(userId, serverType, agentSlug);
  // Match the base key AND every scoping suffix — ":ws:…" (Spaces workspace),
  // ":team:…" (Slack), "::app" (app lane) and their combinations — because a
  // reconnect / disconnect / OAuth event must not outlive the credential ANY
  // scoped session was built on. The pool matches `key` and `${key}:…`.
  dropUserToolLists((candidate) => candidate.startsWith(`${key}#`) || candidate.startsWith(`${key}:`));
  log.info(`[mcp/runner] evicting sessions for ${key}`);
  if (mcpServiceConfigured()) await mcpExecutor().evict({ scopedKeys: [key] });
}

export async function evictAllSessionsForUser(userId: string): Promise<void> {
  const prefix = `${userId}:`;
  dropUserToolLists((candidate) => candidate.startsWith(prefix));
  if (mcpServiceConfigured()) await mcpExecutor().evict({ prefixes: [prefix] });
}

function sessionServerType(key: string): string {
  return key.split("#")[0]?.split(":")[1] ?? "";
}

export async function restartMcpServers(serverType?: string): Promise<{ sessions: number; toolLists: number }> {
  const matches = (key: string) => !serverType || sessionServerType(key) === serverType;
  let toolLists = 0;
  for (const key of [...toolListCache.keys()]) {
    if (serverType && key !== serverType) continue;
    toolListCache.delete(key);
    toolListInflight.delete(key);
    toolLists++;
  }
  for (const key of [...userToolListCache.keys()]) if (matches(key)) toolLists++;
  dropUserToolLists(matches);
  if (serverType) toolListSkipUntil.delete(serverType);
  else toolListSkipUntil.clear();
  if (!serverType) toolListInflight.clear();
  const sessions = mcpServiceConfigured() ? await mcpExecutor().restart(serverType) : 0;
  log.info(`[mcp/runner] restart ${serverType ?? "all servers"}: closed ${sessions} session(s), dropped ${toolLists} tool list(s)`);
  return { sessions, toolLists };
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
