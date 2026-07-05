import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { prisma } from "../db.js";
import { decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { listToolsForUser, callTool } from "../mcp/runner.js";
import { agentRunRepository } from "../repositories/index.js";
import type { McpToolInfo, McpServerTools } from "../mcp/types.js";
import { hasConnectorDefinition, resolveConnectorDefinition } from "../mcp/connector-definitions.js";
import { BITBUCKET_CUSTOM_TOOLS, handleUploadPrScreenshot, handleGetPrComments } from "../mcp/adapters/bitbucket.js";
import { GRAFANA_CUSTOM_TOOLS, handleGrafanaQueryLogs, handleGrafanaListMetrics, handleGrafanaQueryMetrics, handleGrafanaQueryDatabase, buildUpstreamGrafanaCitation } from "../mcp/adapters/grafana.js";
import type { Citation } from "xyne-claw-shared";
import { SLACK_CUSTOM_TOOLS, handleSlackFindChannel } from "../mcp/adapters/slack.js";
import { WEBFETCH_SERVER_TYPE, WEBFETCH_SERVER_NAME, WEBFETCH_CUSTOM_TOOLS, handleWebfetch } from "../mcp/adapters/webfetch.js";
import { AGENT_INTROSPECT_TOOLS, AGENT_INTROSPECT_TOOL_NAMES, handleAgentIntrospect } from "../mcp/adapters/agent-introspect.js";
import { callBitbucketThrottled } from "../mcp/bitbucket-throttle.js";
import { loadEffectiveCredentials, isPrivateUserCredential, type EffectiveCredentials } from "../lib/credentials-loader.js";
import { requireSessionToken } from "../middleware/require-session-token.js";
import { requireStrictS2S } from "../middleware/require-auth.js";
import { validateWriteAction } from "../mcp/validators.js";
import { loadForSession as loadAttachedContextForSession, injectDefaults as injectAttachedContextDefaults } from "../mcp/attached-context-injector.js";
import { KB_TOOLS, KB_TOOL_NAMES, type KbToolName } from "../mcp/kb-tools.js";
import {
  handleKbListResources,
  handleKbSearch,
  handleKbListFiles,
  handleKbReadFile,
  handleKbGetChunks,
  handleKbSearchWithinDoc,
  type KbHandlerResult,
} from "../mcp/kb-handlers.js";
import { createLogger } from "../logger.js";
import { executeTool as executeGatewayTool } from "../mcpgateway/services/execution.js";
import {
  GATEWAY_KEY_PREFIX,
  gatewayCatalogSource,
  gatewayToolSelectionKey,
  parseGatewayCatalogSource,
  parseGatewayToolSelectionKey,
} from "../mcpgateway/key-format.js";
import { parseToolsConfig } from "xyne-claw-shared";

const log = createLogger("mcp");

const DEFAULT_GATEWAY_TENANT = process.env.ALLOWED_TENANTS
  ?.split(",")
  .map((tenant) => tenant.trim())
  .find((tenant) => tenant.length > 0);

function resolveGatewayTenantForRequest(): string | null {
  // Do not trust caller-provided tenant headers for gateway selection.
  // Gateway tenant context is deployment-scoped for this backend instance.
  return DEFAULT_GATEWAY_TENANT ?? null;
}

type GatewayToolDescriptor = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  method?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseGatewayServerType(serverType: string): { serviceName: string; backendId?: string } | null {
  const parsed = parseGatewayCatalogSource(serverType);
  if (parsed) return { serviceName: parsed.serviceName, backendId: parsed.backendId };

  if (!serverType.startsWith(GATEWAY_KEY_PREFIX)) return null;
  const raw = serverType.slice(GATEWAY_KEY_PREFIX.length).trim();
  if (!raw) return null;
  const parts = raw.split(":");
  if (parts.length !== 1) return null;
  const [serviceName] = parts;
  if (!serviceName) return null;
  return { serviceName };
}

function humaniseGatewayService(serviceName: string): string {
  return serviceName
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function gatewayDisplayName(serviceName: string, backendId: string): string {
  return `${humaniseGatewayService(serviceName)} (${backendId})`;
}

function parseGatewayTools(rawTools: unknown): GatewayToolDescriptor[] {
  if (!Array.isArray(rawTools)) return [];
  const parsed: GatewayToolDescriptor[] = [];
  for (const entry of rawTools) {
    if (!isRecord(entry) || typeof entry.name !== "string") continue;
    parsed.push({
      name: entry.name,
      description: typeof entry.description === "string" ? entry.description : "",
      inputSchema: isRecord(entry.inputSchema) ? entry.inputSchema : {},
      ...(typeof entry.method === "string" ? { method: entry.method.toUpperCase() } : {}),
    });
  }
  return parsed;
}

function isGatewayWriteMethod(method: string | undefined): boolean {
  if (!method) return false;
  return method.toUpperCase() !== "GET";
}

function formatGatewayExecutionError(
  execution: { error?: string; errorDetail?: unknown },
  serviceName: string,
  toolName: string,
): string {
  const detail = execution.errorDetail;
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const record = detail as Record<string, unknown>;
    const responseMessage = typeof record.responseMessage === "string" ? record.responseMessage.trim() : "";
    if (responseMessage.length > 0) return responseMessage;

    const message = typeof record.message === "string" ? record.message.trim() : "";
    if (message.length > 0) return message;

    const error = typeof record.error === "string" ? record.error.trim() : "";
    if (error.length > 0) return error;
  }

  const directError = typeof execution.error === "string" ? execution.error.trim() : "";
  if (directError.length > 0) return directError;

  return `Gateway execution failed for ${serviceName}/${toolName}`;
}

async function findGatewayToolDescriptor(
  tenantUniqueId: string,
  serviceName: string,
  toolName: string,
  backendId?: string,
): Promise<GatewayToolDescriptor | null> {
  const rows = await prisma.serviceRegistry.findMany({
    where: {
      tenantUniqueId,
      serviceName,
      ...(backendId ? { backendId } : {}),
    },
    select: { tools: true },
  });

  for (const row of rows) {
    const found = parseGatewayTools(row.tools).find((tool) => tool.name === toolName);
    if (found) return found;
  }
  return null;
}

function isGatewayToolEnabledInConfig(
  config: ReturnType<typeof parseToolsConfig>,
  serviceName: string,
  toolName: string,
  backendId?: string,
): boolean {
  const enabledServices = new Set(
    (config?.gateway ?? []).filter((name): name is string => typeof name === "string" && name.length > 0),
  );
  if (enabledServices.has(serviceName)) return true;
  if (!backendId) return false;
  return (config?.direct ?? []).includes(gatewayToolSelectionKey(serviceName, backendId, toolName));
}

async function isToolAllowedForSessionAgent(
  agentSlug: string | undefined,
  userId: string,
  serverType: string,
  toolName: string,
): Promise<boolean> {
  if (!agentSlug) {
    return true;
  }

  const gatewayTarget = parseGatewayServerType(serverType);
  if (gatewayTarget) {
    const agent = await prisma.agent.findUnique({
      where: { slug: agentSlug },
      select: { config: true },
    });
    const config = parseToolsConfig((agent?.config as Record<string, unknown> | null | undefined) ?? undefined);
    return isGatewayToolEnabledInConfig(config, gatewayTarget.serviceName, toolName, gatewayTarget.backendId);
  }

  const agentConn = await prisma.agentMcpConnection.findFirst({
    where: {
      agent: { slug: agentSlug },
      mcpServer: { type: serverType },
    },
    select: { id: true },
  });
  if (agentConn) {
    return true;
  }

  const effective = await loadEffectiveCredentialsWithSpacesFallback(userId, serverType, agentSlug);
  return effective !== null;
}

function signAction(action: Record<string, unknown>): string {
  return crypto.createHmac("sha256", CONFIG.encryptionKey).update(JSON.stringify(action)).digest("hex");
}

/**
 * Grafana-family connector? The custom Grafana tools (esp. grafana-query-database,
 * the only one that executes SQL against a ClickHouse/Postgres/etc. datasource
 * via /api/ds/query) historically attached ONLY to type "grafana". But a deploy
 * can register additional Grafana instances under their own type (e.g.
 * "grafana-hyperswitch-india"), which then got the base mcp-grafana toolkit
 * (dashboards/Loki/Prometheus) but NOT the SQL-query tool — so ClickHouse queries
 * silently failed for those agents. Treat every grafana-prefixed type as a
 * Grafana instance; each runs the custom tools against its OWN credentials
 * (resolved per-serverType in the call handler).
 */
function isGrafanaFamilyType(serverType: string): boolean {
  return serverType === "grafana" || serverType.startsWith("grafana-");
}

/** A connector candidate in the tool-resolution list (user/global/agent). */
type ListEntry = { type: "agent" | "user" | "global"; serverType: string; serverName: string };

/**
 * Custom HTTP tools that augment (or stand in for) an upstream MCP server's
 * toolset. Each is appended to the matching server's listed tools so the agent
 * can see them; the actual execution is intercepted locally in /mcp/call.
 *
 * `createIfMissing`: when the connector is in the resolution list but absent
 * from `data` (its MCP-list spawn failed), synthesize a bare server entry so
 * the custom tools still surface — they hit their API directly and don't need
 * the upstream MCP server. Grafana and Slack rely on this (the Slack resolver
 * and Grafana's SQL/HTTP tools work even when the uvx/token spawn fails).
 */
const CUSTOM_TOOL_INJECTIONS: ReadonlyArray<{
  match: (serverType: string) => boolean;
  tools: McpToolInfo[];
  createIfMissing: boolean;
}> = [
  { match: (t) => t === "bitbucket", tools: BITBUCKET_CUSTOM_TOOLS, createIfMissing: false },
  { match: (t) => t === "slack", tools: SLACK_CUSTOM_TOOLS, createIfMissing: true },
  { match: isGrafanaFamilyType, tools: GRAFANA_CUSTOM_TOOLS, createIfMissing: true },
];

/**
 * Append each injection's custom tools to every matching server in `data`,
 * deduping by tool name. Servers matched from the resolution list (`entries`)
 * but missing from `data` are synthesized when the injection opts in via
 * createIfMissing. Mutates `data` in place.
 */
function injectCustomTools(data: McpServerTools[], entries: ListEntry[]): void {
  for (const inj of CUSTOM_TOOL_INJECTIONS) {
    const matchedTypes = new Set<string>();
    for (const e of entries) if (inj.match(e.serverType)) matchedTypes.add(e.serverType);
    for (const s of data) if (inj.match(s.serverType)) matchedTypes.add(s.serverType);

    for (const serverType of matchedTypes) {
      let server = data.find((s) => s.serverType === serverType);
      if (!server) {
        if (!inj.createIfMissing) continue;
        const entry = entries.find((e) => e.serverType === serverType);
        server = { serverType, serverName: entry?.serverName ?? serverType, tools: [], writeTools: [] };
        data.push(server);
      }
      const have = new Set(server.tools.map((t) => t.name));
      for (const t of inj.tools) {
        if (!have.has(t.name)) server.tools.push(t);
      }
    }
  }
}

/**
 * Fallback credentials for xyne-spaces when no userMcpConnection exists.
 * Looks up the agent by spacesAppUserId and uses its app token.
 */
async function getAppTokenCredentials(userId: string): Promise<Record<string, unknown> | null> {
  const agent = await prisma.agent.findFirst({
    where: { spacesAppUserId: userId },
    select: { spacesAppToken: true },
  });
  if (!agent?.spacesAppToken) return null;
  const [ciphertext, iv, authTag] = agent.spacesAppToken.split(":");
  if (!ciphertext || !iv || !authTag) return null;
  const appToken = decrypt(ciphertext, iv, authTag, CONFIG.encryptionKey);
  return { url: CONFIG.spacesBackendUrl, token: appToken };
}

/**
 * Wrapper around loadEffectiveCredentials that adds the xyne-spaces app-token
 * fallback. Keeps the same return shape so callers can swap it in seamlessly.
 */
async function loadEffectiveCredentialsWithSpacesFallback(
  userId: string,
  serverType: string,
  agentSlug?: string,
): Promise<EffectiveCredentials | null> {
  const effective = await loadEffectiveCredentials(userId, serverType, agentSlug);
  if (effective) return effective;

  if (serverType === "xyne-spaces") {
    const appCreds = await getAppTokenCredentials(userId);
    if (appCreds) {
      // App-token creds are the agent's Spaces app token. Mark as user-sourced
      // for type compatibility; xyne-spaces is ambient, so isPrivateUserCredential
      // still returns false and the run won't be hidden from other admins.
      return {
        credentials: appCreds,
        source: "user",
        connectionId: `app-token:xyne-spaces:${userId}`,
        isUserOwned: true,
      };
    }
  }

  return null;
}

export function verifyActionSignature(action: Record<string, unknown>, signature: string): boolean {
  const expected = signAction(action);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

const router = Router();

router.use("/:sessionId", requireStrictS2S, requireSessionToken);

router.get("/:sessionId/mcp/tools", async (req: Request<{ sessionId: string }>, res: Response) => {
  try {
    const userId = req.session!.userId;
    const agentSlug = req.session?.agentSlug;
    const tenantUniqueId = resolveGatewayTenantForRequest();
    
    console.log(`[mcp/tools] userId=${userId} agentSlug=${agentSlug ?? "(none)"} tenant=${tenantUniqueId}`);

    // User connections + global-fallback servers (servers with allowGlobalFallback
    // = true AND a global cred row, where this user has NO personal connection).
    // Resolve as the union: the user gets to call tools for any server they
    // have credentials for, whether their own or admin-shared.
    const userConnections = await prisma.userMcpConnection.findMany({
      where: { userId },
      include: { mcpServer: true },
    });
    const userServerIds = new Set(userConnections.map((c) => c.mcpServerId));

    const globalServers = await prisma.mcpServer.findMany({
      where: {
        allowGlobalFallback: true,
        globalCredentials: { isNot: null },
        id: { notIn: Array.from(userServerIds) },
      },
      include: { globalCredentials: true },
    });

    const entries: ListEntry[] = [
      ...userConnections.map((c) => ({ type: "user" as const, serverType: c.mcpServer.type, serverName: c.mcpServer.name })),
      ...globalServers.map((s) => ({ type: "global" as const, serverType: s.type, serverName: s.name })),
    ];

    // Add MCPs the agent has pinned (only when this session is running an
    // agent). Agent-pinned servers get added with type=agent and prepended
    // to the resolution list so the resolver picks them first. If the user
    // also has a connection for the same type, we still add the agent
    // entry but the dedupe below keeps the agent one (it's pre-pended
    // before user/global of the same type).
    if (agentSlug) {
      const agentConns = await prisma.agentMcpConnection.findMany({
        where: { agent: { slug: agentSlug } },
        include: { mcpServer: true },
      });
      for (const c of agentConns) {
        const alreadyListed = entries.some((e) => e.serverType === c.mcpServer.type);
        if (!alreadyListed) {
          entries.unshift({ type: "agent", serverType: c.mcpServer.type, serverName: c.mcpServer.name });
        }
      }
    }

    // Virtual xyne-spaces entry: if SPACES_DB_URL is configured the user can
    // use Spaces tools without ever clicking "Connect" — loadEffectiveCredentials
    // synthesizes the creds from the live session row. Only add when there's
    // no existing user/global row for xyne-spaces (else we'd duplicate).
    const hasSpacesEntry = entries.some((e) => e.serverType === "xyne-spaces");
    if (!hasSpacesEntry && CONFIG.spacesDbUrl) {
      const spacesServer = await prisma.mcpServer.findUnique({ where: { type: "xyne-spaces" } });
      log.info(`[mcp/tools] spaces virtual-entry check: mcpServerRow=${!!spacesServer}`);
      if (spacesServer) {
        entries.push({ type: "user", serverType: "xyne-spaces", serverName: spacesServer.name });
        log.info(`[mcp/tools] added virtual xyne-spaces entry for userId=${userId}`);
      }
    }

    // Virtual xyne-spaces-app-tools entry: same pattern as xyne-spaces above.
    // The adapter declares credentialFields: [] (the app_token is auto-sourced
    // from the default agent's spacesAppToken, not user-supplied), so existing
    // users have no user_mcp_connections row for this server. Without this
    // virtual fallback they'd never see apps-send-message in the picker, and
    // the runtime listToolsForUser path would never spawn the MCP server.
    const hasAppToolsEntry = entries.some((e) => e.serverType === "xyne-spaces-app-tools");
    if (!hasAppToolsEntry) {
      const appToolsServer = await prisma.mcpServer.findUnique({ where: { type: "xyne-spaces-app-tools" } });
      if (appToolsServer) {
        entries.push({ type: "user", serverType: "xyne-spaces-app-tools", serverName: appToolsServer.name });
        log.info(`[mcp/tools] added virtual xyne-spaces-app-tools entry for userId=${userId}`);
      }
    }
    // Virtual research-agent-mcp entry: global stdio proxy configured by env.
    // No user connection row is needed; credentials-loader sources the API key
    // from RESEARCH_AGENT_MCP_API_KEY for every agent/user.
    const hasResearchAgentMcpEntry = entries.some((e) => e.serverType === "research-agent-mcp");
    if (!hasResearchAgentMcpEntry && CONFIG.researchAgentMcpApiKey) {
      const researchAgentMcpServer = await prisma.mcpServer.findUnique({ where: { type: "research-agent-mcp" } });
      if (researchAgentMcpServer) {
        entries.push({ type: "global", serverType: "research-agent-mcp", serverName: researchAgentMcpServer.name });
        log.info(`[mcp/tools] added virtual research-agent-mcp entry for userId=${userId}`);
      }
    }

    log.info(`[mcp/tools] final entries=${entries.map((e) => `${e.serverType}:${e.type}`).join(",")}`);

    // Fallback: if no xyne-spaces connection exists, try using the agent's app token
    const hasSpacesConnection = entries.some((e) => e.serverType === "xyne-spaces" && e.type !== "user");
    let appTokenToolsResult: Awaited<ReturnType<typeof listToolsForUser>> | null = null;
    if (!hasSpacesConnection) {
      const appCreds = await getAppTokenCredentials(userId);
      if (appCreds) {
        try {
          appTokenToolsResult = await listToolsForUser(userId, "xyne-spaces", "Xyne Spaces", appCreds);
        } catch (err) {
          log.error("[mcp/tools] App token fallback failed:", err);
        }
      }
    }

    const results = await Promise.allSettled(
      entries.map(async (entry) => {
        if (!(await hasConnectorDefinition(entry.serverType))) return null;
        const effective = await loadEffectiveCredentials(userId, entry.serverType, agentSlug);
        if (!effective) return null;
        return listToolsForUser(userId, entry.serverType, entry.serverName, effective.credentials, agentSlug);
      }),
    );

    const data = results
      .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof listToolsForUser>> | null> => r.status === "fulfilled")
      .map((r) => r.value)
      .filter((v): v is Awaited<ReturnType<typeof listToolsForUser>> => v !== null);

    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));

    if (errors.length > 0) {
      log.error("[mcp/tools] Some servers failed to list tools:", errors);
    }

    // Add app token fallback result if available
    if (appTokenToolsResult) {
      data.push(appTokenToolsResult);
    }

    // Add gateway tools selected in the agent config as extra MCP groups.
    // This is additive: legacy MCP loading remains unchanged.
    if (agentSlug && tenantUniqueId) {
      console.log(`[mcp/tools] Gateway check: agentSlug="${agentSlug}" tenantUniqueId="${tenantUniqueId}"`);
      const agent = await prisma.agent.findUnique({
        where: { slug: agentSlug },
        select: { config: true },
      });
      console.log(`[mcp/tools] Agent config loaded: ${agent ? 'found' : 'NOT FOUND'}`);
      const config = parseToolsConfig((agent?.config as Record<string, unknown> | null | undefined) ?? undefined);
      console.log(`[mcp/tools] Parsed config.gateway:`, config?.gateway ?? []);
      const selectedGatewayServices = (config?.gateway ?? []).filter((name): name is string => typeof name === "string" && name.length > 0);
      const selectedGatewayToolKeys = new Set(
        (config?.direct ?? []).filter((key): key is string =>
          typeof key === "string" && parseGatewayToolSelectionKey(key) !== null,
        ),
      );
      const selectedGatewayToolTargets = Array.from(selectedGatewayToolKeys)
        .map(parseGatewayToolSelectionKey)
        .filter((target): target is NonNullable<ReturnType<typeof parseGatewayToolSelectionKey>> => target !== null);
      const selectedGatewayServiceNames = new Set([
        ...selectedGatewayServices,
        ...selectedGatewayToolTargets.map((target) => target.serviceName),
      ]);
      console.log(`[mcp/tools] Selected gateway services: ${selectedGatewayServices.join(", ")}`);

      if (selectedGatewayServiceNames.size > 0) {
        const gatewayRows = await prisma.serviceRegistry.findMany({
          where: {
            tenantUniqueId,
            serviceName: { in: Array.from(selectedGatewayServiceNames) },
          },
          select: {
            serviceName: true,
            backendId: true,
            tools: true,
          },
          orderBy: [{ serviceName: "asc" }, { backendId: "asc" }],
        });
        console.log(`[mcp/tools] Found ${gatewayRows.length} gateway services`);

        for (const row of gatewayRows) {
          const serviceEnabled = selectedGatewayServices.includes(row.serviceName);
          const rowTools = parseGatewayTools(row.tools);
          const exposedTools = serviceEnabled
            ? rowTools
            : rowTools.filter((tool) =>
                selectedGatewayToolKeys.has(gatewayToolSelectionKey(row.serviceName, row.backendId, tool.name)),
              );
          if (exposedTools.length === 0) continue;

          const tools = exposedTools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            serviceName: row.serviceName,
            backendId: row.backendId,
            selectionKey: gatewayToolSelectionKey(row.serviceName, row.backendId, tool.name),
          }));
          const writeTools = exposedTools
            .filter((tool) => isGatewayWriteMethod(tool.method))
            .map((tool) => tool.name);
          
          console.log(`[mcp/tools] Adding gateway: ${row.serviceName}/${row.backendId} with ${tools.length} tools`);

          data.push({
            serverType: gatewayCatalogSource(row.serviceName, row.backendId),
            // Runtime tool names are derived from serverName in xyne-claw.
            // Keep the historical namespace stable (service/backendId) while
            // the toolbox catalog presents the friendly "Service (backendId)"
            // label to users.
            serverName: `${row.serviceName}/${row.backendId}`,
            displayName: gatewayDisplayName(row.serviceName, row.backendId),
            tools,
            writeTools,
          });
        }
      }
    } else {
      console.log(`[mcp/tools] Gateway check SKIPPED: agentSlug=${agentSlug} tenantUniqueId=${tenantUniqueId}`);
    }

    // Append custom HTTP tools (bitbucket/slack/grafana) to their servers — see
    // CUSTOM_TOOL_INJECTIONS. Slack/grafana surface even when the upstream MCP
    // list failed (createIfMissing); all dedupe by tool name.
    injectCustomTools(data, entries);

    // Append Knowledge Base tools as a DEDICATED `knowledge-base` server when
    // EITHER the agent has at least one AgentCollection grant (allowlist mode)
    // OR the agent is configured with kbScope="USER" (inherits caller's full
    // KB). Kept separate from `xyne-spaces` so the parent agent (not the
    // spaces subagent) can call them directly — see the parent-hoist branch
    // in xyne-claw/src/routes/run.ts. Without that separation the tools
    // would be folded into the spaces subagent's palette and only reachable
    // through delegation.
    if (agentSlug) {
      const agentRow = await prisma.agent.findUnique({
        where: { slug: agentSlug },
        select: { kbScope: true, _count: { select: { collections: true } } },
      });
      const isUserScoped = agentRow?.kbScope === "USER";
      const kbCount = agentRow?._count.collections ?? 0;
      if (isUserScoped || kbCount > 0) {
        data.push({
          serverType: "knowledge-base",
          serverName: "Knowledge Base",
          tools: [...KB_TOOLS],
          writeTools: [], // all four tools are read-only by design
        });
        log.info(
          `[mcp/tools] added knowledge-base server (agent=${agentSlug}, scope=${isUserScoped ? "USER" : "COLLECTIONS"}, grants=${kbCount}, tools=${KB_TOOLS.length})`,
        );
      }
    }

    // Built-in webfetch — a claw-auth-executed tool with no upstream connector
    // and no credentials. Surfaced for every agent so it can be selected under
    // "System Tools" (catalogued as source `custom:webfetch`); agents that did
    // NOT select it get it filtered out by the tools.custom gate in
    // xyne-claw/src/routes/run.ts. Execution is handled inline in /mcp/call.
    data.push({
      serverType: WEBFETCH_SERVER_TYPE,
      serverName: WEBFETCH_SERVER_NAME,
      // webfetch + read-only agent-config introspection tools. All System Tools
      // (custom:* slugs); agents opt in via tools.custom[]. Execution inline below.
      tools: [...WEBFETCH_CUSTOM_TOOLS, ...AGENT_INTROSPECT_TOOLS],
      writeTools: [],
    });

    res.json({ success: true, data });
  } catch (err) {
    log.error("[mcp/tools] error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/:sessionId/mcp/call", async (req: Request<{ sessionId: string }>, res: Response) => {
  const startedAt = Date.now();
  try {
    const userId = req.session!.userId;
    const agentSlug = req.session?.agentSlug;
    const { serverType, tool, params, permission, backendId } = req.body as {
      serverType?: string;
      tool?: string;
      params?: Record<string, unknown>;
      permission?: string;
      backendId?: string;
    };

    if (!serverType || typeof serverType !== "string") {
      res.status(400).json({ success: false, error: "serverType is required" });
      return;
    }

    if (!tool || typeof tool !== "string") {
      res.status(400).json({ success: false, error: "tool is required" });
      return;
    }

    // Knowledge Base is a virtual server — no connector definition / no
    // credentials. Tools are dispatched inline below using the agent's stored
    // KB grants + the user's spaces session. Short-circuit here BEFORE the
    // connector + credentials checks so they don't reject a valid call.
    //
    // SECURITY:
    // - ALL four kb-* tools are read-only by design (see KB_TOOLS, writeTools
    //   set to []). They intentionally bypass the write-action approval flow
    //   below — if a future change adds a mutating KB tool, it MUST be routed
    //   through validateWriteAction (above) instead of this branch.
    // - The handlers re-fetch the user's accessible KB tree from spaces on
    //   every call, so a revoked permission stops working immediately — the
    //   agent's stored allowlist is intersected with the live spaces access.
    // - agentSlug comes from the HMAC-signed session token (see
    //   require-session-token.ts); a caller can't spoof it to read another
    //   agent's KB scope. userId is similarly signed.
    if (serverType === "knowledge-base") {
      if (!(KB_TOOL_NAMES as readonly string[]).includes(tool)) {
        res.status(400).json({ success: false, error: `Unknown knowledge-base tool: ${tool}` });
        return;
      }
      if (!agentSlug) {
        res.status(400).json({ success: false, error: "agentSlug is required for KB tools" });
        return;
      }
      try {
        const p = (params ?? {}) as Record<string, unknown>;
        let out: KbHandlerResult;
        switch (tool as KbToolName) {
          case "kb-list-resources":
            out = await handleKbListResources({ userId, agentSlug });
            break;
          case "kb-search":
            out = await handleKbSearch({
              userId,
              agentSlug,
              query: String(p["query"] ?? ""),
              ...(typeof p["collectionId"] === "string" ? { collectionId: p["collectionId"] as string } : {}),
              ...(typeof p["limit"] === "number" ? { limit: p["limit"] as number } : {}),
              ...(typeof p["offset"] === "number" ? { offset: p["offset"] as number } : {}),
              ...(typeof p["createdBy"] === "string" ? { createdBy: p["createdBy"] as string } : {}),
              ...(typeof p["before"] === "string" ? { before: p["before"] as string } : {}),
              ...(typeof p["after"] === "string" ? { after: p["after"] as string } : {}),
              ...(typeof p["on"] === "string" ? { on: p["on"] as string } : {}),
              ...(typeof p["range"] === "string" ? { range: p["range"] as string } : {}),
            });
            break;
          case "kb-list-files":
            out = await handleKbListFiles({ userId, agentSlug, collectionId: String(p["collectionId"] ?? "") });
            break;
          case "kb-read-file":
            out = await handleKbReadFile({ userId, agentSlug, fileId: String(p["fileId"] ?? "") });
            break;
          case "kb-get-chunks":
            out = await handleKbGetChunks({
              userId,
              agentSlug,
              fileId: String(p["fileId"] ?? ""),
              startChunkIndex:
                typeof p["startChunkIndex"] === "number"
                  ? (p["startChunkIndex"] as number)
                  : Number(p["startChunkIndex"] ?? 0),
              ...(typeof p["limit"] === "number" ? { limit: p["limit"] as number } : {}),
            });
            break;
          case "kb-search-within-doc":
            out = await handleKbSearchWithinDoc({
              userId,
              agentSlug,
              fileId: String(p["fileId"] ?? ""),
              query: String(p["query"] ?? ""),
              ...(typeof p["limit"] === "number" ? { limit: p["limit"] as number } : {}),
            });
            break;
        }
        res.json({
          success: true,
          data: {
            content: out.content,
            ...(out.citations && out.citations.length > 0 ? { citations: out.citations } : {}),
            ...(out.isError ? { isError: true } : {}),
            ...(out.debug ? { debug: out.debug } : {}),
          },
        });
      } catch (err) {
        log.error(`[mcp/call] kb-tool error tool=${tool}:`, err);
        res.json({ success: true, data: { content: `KB tool failed: ${err instanceof Error ? err.message : String(err)}`, isError: true } });
      }
      return;
    }

    // Built-in webfetch — virtual server, no connector / no credentials. Like
    // the knowledge-base branch, short-circuit BEFORE the connector + credential
    // checks. The tool is read-only (fetch → markdown), so it does not go
    // through the write-action approval flow.
    if (serverType === WEBFETCH_SERVER_TYPE) {
      const isIntrospect = (AGENT_INTROSPECT_TOOL_NAMES as readonly string[]).includes(tool);
      if (tool !== "webfetch" && !isIntrospect) {
        res.status(400).json({ success: false, error: `Unknown built-in tool: ${tool}` });
        return;
      }
      try {
        const content = isIntrospect
          ? await handleAgentIntrospect(tool, params ?? {})
          : await handleWebfetch(params ?? {});
        res.json({ success: true, data: { content } });
      } catch (err) {
        log.error(`[mcp/call] built-in tool error (${tool}):`, err);
        res.json({ success: true, data: { content: `${tool} failed: ${err instanceof Error ? err.message : String(err)}`, isError: true } });
      }
      return;
    }

    // Gateway server handling (gateway:<serviceName>[:<backendId>]) — passes
    // calls through to the mcpgateway execution service. Validate agent has
    // enabled the service in its config and enforce write-tool approval.
    const gatewayTarget = parseGatewayServerType(serverType);
    if (gatewayTarget) {
      const tenantUniqueId = resolveGatewayTenantForRequest();
      if (!tenantUniqueId) {
        res.status(400).json({ success: false, error: "Gateway tenant is not configured" });
        return;
      }

      if (!agentSlug) {
        res.status(401).json({ success: false, error: "No agent session" });
        return;
      }

      const agent = await prisma.agent.findUnique({
        where: { slug: agentSlug },
        select: { config: true },
      });
      const config = parseToolsConfig((agent?.config as Record<string, unknown> | null | undefined) ?? {});

      if (backendId && gatewayTarget.backendId && backendId !== gatewayTarget.backendId) {
        res.status(400).json({ success: false, error: "backendId conflicts with serverType" });
        return;
      }

      const effectiveBackendId = gatewayTarget.backendId ?? backendId;
      if (!isGatewayToolEnabledInConfig(config, gatewayTarget.serviceName, tool, effectiveBackendId)) {
        res.status(403).json({ success: false, error: "Gateway tool not enabled for this agent" });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      if (!user) {
        res.status(404).json({ success: false, error: "User not found" });
        return;
      }

      const descriptor = await findGatewayToolDescriptor(tenantUniqueId, gatewayTarget.serviceName, tool, effectiveBackendId);
      if (!descriptor) {
        res.status(404).json({ success: false, error: `Gateway tool not found: ${gatewayTarget.serviceName}/${tool}` });
        return;
      }

      const isWriteTool = isGatewayWriteMethod(descriptor.method);
      const effectivePermission = isWriteTool ? "ask" : (permission ?? "allow");

      console.log(`[mcp/call] user=${userId} server=${serverType} tool=${tool} permission=${effectivePermission}${isWriteTool ? " (gateway write-tool, forced ask)" : ""}`);

      if (effectivePermission === "ask") {
        const action = { serverType, tool, params: params ?? {}, userId };
        const signature = signAction(action);
        res.json({ success: true, data: { content: `Action queued for approval: ${tool}`, pendingAction: { ...action, signature } } });
        return;
      }

      const execution = await executeGatewayTool(tenantUniqueId, user.email, {
        serviceName: gatewayTarget.serviceName,
        toolName: tool,
        arguments: params ?? {},
        ...(effectiveBackendId ? { backendId: effectiveBackendId } : {}),
      });

      if (!execution.success) {
        const errorMessage = formatGatewayExecutionError(execution, gatewayTarget.serviceName, tool);
        res.json({ success: true, data: { content: `Error: ${errorMessage}` } });
        return;
      }

      const content = typeof execution.result === "string"
        ? execution.result
        : JSON.stringify(execution.result ?? {});

      res.json({ success: true, data: { content } });
      return;
    }

    if (!(await hasConnectorDefinition(serverType))) {
      res.status(400).json({ success: false, error: `No adapter for server type: ${serverType}` });
      return;
    }

    const effective = await loadEffectiveCredentialsWithSpacesFallback(userId, serverType, agentSlug);
    if (!effective) {
      res.status(404).json({ success: false, error: `No connection found for user and server type: ${serverType}` });
      return;
    }
    const credentials = effective.credentials;
    // Record that this tool call used the user's PRIVATE credential (a
    // personally-connected connector: google, microsoft, bitbucket, …), so
    // the admin "All Runs" ACL hides this run from OTHER admins. Crucially
    // this EXCLUDES the ambient Spaces session (xyne-spaces also resolves to
    // source "user") — every spaces-agent run reads Spaces, so marking it
    // would hide nearly everything and defeat the feature. See
    // isPrivateUserCredential. Fire-and-forget — never block the tool call.
    if (isPrivateUserCredential(serverType, effective.source)) {
      agentRunRepository.markUsedUserToken(req.params.sessionId).catch((e) =>
        log.warn(`[mcp/call] markUsedUserToken failed for ${req.params.sessionId}: ${e instanceof Error ? e.message : String(e)}`),
      );
    }

    // Default-fill spaces-* tool args from the run's attached context — only
    // fills slots the LLM left empty. See mcp/attached-context-injector.ts.
    // Reads from Redis keyed by the URL sessionId (set in /run). If nothing was
    // attached, this is a no-op fast path.
    const attachedItems = await loadAttachedContextForSession(req.params.sessionId);
    const effectiveParams = injectAttachedContextDefaults(serverType, tool, params ?? {}, attachedItems);

    // Write tools always require approval — cannot be overridden by agent config
    const definition = await resolveConnectorDefinition(serverType);
    const isWriteTool = definition?.writeTools?.includes(tool) ?? false;
    const effectivePermission = isWriteTool ? "ask" : (permission ?? "allow");

    log.info(
      `[mcp/call] user=${userId} server=${serverType} tool=${tool} permission=${effectivePermission}${isWriteTool ? " (write-tool, forced ask)" : ""}`,
      { event: "mcp_call_start", userId, server: serverType, tool, permission: effectivePermission, isWriteTool },
    );

    if (effectivePermission === "ask") {
      const validationError = await validateWriteAction(serverType, tool, effectiveParams, { ...credentials, userId });
      if (validationError) {
        log.info(`[mcp/call] validator rejected ${serverType}/${tool}: ${validationError}`);
        res.json({ success: true, data: { content: `Cannot ${tool}: ${validationError}` } });
        return;
      }
      const action = { serverType, tool, params: effectiveParams, userId };
      const signature = signAction(action);
      res.json({ success: true, data: { content: `Action queued for approval: ${tool}`, pendingAction: { ...action, signature } } });
      return;
    }

    // Handle custom tools locally instead of forwarding to MCP server
    if (serverType === "bitbucket" && tool === "upload-pr-screenshot") {
      const content = await handleUploadPrScreenshot(credentials, params ?? {});
      res.json({ success: true, data: { content } });
      return;
    }
    if (serverType === "bitbucket" && tool === "get-pr-comments") {
      const content = await handleGetPrComments(credentials, params ?? {});
      res.json({ success: true, data: { content } });
      return;
    }

    // Slack: private-aware, paginated channel resolver (name → ID)
    if (serverType === "slack" && tool === "slack_find_channel") {
      const content = await handleSlackFindChannel(credentials, params ?? {});
      res.json({ success: true, data: { content } });
      return;
    }

    // Handle Grafana custom tools locally — for ANY grafana-family connector.
    // `credentials` were resolved above for this exact serverType, so the query
    // runs against the right Grafana instance (e.g. Hyperswitch India).
    if (isGrafanaFamilyType(serverType) && tool.startsWith("grafana-")) {
      try {
        let content: string = "";
        let citations: Citation[] | undefined;
        const p = params ?? {};
        // Normalize credential field names. The static "grafana" connector uses
        // {url, token}; other grafana-family connectors may name the base URL /
        // service-account token differently. The handlers read url/token, so map
        // common aliases here — keeps the static connector unchanged (url/token
        // resolve first) while letting e.g. grafana-hyperswitch-india work even
        // if it stored its creds under different field names.
        const gfCreds: Record<string, unknown> = {
          ...credentials,
          url: credentials["url"] ?? credentials["baseUrl"] ?? credentials["grafanaUrl"],
          token: credentials["token"] ?? credentials["apiKey"] ?? credentials["serviceAccountToken"] ?? credentials["serviceAccount"],
        };
        // query-* handlers return { content, citations }; list-metrics still
        // returns a bare string. Normalize both into { content, citations? }.
        const unwrap = (r: string | { content: string; citations?: Citation[] }): void => {
          if (typeof r === "string") {
            content = r;
          } else {
            content = r.content;
            citations = r.citations;
          }
        };
        switch (tool) {
          case "grafana-query-logs": unwrap(await handleGrafanaQueryLogs(gfCreds, p)); break;
          case "grafana-list-metrics": unwrap(await handleGrafanaListMetrics(gfCreds, p)); break;
          case "grafana-query-metrics": unwrap(await handleGrafanaQueryMetrics(gfCreds, p)); break;
          case "grafana-query-database": unwrap(await handleGrafanaQueryDatabase(gfCreds, p)); break;
          default: content = `Unknown grafana tool: ${tool}`;
        }
        res.json({ success: true, data: { content, ...(citations?.length ? { citations } : {}) } });
      } catch (err) {
        res.json({ success: true, data: { content: `Error: ${err instanceof Error ? err.message : String(err)}` } });
      }
      return;
    }

    // KB tools are short-circuited above (before connector + creds checks) —
    // see the `serverType === "knowledge-base"` branch near the top of this
    // handler. No second dispatch here.

    // Handle spaces-trigger-agent locally — call /run to start the target agent
    if (serverType === "xyne-spaces" && tool === "spaces-trigger-agent") {
      const p = effectiveParams;
      const targetAgent = p["targetAgent"] as string;
      const task = p["task"] as string;
      const convId = p["conversationId"] as string | undefined;
      const chanId = p["channelId"] as string | undefined;

      if (!targetAgent || !task) {
        res.status(400).json({ success: false, error: "targetAgent and task are required" });
        return;
      }

      try {
        const runUrl = `${CONFIG.internalUrl}/claw/api/v1/internal/run`;
        const runRes = await fetch(runUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
          },
          body: JSON.stringify({
            userId,
            task: `${task}\n\n## Session Metadata\n- channelId: ${chanId ?? "unknown"}\n- conversationId: ${convId ?? "unknown"}`,
            agentSlug: targetAgent,
            ...(chanId ? { channelId: chanId } : {}),
            // Don't pass conversationId — it causes session resume with prior agent context.
            // Session Metadata is injected into the task text instead.
            callbackUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/result`,
          }),
        });

        const runBody = (await runRes.json()) as { success: boolean; sessionId?: string; error?: string };

        if (!runBody.success) {
          res.json({ success: true, data: { content: `Failed to trigger ${targetAgent}: ${runBody.error ?? "unknown error"}` } });
          return;
        }

        // Store session context for the callback
        const { setSession } = await import("./webhook.js");
        const targetAgentRow = await prisma.agent.findUnique({ where: { slug: targetAgent } });
        if (targetAgentRow?.spacesAppToken && targetAgentRow.spacesAppId && chanId && convId) {
          const appToken = decrypt(
            ...targetAgentRow.spacesAppToken.split(":") as [string, string, string],
            CONFIG.encryptionKey,
          );
          await setSession(runBody.sessionId!, {
            mentionedUserId: targetAgentRow.spacesAppUserId ?? "",
            senderId: userId,
            senderName: "",
            channelId: chanId,
            channelName: chanId,
            conversationId: convId,
            task,
            agentSlug: targetAgent,
            responseMode: "conversation",
            appToken,
            spacesAppId: targetAgentRow.spacesAppId,
            spacesAppUserId: targetAgentRow.spacesAppUserId ?? "",
          });
        }

        log.info(`[mcp/trigger-agent] Triggered ${targetAgent} → session ${runBody.sessionId}`);
        res.json({ success: true, data: { content: `Triggered ${targetAgent}. Session: ${runBody.sessionId}` } });
      } catch (err) {
        log.error("[mcp/trigger-agent] error:", err);
        res.json({ success: true, data: { content: `Failed to trigger ${targetAgent}: ${err instanceof Error ? err.message : "unknown"}` } });
      }
      return;
    }

    // Bitbucket goes through a per-user throttle + 429 backoff + real-status
    // wrapper. The upstream MCP server reports rate-limits (429) as the
    // misleading "Permission denied", so a burst of PR/diff calls looks like an
    // access failure. The wrapper caps per-token concurrency to avoid tripping
    // the limit, and on error surfaces the true HTTP status (429 vs 403).
    const callStartedAt = Date.now();
    const upstreamResult = serverType === "bitbucket"
      ? await callBitbucketThrottled(userId, credentials, tool, effectiveParams, agentSlug)
      : await callTool(userId, serverType, credentials, tool, effectiveParams, agentSlug);
    let result = upstreamResult;

    // Upstream mcp-grafana query tools (query_elasticsearch, …) run through
    // callTool, not the local grafana-* switch, so they get no Explore link by
    // default. When this is a grafana-family connector and the tool is one we
    // know how to link, attach an `external` Explore citation to the result —
    // same shape the handleGrafanaQuery* handlers emit, so the same frontend
    // surface resolves it. `credentials` were normalized for the local switch
    // above; here we re-derive the base url the same way (url ?? baseUrl ??
    // grafanaUrl). No-op for tools we don't map (buildUpstreamGrafanaCitation
    // returns null) and for the local grafana-* tools (already linked, and they
    // never reach callTool — the switch above returns before this point).
    if (isGrafanaFamilyType(serverType) && !tool.startsWith("grafana-")) {
      const gfBaseUrl =
        (credentials["url"] as string | undefined) ??
        (credentials["baseUrl"] as string | undefined) ??
        (credentials["grafanaUrl"] as string | undefined);
      const citation = gfBaseUrl ? buildUpstreamGrafanaCitation(gfBaseUrl, tool, effectiveParams) : null;
      if (citation) result = { ...upstreamResult, citations: [...(upstreamResult.citations ?? []), citation] };
    }

    log.info(`[mcp/call] done user=${userId} server=${serverType} tool=${tool}`, {
      event: "mcp_call",
      userId,
      server: serverType,
      tool,
      permission: effectivePermission,
      status: "ok",
      durationMs: Date.now() - callStartedAt,
      resultBytes: result.content?.length,
    });

    res.json({ success: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // serverType/tool are block-scoped to the try above; re-read from the body
    // so the error is attributable to a server/tool in the structured log.
    const body = req.body as { serverType?: string; tool?: string };
    const httpStatus = Number(/status code (\d{3})/.exec(msg)?.[1]) || undefined;
    log.error(`[mcp/call] error: ${msg}`, {
      event: "mcp_call",
      userId: req.session?.userId,
      server: body.serverType,
      tool: body.tool,
      status: "error",
      durationMs: Date.now() - startedAt,
      httpStatus,
      errorMessage: msg,
    });
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Internal server error" });
  }
});

router.post("/:sessionId/actions/sign", async (req: Request<{ sessionId: string }>, res: Response) => {
  try {
    const userId = req.session!.userId;
    const agentSlug = req.session?.agentSlug;
    const { pendingAction } = req.body as {
      pendingAction?: {
        serverType?: string;
        tool?: string;
        params?: Record<string, unknown>;
        userId?: string;
        signature?: string;
      };
    };

    if (!pendingAction || typeof pendingAction !== "object") {
      res.status(400).json({ success: false, error: "pendingAction is required" });
      return;
    }

    const { serverType, tool, params, userId: pendingUserId, signature } = pendingAction;
    if (!serverType || !tool || !pendingUserId || !signature) {
      res.status(400).json({ success: false, error: "pendingAction must include serverType, tool, userId, signature" });
      return;
    }

    if (pendingUserId !== userId) {
      res.status(403).json({ success: false, error: "pendingAction user does not match session user" });
      return;
    }

    const actionParams = params ?? {};
    const action = { serverType, tool, params: actionParams, userId: pendingUserId };
    if (!verifyActionSignature(action, signature)) {
      res.status(400).json({ success: false, error: "Invalid pendingAction signature" });
      return;
    }

    const allowedForAgent = await isToolAllowedForSessionAgent(agentSlug, userId, serverType, tool);
    if (!allowedForAgent) {
      res.status(403).json({ success: false, error: "Action is not allowed for this session agent" });
      return;
    }

    // Revalidate gateway actions before issuing a signature.
    const gatewayTarget = parseGatewayServerType(serverType);
    if (gatewayTarget) {
      if (!agentSlug) {
        res.status(401).json({ success: false, error: "No agent session" });
        return;
      }

      const agent = await prisma.agent.findUnique({
        where: { slug: agentSlug },
        select: { config: true },
      });
      const config = parseToolsConfig((agent?.config as Record<string, unknown> | null | undefined) ?? {});
      if (!isGatewayToolEnabledInConfig(config, gatewayTarget.serviceName, tool, gatewayTarget.backendId)) {
        res.status(403).json({ success: false, error: "Gateway tool not enabled for this agent" });
        return;
      }

      const tenantUniqueId = resolveGatewayTenantForRequest();
      if (!tenantUniqueId) {
        res.status(400).json({ success: false, error: "Gateway tenant is not configured" });
        return;
      }

      const descriptor = await findGatewayToolDescriptor(
        tenantUniqueId,
        gatewayTarget.serviceName,
        tool,
        gatewayTarget.backendId,
      );
      if (!descriptor) {
        res.status(404).json({ success: false, error: `Gateway tool not found: ${gatewayTarget.serviceName}/${tool}` });
        return;
      }
      if (!isGatewayWriteMethod(descriptor.method)) {
        res.status(400).json({ success: false, error: "Only write actions can be signed" });
        return;
      }
    } else {
      // Revalidate non-gateway actions before issuing a signature.
      if (!(await hasConnectorDefinition(serverType))) {
        res.status(400).json({ success: false, error: `No adapter for server type: ${serverType}` });
        return;
      }

      const definition = await resolveConnectorDefinition(serverType);
      const isWriteTool = definition?.writeTools?.includes(tool) ?? false;
      if (!isWriteTool) {
        res.status(400).json({ success: false, error: "Only write actions can be signed" });
        return;
      }

      const effective = await loadEffectiveCredentialsWithSpacesFallback(userId, serverType, agentSlug);
      const credentials = effective?.credentials;
      if (!credentials) {
        res.status(404).json({ success: false, error: `No connection found for user and server type: ${serverType}` });
        return;
      }

      const validationError = await validateWriteAction(serverType, tool, actionParams, { ...credentials, userId });
      if (validationError) {
        res.status(400).json({ success: false, error: validationError });
        return;
      }
    }

    const signedAction = { serverType, tool, params: actionParams, userId };
    const signedSignature = signAction(signedAction);

    log.info(`[actions/sign] Signed write action: user=${userId} server=${serverType} tool=${tool}`);

    res.json({ success: true, data: { ...signedAction, signature: signedSignature } });
  } catch (err) {
    log.error("[actions/sign] error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export { router as mcpRouter };
