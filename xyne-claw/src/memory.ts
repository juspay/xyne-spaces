/**
 * Memory hot-path in xyne-claw. Delegates all storage / retrieval to a
 * MemoryProvider from xyne-claw-shared. Hindsight is the default; alternate
 * providers can be selected via the MEMORY_PROVIDER env var.
 *
 * What lives here (xyne-claw concerns, NOT provider concerns):
 *   - listSubsystemTaxonomy() — session-start hint for the memory-search tool
 *   - retainContent()         — direct retain helper for cron use
 *   - deleteMemory()          — wrapper for force-delete
 *
 * On-demand recall during a run lives in memory-search.ts (the tool the
 * agent invokes itself). The provider knows nothing about HITL approval,
 * recall-hit tracking, or per-agent policy — those stay in this layer.
 */

import { bankIdForAgent, getMemoryProvider } from "xyne-claw-shared";
import { HINDSIGHT } from "./config.js";

/** Stable bank id for an agent — re-exported for legacy callers. */
export const memoryBankId = bankIdForAgent;

export interface SubsystemSummary {
  name: string;
  memoryCount: number;
  sampleContent: string;
}

/**
 * List the subsystem taxonomy for an agent's memory bank. Used to inject a
 * ~50-token hint into the system prompt at session start so the model knows
 * what topics it can search via the memory-search tool.
 *
 * `userTag` (e.g. "user:abc123") — if provided, narrow the count to memories
 * tagged with that string. CRITICAL for the Digital Twin: the digital-twin
 * bank holds every opted-in user's personal memories, distinguished only by
 * the `user:<id>` tag. Without this filter the injected hint would surface
 * per-subsystem counts that aggregate across ALL users in the bank — a
 * privacy leak (one user could infer that another exists and roughly what
 * subsystems they've populated).
 *
 * For non-Twin agents (shared bank) `userTag` is left undefined and the
 * full bank is counted as before — that's the shared agent-wide taxonomy.
 */
export async function listSubsystemTaxonomy(
  agentSlug: string,
  opts?: { userTag?: string },
): Promise<SubsystemSummary[]> {
  if (!HINDSIGHT.enabled) return [];
  try {
    const provider = getMemoryProvider();
    const bankId = bankIdForAgent(agentSlug);
    const page = await provider.listMemories(bankId, { limit: 200 });
    const acc = new Map<string, { count: number; sample: string }>();
    for (const m of page.memories) {
      const tags = m.tags ?? [];
      // Per-user scoping: drop anything that doesn't carry the requested user tag.
      if (opts?.userTag && !tags.includes(opts.userTag)) continue;
      const subsystemTag = tags.find((t) => t.startsWith("subsystem:"));
      if (!subsystemTag) continue;
      const name = subsystemTag.slice("subsystem:".length).trim();
      if (!name) continue;
      const cur = acc.get(name);
      if (cur) {
        cur.count += 1;
      } else {
        acc.set(name, { count: 1, sample: (m.content ?? "").slice(0, 80) });
      }
    }
    return Array.from(acc, ([name, v]) => ({ name, memoryCount: v.count, sampleContent: v.sample }))
      .sort((a, b) => b.memoryCount - a.memoryCount);
  } catch (err) {
    console.warn(`[memory] listSubsystemTaxonomy failed for agent=${agentSlug}: ${errMsg(err)}`);
    return [];
  }
}

// ── Retain / delete passthroughs (used by cron + admin force-delete) ──────

/**
 * Direct-retain helper. Memory is agent-wide — always tagged "shared".
 * `userId` is accepted for audit-style metadata only; it does NOT scope the
 * memory.
 */
export async function retainContent(
  agentSlug: string,
  userId: string,
  content: string,
  metadata?: Record<string, string>,
): Promise<void> {
  if (!HINDSIGHT.enabled) return;
  const provider = getMemoryProvider();
  const bank = bankIdForAgent(agentSlug);
  await provider.retain(bank, [
    {
      content,
      tags: ["shared"],
      metadata: { ...(metadata ?? {}), retainedBy: userId },
    },
  ]);
}

export async function deleteMemory(agentSlug: string, memoryId: string): Promise<void> {
  if (!HINDSIGHT.enabled) return;
  const provider = getMemoryProvider();
  const bank = bankIdForAgent(agentSlug);
  await provider.deleteMemory(bank, memoryId);
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
