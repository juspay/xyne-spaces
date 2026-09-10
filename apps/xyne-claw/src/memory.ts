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
import { HINDSIGHT, SERVER } from "./config.js";

import { createLogger } from "./logger.js";
const log = createLogger("memory");

/** Stable bank id for an agent — re-exported for legacy callers. */
export const memoryBankId = bankIdForAgent;

export const DIGITAL_TWIN_SLUG = "digital-twin";

/**
 * Twin gate — MUST be keyed on the bank id, not the raw slug. bankIdForAgent
 * sanitizes (lowercase, collapse hyphens, truncate), so distinct raw slugs
 * like "digital--twin" map onto the twin's bank; an exact-slug comparison
 * would let such an agent read the bank WITHOUT the per-user `user:<id>`
 * gating and leak every opted-in user's personal memories. Anything that
 * lands in the twin bank gets twin scoping.
 */
export function isDigitalTwinAgent(agentSlug: string): boolean {
  return bankIdForAgent(agentSlug) === bankIdForAgent(DIGITAL_TWIN_SLUG);
}

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
  memoryBankId?: string,
): Promise<SubsystemSummary[]> {
  if (!HINDSIGHT.enabled) return [];
  try {
    const provider = getMemoryProvider();
    const bankId = isDigitalTwinAgent(agentSlug)
      ? bankIdForAgent(agentSlug)
      : memoryBankId?.trim() || bankIdForAgent(agentSlug);
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
    log.warn(`[memory] listSubsystemTaxonomy failed for agent=${agentSlug}: ${errMsg(err)}`);
    return [];
  }
}

// ── Retain / delete passthroughs (used by cron + admin force-delete) ──────

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── File-based memory (Memory v2) ─────────────────────────────────────────

export interface PromptMemoryFile {
  name: string;
  content: string;
}

/**
 * Fetch the deterministic, always-loaded memory files for (agentSlug, userId)
 * from claw-auth — the persona (soul.md, …) injected into the system prompt at
 * run start. S2S. Degrades to [] on any error so a slow/absent file store never
 * breaks a run. Content is already ≤20k chars/file and ≤3 files (enforced
 * server-side).
 */
export async function fetchAgentPromptFiles(agentSlug: string, userId: string): Promise<PromptMemoryFile[]> {
  if (!SERVER.authServiceUrl || !userId) return [];
  try {
    const qs = new URLSearchParams({ agentSlug, userId });
    const res = await fetch(
      `${SERVER.authServiceUrl.replace(/\/+$/, "")}/claw/api/v1/memory/agent-prompt-files?${qs.toString()}`,
      {
        headers: {
          ...(SERVER.s2sKey ? { "x-s2s-key": SERVER.s2sKey, "x-user-id": userId } : {}),
        },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      data?: { files?: Array<{ name?: unknown; content?: unknown }> };
    };
    const files = data?.data?.files ?? [];
    return files
      .filter((f): f is { name: string; content: string } => typeof f?.name === "string" && typeof f?.content === "string")
      .map((f) => ({ name: f.name, content: f.content }));
  } catch (err) {
    log.warn(`[memory] fetchAgentPromptFiles failed agent=${agentSlug}: ${errMsg(err)}`);
    return [];
  }
}

/**
 * Ask claw-auth whether `userId` (the human who triggered the run) may inspect
 * or mutate this agent's memory bank via the inspect-memory / mutate-memory
 * tools. Mirrors the requireAgentOwnerContributorOrAdmin decision: agent owner
 * OR EDITOR/CONTRIBUTOR share OR CLAW_ADMIN.
 *
 * Resolved ONCE per session in run.ts and threaded into the tool builders. S2S.
 * FAIL-CLOSED: any missing config, non-2xx, timeout, or parse error returns
 * false so a claw-auth blip can never hand memory-management to an
 * unauthorized caller. authServiceUrl is the same trust anchor used by
 * fetchAgentPromptFiles / logRecallHits.
 */
export async function fetchMemoryAdminAccess(agentSlug: string, userId: string): Promise<boolean> {
  if (!SERVER.authServiceUrl || !agentSlug || !userId) return false;
  try {
    const qs = new URLSearchParams({ userId });
    const res = await fetch(
      `${SERVER.authServiceUrl.replace(/\/+$/, "")}/claw/api/v1/memory/banks/${encodeURIComponent(agentSlug)}/admin-access?${qs.toString()}`,
      {
        headers: {
          ...(SERVER.s2sKey ? { "x-s2s-key": SERVER.s2sKey, "x-user-id": userId } : {}),
        },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!res.ok) return false;
    const data = (await res.json()) as { data?: { allowed?: unknown } };
    return data?.data?.allowed === true;
  } catch (err) {
    log.warn(`[memory] fetchMemoryAdminAccess failed agent=${agentSlug}: ${errMsg(err)}`);
    return false;
  }
}
