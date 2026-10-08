import type { MemoryRecord } from "xyne-claw-shared";
import { prisma } from "../../db.js";
import { createLogger } from "../../logger.js";
import { errMsg } from "../../lib/errors.js";
import { getAllCustomTools } from "xyne-claw-shared";
import { resolveConnectorDefinition } from "../../mcp/connector-definitions.js";
import { readHashTag } from "../agent-index/render.js";
import { listAllBankEntries } from "../agent-index/sync.js";
import { ensureToolIndexBank, memory, memoryEnabled } from "./bank.js";
import { integrationOf, readToolTag, renderToolBlob } from "./render.js";
import type { ToolBlob, ToolRow, ToolSyncOutcome } from "./types.js";

const log = createLogger("tool-index-sync");

const TOOL_SELECT = {
  slug: true,
  name: true,
  description: true,
  source: true,
  inputSchema: true,
  enabled: true,
  updatedAt: true,
} as const;

interface WriteLookup {
  /** MCP tools their connector declares as writes, keyed by server type. */
  byServerType: Map<string, Set<string>>;
  /** Custom tool slugs the shared registry flags as writes. Membership is the
   *  only signal — absence means "not flagged", never "confirmed read". */
  customWrites: Set<string>;
}

/**
 * Built once per sync pass, not per tool — `resolveConnectorDefinition` hits
 * the database and a rebuild touches every row.
 *
 * `isWriteTool` marks tools the runtime gates for approval; some real writes
 * (e.g. `sandbox-edit-file`, `create-app`) aren't flagged. Absence means "no
 * opinion", not "read" — callers fall back to a name heuristic that leans write.
 */
async function writeToolLookup(): Promise<WriteLookup> {
  const servers = await prisma.mcpServer.findMany({ select: { type: true } });
  const byServerType = new Map<string, Set<string>>();
  for (const server of servers) {
    const definition = await resolveConnectorDefinition(server.type).catch(() => undefined);
    byServerType.set(server.type, new Set(definition?.writeTools ?? []));
  }

  const customWrites = new Set(
    getAllCustomTools()
      .filter((ct) => (ct as { isWriteTool?: boolean }).isWriteTool === true)
      .map((ct) => ct.slug),
  );
  return { byServerType, customWrites };
}

/** True/false when a source of record has an opinion, undefined when none does —
 *  at which point `classifyToolRisk` falls back to the name, leaning write. */
function isWriteTool(tool: ToolRow, writes: WriteLookup): boolean | undefined {
  if (tool.source.startsWith("custom:")) return writes.customWrites.has(tool.slug) ? true : undefined;
  const set = writes.byServerType.get(integrationOf(tool.source)) ?? writes.byServerType.get(tool.source);
  return set ? set.has(tool.name) : undefined;
}

/** Tags stored per tool slug, so sync can tell what the bank already holds. */
function storedTags(entries: MemoryRecord[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of entries) {
    const slug = readToolTag(m.tags);
    if (slug) out.set(slug, m.tags ?? []);
  }
  return out;
}

/**
 * "Current" = content hash matches AND tags match as sets. The tag check is
 * not redundant: risk/enablement/integration live in tags, not the text, so
 * e.g. an `enabled:false` flip leaves the hash unchanged.
 */
function isCurrent(stored: string[] | undefined, blob: ToolBlob): boolean {
  if (!stored) return false;
  if (readHashTag(stored) !== blob.contentHash) return false;
  const desired = new Set(blob.tags);
  return stored.length === desired.size && stored.every((tag) => desired.has(tag));
}

/** Retires every entry for one tool. Retain appends, so this runs before a rewrite. */
async function sweepTool(bankId: string, entries: MemoryRecord[], slug: string): Promise<number> {
  const provider = memory();
  const doomed = entries.filter((m) => readToolTag(m.tags) === slug);
  for (const m of doomed) {
    await provider.deleteMemory(bankId, m.id).catch((e) =>
      log.warn(`[tool-index] sweep failed id=${m.id}: ${errMsg(e)}`),
    );
  }
  return doomed.length;
}

/**
 * Writes the given tools into the bank, skipping ones already current.
 * Lists the bank once for the whole batch rather than once per tool — hooks
 * sync a whole MCP server's worth of tools at a time.
 */
export async function syncToolsToIndex(slugs?: string[]): Promise<ToolSyncOutcome> {
  if (!memoryEnabled()) return { written: 0, skipped: 0, removed: 0, failed: 0 };

  const rows = (await prisma.tool.findMany({
    ...(slugs?.length ? { where: { slug: { in: slugs } } } : {}),
    select: TOOL_SELECT,
    orderBy: { slug: "asc" },
  })) as ToolRow[];
  if (rows.length === 0) return { written: 0, skipped: 0, removed: 0, failed: 0 };

  const bankId = await ensureToolIndexBank();
  const provider = memory();
  const entries = await listAllBankEntries(bankId);
  const existing = storedTags(entries);
  const writes = await writeToolLookup();

  const outcome: ToolSyncOutcome = { written: 0, skipped: 0, removed: 0, failed: 0 };
  for (const row of rows) {
    const blob = renderToolBlob(row, isWriteTool(row, writes));
    if (isCurrent(existing.get(row.slug), blob)) {
      outcome.skipped += 1;
      continue;
    }
    try {
      outcome.removed += await sweepTool(bankId, entries, row.slug);
      await provider.retain(
        bankId,
        [{ content: blob.content, tags: blob.tags, metadata: blob.metadata, timestamp: row.updatedAt.toISOString() }],
        { waitForIndex: true },
      );
      outcome.written += 1;
    } catch (e) {
      outcome.failed += 1;
      log.warn(`[tool-index] sync failed for ${row.slug}: ${errMsg(e)}`);
    }
  }

  if (outcome.written || outcome.failed) {
    log.info(
      `[tool-index] ${outcome.written} written, ${outcome.skipped} unchanged, ${outcome.removed} swept, ${outcome.failed} failed`,
    );
  }
  return outcome;
}

export async function removeToolFromIndex(slug: string): Promise<number> {
  if (!memoryEnabled()) return 0;
  const bankId = await ensureToolIndexBank();
  const provider = memory();
  if (provider.deleteByTag) return provider.deleteByTag(bankId, `tool:${slug}`);

  const entries = await listAllBankEntries(bankId);
  return sweepTool(bankId, entries, slug);
}

/**
 * Rebuilds the catalog, then drops entries for tools that no longer exist —
 * a stale entry would point the agent at a tool that resolves to nothing.
 */
export async function rebuildToolIndex(): Promise<ToolSyncOutcome & { purged: number }> {
  const outcome = await syncToolsToIndex();
  if (!memoryEnabled()) return { ...outcome, purged: 0 };

  const live = new Set((await prisma.tool.findMany({ select: { slug: true } })).map((t) => t.slug));
  const bankId = await ensureToolIndexBank();
  const stale = new Set(
    (await listAllBankEntries(bankId))
      .map((m) => readToolTag(m.tags))
      .filter((slug): slug is string => !!slug && !live.has(slug)),
  );
  for (const slug of stale) await removeToolFromIndex(slug);

  log.info(`[tool-index] rebuild: ${outcome.written} written, ${outcome.skipped} unchanged, ${stale.size} purged`);
  return { ...outcome, purged: stale.size };
}

/**
 * Fire-and-forget: the index is a derived view, so a memory-backend outage
 * must never fail the Postgres write that feeds it. Reconciled by the next
 * sync or a rebuild.
 */
export function syncToolsToIndexBestEffort(slugs?: string[]): void {
  void syncToolsToIndex(slugs).catch((e) => log.warn(`[tool-index] background sync failed: ${errMsg(e)}`));
}

export function removeToolFromIndexBestEffort(slug: string): void {
  void removeToolFromIndex(slug).catch((e) => log.warn(`[tool-index] background remove failed: ${errMsg(e)}`));
}
