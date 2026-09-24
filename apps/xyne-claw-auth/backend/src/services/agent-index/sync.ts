import type { MemoryRecord } from "xyne-claw-shared";
import { prisma } from "../../db.js";
import { createLogger } from "../../logger.js";
import { errMsg } from "../../lib/errors.js";
import { ensureAgentIndexBank, memory } from "./bank.js";
import { readAgentTag, readHashTag, readKindTag, renderAgentBlobs, type AgentRow } from "./render.js";
import type { IndexBlob, IndexKind, StoredBlob, SyncOutcome } from "./types.js";

const log = createLogger("agent-index-sync");

const AGENT_SELECT = {
  id: true,
  slug: true,
  name: true,
  description: true,
  scope: true,
  enabled: true,
  delegationTier: true,
  orgId: true,
  systemPrompt: true,
  activePromptVersion: true,
  updatedAt: true,
  config: true,
  skills: { select: { skill: { select: { slug: true, name: true, description: true } } } },
  tools: { select: { tool: { select: { slug: true, name: true } } } },
  collections: { select: { collectionId: true } },
} as const;

const PAGE = 500;

/**
 * Every entry in the org's bank, paged.
 *
 * Entry count is agents x kinds x chunks, not agents — a long system prompt is
 * several persona entries on its own — so a roster of a few hundred agents runs
 * well past any single page. Truncation here would be silent and corrupting
 * rather than loud: `isCurrent` would miss an entry that exists, `sweepKind`
 * would filter the same short list and delete nothing, and the rewrite would
 * stack a duplicate on every sync.
 */
export async function listAllBankEntries(bankId: string): Promise<MemoryRecord[]> {
  const provider = memory();
  const all: MemoryRecord[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { memories } = await provider.listMemories(bankId, { limit: PAGE, offset });
    all.push(...memories);
    if (memories.length < PAGE) return all;
  }
}

export async function listBankEntries(orgId: string): Promise<StoredBlob[]> {
  const bankId = await ensureAgentIndexBank(orgId);
  return (await listAllBankEntries(bankId)).map(toStoredBlob);
}

function toStoredBlob(m: MemoryRecord): StoredBlob {
  const kind = readKindTag(m.tags);
  return {
    id: m.id,
    kind: (kind as IndexKind) ?? "unknown",
    slug: readAgentTag(m.tags) ?? "",
    text: m.content,
    chars: m.content.length,
    tags: m.tags ?? [],
    chunkId: m.chunkId ?? null,
    indexedAt: m.createdAt ?? null,
    metadata: m.metadata ?? {},
  };
}

/** The tag set stored per kind for one agent. Tags carry everything that has to
 *  survive a list read — the content hash, the prompt version — so comparing
 *  them is how sync decides whether a stored entry still matches. */
function storedTags(entries: MemoryRecord[], slug: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of entries) {
    if (readAgentTag(m.tags) !== slug) continue;
    const kind = readKindTag(m.tags);
    if (kind) out.set(kind, m.tags ?? []);
  }
  return out;
}

/**
 * A stored entry is current when its content hash matches and it carries every
 * tag we would write now. The tag check matters because tags hold metadata that
 * is not part of the content — a prompt-version bump with identical text would
 * otherwise never be rewritten, and the UI would read a version that is absent.
 */
function isCurrent(stored: string[] | undefined, blob: IndexBlob): boolean {
  if (!stored) return false;
  if (readHashTag(stored) !== blob.contentHash) return false;
  // Set equality, not containment: a tag we no longer write is as much a drift
  // as one we newly write, and a leftover would keep reading back as truth.
  const desired = new Set(blob.tags);
  return stored.length === desired.size && stored.every((tag) => desired.has(tag));
}

/**
 * Sync one agent into the index.
 *
 * Retain appends — there is no upsert — so each changed kind is swept before it
 * is rewritten, or every save would stack another copy of the prompt. Unchanged
 * kinds are left alone: most config writes touch one field and re-embedding the
 * persona for each of them is pure waste.
 */
export async function syncAgentToIndex(agentId: string, orgId: string): Promise<SyncOutcome> {
  const row = await prisma.agent.findFirst({ where: { id: agentId, orgId }, select: AGENT_SELECT });
  if (!row) throw new Error(`agent ${agentId} not found in org ${orgId}`);

  const bankId = await ensureAgentIndexBank(orgId);
  const provider = memory();
  const blobs = renderAgentBlobs(row as AgentRow);

  // An agent that became a caller — promoted to orchestrator tier — must leave
  // the catalogue, not merely stop being refreshed in it.
  if (!blobs.length) {
    const removed = await removeAgentFromIndex(row.slug, orgId);
    return { slug: row.slug, written: [], skipped: [], removed };
  }

  const memories = await listAllBankEntries(bankId);
  const existing = storedTags(memories, row.slug);

  const written: IndexKind[] = [];
  const skipped: IndexKind[] = [];
  let removed = 0;

  for (const blob of blobs) {
    if (isCurrent(existing.get(blob.kind), blob)) {
      skipped.push(blob.kind);
      continue;
    }
    removed += await sweepKind(bankId, memories, row.slug, blob.kind);
    await provider.retain(
      bankId,
      [{ content: blob.content, tags: blob.tags, metadata: blob.metadata, timestamp: row.updatedAt.toISOString() }],
      { waitForIndex: true },
    );
    written.push(blob.kind);
  }

  if (written.length) {
    log.info(`[agent-index] ${row.slug}: wrote ${written.join(", ")}${skipped.length ? ` (skipped ${skipped.join(", ")})` : ""}`);
  }
  return { slug: row.slug, written, skipped, removed };
}

/** Retires the stored entries of one kind for one agent. */
async function sweepKind(bankId: string, entries: MemoryRecord[], slug: string, kind: IndexKind): Promise<number> {
  const provider = memory();
  const doomed = entries.filter((m) => readAgentTag(m.tags) === slug && readKindTag(m.tags) === kind);
  for (const m of doomed) {
    await provider.deleteMemory(bankId, m.id).catch((e) =>
      log.warn(`[agent-index] sweep failed id=${m.id}: ${errMsg(e)}`),
    );
  }
  return doomed.length;
}

/** Removes every entry for an agent — used when the agent itself is deleted. */
export async function removeAgentFromIndex(slug: string, orgId: string): Promise<number> {
  const bankId = await ensureAgentIndexBank(orgId);
  const provider = memory();
  if (provider.deleteByTag) return provider.deleteByTag(bankId, `agent:${slug}`);

  const memories = await listAllBankEntries(bankId);
  const doomed = memories.filter((m) => readAgentTag(m.tags) === slug);
  for (const m of doomed) await provider.deleteMemory(bankId, m.id).catch(() => undefined);
  return doomed.length;
}

/**
 * Rebuilds the whole org: syncs every agent, then drops entries for agents that
 * no longer exist. An index that still answers for a deleted agent is worse than
 * one missing it — the orchestrator would route to a slug that cannot resolve.
 */
export async function rebuildOrgIndex(orgId: string): Promise<{ synced: number; failed: number; purged: number }> {
  const agents = await prisma.agent.findMany({ where: { orgId }, select: { id: true, slug: true } });
  const live = new Set(agents.map((a) => a.slug));

  let synced = 0;
  let failed = 0;
  for (const agent of agents) {
    try {
      await syncAgentToIndex(agent.id, orgId);
      synced += 1;
    } catch (e) {
      failed += 1;
      log.warn(`[agent-index] rebuild failed for ${agent.slug}: ${errMsg(e)}`);
    }
  }

  const stale = new Set(
    (await listBankEntries(orgId)).map((b) => b.slug).filter((slug) => slug && !live.has(slug)),
  );
  for (const slug of stale) await removeAgentFromIndex(slug, orgId);

  log.info(`[agent-index] rebuild org=${orgId}: ${synced} synced, ${failed} failed, ${stale.size} purged`);
  return { synced, failed, purged: stale.size };
}

/**
 * Fire-and-forget wrapper for request paths. Mirrors `syncAwakeningState` beside
 * the agent write: a memory-backend outage must never fail an agent save, and
 * the next write or a manual rebuild reconciles.
 */
export function syncAgentToIndexBestEffort(agentId: string, orgId: string, slug: string): void {
  void syncAgentToIndex(agentId, orgId).catch((e) =>
    log.warn(`[agent-index] sync failed for ${slug}: ${errMsg(e)}`),
  );
}
