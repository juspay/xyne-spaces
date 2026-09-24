import { prisma } from "./db.js";
import { listToolsForUser } from "./mcp/runner.js";
import { removeToolFromIndexBestEffort, syncToolsToIndexBestEffort } from "./services/tool-index/index.js";
import { GITHUB_CUSTOM_TOOLS } from "./mcp/adapters/github.js";
import { GITHUB_INSIGHTS_TOOLS } from "./mcp/adapters/github-insights.js";
import type { McpToolInfo } from "./mcp/types.js";
import type { Prisma } from "@prisma/client";

import { createLogger } from "./logger.js";
const log = createLogger("tool-sync");

/**
 * Tools claw-auth serves ITSELF for a connector.
 *
 * They are injected into the live /mcp/tools listing (routes/mcp.ts,
 * CUSTOM_TOOL_INJECTIONS) so agents can call them, but the upstream MCP server
 * knows nothing about them — which means `listToolsForUser` never returns
 * them and the catalog drifts from what the agent can actually call. The
 * visible symptom is a tool that works at runtime yet can never be granted in
 * the agent-config picker (and any row seeded by hand gets pruned by the
 * reconcile below).
 *
 * Scoped to github on purpose: the other connectors' custom tools have the
 * same gap, but widening their pickers is a product decision, not a sync fix.
 */
function locallyServedTools(serverType: string): McpToolInfo[] {
  return serverType === "github" ? [...GITHUB_CUSTOM_TOOLS, ...GITHUB_INSIGHTS_TOOLS] : [];
}

/** Live upstream tools plus the locally-served ones, deduped by name. */
function withLocallyServedTools(serverType: string, tools: McpToolInfo[]): McpToolInfo[] {
  const have = new Set(tools.map((t) => t.name));
  return [...tools, ...locallyServedTools(serverType).filter((t) => !have.has(t.name))];
}

export async function syncToolsForServer(
  userId: string,
  serverType: string,
  serverName: string,
  credentials: Record<string, unknown>,
): Promise<number> {
  const result = await listToolsForUser(userId, serverType, serverName, credentials);
  const synced: string[] = [];

  for (const tool of withLocallyServedTools(serverType, result.tools)) {
    const slug = `${serverType}__${tool.name}`;
    synced.push(slug);
    await prisma.tool.upsert({
      where: { slug },
      create: {
        slug,
        name: tool.name,
        description: tool.description,
        source: `mcp:${serverType}`,
        inputSchema: tool.inputSchema as Prisma.InputJsonValue,
      },
      update: {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as Prisma.InputJsonValue,
      },
    });
  }

  // Batched once per server, not per tool — the index lists the bank once per
  // call. Best-effort: Postgres is the record, the bank is a derived view.
  syncToolsToIndexBestEffort(synced);

  log.info(`[tool-sync] Registered ${synced.length} tools from ${serverType}`);
  return synced.length;
}

// Per-(user,server) debounce so repeated picker opens don't re-list (= re-spawn)
// the MCP server every time. In-memory: resets on restart, which is fine — the
// first picker open after a deploy re-reconciles, which is exactly what we want.
const RECONCILE_DEBOUNCE_MS = Number(process.env["MCP_CATALOG_RECONCILE_DEBOUNCE_MS"] ?? 60_000);
const lastReconcileAt = new Map<string, number>();

/**
 * Reconcile the tool CATALOG (`tool` table) for one server against its LIVE
 * tools — upsert what the server currently exposes AND prune catalog rows it no
 * longer does. Called when the agent-config picker is opened (the only consumer
 * of the catalog; the runtime uses the live /mcp/tools list directly), so the UI
 * never drifts from what the agent can actually call. Best-effort, debounced.
 */
export async function reconcileServerCatalog(
  userId: string,
  serverType: string,
  serverName: string,
  credentials: Record<string, unknown>,
): Promise<void> {
  const key = `${userId}:${serverType}`;
  if (Date.now() - (lastReconcileAt.get(key) ?? 0) < RECONCILE_DEBOUNCE_MS) return;

  const result = await listToolsForUser(userId, serverType, serverName, credentials);

  // Guard: an empty live list almost always means a transient list failure
  // (server down / token issue), NOT "the server has zero tools". Pruning to
  // empty would wipe the whole server's catalog on a glitch — so skip the
  // reconcile entirely and let the next picker open retry (no debounce stamp).
  if (result.tools.length === 0) {
    log.warn(`[tool-sync] reconcile ${serverType}: live list empty — skipping (transient?)`);
    return;
  }

  const liveSlugs: string[] = [];
  for (const tool of withLocallyServedTools(serverType, result.tools)) {
    const slug = `${serverType}__${tool.name}`;
    liveSlugs.push(slug);
    await prisma.tool.upsert({
      where: { slug },
      create: {
        slug,
        name: tool.name,
        description: tool.description,
        source: `mcp:${serverType}`,
        inputSchema: tool.inputSchema as Prisma.InputJsonValue,
      },
      update: {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as Prisma.InputJsonValue,
      },
    });
  }

  // Prune catalog rows for this server it no longer exposes. (AgentTool links
  // cascade-delete — correct: a removed server tool can't stay selected.)
  // Read slugs before deleteMany (it only returns a count) — the index needs
  // names, or a pruned tool stays searchable but resolves to nothing.
  const doomed = await prisma.tool.findMany({
    where: { source: `mcp:${serverType}`, slug: { notIn: liveSlugs } },
    select: { slug: true },
  });
  const pruned = await prisma.tool.deleteMany({
    where: { source: `mcp:${serverType}`, slug: { notIn: liveSlugs } },
  });
  syncToolsToIndexBestEffort(liveSlugs);
  for (const tool of doomed) removeToolFromIndexBestEffort(tool.slug);

  lastReconcileAt.set(key, Date.now());
  log.info(`[tool-sync] reconcile ${serverType}: ${liveSlugs.length} live, ${pruned.count} pruned`);
}
