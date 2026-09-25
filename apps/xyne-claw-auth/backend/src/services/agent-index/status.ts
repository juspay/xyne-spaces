import { prisma } from "../../db.js";
import { isIndexable, readHashTag, readPromptVersionTag, renderAgentBlobs, type AgentRow } from "./render.js";
import { listBankEntries } from "./sync.js";
import type { AgentIndexStatus, IndexDocument, IndexKind, StoredBlob } from "./types.js";

/**
 * Status stage: what the bank holds versus what the roster says it should.
 *
 * Staleness is decided by re-rendering the agent and comparing content hashes —
 * the same test `sync` uses to decide what to rewrite, so the dashboard can
 * never claim an agent is stale that a sync would skip, or vice versa.
 *
 * The hash is read from a tag rather than from metadata because the provider's
 * list endpoint returns tags but not metadata.
 */

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

interface Coverage {
  agents: AgentIndexStatus[];
  indexed: number;
  total: number;
  stale: number;
  entries: number;
  chars: number;
}

function statusFor(agent: AgentRow, blobs: StoredBlob[]): AgentIndexStatus {
  const expected = renderAgentBlobs(agent);
  const storedHashes = new Map(
    blobs.map((b) => [b.kind, readHashTag(b.tags)] as const).filter(([, h]) => h !== null),
  );

  const present = blobs.map((b) => b.kind).filter((k): k is IndexKind => k !== "unknown");
  const missing = expected.filter((e) => !storedHashes.has(e.kind)).map((e) => e.kind);
  const stale = expected.some((e) => storedHashes.has(e.kind) && storedHashes.get(e.kind) !== e.contentHash);

  const persona = blobs.find((b) => b.kind === "persona");

  return {
    slug: agent.slug,
    name: agent.name,
    agentId: agent.id,
    indexed: [...new Set(present)],
    missing,
    stale,
    liveUpdatedAt: agent.updatedAt.toISOString(),
    indexedUpdatedAt: persona?.indexedAt ?? blobs[0]?.indexedAt ?? null,
    promptVersion: agent.activePromptVersion,
    indexedPromptVersion: persona ? readPromptVersionTag(persona.tags) : null,
    chars: blobs.reduce((n, b) => n + b.chars, 0),
  };
}

function groupBySlug(entries: StoredBlob[]): Map<string, StoredBlob[]> {
  const bySlug = new Map<string, StoredBlob[]>();
  for (const entry of entries) {
    if (!entry.slug) continue;
    const list = bySlug.get(entry.slug) ?? [];
    list.push(entry);
    bySlug.set(entry.slug, list);
  }
  return bySlug;
}

/**
 * Coverage is the number that matters — an agent missing from the index is
 * invisible to routing however well it is configured.
 */
export async function orgIndexCoverage(orgId: string): Promise<Coverage> {
  const [agents, entries] = await Promise.all([
    prisma.agent.findMany({ where: { orgId }, select: AGENT_SELECT, orderBy: { slug: "asc" } }),
    listBankEntries(orgId),
  ]);

  const bySlug = groupBySlug(entries);
  // Callers are not delegation targets, so they are not coverage gaps either —
  // counting them would make full coverage unreachable by construction.
  const statuses = agents
    .filter((a) => isIndexable(a as AgentRow))
    .map((a) => statusFor(a as AgentRow, bySlug.get(a.slug) ?? []));

  return {
    agents: statuses,
    indexed: statuses.filter((s) => s.missing.length === 0).length,
    total: statuses.length,
    stale: statuses.filter((s) => s.stale).length,
    entries: entries.length,
    chars: entries.reduce((n, e) => n + e.chars, 0),
  };
}

/**
 * Reassembles stored chunks into the documents they were written as.
 *
 * The provider splits anything past its chunk size, so one system prompt can
 * land as several entries. Callers reason about documents — presenting the
 * chunks raw reads as several personas rather than one that was too long.
 */
export function groupIntoDocuments(blobs: StoredBlob[]): IndexDocument[] {
  const byDocument = new Map<string, StoredBlob[]>();
  for (const blob of blobs) {
    // chunk_id is `<document>_<ordinal>`; without one, the entry is its own document.
    const documentId = blob.chunkId?.replace(/_\d+$/, "") ?? blob.id;
    const group = byDocument.get(documentId) ?? [];
    group.push(blob);
    byDocument.set(documentId, group);
  }

  return [...byDocument.values()]
    .map((group) => {
      const ordered = [...group].sort((a, b) => (a.chunkId ?? "").localeCompare(b.chunkId ?? ""));
      const first = ordered[0] as StoredBlob;
      return {
        kind: first.kind,
        slug: first.slug,
        contentHash: readHashTag(first.tags),
        text: ordered.map((b) => b.text).join(""),
        chars: ordered.reduce((n, b) => n + b.chars, 0),
        chunks: ordered.length,
        indexedAt: first.indexedAt,
      };
    })
    .sort((a, b) => a.kind.localeCompare(b.kind));
}

export async function agentIndexDetail(
  orgId: string,
  slug: string,
): Promise<{ status: AgentIndexStatus; documents: IndexDocument[] } | null> {
  const agent = await prisma.agent.findFirst({ where: { orgId, slug }, select: AGENT_SELECT });
  if (!agent) return null;

  const blobs = (await listBankEntries(orgId)).filter((b) => b.slug === slug);
  return { status: statusFor(agent as AgentRow, blobs), documents: groupIntoDocuments(blobs) };
}
