/**
 * Connectors for Spaces artifact apps.
 *
 * An app running in the dashboard can only reach Spaces (`/api/sdk/*`); the
 * Spaces backend relays here over INTERNAL_S2S_KEY with the viewer's user id.
 * We resolve the VIEWER's own connection, run the MCP tool server-side, and
 * hand back text. The credential never leaves this process — that is the whole
 * point versus shipping a secret inside the app bundle.
 *
 * v1 is deliberately narrow:
 *  - Read-only. A tool in the definition's writeTools is refused (403), even
 *    though callTool itself would run it — the /mcp/call path forces "ask" for
 *    those (routes/mcp.ts) and there is no approval card for an app to show.
 *  - As the viewer, never as an agent. loadEffectiveCredentials is called with
 *    NO agent slug, so only the user's UserMcpConnection or the org's
 *    GlobalMcpCredentials (allowGlobalFallback) can answer — never creds an
 *    agent owner pinned for their agent.
 *  - Platform-internal servers are invisible (404), see PLATFORM_INTERNAL_TYPES.
 *
 * Every failure is `{ success:false, code, error }` so Spaces can map `code`
 * onto its SDK error envelope without parsing prose.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler, ok, HttpError } from "../lib/http.js";
import { errMsg } from "../lib/errors.js";
import { availabilityForServerIds } from "../lib/connector-availability.js";
import { isUsableByUser } from "../lib/connector-visibility.js";
import { loadEffectiveCredentials, type EffectiveCredentials } from "../lib/credentials-loader.js";
import { resolveConnectorDefinition } from "../mcp/connector-definitions.js";
import { callTool, listToolsForUser } from "../mcp/runner.js";
import { getOAuthProvider, isOAuthConnector } from "./oauth-token.js";
import { createLogger } from "../logger.js";

const log = createLogger("app-connectors-internal");

/**
 * Claw's own plumbing, not services a user connected. Each one short-circuits
 * in lib/credentials-loader.ts to a credential the user never handed over:
 *  - xyne-spaces / xyne-dashboard / xyne-workflows: the viewer's LIVE Spaces
 *    session — exposing them would give an app a second, ungated route into
 *    Spaces that bypasses the /api/sdk gateway;
 *  - xyne-spaces-app-tools: an agent's bot app token;
 *  - heisenberg / research-agent-mcp: claw-auth's own environment keys.
 */
const PLATFORM_INTERNAL_TYPES = new Set<string>([
  "xyne-spaces",
  "xyne-dashboard",
  "xyne-workflows",
  "xyne-spaces-app-tools",
  "heisenberg",
  "research-agent-mcp",
]);

const serverType = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const userId = z.string().min(1).max(200);

const listBody = z.object({ userId }).strict();
const toolsBody = z.object({ userId, serverType }).strict();
const callBody = z
  .object({
    userId,
    serverType,
    tool: z.string().min(1).max(200),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
const connectBody = z
  .object({
    userId,
    serverType,
    returnTo: z.string().max(2048).optional(),
  })
  .strict();

type ConnectorRow = {
  id: string;
  type: string;
  name: string;
  description: string | null;
  enabled: boolean;
  connectorMeta: unknown;
  isOauth: boolean;
};

const connectorSelect = {
  id: true,
  type: true,
  name: true,
  description: true,
  enabled: true,
  connectorMeta: true,
  isOauth: true,
} as const;

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    throw new HttpError(400, `${where}${issue?.message ?? "invalid body"}`, "validation_failed");
  }
  return parsed.data;
}

/** Not found, not visible, disabled and internal all read the same — 404. */
function connectorNotFound(type: string): HttpError {
  return new HttpError(404, `Connector "${type}" not found`, "not_found");
}

function authKind(row: ConnectorRow): "oauth" | "credentials" {
  return isOAuthConnector(row.type, row.connectorMeta, row.isOauth) ? "oauth" : "credentials";
}

/** The connector row, iff this user may use it through an app. */
async function loadVisibleConnector(type: string, uid: string): Promise<ConnectorRow> {
  if (PLATFORM_INTERNAL_TYPES.has(type)) throw connectorNotFound(type);
  const row = await prisma.mcpServer.findUnique({ where: { type }, select: connectorSelect });
  if (!row || !isUsableByUser(row, uid)) throw connectorNotFound(type);
  return row;
}

/**
 * Everything /tools and /call need before touching the MCP server: a visible
 * connector, a runnable definition, and the viewer's own credential.
 */
async function resolveForCall(type: string, uid: string) {
  const row = await loadVisibleConnector(type, uid);
  const definition = await resolveConnectorDefinition(type);
  if (!definition) throw connectorNotFound(type);
  // No agent slug on purpose — see the file header.
  const effective: EffectiveCredentials | null = await loadEffectiveCredentials(uid, type);
  if (!effective) {
    throw new HttpError(409, `No usable ${row.name} connection for this user`, "not_connected");
  }
  return { row, definition, credentials: effective.credentials };
}

export const appConnectorsInternalRouter = Router();

// POST /list { userId } → { connectors: Connector[] }
appConnectorsInternalRouter.post("/list", asyncHandler(async (req: Request, res: Response) => {
  const { userId: uid } = parse(listBody, req.body);

  const rows = await prisma.mcpServer.findMany({ select: connectorSelect, orderBy: { name: "asc" } });
  const visible = rows.filter((r) => !PLATFORM_INTERNAL_TYPES.has(r.type) && isUsableByUser(r, uid));
  // Same personal/org split GET /users/:userId/connections/availability serves.
  const availability = await availabilityForServerIds(uid, visible.map((r) => r.id));

  const connectors = visible.map((r) => {
    const personal = availability.personal.has(r.id);
    const org = availability.org.has(r.id);
    return {
      type: r.type,
      name: r.name,
      description: r.description ?? null,
      auth: authKind(r),
      connected: personal || org,
      // Personal wins: it is what loadEffectiveCredentials would pick.
      source: personal ? "personal" : org ? "org" : null,
    };
  });

  ok(res, { connectors });
}));

// POST /tools { userId, serverType } → { tools: ConnectorTool[] }
appConnectorsInternalRouter.post("/tools", asyncHandler(async (req: Request, res: Response) => {
  const body = parse(toolsBody, req.body);
  const { row, credentials } = await resolveForCall(body.serverType, body.userId);

  let listed;
  try {
    listed = await listToolsForUser(body.userId, body.serverType, row.name, credentials);
  } catch (err) {
    log.error(`[app-connectors] list tools failed type=${body.serverType} user=${body.userId}: ${errMsg(err)}`);
    throw new HttpError(502, `${row.name} did not respond`, "upstream_failed");
  }

  ok(res, {
    tools: listed.tools.map((t) => ({
      name: t.name,
      description: t.description || null,
      inputSchema: t.inputSchema ?? {},
      write: listed.writeTools.includes(t.name),
    })),
  });
}));

// POST /call { userId, serverType, tool, params? } → { content }
appConnectorsInternalRouter.post("/call", asyncHandler(async (req: Request, res: Response) => {
  const body = parse(callBody, req.body);
  const { row, definition, credentials } = await resolveForCall(body.serverType, body.userId);

  // Mirrors the write-tool check in routes/mcp.ts (/mcp/call); callTool does
  // not enforce it, and an app has no approval card to route the write to.
  if (definition.writeTools.includes(body.tool)) {
    throw new HttpError(403, `"${body.tool}" is a write tool; apps can only call read tools`, "write_tool");
  }

  try {
    // Only a tool the server actually advertises may be invoked, so an app
    // cannot probe for unlisted/hidden names.
    const listed = await listToolsForUser(body.userId, body.serverType, row.name, credentials);
    if (!listed.tools.some((t) => t.name === body.tool)) {
      throw new HttpError(400, `${row.name} has no tool "${body.tool}"`, "validation_failed");
    }

    const result = await callTool(body.userId, body.serverType, credentials, body.tool, body.params ?? {});
    log.info(`[app-connectors] called type=${body.serverType} tool=${body.tool} user=${body.userId}`);
    ok(res, { content: result.content });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    // The raw error can carry connector internals; keep it in the log only
    // (same stance as lib/approved-write.ts).
    log.error(`[app-connectors] call failed type=${body.serverType} tool=${body.tool} user=${body.userId}: ${errMsg(err)}`);
    throw new HttpError(502, `${body.tool} failed to run`, "upstream_failed");
  }
}));

// POST /connect { userId, serverType, returnTo? } → ConnectResult
appConnectorsInternalRouter.post("/connect", asyncHandler(async (req: Request, res: Response) => {
  const body = parse(connectBody, req.body);
  const row = await loadVisibleConnector(body.serverType, body.userId);

  // Same function the connector's POST /users/:userId/oauth/<type>/authorize
  // route runs, returnTo validation included (lib/oauth-return.ts).
  const authorize = authKind(row) === "oauth" ? getOAuthProvider(row.type)?.authorize : undefined;
  if (authorize) {
    let authUrl: string;
    try {
      authUrl = await authorize(body.userId, { returnTo: body.returnTo });
    } catch (err) {
      log.error(`[app-connectors] authorize failed type=${row.type} user=${body.userId}: ${errMsg(err)}`);
      throw new HttpError(502, `Could not start the ${row.name} sign-in`, "upstream_failed");
    }
    ok(res, { kind: "oauth", authUrl });
    return;
  }

  // Credential-form connectors (and admin-declared OAuth ones with no provider
  // registered here) are set up on the connector's settings page. That page is
  // the Spaces dashboard's, whose workspace-scoped URL only Spaces can build,
  // so the caller fills it in. Apps never collect secrets themselves.
  ok(res, { kind: "manual", settingsUrl: null });
}));
