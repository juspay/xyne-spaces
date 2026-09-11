import { Router, type Request, type Response } from "express";
import { errMsg } from "../lib/errors.js";
import { asyncHandler, ok, badRequest } from "../lib/http.js";
import { prisma } from "../db.js";
import { decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { hasConnectorDefinition, resolveConnectorDefinition } from "../mcp/connector-definitions.js";
import { syncToolsForServer, reconcileServerCatalog } from "../tool-sync.js";
import { requireClawAdmin, getRequesterId, getOrgId } from "../middleware/agent-acl.js";
import { SKIP_CATALOG_SOURCES } from "../catalog-skip.js";

import { createLogger } from "../logger.js";
import { gatewayCatalogSource, gatewayToolSelectionKey } from "../mcpgateway/key-format.js";
import { requiresGatewayToolApproval } from "../mcpgateway/tool-approval.js";
const log = createLogger("tools");

const router = Router();
const DEFAULT_GATEWAY_TENANT = process.env.ALLOWED_TENANTS
  ?.split(",")
  .map((tenant) => tenant.trim())
  .find((tenant) => tenant.length > 0);

type CustomSubagentRow = {
  name: string;
  description: string;
  progressLabels: unknown;
};

type CustomSubagentDelegate = {
  findMany: (args: { where: { enabled: boolean; orgId: string }; orderBy: { name: "asc" } }) => Promise<CustomSubagentRow[]>;
};

function getCustomSubagentDelegate(): CustomSubagentDelegate | undefined {
  const delegate = (prisma as unknown as { subagentDefinition?: CustomSubagentDelegate }).subagentDefinition;
  return delegate;
}

function isMissingTableError(err: unknown): boolean {
  return typeof err === "object"
    && err !== null
    && "code" in err
    && (err as { code?: string }).code === "P2021";
}

async function listCustomSubagentRows(orgId: string): Promise<CustomSubagentRow[]> {
  const delegate = getCustomSubagentDelegate();
  if (!delegate) {
    // Backward-compat: older generated Prisma client (without subagentDefinition)
    // should not break /tools/available.
    log.warn("[tools] subagentDefinition delegate missing; returning builtin subagents only");
    return [];
  }
  try {
    return await delegate.findMany({
      where: { orgId, enabled: true },
      orderBy: { name: "asc" },
    });
  } catch (err) {
    if (isMissingTableError(err)) {
      // Backward-compat: DB not migrated with subagent_definitions table yet.
      log.warn("[tools] subagent_definitions table missing; returning builtin subagents only");
      return [];
    }
    throw err;
  }
}

// Classify a tool's risk level from its name. Used for visual badges (read =
// green, write = yellow, destructive = red) and as a safety hint to the
// "suggest-tools" LLM so it biases toward read unless intent demands writes.
const DESTRUCTIVE_PATTERNS = [
  "delete", "remove", "drop", "destroy", "purge",
  "revoke", "terminate", "uninstall", "trash",
  "decline", "cancel",
];

function classifyRisk(toolName: string, isWrite: boolean): "read" | "write" | "destructive" {
  const lower = toolName.toLowerCase();
  if (DESTRUCTIVE_PATTERNS.some((p) => lower.includes(p))) return "destructive";
  return isWrite ? "write" : "read";
}

// Pretty integration label: prefer the server.name from the DB (already a
// human name like "Slack"), fall back to capitalising the slug.
function humanise(slug: string): string {
  return slug
    .replace(/^(mcp:|custom:)/, "")
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export type IntegrationToolEntry = {
  slug: string;
  name: string;
  description: string;
  riskLevel: "read" | "write" | "destructive";
};

export type Integration = {
  slug: string;
  label: string;
  kind: "mcp" | "builtin" | "custom" | "gateway";
  connected: boolean;
  /** Populated only for kind=="gateway". Lists every backendId registered under this serviceName. */
  backendIds?: string[];
  readTools: IntegrationToolEntry[];
  writeTools: IntegrationToolEntry[];
  /** How many agents currently select tools from this integration — powers the
   *  "most used by other agents" ordering in the picker. */
  usageCount: number;
};

export type AvailableToolsCatalog = {
  subagents: Array<{
    name: string;
    description: string;
    serverType: string;
    progressLabel: string;
    progressLabels: string[];
    source: "builtin" | "custom";
  }>;
  mcpServers: Awaited<ReturnType<typeof prisma.mcpServer.findMany>>;
  writeTools: Array<{ name: string; source: string }>;
  customGroups: Array<{ source: string; tools: Array<{ slug: string; name: string }> }>;
  serverTools: Record<string, Array<{ slug: string; name: string }>>;
  integrations: Integration[];
};

// Single source of truth for the agent-config catalog. Used by /available
// (which returns it as-is) and by /agents/suggest-tools (which feeds a
// compressed form to the LLM). Don't fork — keep both surfaces in sync.
type GatewayToolDescriptor = {
  name: string;
  description: string;
  method?: string;
  requiresApproval?: boolean;
  isWriteTool?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseGatewayTools(rawTools: unknown): GatewayToolDescriptor[] {
  if (!Array.isArray(rawTools)) return [];
  const parsed: GatewayToolDescriptor[] = [];
  for (const entry of rawTools) {
    if (!isRecord(entry) || typeof entry.name !== "string") continue;
    parsed.push({
      name: entry.name,
      description: typeof entry.description === "string" ? entry.description : "",
      ...(typeof entry.method === "string" ? { method: entry.method.toUpperCase() } : {}),
      ...(typeof entry.requiresApproval === "boolean" ? { requiresApproval: entry.requiresApproval } : {}),
      ...(typeof entry.isWriteTool === "boolean" ? { isWriteTool: entry.isWriteTool } : {}),
    });
  }
  return parsed;
}

function gatewayDisplayLabel(serviceName: string, backendId: string): string {
  return `${humanise(serviceName)} (${backendId})`;
}

export async function buildAvailableToolsCatalog(tenantUniqueId: string | undefined, orgId: string): Promise<AvailableToolsCatalog> {
  const gatewayTenant = tenantUniqueId ?? DEFAULT_GATEWAY_TENANT;
  const { SUBAGENT_DEFINITIONS } = await import("xyne-claw-shared");

  // Get MCP servers (available integrations)
  const servers = await prisma.mcpServer.findMany({ orderBy: { name: "asc" } });

    // Filter builtin sandbox tools whose UI toggle has no runtime effect — so
    // they never appear in v1's `serverTools`/`writeTools` arrays or v3's
    // `integrations` cards. Two classes are hidden:
    //   (a) ALWAYS_ON — the five builtins always enabled by pi-coding-agent's
    //       hard-coded allowlist (xyne-claw/src/agent.ts:911 →
    //       ["read","write","grep","find","ls"]). Toggling them off in the
    //       UI doesn't disable them at runtime.
    //   (b) ALWAYS_OFF — `bash` is explicitly EXCLUDED from that allowlist
    //       (see security comment at agent.ts:899-901), and `edit` is never
    //       registered as either a pi builtin or a customTool — so neither
    //       is ever exposed to the model. Toggling them on does nothing.
    // If we later wire `bash` or `edit` through (allowlist change or new
    // custom tool), remove the corresponding name(s) and the card will
    // reappear automatically.
    const RUNTIME_NOOP_BUILTINS = new Set([
      "read", "write", "grep", "find", "ls", // always-on at runtime
      "bash", "edit",                          // never callable from runtime
    ]);

    // Get all tools grouped by source
    const tools = (await prisma.tool.findMany({ orderBy: [{ source: "asc" }, { name: "asc" }] }))
      .filter((t) => !(t.source === "builtin" && RUNTIME_NOOP_BUILTINS.has(t.name)));

    // Subagents from shared definitions (built-ins) PLUS user-created
    // custom subagents from the subagent_definitions table. Both surfaces
    // need to appear in the agent edit page's subagent picker; the runtime
    // resolver decides which to hydrate per request.
    const customSubagentRows = await listCustomSubagentRows(orgId);
    const subagents = [
      ...SUBAGENT_DEFINITIONS.map((d) => ({
        name: d.name,
        description: d.description,
        serverType: d.serverType,
        progressLabel: d.progressLabels[0] ?? "",
        progressLabels: d.progressLabels,
        source: "builtin" as const,
      })),
      ...customSubagentRows.map((r) => {
        const labels = Array.isArray(r.progressLabels) ? (r.progressLabels as string[]) : [];
        return {
          name: r.name,
          description: r.description,
          serverType: `custom-defined:${r.name}`,
          progressLabel: labels[0] ?? "",
          progressLabels: labels,
          source: "custom" as const,
        };
      }),
    ];

    // Direct tools = tools marked as write tools in adapters
    const writeTools: Array<{ name: string; source: string }> = [];
    // Per-server write-tool sets for quick lookup when classifying risk and
    // building integration cards below.
    const writeToolsByType = new Map<string, Set<string>>();
    for (const server of servers) {
      const definition = await resolveConnectorDefinition(server.type);
      const set = new Set<string>();
      for (const toolName of definition?.writeTools ?? []) {
        writeTools.push({ name: toolName, source: server.type });
        set.add(toolName);
      }
      writeToolsByType.set(server.type, set);
    }

    // Custom tool sources (google, research-agent, sandbox, etc.)
    const customSources = [...new Set(tools.filter((t) => t.source.startsWith("custom:")).map((t) => t.source))];
    const customGroups = customSources.map((source) => ({
      source,
      tools: tools.filter((t) => t.source === source).map((t) => ({ slug: t.slug, name: t.name })),
    }));

    // Group all tools by MCP server type (for subagent:tool cascading selector)
    const serverTools: Record<string, Array<{ slug: string; name: string }>> = {};
    // From DB (synced tools) — strip "mcp:" prefix to match subagent serverType
    for (const tool of tools) {
      if (tool.source.startsWith("custom:")) continue;
      const key = tool.source.startsWith("mcp:") ? tool.source.slice(4) : tool.source;
      const list = serverTools[key] ?? [];
      if (!list.some((t) => t.name === tool.name)) list.push({ slug: tool.slug, name: tool.name });
      serverTools[key] = list;
    }
    // Ensure write tools AND adapter-declared static tools are included even
    // if the `tools` table has not been synced yet. staticTools is for tools
    // that should appear in the picker without needing a per-user connection
    // (e.g. bot-token servers where credentialFields=[] and sync only fires
    // at user-creation time). writeTools doubles as a fallback for HITL-gated
    // tools — see types.ts comments.
    for (const server of servers) {
      const type = server.type;
      const definition = await resolveConnectorDefinition(type);
      const list = serverTools[type] ?? [];
      for (const toolName of [...(definition?.writeTools ?? []), ...(definition?.staticTools ?? [])]) {
        if (!list.some((t) => t.name === toolName)) list.push({ slug: toolName, name: toolName });
      }
      serverTools[type] = list;
    }
    // Include custom tool groups
    for (const group of customSources) {
      const groupTools = tools.filter((t) => t.source === group).map((t) => ({ slug: t.slug, name: t.name }));
      if (groupTools.length > 0) serverTools[group] = groupTools;
    }

    // ── Integration view ─────────────────────────────────────────────
    // Single per-integration card structure for the new V3 Toolbox UI.
    // Each entry rolls up everything a user needs to make a decision
    // without leaving the card: display name, connection state, and the
    // read/write/destructive tool lists with descriptions.
    const descriptionByName = new Map<string, string>();
    for (const t of tools) {
      if (t.description) descriptionByName.set(t.name, t.description);
    }

    const integrations: Integration[] = [];
    const gatewayIntegrationSlugsByService = new Map<string, string[]>();

    // 1) MCP-backed integrations (Slack, Jira, Airtable, ...). One card
    //    per registered server type — connected status comes from whether
    //    the server row exists; per-user OAuth state lives elsewhere.
    for (const server of servers) {
      const type = server.type;
      const writeSet = writeToolsByType.get(type) ?? new Set<string>();
      const entries = (serverTools[type] ?? []).map((t) => {
        const isWrite = writeSet.has(t.name);
        return {
          slug: t.slug,
          name: t.name,
          description: descriptionByName.get(t.name) ?? "",
          riskLevel: classifyRisk(t.name, isWrite),
        } satisfies IntegrationToolEntry;
      });
      integrations.push({
        slug: type,
        label: server.name || humanise(type),
        kind: "mcp",
        connected: true,
        readTools: entries.filter((e) => e.riskLevel === "read"),
        writeTools: entries.filter((e) => e.riskLevel !== "read"),
        usageCount: 0,
      });
    }

    // 2) Builtin sandbox tools. The `tools` array is already filtered up-front
    //    to exclude runtime-noop builtins (see RUNTIME_NOOP_BUILTINS above).
    //    Currently every builtin falls into that bucket — so this card never
    //    renders today. Kept here so that if a new pi-coding-agent builtin
    //    becomes runtime-callable in the future, it automatically appears.
    const builtinTools = tools.filter((t) => t.source === "builtin");
    if (builtinTools.length > 0) {
      const entries = builtinTools.map((t) => {
        const writeNames = new Set(["write", "edit", "bash"]);
        const isWrite = writeNames.has(t.name);
        return {
          slug: t.slug,
          name: t.name,
          description: t.description ?? "",
          riskLevel: classifyRisk(t.name, isWrite),
        } satisfies IntegrationToolEntry;
      });
      integrations.push({
        slug: "builtin",
        label: "Sandbox",
        kind: "builtin",
        connected: true,
        readTools: entries.filter((e) => e.riskLevel === "read"),
        writeTools: entries.filter((e) => e.riskLevel !== "read"),
        usageCount: 0,
      });
    }

    // 3) Custom tool sources (custom:sandbox, custom:google, ...). Each
    //    source becomes its own card so users can opt-in by capability
    //    rather than by individual tool.
    for (const source of customSources) {
      const groupTools = tools.filter((t) => t.source === source);
      const entries = groupTools.map((t) => ({
        slug: t.slug,
        name: t.name,
        description: t.description ?? "",
        // Custom tool sources don't have a write/read split in the catalog
        // yet, so we infer purely from the name heuristic.
        riskLevel: classifyRisk(t.name, false),
      } satisfies IntegrationToolEntry));
      integrations.push({
        slug: source,
        label: humanise(source),
        kind: "custom",
        connected: true,
        readTools: entries.filter((e) => e.riskLevel === "read"),
        writeTools: entries.filter((e) => e.riskLevel !== "read"),
        usageCount: 0,
      });
    }

    // 4) MCP Gateway services (service_registry). These are tenant-scoped and
    // selectable like other integrations, but runtime execution is routed via
    // gateway instead of local MCP adapters.
    if (gatewayTenant) {
      let gatewayRows = await prisma.serviceRegistry.findMany({
        where: { tenantUniqueId: gatewayTenant },
        select: {
          serviceName: true,
          backendId: true,
          tools: true,
        },
        orderBy: [{ serviceName: "asc" }],
      });

      // Local-dev safety net: if the authenticated workspace tenant has no
      // gateway rows but a default tenant is configured, fall back so the UI
      // can still discover registered gateway tools.
      if (
        gatewayRows.length === 0
        && tenantUniqueId
        && DEFAULT_GATEWAY_TENANT
        && tenantUniqueId !== DEFAULT_GATEWAY_TENANT
        && process.env.NODE_ENV !== "production"
      ) {
        gatewayRows = await prisma.serviceRegistry.findMany({
          where: { tenantUniqueId: DEFAULT_GATEWAY_TENANT },
          select: {
            serviceName: true,
            backendId: true,
            tools: true,
          },
          orderBy: [{ serviceName: "asc" }],
        });
        if (gatewayRows.length > 0) {
          console.warn(
            `[tools] using default gateway tenant (${DEFAULT_GATEWAY_TENANT}) as fallback for workspace tenant ${tenantUniqueId}`,
          );
        }
      }

      for (const row of gatewayRows) {
        const source = gatewayCatalogSource(row.serviceName, row.backendId);
        const slugsForService = gatewayIntegrationSlugsByService.get(row.serviceName) ?? [];
        slugsForService.push(source);
        gatewayIntegrationSlugsByService.set(row.serviceName, slugsForService);
        const seenTools = new Set<string>();
        const serviceTools = parseGatewayTools(row.tools).filter((tool) => {
          if (seenTools.has(tool.name)) return false;
          seenTools.add(tool.name);
          return true;
        });
        const entries = serviceTools.map((tool) => ({
          slug: gatewayToolSelectionKey(row.serviceName, row.backendId, tool.name),
          name: tool.name,
          description: tool.description,
          riskLevel: classifyRisk(tool.name, requiresGatewayToolApproval(tool)),
        } satisfies IntegrationToolEntry));

        if (entries.length === 0) continue;

        serverTools[source] = entries.map((entry) => ({
          slug: entry.slug,
          name: entry.name,
        }));

        integrations.push({
          slug: source,
          label: gatewayDisplayLabel(row.serviceName, row.backendId),
          kind: "gateway",
          backendIds: [row.backendId],
          connected: true,
          usageCount: 0,
          readTools: entries.filter((e) => e.riskLevel === "read"),
          writeTools: entries.filter((e) => e.riskLevel !== "read"),
        });
      }
    }

    // Popularity: how many agents currently reference each integration, so the
    // picker can surface "most used by other agents" first. An agent references
    // an integration if its config.tools picks any of that integration's tool
    // slugs (custom[]/direct[]) or names the integration as a subagent.
    const slugToIntegration = new Map<string, string>();
    for (const integ of integrations) {
      for (const e of [...integ.readTools, ...integ.writeTools]) slugToIntegration.set(e.slug, integ.slug);
    }
    const subagentToIntegration = new Map<string, string>();
    for (const sa of subagents) subagentToIntegration.set(sa.name, sa.serverType);

    const usage = new Map<string, number>();
    const agentConfigs = await prisma.agent.findMany({ where: { orgId }, select: { config: true } });
    for (const a of agentConfigs) {
      const t = (a.config as { tools?: { custom?: string[]; direct?: string[]; subagents?: string[]; gateway?: string[] } } | null)?.tools;
      if (!t) continue;
      const refs = new Set<string>();
      for (const s of [...(t.custom ?? []), ...(t.direct ?? [])]) {
        const ig = slugToIntegration.get(s);
        if (ig) refs.add(ig);
      }
      for (const s of t.subagents ?? []) {
        const ig = subagentToIntegration.get(s);
        if (ig) refs.add(ig);
      }
      for (const s of t.gateway ?? []) {
        const gatewaySlugs = gatewayIntegrationSlugsByService.get(s);
        if (gatewaySlugs) {
          for (const slug of gatewaySlugs) refs.add(slug);
        } else {
          refs.add(s);
        }
      }
      for (const ig of refs) usage.set(ig, (usage.get(ig) ?? 0) + 1);
    }
    for (const integ of integrations) integ.usageCount = usage.get(integ.slug) ?? 0;
    integrations.sort((a, b) => b.usageCount - a.usageCount || a.label.localeCompare(b.label));

    return { subagents, mcpServers: servers, writeTools, customGroups, serverTools, integrations };
}

// List available subagents, MCP servers, and direct tools for agent creation
router.get("/available", asyncHandler(async (req: Request, res: Response) => {
  // Reconcile the catalog from the LIVE tool lists of the requester's
  // connected MCP servers BEFORE building the response, so the picker never
  // drifts from what the agent can actually call (server-side tool changes,
  // new connectors). The catalog is only consumed here — the runtime uses the
  // live /mcp/tools list — so this is the single point that needs to be fresh.
  // Best-effort + bounded: per-server timeout, debounced in reconcileServerCatalog,
  // failures ignored (we still serve the current catalog).
  const userId = getRequesterId(req);
  const orgId = getOrgId(req)
    ?? (userId
      ? (await prisma.user.findUnique({ where: { id: userId }, select: { orgId: true } }))?.orgId
      : undefined);
  if (!orgId) {
    log.error(`[tools/available] orgId is required; refusing global tools catalog userId=${userId ?? "none"}`);
    throw badRequest("orgId is required");
  }
  if (userId) {
    const connections = await prisma.userMcpConnection.findMany({
      where: { userId },
      include: { mcpServer: true },
      distinct: ["mcpServerId"],
    });
    const RECONCILE_TIMEOUT_MS = 8_000;
    await Promise.allSettled(
      connections.map(async (conn) => {
        if (!(await hasConnectorDefinition(conn.mcpServer.type))) return;
        const credentials = JSON.parse(
          decrypt(conn.encryptedCreds, conn.iv, conn.authTag, CONFIG.encryptionKey),
        ) as Record<string, unknown>;
        await Promise.race([
          reconcileServerCatalog(userId, conn.mcpServer.type, conn.mcpServer.name, credentials),
          new Promise((resolve) => setTimeout(resolve, RECONCILE_TIMEOUT_MS)),
        ]);
      }),
    );
  }

  const tenantUniqueId = (req as Request & { user?: { workspaceId?: string } }).user?.workspaceId;
  const catalog = await buildAvailableToolsCatalog(tenantUniqueId, orgId);
  ok(res, catalog);
}));

router.get("/", asyncHandler(async (_req: Request, res: Response) => {
  const tools = await prisma.tool.findMany({
    orderBy: [{ source: "asc" }, { name: "asc" }],
  });
  ok(res, tools);
}));

router.post("/sync", requireClawAdmin, asyncHandler(async (req: Request, res: Response) => {
  // Optional filter: sync only specific MCP server(s) instead of the full
  // sweep (the full sweep spawns every connected server for every user and
  // routinely exceeds the nginx upstream timeout → 504). Accept names/types
  // from body { serverTypes: [...] } / { serverType: "google" } or query
  // ?types=google,microsoft / ?type=google. Matched (case-insensitively)
  // against the server's `type` OR display `name`, so either works.
  const body = (req.body ?? {}) as { serverType?: unknown; serverTypes?: unknown };
  const rawFilter = [
    ...(Array.isArray(body.serverTypes) ? body.serverTypes : []),
    ...(body.serverType != null ? [body.serverType] : []),
    ...(typeof req.query["types"] === "string" ? req.query["types"].split(",") : []),
    ...(typeof req.query["type"] === "string" ? [req.query["type"]] : []),
  ]
    .map((s) => String(s).trim().toLowerCase())
    .filter(Boolean);
  const filter = rawFilter.length > 0 ? new Set(rawFilter) : null;

  // Find all connections grouped by server type, pick one per type
  const connections = await prisma.userMcpConnection.findMany({
    include: { mcpServer: true },
    distinct: ["mcpServerId"],
  });

  let totalSynced = 0;
  const errors: string[] = [];
  const syncedServers: string[] = [];

  for (const conn of connections) {
    if (!(await hasConnectorDefinition(conn.mcpServer.type))) continue;
    // Targeted sync: skip servers that don't match the requested type/name.
    if (
      filter &&
      !filter.has(conn.mcpServer.type.toLowerCase()) &&
      !filter.has((conn.mcpServer.name ?? "").toLowerCase())
    ) {
      continue;
    }

    try {
      const decrypted = decrypt(conn.encryptedCreds, conn.iv, conn.authTag, CONFIG.encryptionKey);
      const credentials = JSON.parse(decrypted) as Record<string, unknown>;
      const count = await syncToolsForServer(conn.userId, conn.mcpServer.type, conn.mcpServer.name, credentials);
      totalSynced += count;
      syncedServers.push(conn.mcpServer.type);
    } catch (err) {
      const msg = `${conn.mcpServer.type}: ${errMsg(err)}`;
      errors.push(msg);
      log.error(`[tools/sync] ${msg}`);
    }
  }

  // A targeted sync only touches the requested MCP server(s). The builtin +
  // shared-registry upserts below are GLOBAL housekeeping (re-seed every
  // custom tool), irrelevant to one server and slow — only run on a full sweep.
  if (filter) {
    const noMatch = syncedServers.length === 0 && errors.length === 0;
    ok(res, {
      synced: totalSynced,
      servers: syncedServers,
      errors,
      requested: [...filter],
      ...(noMatch ? { note: "no connected MCP server matched the requested name(s)" } : {}),
    });
    return;
  }

  // Also ensure builtin tools exist
  const builtins = [
    { slug: "builtin__bash", name: "bash", description: "Execute shell commands", source: "builtin" },
    { slug: "builtin__read", name: "read", description: "Read files", source: "builtin" },
    { slug: "builtin__write", name: "write", description: "Write files", source: "builtin" },
    { slug: "builtin__edit", name: "edit", description: "Edit files", source: "builtin" },
    { slug: "builtin__grep", name: "grep", description: "Search file contents with regex", source: "builtin" },
    { slug: "builtin__find", name: "find", description: "Find files by pattern", source: "builtin" },
    { slug: "builtin__ls", name: "ls", description: "List directory contents", source: "builtin" },
  ];

  for (const b of builtins) {
    await prisma.tool.upsert({
      where: { slug: b.slug },
      create: b,
      update: { name: b.name, description: b.description },
    });
  }
  totalSynced += builtins.length;

  // Sync custom tools from shared registry (research-agent, sandbox, etc.).
  // SKIP_CATALOG_SOURCES (google/microsoft) are per-user OAuth MCP connectors,
  // NOT custom tools — upserting them here would resurrect the `custom:*` rows
  // the catalog-cleanup migration deletes (and the picker would list them under
  // "custom tools"). Same filter bootstrap-tools.ts uses; shared so they can't drift.
  const { getAllCustomTools } = await import("xyne-claw-shared");
  const customTools = getAllCustomTools().filter((ct) => !SKIP_CATALOG_SOURCES.has(ct.source));
  for (const ct of customTools) {
    await prisma.tool.upsert({
      where: { slug: ct.slug },
      create: {
        slug: ct.slug,
        name: ct.name,
        description: ct.description,
        source: ct.source,
        inputSchema: ct.inputSchema as unknown as import("@prisma/client").Prisma.InputJsonValue,
      },
      update: {
        name: ct.name,
        description: ct.description,
        source: ct.source,
        inputSchema: ct.inputSchema as unknown as import("@prisma/client").Prisma.InputJsonValue,
      },
    });
  }
  totalSynced += customTools.length;

  ok(res, { synced: totalSynced, servers: syncedServers, errors });
}));

export { router as toolsRouter };
