import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { hasConnectorDefinition, resolveConnectorDefinition } from "../mcp/connector-definitions.js";
import { syncToolsForServer } from "../tool-sync.js";
import { requireClawAdmin } from "../middleware/agent-acl.js";

const router = Router();

type CustomSubagentRow = {
  name: string;
  description: string;
  progressLabels: unknown;
};

type CustomSubagentDelegate = {
  findMany: (args: { where: { enabled: boolean }; orderBy: { name: "asc" } }) => Promise<CustomSubagentRow[]>;
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

async function listCustomSubagentRows(): Promise<CustomSubagentRow[]> {
  const delegate = getCustomSubagentDelegate();
  if (!delegate) {
    // Backward-compat: older generated Prisma client (without subagentDefinition)
    // should not break /tools/available.
    console.warn("[tools] subagentDefinition delegate missing; returning builtin subagents only");
    return [];
  }
  try {
    return await delegate.findMany({
      where: { enabled: true },
      orderBy: { name: "asc" },
    });
  } catch (err) {
    if (isMissingTableError(err)) {
      // Backward-compat: DB not migrated with subagent_definitions table yet.
      console.warn("[tools] subagent_definitions table missing; returning builtin subagents only");
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
  kind: "mcp" | "builtin" | "custom";
  connected: boolean;
  readTools: IntegrationToolEntry[];
  writeTools: IntegrationToolEntry[];
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
export async function buildAvailableToolsCatalog(): Promise<AvailableToolsCatalog> {
  const { SUBAGENT_DEFINITIONS } = await import("xyne-claw-shared");

  // Get MCP servers (available integrations)
  const servers = await prisma.mcpServer.findMany({ orderBy: { name: "asc" } });

    // Get all tools grouped by source
    const tools = await prisma.tool.findMany({ orderBy: [{ source: "asc" }, { name: "asc" }] });

    // Subagents from shared definitions (built-ins) PLUS user-created
    // custom subagents from the subagent_definitions table. Both surfaces
    // need to appear in the agent edit page's subagent picker; the runtime
    // resolver decides which to hydrate per request.
    const customSubagentRows = await listCustomSubagentRows();
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

    // Custom tool sources (pgm, google, research-agent, etc.)
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
    // Ensure write tools from adapters are included even if not synced
    for (const server of servers) {
      const type = server.type;
      const definition = await resolveConnectorDefinition(type);
      const list = serverTools[type] ?? [];
      for (const toolName of definition?.writeTools ?? []) {
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
      });
    }

    // 2) Builtin sandbox tools (read/write/edit/grep/find/ls/bash). These
    //    aren't an MCP server but conceptually behave like an integration
    //    ("the agent's sandbox filesystem"), so we expose them as one card.
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
      });
    }

    // 3) Custom tool sources (custom:pgm, custom:google, ...). Each
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
      });
    }

    integrations.sort((a, b) => a.label.localeCompare(b.label));

    return { subagents, mcpServers: servers, writeTools, customGroups, serverTools, integrations };
}

// List available subagents, MCP servers, and direct tools for agent creation
router.get("/available", async (_req: Request, res: Response) => {
  try {
    const catalog = await buildAvailableToolsCatalog();
    res.json({ success: true, data: catalog });
  } catch (err) {
    console.error("[tools] available error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.get("/", async (_req: Request, res: Response) => {
  try {
    const tools = await prisma.tool.findMany({
      orderBy: [{ source: "asc" }, { name: "asc" }],
    });
    res.json({ success: true, data: tools });
  } catch (err) {
    console.error("[tools] list error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/sync", requireClawAdmin, async (_req: Request, res: Response) => {
  try {
    // Find all connections grouped by server type, pick one per type
    const connections = await prisma.userMcpConnection.findMany({
      include: { mcpServer: true },
      distinct: ["mcpServerId"],
    });

    let totalSynced = 0;
    const errors: string[] = [];

    for (const conn of connections) {
      if (!(await hasConnectorDefinition(conn.mcpServer.type))) continue;

      try {
        const decrypted = decrypt(conn.encryptedCreds, conn.iv, conn.authTag, CONFIG.encryptionKey);
        const credentials = JSON.parse(decrypted) as Record<string, unknown>;
        const count = await syncToolsForServer(conn.userId, conn.mcpServer.type, conn.mcpServer.name, credentials);
        totalSynced += count;
      } catch (err) {
        const msg = `${conn.mcpServer.type}: ${err instanceof Error ? err.message : String(err)}`;
        errors.push(msg);
        console.error(`[tools/sync] ${msg}`);
      }
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

    // Sync custom tools from shared registry (pgm, google, research-agent, etc.)
    const { getAllCustomTools } = await import("xyne-claw-shared");
    const customTools = getAllCustomTools();
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

    res.json({ success: true, data: { synced: totalSynced, errors } });
  } catch (err) {
    console.error("[tools/sync] error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export { router as toolsRouter };
