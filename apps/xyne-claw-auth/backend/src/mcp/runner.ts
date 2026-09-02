import path from "node:path";
import { errMsg } from "../lib/errors.js";
import { existsSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpAdapter, McpCallResult, McpServerTools, McpToolInfo } from "./types.js";
import { extForMime, fileNameFromResource } from "./attachment-filename.js";
import { STATIC_ADAPTERS } from "./static-adapters.js";
import { resolveConnectorDefinition } from "./connector-definitions.js";
import { getSpacesAuthForUser, getWorkspaceIdForUser } from "../lib/spaces-db.js";
import { provisionStdioCommand } from "./provision.js";
import { prisma } from "../db.js";
import { decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";

import { createLogger } from "../logger.js";
const log = createLogger("runner");

/**
 * Tolerant JSON Schema validator for MCP tool output schemas.
 *
 * Since SDK ~1.28, Client.listTools() eagerly compiles an Ajv validator for
 * EVERY tool's outputSchema. A single non-self-contained schema — e.g. Google
 * Stitch's `$ref: "#/$defs/ScreenInstance"` with the $defs block living
 * outside the outputSchema document — makes Ajv throw MissingRefError
 * ("can't resolve reference ... from id #"), which fails the whole listTools
 * and bricks the entire connector, not just the one bad tool.
 *
 * One malformed third-party schema must degrade to "that tool's output isn't
 * validated", never to "the connector doesn't work". Compile failures are
 * logged once and replaced with a pass-through validator.
 */
const strictSchemaValidator = new AjvJsonSchemaValidator();
const warnedSchemaCompileFailures = new Set<string>();
const tolerantSchemaValidator: Pick<AjvJsonSchemaValidator, "getValidator"> = {
  getValidator: (schema) => {
    try {
      return strictSchemaValidator.getValidator(schema);
    } catch (err) {
      const message = errMsg(err);
      if (!warnedSchemaCompileFailures.has(message)) {
        warnedSchemaCompileFailures.add(message);
        log.warn(
          `[mcp/runner] tool outputSchema failed to compile — output validation disabled for this tool: ${message}`,
        );
      }
      return (input: unknown) => ({ valid: true as const, data: input as never, errorMessage: undefined });
    }
  },
};

/**
 * Resolve the app token for an agent's app user. App users have no Spaces login
 * session (so getSpacesAuthForUser returns null for them), but the agent row
 * carries a `spacesAppToken` (GCM-encrypted "ciphertext:iv:authTag"). When the
 * spaces MCP runs for such a userId we hand it this token + APP MODE so its
 * tools hit the /api/apps/* routes instead of /api/query.
 */
async function resolveAppTokenForAppUser(appUserId: string): Promise<string | null> {
  try {
    const agent = await prisma.agent.findFirst({
      where: { spacesAppUserId: appUserId },
      select: { spacesAppToken: true },
    });
    if (!agent?.spacesAppToken) return null;
    const [ciphertext, iv, authTag] = agent.spacesAppToken.split(":");
    if (!ciphertext || !iv || !authTag) return null;
    return decrypt(ciphertext, iv, authTag, CONFIG.encryptionKey);
  } catch (err) {
    log.warn(
      `[mcp/runner] app-token resolve failed for app user ${appUserId}: ${errMsg(err)}`,
    );
    return null;
  }
}

// Resolved once at module load — process.cwd() here is the running backend's
// dir. Logged so prod tells us if the path lands somewhere without
// node_modules/tsx (which is the failure mode we just fixed).
const TSX_ESM_PATH = path.join(process.cwd(), "node_modules", "tsx", "dist", "esm", "index.mjs");
const TSX_ESM_URL = `file://${TSX_ESM_PATH}`;
log.info(
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

// In-flight spawns, keyed like `sessions`. Coalesces concurrent first-time
// getOrCreateSession calls for the same key onto ONE spawn — without this, two
// concurrent callers each spawn a child process and the second `sessions.set`
// overwrites the first, ORPHANING its child (a leaked `node` MCP server). That
// plus un-cleaned-up failed connects grew claw-auth to ~100 node children /
// 44 GiB → kubelet eviction (2026-06-14).
const inflight = new Map<string, Promise<Client>>();

/**
 * Global per-call timeout for MCP requests (10 minutes). Applied around
 * `client.callTool()` and `client.listTools()`. Without this, a slow MCP
 * effectively gets the `@modelcontextprotocol/sdk` default (~60s), which
 * was biting operators on slow integrations (knowledge-base queries,
 * batched external APIs).
 *
 * Set globally rather than per-integration because (a) we couldn't reproduce
 * the original "30s" complaint as a real claw-auth-side cutoff, and (b) the
 * heterogeneous-MCP case ("Slack should fail fast, KB should be lenient")
 * never came up in practice. If it does, layer a per-integration override
 * via httpConfigTemplate.timeoutMs at that point.
 *
 * Initial `client.connect()` and stdio child startup keep SDK defaults —
 * different failure mode, separate concern.
 */
const MCP_REQUEST_TIMEOUT_MS = 600_000;

// Idle eviction. A cached session pins a child process (stdio) or an HTTP
// client plus its buffers in claw-auth's heap. Previously sessions were only
// dropped on token rotation / OAuth events / transport close — never on idle —
// so every (user × server) that ever ran a tool leaked forever. We now sweep
// idle sessions periodically; the next call simply respawns on demand.
const SESSION_IDLE_TTL_MS = Number(process.env["MCP_SESSION_IDLE_TTL_MS"] ?? 20 * 60 * 1000);
const SESSION_SWEEP_INTERVAL_MS = Number(process.env["MCP_SESSION_SWEEP_INTERVAL_MS"] ?? 5 * 60 * 1000);

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

function sessionKey(
  userId: string,
  serverType: string,
  agentSlug?: string,
  credentials?: Record<string, unknown>,
): string {
  // Slack credentials can be supplied by the workspace that dispatched a
  // surface run. Keep each team's env-bound child process isolated.
  const slackTeamId = credentials?.["teamId"];
  if (serverType === "slack" && typeof slackTeamId === "string" && slackTeamId) {
    return `${userId}:${serverType}:team:${slackTeamId}`;
  }
  if (PER_AGENT_SERVER_TYPES.has(serverType) && agentSlug) {
    return `${userId}:${serverType}:${agentSlug}`;
  }
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
    log.info(`[mcp/runner] idle sweep: evicted ${evicted} session(s) (${sessions.size} cached)`);
  }
}

const idleSweepTimer = setInterval(sweepIdleSessions, SESSION_SWEEP_INTERVAL_MS);
idleSweepTimer.unref(); // don't keep the process alive for the sweep

async function getOrCreateSession(
  userId: string,
  serverType: string,
  credentials: Record<string, unknown>,
  agentSlug?: string,
): Promise<Client> {
  const key = sessionKey(userId, serverType, agentSlug, credentials);

  // For xyne-spaces: ALWAYS read fresh creds from the Spaces DB FIRST, before
  // any cache lookup. The cached child process has its token baked into env
  // at spawn time; we must compare that against the live token and evict the
  // session if Spaces' middleware has rotated the JWT. Without this, the
  // creds-loader's "live-first hit" is computed and then thrown away — the
  // child keeps calling Spaces with a stale env-baked token and 401s.
  if (serverType === "xyne-spaces" || serverType === "xyne-dashboard") {
    // Benchmark lane: the onyx-ask-ai agent ALWAYS routes to the benchmark Vespa
    // cluster, regardless of whether a live login session exists. The agent's
    // app token is resolved so the spaces tools authenticate via /api/apps/*
    // (no user session needed).
    if (agentSlug === "onyx-ask-ai") {
      if (!CONFIG.onyxVespaEndpoint.trim()) {
        throw new Error("[mcp/runner] onyx dispatch but ONYX_EVAL_VESPA_ENDPOINT is unset — refusing to spawn (no prod fallback).");
      }
      const appToken = await resolveAppTokenForAppUser(userId);
      log.info(`[mcp/runner] onyx-routing for bench agent (slug=${agentSlug}, user=${userId}) → ${CONFIG.onyxVespaEndpoint} (appToken=${appToken ? "resolved" : "missing"})`);
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
      const live = await getSpacesAuthForUser(userId, "mcp-runner", credsWorkspaceId);
      if (live) {
        credentials = {
          ...credentials,
          token: live.token,
          sessionId: live.sessionId,
          workspaceId: live.workspaceId,
          userId,
        };
      } else {
        // No login session for this userId. If it's an agent's app user, fall
        // back to the agent's app token in APP MODE so the spaces tools work
        // headlessly via /api/apps/* (no user session needed).
        const appToken = await resolveAppTokenForAppUser(userId);
        if (appToken) {
          const workspaceId = await getWorkspaceIdForUser(userId, "mcp-runner", credsWorkspaceId).catch(() => null);
          log.info(`[mcp/runner] xyne-spaces app-mode for app user ${userId} (no session, using app token)`);
          credentials = { ...credentials, token: appToken, authMode: "app", userId, ...(workspaceId ? { workspaceId } : {}) };
        } else {
          credentials = { ...credentials, userId };
        }
      }
    }
  }

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
    typeof credentials["token"] === "string"
      ? (credentials["token"] as string)
      : typeof credentials["accessToken"] === "string"
        ? (credentials["accessToken"] as string)
        : typeof credentials["botToken"] === "string"
          ? (credentials["botToken"] as string)
        : typeof credentials["apiKey"] === "string"
          ? (credentials["apiKey"] as string)
          : undefined;

  const existing = sessions.get(key);
  if (existing) {
    // For xyne-spaces, the token rotates frequently (refresh-flow) so the
    // child must be respawned with the new env every time the token changes.
    // For other server types, creds rarely change between calls — but if they
    // do (e.g. user re-enters Bitbucket token), the same eviction kicks in.
    if (incomingToken && existing.spawnedToken && existing.spawnedToken !== incomingToken) {
      log.info(`[mcp/runner] evicting stale cached session for ${key} (token rotated)`);
      sessions.delete(key);
      await existing.transport.close().catch(() => {});
    } else {
      log.info(`[mcp/runner] reusing cached session for ${key}`);
      existing.lastUsedAt = Date.now(); // keep alive — only idle sessions are swept
      return existing.client;
    }
  }

  // Coalesce concurrent first-time spawns for this key onto one in-flight
  // promise so we never spawn (and then orphan) duplicate child processes.
  const pending = inflight.get(key);
  if (pending) {
    log.info(`[mcp/runner] awaiting in-flight spawn for ${key}`);
    return pending;
  }

  const spawnPromise = spawnSession(key, serverType, credentials, incomingToken)
    .finally(() => inflight.delete(key));
  inflight.set(key, spawnPromise);
  return spawnPromise;
}

/** Spawn + connect a fresh MCP session. Always reaps the child on connect
 *  failure (close() does SIGTERM→SIGKILL) so a failed/slow connect can't leak
 *  an orphaned MCP server process. */
async function spawnSession(
  key: string,
  serverType: string,
  credentials: Record<string, unknown>,
  incomingToken: string | undefined,
): Promise<Client> {
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
    log.info(`[mcp/runner] spawning HTTP session for ${key} url=${url}`);
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

  const client = new Client(
    { name: "xyne-claw-auth", version: "0.1.0" },
    { jsonSchemaValidator: tolerantSchemaValidator },
  );
  try {
    await client.connect(transport as Parameters<typeof client.connect>[0]);
  } catch (err) {
    // Connect failed (timeout, server crash on startup, bad creds). The child
    // process is already spawned — reap it (close() does SIGTERM→SIGKILL) so a
    // failed connect can't leak an orphaned MCP server. This was the dominant
    // leak: every "Some servers failed to list tools" left a live `node` child.
    await transport.close().catch(() => {});
    throw err;
  }

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
  agentSlug?: string,
): Promise<McpServerTools> {
  const client = await getOrCreateSession(userId, serverType, credentials, agentSlug);
  // Must pass BOTH `timeout` AND `signal`: the SDK runs an independent
  // internal timer initialised from `options.timeout ?? DEFAULT_REQUEST_TIMEOUT_MSEC`
  // (60s, see @modelcontextprotocol/sdk shared/protocol.js:712). Without
  // `timeout`, the SDK's 60s default wins the race and aborts the request
  // before our AbortSignal fires. The signal is kept as belt-and-suspenders.
  const result = await client.listTools(undefined, {
    timeout: MCP_REQUEST_TIMEOUT_MS,
    signal: AbortSignal.timeout(MCP_REQUEST_TIMEOUT_MS),
  });

  const tools: McpToolInfo[] = result.tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    inputSchema: t.inputSchema as Record<string, unknown>,
  }));

  const definition = await resolveConnectorDefinition(serverType);
  const writeTools = definition?.writeTools ?? [];
  return { serverType, serverName, tools, writeTools };
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
): Promise<McpCallResult> {
  const client = await getOrCreateSession(userId, serverType, credentials, agentSlug);

  // Same pattern as listToolsForUser above: pass BOTH `timeout` and `signal`
  // to override the SDK's 60s default. See protocol.js:712 in the MCP SDK.
  const result = await client.callTool({ name: tool, arguments: params }, undefined, {
    timeout: MCP_REQUEST_TIMEOUT_MS,
    signal: AbortSignal.timeout(MCP_REQUEST_TIMEOUT_MS),
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
      throw new Error(text || "MCP tool returned an error");
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

export async function evictSession(userId: string, serverType: string, agentSlug?: string): Promise<void> {
  const key = sessionKey(userId, serverType, agentSlug);
  if (serverType === "slack") {
    const keys = [...sessions.keys()].filter((candidate) => candidate === key || candidate.startsWith(`${key}:team:`));
    for (const candidate of keys) {
      const scopedSession = sessions.get(candidate);
      if (!scopedSession) continue;
      log.info(`[mcp/runner] evicting cached session for ${candidate}`);
      sessions.delete(candidate);
      await scopedSession.transport.close().catch(() => {});
    }
    if (keys.length === 0) log.info(`[mcp/runner] evictSession no-op for ${key} (not cached)`);
    return;
  }
  const session = sessions.get(key);
  if (session) {
    log.info(`[mcp/runner] evicting cached session for ${key}`);
    sessions.delete(key);
    await session.transport.close().catch(() => {});
  } else {
    log.info(`[mcp/runner] evictSession no-op for ${key} (not cached)`);
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
