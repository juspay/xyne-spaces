import { Router, type Request, type Response } from "express";
import { AWAKENING_SEND_TOOL } from "../awakening/send-tool.js";
import { errMsg } from "../lib/errors.js";
import crypto from "node:crypto";
import { prisma } from "../db.js";
import { decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { listToolsForUser, callTool } from "../mcp/runner.js";
import { agentRunRepository } from "../repositories/index.js";
import type { McpToolInfo, McpServerTools } from "../mcp/types.js";
import { hasConnectorDefinition, resolveConnectorDefinition } from "../mcp/connector-definitions.js";
import { BITBUCKET_CUSTOM_TOOLS, handleUploadPrScreenshot, handleGetPrComments, handleGetPrTemplate, handleListPullRequests, buildUpstreamBitbucketCitation } from "../mcp/adapters/bitbucket.js";
import { GITHUB_CUSTOM_TOOLS, handleUploadPrAttachment } from "../mcp/adapters/github.js";
import { GRAFANA_CUSTOM_TOOLS, handleGrafanaQueryLogs, handleGrafanaListMetrics, handleGrafanaQueryMetrics, handleGrafanaQueryDatabase, buildUpstreamGrafanaCitation, prefixChunk } from "../mcp/adapters/grafana.js";
import { SDLC_TOOL_NAMES, type Citation } from "xyne-claw-shared";
import { SLACK_CUSTOM_TOOLS, handleSlackFindChannel } from "../mcp/adapters/slack.js";
import { POSTMAN_CUSTOM_TOOLS, handleRunMonitor } from "../mcp/adapters/postman.js";
import {
  WEBFETCH_SERVER_TYPE,
  WEBFETCH_SERVER_NAME,
  WEBFETCH_CUSTOM_TOOLS,
  handleWebfetch,
} from "../mcp/adapters/webfetch.js";
import {
  AGENT_INTROSPECT_TOOLS,
  AGENT_INTROSPECT_TOOL_NAMES,
  handleAgentIntrospect,
} from "../mcp/adapters/agent-introspect.js";
import { ORCHESTRATOR_TOOLS, ORCHESTRATOR_TOOL_NAMES } from "../mcp/adapters/orchestrator.js";
import { callBitbucketThrottled } from "../mcp/bitbucket-throttle.js";
import {
  loadEffectiveCredentials,
  isPrivateUserCredential,
  type EffectiveCredentials,
} from "../lib/credentials-loader.js";
import { getWorkspaceIdForUser } from "../lib/spaces-db.js";
import { requireSessionToken } from "../middleware/require-session-token.js";
import { requireStrictS2S } from "../middleware/require-auth.js";
import { validateWriteAction } from "../mcp/validators.js";
import {
  loadForSession as loadAttachedContextForSession,
  injectDefaults as injectAttachedContextDefaults,
} from "../mcp/attached-context-injector.js";
import { loadRunScalars } from "../mcp/run-scalars.js";
import { injectSdlcBaselineRunContext } from "../mcp/sdlc-baseline-run-context.js";
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
import { requiresGatewayToolApproval } from "../mcpgateway/tool-approval.js";
import { buildAgentCallProposalFlow, parseToolsConfig, type AgentToolsConfig } from "xyne-claw-shared";
import { visibleAgentWhereForRunningUser } from "../lib/callable-agent-resolver.js";
import { isClawAdmin } from "../middleware/agent-acl.js";
import {
  buildSubagentToolRefs,
  filterMcpServerToolsForAgentConfig,
  isMcpToolAllowedByAgentConfig,
  shouldBypassMcpToolAgentFilter,
  subagentReferencingTool,
  type SubagentToolRefs,
} from "./mcp-agent-tools.js";

const log = createLogger("mcp");

const DEFAULT_GATEWAY_TENANT = process.env.ALLOWED_TENANTS?.split(",")
  .map((tenant) => tenant.trim())
  .find((tenant) => tenant.length > 0);
const loggedGlobalServerExclusions = new Set<string>();

// Tools implemented locally by xyne-spaces-app-tools-server.ts (not part of the
// shared Spaces registry it also mounts). On non-automation runs the app-tools
// listing is reduced to exactly these — see the filter in GET /mcp/tools.
// `spaces-send-message` is the legacy alias the server still dispatches.
const APP_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set([
  "ping",
  "apps-send-message",
  "spaces-send-message",
]);

function isStrictAgentToolsEnabled(): boolean {
  return (process.env.MCP_STRICT_AGENT_TOOLS ?? "on").toLowerCase() !== "off";
}

function resolveGatewayTenantForRequest(): string | null {
  // Do not trust caller-provided tenant headers for gateway selection.
  // Gateway tenant context is deployment-scoped for this backend instance.
  return DEFAULT_GATEWAY_TENANT ?? null;
}

async function resolveSessionAgentOrgId(userId: string, spacesAppId?: string): Promise<string | undefined> {
  if (spacesAppId) {
    const agent = await prisma.agent.findUnique({ where: { spacesAppId }, select: { orgId: true } });
    return agent?.orgId;
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { orgId: true } });
  return user?.orgId;
}

function decryptStoredToken(stored: string): string {
  const [ciphertext, iv, authTag] = stored.split(":");
  if (!ciphertext || !iv || !authTag) throw new Error("Invalid encrypted token format");
  return decrypt(ciphertext, iv, authTag, CONFIG.encryptionKey);
}

type GatewayToolDescriptor = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  method?: string;
  requiresApproval?: boolean;
  isWriteTool?: boolean;
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
      ...(typeof entry.requiresApproval === "boolean" ? { requiresApproval: entry.requiresApproval } : {}),
      ...(typeof entry.isWriteTool === "boolean" ? { isWriteTool: entry.isWriteTool } : {}),
    });
  }
  return parsed;
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

type GatewayConfigEntry = { serviceName: string; backendId?: string };

function parseGatewayConfigEntry(entry: unknown): GatewayConfigEntry | null {
  if (typeof entry !== "string") return null;
  const trimmed = entry.trim();
  if (!trimmed) return null;

  const parsed = parseGatewayCatalogSource(trimmed);
  if (parsed) return { serviceName: parsed.serviceName, backendId: parsed.backendId };

  if (trimmed.startsWith(GATEWAY_KEY_PREFIX)) return null;
  return { serviceName: trimmed };
}

function getEnabledGatewayConfigEntries(config: ReturnType<typeof parseToolsConfig>): GatewayConfigEntry[] {
  return (config?.gateway ?? [])
    .map(parseGatewayConfigEntry)
    .filter((entry): entry is GatewayConfigEntry => entry !== null);
}

function gatewayEntryMatchesBackend(
  entry: GatewayConfigEntry,
  serviceName: string,
  backendId?: string,
): boolean {
  if (entry.serviceName !== serviceName) return false;
  if (!entry.backendId) return true;
  return backendId === entry.backendId;
}

function isGatewayToolEnabledInConfig(
  config: ReturnType<typeof parseToolsConfig>,
  serviceName: string,
  toolName: string,
  backendId?: string,
): boolean {
  if (
    getEnabledGatewayConfigEntries(config).some((entry) =>
      gatewayEntryMatchesBackend(entry, serviceName, backendId),
    )
  ) {
    return true;
  }
  if (!backendId) return false;
  return (config?.direct ?? []).some(
    (entry) => entry === toolName || entry === gatewayToolSelectionKey(serviceName, backendId, toolName),
  );
}

type SessionAgentToolsContext = {
  id: string;
  slug: string;
  toolsConfig: AgentToolsConfig | undefined;
  /**
   * Tool references from the agent's enabled CUSTOM subagent definitions.
   * Strict enforcement must keep these alive even when the agent's own
   * selection omits their servers — the subagent is the intended access path
   * (see buildSubagentToolRefs). Empty when the agent uses no custom subagents.
   */
  subagentToolRefs: SubagentToolRefs[];
};

async function loadSessionAgentToolsContext(
  agentSlug: string | undefined,
  spacesAppId: string | undefined,
  agentOrgId: string | undefined,
): Promise<SessionAgentToolsContext | null> {
  if (!agentSlug && !spacesAppId) return null;
  const agent = spacesAppId
    ? await prisma.agent.findUnique({
        where: { spacesAppId },
        select: { id: true, slug: true, config: true, orgId: true },
      })
    : agentSlug && agentOrgId
      ? await prisma.agent.findUnique({
          where: { orgId_slug: { orgId: agentOrgId, slug: agentSlug } },
          select: { id: true, slug: true, config: true, orgId: true },
        })
      : null;
  if (!agent) return null;
  const toolsConfig = parseToolsConfig(
    (agent.config as Record<string, unknown> | null | undefined) ?? undefined,
  );

  let subagentToolRefs: SubagentToolRefs[] = [];
  const subagentNames = (toolsConfig?.subagents ?? []).filter(
    (name) => typeof name === "string" && name.trim().length > 0,
  );
  if (isStrictAgentToolsEnabled() && subagentNames.length > 0) {
    try {
      const defs = await prisma.subagentDefinition.findMany({
        where: {
          name: { in: subagentNames },
          enabled: true,
          ...(agent.orgId ? { orgId: agent.orgId } : {}),
        },
        select: { name: true, tools: true },
      });
      subagentToolRefs = buildSubagentToolRefs(defs);
    } catch (err) {
      // Fail open on the lookup only: worst case we behave like pre-fix
      // enforcement for this request instead of 500ing the tool listing.
      log.error(`[mcp/tools] failed to load subagent definitions for agent=${agent.slug}:`, err);
    }
  }

  return {
    id: agent.id,
    slug: agent.slug,
    toolsConfig,
    subagentToolRefs,
  };
}

function logGlobalServerExcludedOnce(sessionId: string, serverName: string, agentSlug: string): void {
  const key = `${sessionId}:${agentSlug}:${serverName}`;
  if (loggedGlobalServerExclusions.has(key)) return;
  loggedGlobalServerExclusions.add(key);
  log.info(`[mcp/tools] global server ${serverName} excluded by agent config agent=${agentSlug}`);
}

async function isToolAllowedForSessionAgent(
  agentSlug: string | undefined,
  spacesAppId: string | undefined,
  agentOrgId: string | undefined,
  userId: string,
  serverType: string,
  toolName: string,
): Promise<boolean> {
  if (!agentSlug && !spacesAppId) {
    return true;
  }
  const sessionAgent = spacesAppId
    ? await prisma.agent.findUnique({ where: { spacesAppId }, select: { id: true, config: true } })
    : agentSlug && agentOrgId
      ? await prisma.agent.findUnique({
          where: { orgId_slug: { orgId: agentOrgId, slug: agentSlug } },
          select: { id: true, config: true },
        })
      : null;

  const gatewayTarget = parseGatewayServerType(serverType);
  if (gatewayTarget) {
    const config = parseToolsConfig(
      (sessionAgent?.config as Record<string, unknown> | null | undefined) ?? undefined,
    );
    return isGatewayToolEnabledInConfig(config, gatewayTarget.serviceName, toolName, gatewayTarget.backendId);
  }

  const agentConn = await prisma.agentMcpConnection.findFirst({
    where: {
      ...(sessionAgent?.id ? { agentId: sessionAgent.id } : { agent: { id: "__missing_session_agent__" } }),
      mcpServer: { type: serverType },
    },
    select: { id: true },
  });
  if (agentConn) {
    return true;
  }

  const effective = await loadEffectiveCredentialsWithSpacesFallback(
    userId,
    serverType,
    agentSlug,
    agentOrgId,
  );
  return effective !== null;
}

async function resolveServerNameForMcpCall(serverType: string, backendId?: string): Promise<string> {
  if (serverType === WEBFETCH_SERVER_TYPE) return WEBFETCH_SERVER_NAME;

  const gatewayTarget = parseGatewayServerType(serverType);
  if (gatewayTarget) {
    const effectiveBackendId = gatewayTarget.backendId ?? backendId;
    return effectiveBackendId ? `${gatewayTarget.serviceName}/${effectiveBackendId}` : serverType;
  }

  if (serverType === "xyne-spaces") {
    const server = await prisma.mcpServer.findUnique({ where: { type: serverType }, select: { name: true } });
    return server?.name ?? "Xyne Spaces";
  }

  const server = await prisma.mcpServer.findUnique({ where: { type: serverType }, select: { name: true } });
  return server?.name ?? serverType;
}

export function signAction(action: Record<string, unknown>): string {
  return crypto.createHmac("sha256", CONFIG.actionSigningKey).update(JSON.stringify(action)).digest("hex");
}

function signLegacyAction(action: Record<string, unknown>): string {
  return crypto.createHmac("sha256", CONFIG.legacyActionSigningKey).update(JSON.stringify(action)).digest("hex");
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

async function postAgentCallProposal(
  params: Record<string, unknown>,
  context: {
    userId: string;
    sessionId: string;
    agentSlug?: string;
    spacesAppId?: string;
    orgId?: string;
  },
): Promise<string> {
  const targetSlug = String(params["agentSlug"] ?? "").trim();
  const task = String(params["task"] ?? "").trim();
  const why = String(params["why"] ?? "").trim();
  if (!targetSlug || !task || !why) {
    return "propose-agent-call failed: agentSlug, task, and why are required.";
  }
  if (!context.orgId) {
    return "propose-agent-call failed: agent org context is unavailable.";
  }

  const { getSession } = await import("./webhook.js");
  const runContext = await getSession(context.sessionId);
  const fallbackRun = runContext
    ? null
    : await agentRunRepository.findBySessionId(context.sessionId).catch(() => null);
  const conversationId = runContext?.conversationId ?? fallbackRun?.conversationId ?? undefined;
  const channelId = runContext?.channelId ?? fallbackRun?.channelId ?? undefined;
  if (!conversationId || !channelId) {
    return "propose-agent-call failed: current Spaces conversation/channel context is unavailable.";
  }

  const proposer = context.spacesAppId
    ? await prisma.agent.findUnique({ where: { spacesAppId: context.spacesAppId } })
    : context.agentSlug
      ? await prisma.agent.findUnique({
          where: { orgId_slug: { orgId: context.orgId, slug: context.agentSlug } },
        })
      : null;
  if (!proposer?.spacesAppToken || !proposer.spacesAppUserId || !proposer.spacesAppId) {
    return "propose-agent-call failed: running agent has no Spaces app identity.";
  }
  if (proposer.slug === targetSlug) {
    return "propose-agent-call failed: an agent cannot propose calling itself.";
  }

  const target = await prisma.agent.findFirst({
    where: {
      orgId: context.orgId,
      slug: targetSlug,
      enabled: true,
      ...visibleAgentWhereForRunningUser(context.userId, await isClawAdmin(context.userId)),
    },
    select: { slug: true, name: true },
  });
  if (!target) {
    return `propose-agent-call failed: target agent "${targetSlug}" was not found or is not visible to the running user.`;
  }

  const actionPayload = {
    actionType: "agent-call",
    targetAgentSlug: target.slug,
    task,
    proposerAgentSlug: proposer.slug,
    conversationId,
  };
  const flow = buildAgentCallProposalFlow({
    proposerAgentSlug: proposer.slug,
    proposerAgentName: proposer.name,
    targetAgentSlug: target.slug,
    targetAgentName: target.name,
    task,
    why,
    conversationId,
    channelId,
    signature: signAction(actionPayload),
  });
  flow.data = { ...(flow.data ?? {}), spacesAppId: proposer.spacesAppId };

  const appToken = decryptStoredToken(proposer.spacesAppToken);
  const postRes = await fetch(`${CONFIG.spacesInternalUrl}/api/apps/chat/postMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${appToken}` },
    body: JSON.stringify({
      channelId,
      conversationId,
      flow,
      userId: proposer.spacesAppUserId,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!postRes.ok) {
    const body = await postRes.text().catch(() => "");
    return `propose-agent-call failed: could not post proposal card (${postRes.status}: ${body.slice(0, 200)})`;
  }

  return `Proposal card posted for ${target.name}. The user decides now; do NOT call propose-agent-call again for the same task.`;
}

type EnforcementLogType = "user" | "global" | "virtual";

/** A connector candidate in the tool-resolution list (user/global/agent). */
type ListEntry = {
  type: "agent" | "user" | "global";
  serverType: string;
  serverName: string;
  enforcementType?: EnforcementLogType;
};

function enforcementLogTypeForEntry(entry: ListEntry): EnforcementLogType {
  if (entry.enforcementType) return entry.enforcementType;
  return entry.type === "global" ? "global" : "user";
}

function serverToolsKey(serverType: string, serverName: string): string {
  return `${serverType}\u0000${serverName}`;
}

function enforceMcpToolsListing(
  data: McpServerTools[],
  config: AgentToolsConfig,
  agentSlug: string,
  entryTypes: Map<string, EnforcementLogType>,
  subagentRefs: SubagentToolRefs[] = [],
): McpServerTools[] {
  let kept = 0;
  let dropped = 0;
  const enforced: McpServerTools[] = [];

  for (const serverTools of data) {
    if (shouldBypassMcpToolAgentFilter(serverTools.serverType)) {
      enforced.push(serverTools);
      kept += 1;
      continue;
    }

    const retainedForSubagents = new Set<string>();
    const filtered = filterMcpServerToolsForAgentConfig(
      serverTools,
      config,
      parseGatewayServerType,
      subagentRefs,
      retainedForSubagents,
    );
    if (!filtered) {
      dropped += 1;
      const type =
        entryTypes.get(serverToolsKey(serverTools.serverType, serverTools.serverName)) ??
        entryTypes.get(serverTools.serverType) ??
        "virtual";
      log.info(
        `[mcp/tools] enforced-drop server=${serverTools.serverName} type=${type} tools=${serverTools.tools.length} agent=${agentSlug}`,
      );
      continue;
    }

    if (retainedForSubagents.size > 0) {
      log.info(
        `[mcp/tools] retained server=${serverTools.serverName} tools=${filtered.tools.length} for subagents=[${[...retainedForSubagents].join(",")}] agent=${agentSlug}`,
      );
    }

    kept += 1;
    enforced.push(filtered);
  }

  log.info(`[mcp/tools] enforcement agent=${agentSlug} kept=${kept} dropped=${dropped}`);
  return enforced;
}

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
  // upload-pr-attachment hits GitHub's REST + uploads API directly, so it works
  // even when the upstream github MCP server fails to spawn.
  { match: (t) => t === "github", tools: GITHUB_CUSTOM_TOOLS, createIfMissing: true },
  { match: (t) => t === "postman", tools: POSTMAN_CUSTOM_TOOLS, createIfMissing: false },
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
  const workspaceId = await getWorkspaceIdForUser(userId, "mcp-runner").catch(() => null);
  return {
    url: CONFIG.spacesBackendUrl,
    token: appToken,
    authMode: "app",
    userId,
    ...(workspaceId ? { workspaceId } : {}),
  };
}

/**
 * Wrapper around loadEffectiveCredentials that adds the xyne-spaces app-token
 * fallback. Keeps the same return shape so callers can swap it in seamlessly.
 */
async function loadSlackSurfaceCredentials(
  sessionId: string | undefined,
): Promise<EffectiveCredentials | null> {
  if (!sessionId) return null;

  const { getSession } = await import("./webhook.js");
  const runCtx = await getSession(sessionId).catch(() => null);
  const delivery = runCtx?.slackDelivery;
  if (!delivery?.surfaceAgentId || !delivery.teamId) return null;

  const { agentBotToken, connectedSurfaceBotToken } = await import("../surfaces/slack/delivery.js");
  const botToken = delivery.connectedSurfaceId
    ? await connectedSurfaceBotToken(delivery.connectedSurfaceId).catch(() => null)
    : await agentBotToken(delivery.surfaceAgentId, delivery.teamId).catch(() => null);
  if (!botToken) return null;

  return {
    credentials: { botToken, teamId: delivery.teamId },
    source: "agent",
    connectionId: `slack-surface:${delivery.connectedSurfaceId ?? delivery.surfaceAgentId}:${delivery.teamId}`,
    isUserOwned: false,
  };
}

/**
 * Add a tool to the agent's `direct` allowlist for THIS run only.
 *
 * `apps-send-message` never appears in the agent tool picker (it acts as the
 * bot identity, so it is deliberately not offered for interactive runs), which
 * means a strict `tools.direct` allowlist always excludes it. For an AWAKENED
 * run that is fatal rather than merely restrictive: nobody is in a thread to
 * receive the agent's final answer, so this tool is the ONLY way it can speak.
 * Without it the agent reasons correctly, decides to reply, finds no tool, and
 * says nothing — the whole feature is inert. (Observed live 2026-08-25.)
 *
 * Per-run and in-memory: the stored agent config is untouched, and interactive
 * runs of the same agent are unaffected.
 */
function withDirectTool(config: AgentToolsConfig, toolName: string): AgentToolsConfig {
  const direct = Array.isArray(config.direct)
    ? config.direct.filter((value): value is string => typeof value === "string")
    : [];
  if (direct.includes(toolName)) return config;
  return { ...config, direct: [...direct, toolName] };
}

function withSubagent(config: AgentToolsConfig, subagentName: string): AgentToolsConfig {
  const subagents = Array.isArray(config.subagents)
    ? config.subagents.filter((value): value is string => typeof value === "string")
    : [];
  if (subagents.includes(subagentName)) return config;
  return { ...config, subagents: [...subagents, subagentName] };
}

/**
 * Mirror per-run surface tool injection at the claw-auth enforcement boundary.
 * MCP listing/call routes load the agent's stored config, not the agentConfig
 * override forwarded to claw, so without this a surface-default virtual group
 * is created and then immediately filtered back out.
 */
export async function withSurfaceDefaultToolsConfig(
  config: AgentToolsConfig | undefined,
  sessionId: string,
  sessionSpacesAppId?: string,
): Promise<AgentToolsConfig | undefined> {
  if (!config) return undefined;

  const { getSession } = await import("./webhook.js");
  const runCtx = await getSession(sessionId).catch(() => null);

  let effective = config;
  if (runCtx?.slackDelivery?.surfaceAgentId && runCtx.slackDelivery.teamId) {
    effective = withSubagent(effective, "slack");
  }

  // Spaces-originated runs already carry the agent's Spaces app/user context in
  // the session and credential fallback. Give those runs the Spaces subagent by
  // default, matching Slack's surface-default injection, without mutating the
  // stored agent config or granting Spaces tools to API/chat runs. Scheduled
  // jobs post their result into a Spaces channel, so a scheduled run that
  // carries Spaces app context counts as a Spaces surface too and gets the same
  // default (a non-Spaces scheduled run, lacking that context, does not).
  const hasSpacesContext = !!runCtx?.spacesAppId && !!runCtx?.spacesAppUserId && !runCtx?.slackDelivery;
  // The run-context (`getSession`) can come back empty or partial at tool-list
  // time — a Redis miss or a race — and that silently strips a Spaces-app
  // agent's Spaces tools (prod 2026-08-24: agent `xyne` kept only its hand-
  // listed read tools, every write tool + the app-tools server dropped). The
  // AUTHENTICATED session's own `spacesAppId` is an authoritative signal that
  // this run belongs to a Spaces app, independent of the run-context. Trust it
  // as a Spaces surface unless the run is explicitly a non-Spaces one (Slack
  // delivery, or an explicit api/chat trigger) — so the fallback fixes the
  // empty-run-context case without granting Spaces tools to true API/chat runs.
  const sessionIsSpacesApp =
    !!sessionSpacesAppId &&
    !runCtx?.slackDelivery &&
    runCtx?.triggerSource !== "api" &&
    runCtx?.triggerSource !== "chat";
  const isSpacesSurface =
    runCtx?.triggerSource === "spaces" ||
    runCtx?.triggerSource === "automation" ||
    runCtx?.isAutomation === true ||
    (runCtx?.triggerSource === "scheduled" && hasSpacesContext) ||
    (runCtx?.triggerSource == null && hasSpacesContext) ||
    sessionIsSpacesApp;
  if (isSpacesSurface) {
    if (!hasSpacesContext && sessionIsSpacesApp && runCtx?.triggerSource == null) {
      log.info(`[mcp/tools] spaces default injected from session spacesAppId (run-context absent) app=${sessionSpacesAppId}`);
    }
    effective = withSubagent(effective, "spaces");
  }

  // An awakened run (heartbeat / reflex) has no thread its answer is posted
  // into, so the bot-identity send tool is its only voice. Grant it for this
  // run regardless of the agent's stored allowlist; the write POLICY
  // (observe / reply / act, plus shadow) still governs whether the call is
  // permitted — see awakening/write-policy.ts, enforced at /mcp/call.
  if (runCtx?.triggerSource === "heartbeat" || runCtx?.triggerSource === "reflex") {
    effective = withDirectTool(effective, AWAKENING_SEND_TOOL);
  }

  return effective;
}

async function loadEffectiveCredentialsWithSpacesFallback(
  userId: string,
  serverType: string,
  agentSlug?: string,
  agentOrgId?: string,
  sessionId?: string,
): Promise<EffectiveCredentials | null> {
  // A Slack-surface run must use the bot installed in the workspace that
  // dispatched it. Do this before user/agent/global credential resolution so
  // an unrelated personal Slack connection cannot cross workspace boundaries.
  if (serverType === "slack") {
    const surface = await loadSlackSurfaceCredentials(sessionId);
    if (surface) return surface;
  }

  const effective = await loadEffectiveCredentials(userId, serverType, agentSlug, undefined, agentOrgId);
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

export function verifyActionSignatureAny(
  actions: readonly Record<string, unknown>[],
  signature: string,
): boolean {
  try {
    const given = Buffer.from(signature, "hex");
    return actions.some((action) => {
      const current = Buffer.from(signAction(action), "hex");
      if (current.length === given.length && crypto.timingSafeEqual(current, given)) return true;
      const legacy = Buffer.from(signLegacyAction(action), "hex");
      return legacy.length === given.length && crypto.timingSafeEqual(legacy, given);
    });
  } catch {
    return false;
  }
}

const router = Router();

// Scope the Bearer gate to the subpaths this router actually serves
// (/:sessionId/mcp/* and /:sessionId/actions/*). A bare "/:sessionId" prefix
// SHADOWED every other route under /sessions/:id — most damagingly
// POST /sessions/:id/result in run.ts (the handoff/result callback fallback),
// which 401'd "Bearer token required" on every delivery: claw callbacks send
// x-s2s-key + x-session-token, never a Bearer. Found 2026-07-16 when a drain
// dropped ~50 handoff callbacks; the route had never worked.
router.use("/:sessionId/mcp", requireStrictS2S, requireSessionToken);
router.use("/:sessionId/actions", requireStrictS2S, requireSessionToken);

router.get("/:sessionId/mcp/tools", async (req: Request<{ sessionId: string }>, res: Response) => {
  try {
    const userId = req.session!.userId;
    const agentSlug = req.session?.agentSlug;
    const spacesAppId = req.session?.spacesAppId;
    const sessionAgentOrgId = await resolveSessionAgentOrgId(userId, spacesAppId);
    const sessionAgentTools = await loadSessionAgentToolsContext(agentSlug, spacesAppId, sessionAgentOrgId);
    const strictAgentToolsConfig = isStrictAgentToolsEnabled()
      ? await withSurfaceDefaultToolsConfig(sessionAgentTools?.toolsConfig, req.params.sessionId, spacesAppId)
      : undefined;
    const tenantUniqueId = resolveGatewayTenantForRequest();

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
        // Org-scoped global creds: ANY row (org override or NULL-org default)
        // makes the server listable; the loader picks the right row at call
        // time (org override first, default second).
        globalCredentials: { some: {} },
        id: { notIn: Array.from(userServerIds) },
      },
    });

    const entries: ListEntry[] = [
      ...userConnections.map((c) => ({
        type: "user" as const,
        serverType: c.mcpServer.type,
        serverName: c.mcpServer.name,
      })),
      ...globalServers.map((s) => ({ type: "global" as const, serverType: s.type, serverName: s.name })),
    ];

    // Add MCPs the agent has pinned (only when this session is running an
    // agent). Agent-pinned servers get added with type=agent and prepended
    // to the resolution list so the resolver picks them first. If the user
    // also has a connection for the same type, we still add the agent
    // entry but the dedupe below keeps the agent one (it's pre-pended
    // before user/global of the same type).
    if (agentSlug || spacesAppId) {
      const agentConns = await prisma.agentMcpConnection.findMany({
        where: sessionAgentTools?.id
          ? { agentId: sessionAgentTools.id }
          : { agent: { id: "__missing_session_agent__" } },
        include: { mcpServer: true },
      });
      for (const c of agentConns) {
        const alreadyListed = entries.some((e) => e.serverType === c.mcpServer.type);
        if (!alreadyListed) {
          entries.unshift({ type: "agent", serverType: c.mcpServer.type, serverName: c.mcpServer.name });
        }
      }
    }

    // ── Automation app-mode Spaces (decided HERE, at entry build) ──────────
    // Automation (app-user) runs get Spaces served in APP MODE: the
    // xyne-spaces-app-tools server (full registry, app token, see
    // xyne-spaces-app-tools-server.ts) replaces the user xyne-spaces server.
    // The decision is made once, where server entries are assembled — not by
    // splicing the listing afterwards. `isAutomation` is the explicit dispatch
    // flag; resolveMentions/externalResultCallback is the legacy proxy kept
    // for sessions dispatched before the flag existed.
    const { getSession } = await import("./webhook.js");
    const runCtx = await getSession(req.params.sessionId).catch(() => null);
    const isAutomationRun =
      runCtx?.isAutomation === true ||
      runCtx?.resolveMentions === true ||
      !!runCtx?.externalResultCallback;
    let automationAppSwap = false;
    if (isAutomationRun) {
      // Only swap when the app token actually resolves AND the app-tools
      // server row exists — otherwise we'd strip Spaces access and silently
      // break the run. Keep the user server and log loudly instead.
      const appCreds = await getAppTokenCredentials(userId);
      const appToolsRow = await prisma.mcpServer.findUnique({ where: { type: "xyne-spaces-app-tools" } });
      if (appCreds && appToolsRow) {
        automationAppSwap = true;
        let dropped = 0;
        for (let i = entries.length - 1; i >= 0; i--) {
          if (entries[i]!.serverType === "xyne-spaces") {
            entries.splice(i, 1);
            dropped++;
          }
        }
        log.info(
          `[mcp/tools] automation app-mode: xyne-spaces-app-tools serves Spaces for userId=${userId} ` +
          `(dropped ${dropped} xyne-spaces entr${dropped === 1 ? "y" : "ies"})`,
        );
      } else {
        log.warn(
          `[mcp/tools] automation app-mode SKIPPED for userId=${userId}: ` +
          `appCreds=${!!appCreds} appToolsRow=${!!appToolsRow}. ` +
          "Keeping xyne-spaces user MCP to avoid stripping Spaces access. " +
          "If this is an automation run, the agent's app is likely not installed / app token missing.",
        );
      }
    }

    // Virtual xyne-spaces entry: if SPACES_DB_URL is configured the user can
    // use Spaces tools without ever clicking "Connect" — loadEffectiveCredentials
    // synthesizes the creds from the live session row. Only add when there's
    // no existing user/global row for xyne-spaces (else we'd duplicate).
    // Skipped under the automation app-mode swap — Spaces is served by
    // xyne-spaces-app-tools for those runs.
    const hasSpacesEntry = entries.some((e) => e.serverType === "xyne-spaces");
    if (!hasSpacesEntry && !automationAppSwap && CONFIG.spacesDbUrl) {
      const spacesServer = await prisma.mcpServer.findUnique({ where: { type: "xyne-spaces" } });
      log.info(`[mcp/tools] spaces virtual-entry check: mcpServerRow=${!!spacesServer}`);
      if (spacesServer) {
        entries.push({
          type: "user",
          serverType: "xyne-spaces",
          serverName: spacesServer.name,
          enforcementType: "virtual",
        });
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
        entries.push({
          type: "user",
          serverType: "xyne-spaces-app-tools",
          serverName: appToolsServer.name,
          enforcementType: "virtual",
        });
        log.info(`[mcp/tools] added virtual xyne-spaces-app-tools entry for userId=${userId}`);
      }
    }
    // Virtual research-agent-mcp entry: global stdio proxy configured by env.
    // No user connection row is needed; credentials-loader sources the API key
    // from RESEARCH_AGENT_MCP_API_KEY for every agent/user.
    const hasResearchAgentMcpEntry = entries.some((e) => e.serverType === "research-agent-mcp");
    if (!hasResearchAgentMcpEntry && CONFIG.researchAgentMcpApiKey) {
      const researchAgentMcpServer = await prisma.mcpServer.findUnique({
        where: { type: "research-agent-mcp" },
      });
      if (researchAgentMcpServer) {
        entries.push({
          type: "global",
          serverType: "research-agent-mcp",
          serverName: researchAgentMcpServer.name,
          enforcementType: "virtual",
        });
        log.info(`[mcp/tools] added virtual research-agent-mcp entry for userId=${userId}`);
      }
    }
    // Virtual Heisenberg entry: the internal pipeline service has no user
    // credentials. Its reviewed static adapter uses the deployment-wide
    // HEISENBERG_BASE_URL (with a code default), so every agent can select it
    // without creating a user_mcp_connections row.
    const hasHeisenbergEntry = entries.some((e) => e.serverType === "heisenberg");
    if (!hasHeisenbergEntry) {
      const heisenbergServer = await prisma.mcpServer.findUnique({ where: { type: "heisenberg" } });
      if (heisenbergServer?.enabled) {
        entries.push({ type: "global", serverType: "heisenberg", serverName: heisenbergServer.name, enforcementType: "virtual" });
        log.info(`[mcp/tools] added virtual heisenberg entry for userId=${userId}`);
      }
    }

    // Slack-surface runs do not require a separately configured MCP
    // connection. The verified workspace install supplies credentials.
    const hasSlackEntry = entries.some((entry) => entry.serverType === "slack");
    if (!hasSlackEntry) {
      // runCtx fetched once above (automation app-mode block).
      if (runCtx?.slackDelivery?.surfaceAgentId && runCtx.slackDelivery.teamId) {
        const slackServer = await prisma.mcpServer.findUnique({ where: { type: "slack" } });
        if (slackServer) {
          entries.push({ type: "user", serverType: "slack", serverName: slackServer.name, enforcementType: "virtual" });
          log.info(`[mcp/tools] added virtual slack entry (surface bot token) for userId=${userId}`);
        }
      }
    }

    log.info(`[mcp/tools] final entries=${entries.map((e) => `${e.serverType}:${e.type}`).join(",")}`);

    // Fallback: if no xyne-spaces connection exists, try using the agent's app token.
    // Skipped under the automation app-mode swap — that path must NOT re-list the
    // user xyne-spaces server (with app creds) that the swap just removed.
    const hasSpacesConnection = entries.some((e) => e.serverType === "xyne-spaces" && e.type !== "user");
    let appTokenToolsResult: Awaited<ReturnType<typeof listToolsForUser>> | null = null;
    if (!hasSpacesConnection && !automationAppSwap) {
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
        const effective = entry.serverType === "slack"
          ? await loadEffectiveCredentialsWithSpacesFallback(
              userId,
              entry.serverType,
              agentSlug,
              sessionAgentOrgId,
              req.params.sessionId,
            )
          : await loadEffectiveCredentials(userId, entry.serverType, agentSlug, undefined, sessionAgentOrgId);
        if (!effective) return null;
        const serverTools = await listToolsForUser(
          userId,
          entry.serverType,
          entry.serverName,
          effective.credentials,
          agentSlug,
        );
        return { entry, serverTools };
      }),
    );

    const data = results
      .filter(
        (
          r,
        ): r is PromiseFulfilledResult<{
          entry: ListEntry;
          serverTools: Awaited<ReturnType<typeof listToolsForUser>>;
        } | null> => r.status === "fulfilled",
      )
      .map((r) => r.value)
      .filter(
        (v): v is { entry: ListEntry; serverTools: Awaited<ReturnType<typeof listToolsForUser>> } =>
          v !== null,
      )
      .map((v) => v.serverTools);

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
    if ((agentSlug || spacesAppId) && tenantUniqueId) {
      const agent = spacesAppId
        ? await prisma.agent.findUnique({ where: { spacesAppId }, select: { config: true } })
        : agentSlug && sessionAgentOrgId
          ? await prisma.agent.findUnique({
              where: { orgId_slug: { orgId: sessionAgentOrgId, slug: agentSlug } },
              select: { config: true },
            })
          : null;
      const config = parseToolsConfig(
        (agent?.config as Record<string, unknown> | null | undefined) ?? undefined,
      );
      const selectedGatewayEntries = getEnabledGatewayConfigEntries(config);
      const selectedGatewayToolKeys = new Set(
        (config?.direct ?? []).filter(
          (key): key is string => typeof key === "string" && parseGatewayToolSelectionKey(key) !== null,
        ),
      );
      const selectedGatewayToolTargets = Array.from(selectedGatewayToolKeys)
        .map(parseGatewayToolSelectionKey)
        .filter(
          (target): target is NonNullable<ReturnType<typeof parseGatewayToolSelectionKey>> => target !== null,
        );
      const selectedGatewayServiceNames = new Set([
        ...selectedGatewayEntries.map((entry) => entry.serviceName),
        ...selectedGatewayToolTargets.map((target) => target.serviceName),
      ]);

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

        for (const row of gatewayRows) {
          const serviceEnabled = selectedGatewayEntries.some((entry) =>
            gatewayEntryMatchesBackend(entry, row.serviceName, row.backendId),
          );
          const rowTools = parseGatewayTools(row.tools);
          const exposedTools = serviceEnabled
            ? rowTools
            : rowTools.filter((tool) =>
                selectedGatewayToolKeys.has(
                  gatewayToolSelectionKey(row.serviceName, row.backendId, tool.name),
                ),
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
            .filter((tool) => requiresGatewayToolApproval(tool))
            .map((tool) => tool.name);

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
    if (agentSlug || spacesAppId) {
      const agentRow = spacesAppId
        ? await prisma.agent.findUnique({
            where: { spacesAppId },
            select: { kbScope: true, _count: { select: { collections: true } } },
          })
        : agentSlug && sessionAgentOrgId
          ? await prisma.agent.findUnique({
              where: { orgId_slug: { orgId: sessionAgentOrgId, slug: agentSlug } },
              select: { kbScope: true, _count: { select: { collections: true } } },
            })
          : null;
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
      tools: [...WEBFETCH_CUSTOM_TOOLS, ...AGENT_INTROSPECT_TOOLS, ...ORCHESTRATOR_TOOLS],
      writeTools: [],
    });

    // ── Non-automation runs: app-tools shows ONLY its app-native tools ─────
    // The app-tools server mounts the full Spaces registry so it can be the
    // sole Spaces server on automation runs (the entry-stage swap above). On
    // every OTHER run those registry tools must not be reachable through the
    // bot identity — a human's call would execute with app credentials and
    // skip user ACLs. So outside the swap, app-tools is reduced to its
    // app-native tools regardless of whether a user xyne-spaces server is
    // present (the old name-collision de-dup left the full registry exposed
    // whenever the user server happened to be missing).
    if (!automationAppSwap) {
      const appToolsIdx = data.findIndex((s2) => s2.serverType === "xyne-spaces-app-tools");
      if (appToolsIdx >= 0) {
        const appTools = data[appToolsIdx]!;
        const kept = appTools.tools.filter((t) => APP_ONLY_TOOL_NAMES.has(t.name));
        const removed = appTools.tools.length - kept.length;
        if (removed > 0) {
          // McpServerTools.tools/writeTools are readonly — replace the object.
          data[appToolsIdx] = {
            ...appTools,
            tools: kept,
            writeTools: appTools.writeTools.filter((n) => APP_ONLY_TOOL_NAMES.has(n)),
          };
          log.info(
            `[mcp/tools] hid ${removed} Spaces registry tool(s) on xyne-spaces-app-tools ` +
            `(non-automation run) for userId=${userId}`,
          );
        }
      }
    }

    if (strictAgentToolsConfig && sessionAgentTools) {
      const entryTypes = new Map<string, EnforcementLogType>();
      for (const entry of entries) {
        const type = enforcementLogTypeForEntry(entry);
        entryTypes.set(serverToolsKey(entry.serverType, entry.serverName), type);
        entryTypes.set(entry.serverType, type);
      }
      for (const serverTools of data) {
        if (!entryTypes.has(serverTools.serverType)) entryTypes.set(serverTools.serverType, "virtual");
      }
      data.splice(
        0,
        data.length,
        ...enforceMcpToolsListing(
          data,
          strictAgentToolsConfig,
          sessionAgentTools.slug,
          entryTypes,
          sessionAgentTools.subagentToolRefs,
        ),
      );
    }

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
    const spacesAppId = req.session?.spacesAppId;
    const sessionAgentOrgId = await resolveSessionAgentOrgId(userId, spacesAppId);
    const sessionAgentTools = await loadSessionAgentToolsContext(agentSlug, spacesAppId, sessionAgentOrgId);
    const strictAgentToolsConfig = isStrictAgentToolsEnabled()
      ? await withSurfaceDefaultToolsConfig(sessionAgentTools?.toolsConfig, req.params.sessionId, spacesAppId)
      : undefined;
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
    // - ALL kb-* tools are read-only by design (see KB_TOOL_NAMES, writeTools
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
            out = await handleKbListFiles({
              userId,
              agentSlug,
              collectionId: String(p["collectionId"] ?? ""),
              ...(typeof p["depth"] === "number" ? { depth: p["depth"] as number } : {}),
            });
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
        res.json({
          success: true,
          data: {
            content: `KB tool failed: ${errMsg(err)}`,
            isError: true,
          },
        });
      }
      return;
    }

    const callServerName = strictAgentToolsConfig
      ? await resolveServerNameForMcpCall(serverType, backendId)
      : serverType;

    if (
      strictAgentToolsConfig &&
      !isMcpToolAllowedByAgentConfig(
        strictAgentToolsConfig,
        serverType,
        callServerName,
        tool,
        parseGatewayServerType,
      ) &&
      // Custom-subagent escape hatch: tools referenced by the agent's enabled
      // subagent definitions are callable even though the agent's own config
      // omits them — the subagent is the intended access path. Mirrors the
      // retention in enforceMcpToolsListing; without this the listing offers
      // tools the call gate then 403s ("MCP tool is not enabled for this
      // agent" from inside subagent palettes).
      !subagentReferencingTool(sessionAgentTools?.subagentToolRefs ?? [], { name: tool })
    ) {
      res.status(403).json({ success: false, error: "MCP tool is not enabled for this agent" });
      return;
    }

    // Built-in webfetch — virtual server, no connector / no credentials. Like
    // the knowledge-base branch, short-circuit BEFORE the connector + credential
    // checks. The tool is read-only (fetch → markdown), so it does not go
    // through the write-action approval flow.
    if (serverType === WEBFETCH_SERVER_TYPE) {
      const isIntrospect = (AGENT_INTROSPECT_TOOL_NAMES as readonly string[]).includes(tool);
      const isOrchestrator = (ORCHESTRATOR_TOOL_NAMES as readonly string[]).includes(tool);
      const isWebfetch = tool === "webfetch" || tool === "webfetch_high_limit";
      if (!isWebfetch && !isIntrospect && !isOrchestrator) {
        res.status(400).json({ success: false, error: `Unknown built-in tool: ${tool}` });
        return;
      }
      try {
        const content = isIntrospect
          ? await handleAgentIntrospect(tool, params ?? {}, sessionAgentOrgId, userId)
          : isOrchestrator
            ? await postAgentCallProposal(params ?? {}, {
                userId,
                sessionId: req.params.sessionId,
                ...(agentSlug ? { agentSlug } : {}),
                ...(spacesAppId ? { spacesAppId } : {}),
                ...(sessionAgentOrgId ? { orgId: sessionAgentOrgId } : {}),
              })
            : await handleWebfetch(params ?? {}, { highLimit: tool === "webfetch_high_limit" });
        res.json({ success: true, data: { content } });
      } catch (err) {
        log.error(`[mcp/call] built-in tool error (${tool}):`, err);
        res.json({
          success: true,
          data: {
            content: `${tool} failed: ${errMsg(err)}`,
            isError: true,
          },
        });
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

      if (!agentSlug && !spacesAppId) {
        res.status(401).json({ success: false, error: "No agent session" });
        return;
      }

      const agent = spacesAppId
        ? await prisma.agent.findUnique({ where: { spacesAppId }, select: { config: true } })
        : agentSlug && sessionAgentOrgId
          ? await prisma.agent.findUnique({
              where: { orgId_slug: { orgId: sessionAgentOrgId, slug: agentSlug } },
              select: { config: true },
            })
          : null;
      const config = parseToolsConfig((agent?.config as Record<string, unknown> | null | undefined) ?? {});

      if (backendId && gatewayTarget.backendId && backendId !== gatewayTarget.backendId) {
        res.status(400).json({ success: false, error: "backendId conflicts with serverType" });
        return;
      }

      const effectiveBackendId = gatewayTarget.backendId ?? backendId;
      const gatewayEnabled =
        (config &&
          isGatewayToolEnabledInConfig(config, gatewayTarget.serviceName, tool, effectiveBackendId)) ||
        // Same custom-subagent escape hatch as the strict gate above.
        !!subagentReferencingTool(sessionAgentTools?.subagentToolRefs ?? [], { name: tool });
      if (!gatewayEnabled) {
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

      const descriptor = await findGatewayToolDescriptor(
        tenantUniqueId,
        gatewayTarget.serviceName,
        tool,
        effectiveBackendId,
      );
      if (!descriptor) {
        res
          .status(404)
          .json({ success: false, error: `Gateway tool not found: ${gatewayTarget.serviceName}/${tool}` });
        return;
      }

      const requiresApproval = requiresGatewayToolApproval(descriptor);
      const effectivePermission = requiresApproval ? "ask" : (permission ?? "allow");

      log.info(
        `[mcp/call] user=${userId} server=${serverType} tool=${tool} permission=${effectivePermission}${requiresApproval ? " (gateway approval required, forced ask)" : ""}`,
      );

      // Hard deny. Distinct from "ask": there is no approval that unblocks it,
      // because there is nobody to ask. Used by unattended runs (an awakened
      // agent in shadow or observe mode) where a write must be impossible
      // rather than merely queued behind a card no human will ever click.
      if (effectivePermission === "deny") {
        log.info(`[mcp/call] denied ${serverType}/${tool} for user=${userId} (permission=deny)`);
        res.json({
          success: true,
          data: {
            content: `Blocked: this run is not permitted to call ${tool}. It is running without write access; describe what you would have done instead.`,
          },
        });
        return;
      }

      if (effectivePermission === "ask") {
        const action = { serverType, tool, params: params ?? {}, userId };
        const signature = signAction(action);
        res.json({
          success: true,
          data: { content: `Action queued for approval: ${tool}`, pendingAction: { ...action, signature } },
        });
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

      const content =
        typeof execution.result === "string" ? execution.result : JSON.stringify(execution.result ?? {});

      res.json({ success: true, data: { content } });
      return;
    }

    if (!(await hasConnectorDefinition(serverType))) {
      res.status(400).json({ success: false, error: `No adapter for server type: ${serverType}` });
      return;
    }

    const effective = await loadEffectiveCredentialsWithSpacesFallback(
      userId,
      serverType,
      agentSlug,
      sessionAgentOrgId,
      req.params.sessionId,
    );
    if (!effective) {
      res
        .status(404)
        .json({ success: false, error: `No connection found for user and server type: ${serverType}` });
      return;
    }
    if (
      isStrictAgentToolsEnabled() &&
      effective.source === "global" &&
      sessionAgentTools?.toolsConfig &&
      !isMcpToolAllowedByAgentConfig(
        sessionAgentTools.toolsConfig,
        serverType,
        callServerName,
        tool,
        parseGatewayServerType,
      ) &&
      !subagentReferencingTool(sessionAgentTools.subagentToolRefs, { name: tool })
    ) {
      logGlobalServerExcludedOnce(req.params.sessionId, callServerName, sessionAgentTools.slug);
      res.status(403).json({ success: false, error: "Global MCP server is not enabled for this agent" });
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
      agentRunRepository
        .markUsedUserToken(req.params.sessionId)
        .catch((e) =>
          log.warn(
            `[mcp/call] markUsedUserToken failed for ${req.params.sessionId}: ${errMsg(e)}`,
          ),
        );
    }

    // Default-fill spaces-* tool args from the run's attached context — only
    // fills slots the LLM left empty. See mcp/attached-context-injector.ts.
    // Reads from Redis keyed by the URL sessionId (set in /run). If nothing was
    // attached, this is a no-op fast path.
    const attachedItems = await loadAttachedContextForSession(req.params.sessionId);
    let effectiveParams = injectAttachedContextDefaults(serverType, tool, params ?? {}, attachedItems);

    // Baseline identity is trusted run state, not model memory. Compaction can
    // remove the original task, so force-inject persisted values on every call.
    if (
      serverType === "xyne-spaces" &&
      tool === SDLC_TOOL_NAMES.mutateArtifact &&
      effectiveParams["artifactType"] === "BASELINE"
    ) {
      const run = await agentRunRepository.findBySessionId(req.params.sessionId).catch(() => null);
      effectiveParams = injectSdlcBaselineRunContext(effectiveParams, run?.metadata);
    }

    // xyne-dashboard: force-set the run's dashboard scalars (stored in /run,
    // see mcp/run-scalars.ts). Authoritative — overwrites anything the model
    // put in these slots so a hallucinated dataSourceId/draftId can never
    // reach the Spaces endpoints.
    if (serverType === "xyne-dashboard") {
      const scalars = await loadRunScalars(req.params.sessionId);
      effectiveParams = {
        ...effectiveParams,
        ...(scalars.dataSourceId ? { dataSourceId: scalars.dataSourceId } : {}),
        ...(scalars.draftId ? { draftId: scalars.draftId } : {}),
        ...(scalars.focusedComponentId ? { focusedComponentId: scalars.focusedComponentId } : {}),
      };
    }

    // Write tools always require approval — cannot be overridden by agent config
    const definition = await resolveConnectorDefinition(serverType);
    const isWriteTool = definition?.writeTools?.includes(tool) ?? false;
    const effectivePermission = isWriteTool ? "ask" : (permission ?? "allow");

    log.info(
      `[mcp/call] user=${userId} server=${serverType} tool=${tool} permission=${effectivePermission}${isWriteTool ? " (write-tool, forced ask)" : ""}`,
      {
        event: "mcp_call_start",
        userId,
        server: serverType,
        tool,
        permission: effectivePermission,
        isWriteTool,
      },
    );

    // Hard deny. Distinct from "ask": there is no approval that unblocks it,
    // because there is nobody to ask. Used by unattended runs (an awakened
    // agent in shadow or observe mode) where a write must be impossible
    // rather than merely queued behind a card no human will ever click.
    if (effectivePermission === "deny") {
      log.info(`[mcp/call] denied ${serverType}/${tool} for user=${userId} (permission=deny)`);
      res.json({
        success: true,
        data: {
          content: `Blocked: this run is not permitted to call ${tool}. It is running without write access; describe what you would have done instead.`,
        },
      });
      return;
    }

    if (effectivePermission === "ask") {
      const validationError = await validateWriteAction(serverType, tool, effectiveParams, {
        ...credentials,
        userId,
      });
      if (validationError) {
        log.info(`[mcp/call] validator rejected ${serverType}/${tool}: ${validationError}`);
        res.json({ success: true, data: { content: `Cannot ${tool}: ${validationError}` } });
        return;
      }
      const action = { serverType, tool, params: effectiveParams, userId };
      const signature = signAction(action);
      res.json({
        success: true,
        data: { content: `Action queued for approval: ${tool}`, pendingAction: { ...action, signature } },
      });
      return;
    }

    // Handle custom tools locally instead of forwarding to MCP server
    if (serverType === "bitbucket" && tool === "upload-pr-screenshot") {
      const result = await handleUploadPrScreenshot(credentials, params ?? {});
      res.json({ success: true, data: result });
      return;
    }
    if (serverType === "bitbucket" && tool === "get-pr-comments") {
      const result = await handleGetPrComments(credentials, params ?? {});
      res.json({ success: true, data: result });
      return;
    }
    if (serverType === "bitbucket" && tool === "list-pull-requests") {
      const result = await handleListPullRequests(credentials, params ?? {});
      res.json({ success: true, data: result });
      return;
    }
    if (serverType === "bitbucket" && tool === "get-pr-template") {
      const result = await handleGetPrTemplate(credentials, params ?? {});
      res.json({ success: true, data: result });
      return;
    }

    // GitHub: proof-of-test media → GitHub's user-attachments CDN, returning
    // PR-ready markdown. Runs here (not in claw) because the connection's PAT
    // is decrypted server-side and never leaves this process.
    if (serverType === "github" && tool === "upload-pr-attachment") {
      const result = await handleUploadPrAttachment(credentials, params ?? {});
      res.json({ success: true, data: result });
      return;
    }

    // Postman: on-demand monitor run (added to the postman MCP toolset via
    // POSTMAN_CUSTOM_TOOLS). Handled locally against the Postman API using
    // the connection's stored API key. Collection EXECUTION lives in the
    // sandbox as the postman_sbx tool (xyne-claw-shared), not here.
    if (serverType === "postman" && tool === "runMonitor") {
      const content = await handleRunMonitor(credentials, params ?? {});
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
          token:
            credentials["token"] ??
            credentials["apiKey"] ??
            credentials["serviceAccountToken"] ??
            credentials["serviceAccount"],
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
          case "grafana-query-logs":
            unwrap(await handleGrafanaQueryLogs(gfCreds, p));
            break;
          case "grafana-list-metrics":
            unwrap(await handleGrafanaListMetrics(gfCreds, p));
            break;
          case "grafana-query-metrics":
            unwrap(await handleGrafanaQueryMetrics(gfCreds, p));
            break;
          case "grafana-query-database":
            unwrap(await handleGrafanaQueryDatabase(gfCreds, p));
            break;
          default:
            content = `Unknown grafana tool: ${tool}`;
        }
        res.json({ success: true, data: { content, ...(citations?.length ? { citations } : {}) } });
      } catch (err) {
        res.json({
          success: true,
          data: { content: `Error: ${errMsg(err)}` },
        });
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
        const sourceAgentOrgId = spacesAppId
          ? (await prisma.agent.findUnique({ where: { spacesAppId }, select: { orgId: true } }))?.orgId
          : sessionAgentOrgId;
        const targetAgentRow = sourceAgentOrgId
          ? await prisma.agent.findUnique({
              where: { orgId_slug: { orgId: sourceAgentOrgId, slug: targetAgent } },
            })
          : null;
        if (!targetAgentRow) {
          log.warn(
            `[mcp/trigger-agent] agent org-scoped miss slug=${targetAgent} orgId=${sourceAgentOrgId ?? "none"} userId=${userId ?? "none"} spacesAppId=${spacesAppId ?? "none"}`,
          );
          res.json({
            success: true,
            data: { content: `Failed to trigger ${targetAgent}: target agent not found in this org` },
          });
          return;
        }

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
            orgId: targetAgentRow.orgId,
            ...(chanId ? { channelId: chanId } : {}),
            // Don't pass conversationId — it causes session resume with prior agent context.
            // Session Metadata is injected into the task text instead.
            callbackUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/result`,
          }),
        });

        const runBody = (await runRes.json()) as { success: boolean; sessionId?: string; error?: string };

        if (!runBody.success) {
          res.json({
            success: true,
            data: { content: `Failed to trigger ${targetAgent}: ${runBody.error ?? "unknown error"}` },
          });
          return;
        }

        // Store session context for the callback
        const { setSession } = await import("./webhook.js");
        if (targetAgentRow?.spacesAppToken && targetAgentRow.spacesAppId && chanId && convId) {
          const appToken = decrypt(
            ...(targetAgentRow.spacesAppToken.split(":") as [string, string, string]),
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
            agentId: targetAgentRow.id,
            agentOrgId: targetAgentRow.orgId ?? null,
            agentSlug: targetAgent,
            responseMode: "conversation",
            appToken,
            spacesAppId: targetAgentRow.spacesAppId,
            spacesAppUserId: targetAgentRow.spacesAppUserId ?? "",
          });
        }

        log.info(`[mcp/trigger-agent] Triggered ${targetAgent} → session ${runBody.sessionId}`);
        res.json({
          success: true,
          data: { content: `Triggered ${targetAgent}. Session: ${runBody.sessionId}` },
        });
      } catch (err) {
        log.error("[mcp/trigger-agent] error:", err);
        res.json({
          success: true,
          data: {
            content: `Failed to trigger ${targetAgent}: ${err instanceof Error ? err.message : "unknown"}`,
          },
        });
      }
      return;
    }

    // Bitbucket goes through a per-user throttle + 429 backoff + real-status
    // wrapper. The upstream MCP server reports rate-limits (429) as the
    // misleading "Permission denied", so a burst of PR/diff calls looks like an
    // access failure. The wrapper caps per-token concurrency to avoid tripping
    // the limit, and on error surfaces the true HTTP status (429 vs 403).
    const callStartedAt = Date.now();
    const upstreamResult =
      serverType === "bitbucket"
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
      if (citation) {
        result = {
          ...upstreamResult,
          content: prefixChunk(1, upstreamResult.content),
          citations: [...(upstreamResult.citations ?? []), citation],
        };
      }
    }

    // Upstream bitbucket-mcp-server tools (get_pull_request, get_branch, …) run
    // through callBitbucketThrottled, not the local switch above, so they carry
    // no citation by default. Same pattern as the Grafana block above.
    if (serverType === "bitbucket") {
      const bbBaseUrl = ((credentials["baseUrl"] as string) || "https://bitbucket.juspay.net").replace(
        /\/+$/,
        "",
      );
      const citation = buildUpstreamBitbucketCitation(bbBaseUrl, tool, effectiveParams);
      if (citation) {
        result = {
          ...upstreamResult,
          content: prefixChunk(1, upstreamResult.content),
          citations: [...(upstreamResult.citations ?? []), citation],
        };
      }
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
    const msg = errMsg(err);
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
    res
      .status(500)
      .json({ success: false, error: err instanceof Error ? err.message : "Internal server error" });
  }
});

router.post("/:sessionId/actions/sign", async (req: Request<{ sessionId: string }>, res: Response) => {
  try {
    const userId = req.session!.userId;
    const agentSlug = req.session?.agentSlug;
    const spacesAppId = req.session?.spacesAppId;
    const sessionAgentOrgId = await resolveSessionAgentOrgId(userId, spacesAppId);
    const body = req.body as {
      pendingAction?: {
        serverType?: string;
        tool?: string;
        params?: Record<string, unknown>;
        userId?: string;
        signature?: string;
      };
      // Initial-signing shape (2026-07-15): claw's custom-tool write wrapper
      // (custom-tools.ts signWriteAction) sends the bare action — it CANNOT
      // pre-sign because the HMAC key lives only here. The session token +
      // S2S key on this route already authenticate the caller as the run
      // itself, which is exactly the authority the /mcp/call path uses when
      // it mints signatures for MCP-server write tools inline. Without this
      // branch, claw-side custom write tools (create-skill was the first)
      // 400'd with "pendingAction is required" — the signed-pendingAction
      // shape below only served re-sign/param-edit flows.
      serverType?: string;
      tool?: string;
      params?: Record<string, unknown>;
    };

    let serverType: string | undefined;
    let tool: string | undefined;
    let actionParams: Record<string, unknown>;

    if (body.pendingAction && typeof body.pendingAction === "object") {
      // Re-sign shape: verify the existing signature before re-issuing.
      const { serverType: st, tool: t, params, userId: pendingUserId, signature } = body.pendingAction;
      if (!st || !t || !pendingUserId || !signature) {
        res
          .status(400)
          .json({ success: false, error: "pendingAction must include serverType, tool, userId, signature" });
        return;
      }
      if (pendingUserId !== userId) {
        res.status(403).json({ success: false, error: "pendingAction user does not match session user" });
        return;
      }
      actionParams = params ?? {};
      const action = { serverType: st, tool: t, params: actionParams, userId: pendingUserId };
      if (!verifyActionSignature(action, signature)) {
        res.status(400).json({ success: false, error: "Invalid pendingAction signature" });
        return;
      }
      serverType = st;
      tool = t;
    } else if (typeof body.serverType === "string" && typeof body.tool === "string") {
      // Initial-signing shape from the run itself (see note above).
      serverType = body.serverType;
      tool = body.tool;
      actionParams = (body.params && typeof body.params === "object" ? body.params : {}) as Record<
        string,
        unknown
      >;
    } else {
      res.status(400).json({ success: false, error: "pendingAction is required" });
      return;
    }

    // PERMISSIVE (log-only) mode — same reason as the /mcp/tools listing
    // filter above: the agent-config matcher's tool-name matching disagrees
    // with real configs and was denying legitimate calls platform-wide
    // (2026-07-06). Log would-deny for matcher tuning; do not block until the
    // matcher provably agrees with the runtime's own filter.
    const allowedForAgent = await isToolAllowedForSessionAgent(
      agentSlug,
      spacesAppId,
      sessionAgentOrgId,
      userId,
      serverType,
      tool,
    );
    if (!allowedForAgent) {
      log.warn(
        `[mcp/call] would-deny by agent config (permissive mode): agent=${agentSlug ?? spacesAppId ?? "?"} server=${serverType} tool=${tool}`,
      );
    }

    // Revalidate gateway actions before issuing a signature.
    const gatewayTarget = parseGatewayServerType(serverType);
    if (gatewayTarget) {
      if (!agentSlug && !spacesAppId) {
        res.status(401).json({ success: false, error: "No agent session" });
        return;
      }

      const agent = spacesAppId
        ? await prisma.agent.findUnique({ where: { spacesAppId }, select: { config: true } })
        : agentSlug && sessionAgentOrgId
          ? await prisma.agent.findUnique({
              where: { orgId_slug: { orgId: sessionAgentOrgId, slug: agentSlug } },
              select: { config: true },
            })
          : null;
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
        res
          .status(404)
          .json({ success: false, error: `Gateway tool not found: ${gatewayTarget.serviceName}/${tool}` });
        return;
      }
      if (!requiresGatewayToolApproval(descriptor)) {
        res
          .status(400)
          .json({ success: false, error: "Only approval-required gateway actions can be signed" });
        return;
      }
    } else {
      // Custom in-claw write tools (source `custom:<serverType>` in the
      // shared registry, e.g. create-skill → serverType "skill") have no
      // connector definition or credentials — validate against the registry
      // instead: the tool must exist under that source AND be a write tool.
      // Their execution side is a dedicated flow-action branch (e.g.
      // serverType==="skill"), not the MCP runner.
      const { getAllCustomTools } = await import("xyne-claw-shared");
      const customWriteTool = getAllCustomTools().find(
        (ct) => ct.source === `custom:${serverType}` && ct.slug === tool && ct.isWriteTool === true,
      );
      if (customWriteTool) {
        // Registry match is the validation; fall through to signing.
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

      const effective = await loadEffectiveCredentialsWithSpacesFallback(
        userId,
        serverType,
        agentSlug,
        sessionAgentOrgId,
        req.params.sessionId,
      );
      const credentials = effective?.credentials;
      if (!credentials) {
        res.status(404).json({ success: false, error: `No connection found for user and server type: ${serverType}` });
        return;
      }

        const validationError = await validateWriteAction(serverType, tool, actionParams, {
          ...credentials,
          userId,
        });
        if (validationError) {
          res.status(400).json({ success: false, error: validationError });
          return;
        }
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
