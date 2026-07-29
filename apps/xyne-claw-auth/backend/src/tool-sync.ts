import { prisma } from "./db.js";
import { listToolsForUser } from "./mcp/runner.js";
import type { Prisma } from "@prisma/client";

import { createLogger } from "./logger.js";
const log = createLogger("tool-sync");

export async function syncToolsForServer(
  userId: string,
  serverType: string,
  serverName: string,
  credentials: Record<string, unknown>,
): Promise<number> {
  const result = await listToolsForUser(userId, serverType, serverName, credentials);
  let count = 0;

  for (const tool of result.tools) {
    const slug = `${serverType}__${tool.name}`;
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
    count++;
  }

  log.info(`[tool-sync] Registered ${count} tools from ${serverType}`);
  return count;
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
  for (const tool of result.tools) {
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
  const pruned = await prisma.tool.deleteMany({
    where: { source: `mcp:${serverType}`, slug: { notIn: liveSlugs } },
  });

  lastReconcileAt.set(key, Date.now());
  log.info(`[tool-sync] reconcile ${serverType}: ${liveSlugs.length} live, ${pruned.count} pruned`);
}
