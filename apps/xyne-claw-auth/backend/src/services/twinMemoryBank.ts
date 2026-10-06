/**
 * The Digital Twin's Hindsight bank: ensure it exists, tag + retain a fact into
 * it, and list one user's facts back out.
 *
 * The bank (DIGITAL_TWIN_BANK_ID) is separate from the default 'assistant'
 * agent's bank — Twin user memories live in their own namespace, segregated
 * per-user via the `user:<id>` tag. Wiping or recreating Twin data never
 * touches assistant memories and vice versa.
 */

import { DIGITAL_TWIN_BANK_ID, getMemoryProvider } from "xyne-claw-shared";
import type { MemoryRecord } from "xyne-claw-shared";

const memory = getMemoryProvider();

/**
 * Named retain strategy for restoring an archive of ALREADY-EXTRACTED facts.
 *
 * `retain_extraction_mode: "chunks"` makes Hindsight skip the LLM entirely and
 * store each chunk as-is (hindsight `_extract_facts_chunks`) — no fact
 * extraction, no entity extraction. That is exactly right for re-importing
 * memories Hindsight itself produced: re-extracting them would both burn the
 * rate-limited extraction LLM and let the wording drift from what the user
 * already reviewed and approved.
 *
 * `retain_chunk_size` is pinned above the import route's per-record character
 * cap so one archived record stays ONE memory instead of being split.
 */
export const VERBATIM_IMPORT_STRATEGY = "xyne-verbatim-import";
const TWIN_RETAIN_STRATEGIES: Record<string, Record<string, unknown>> = {
  [VERBATIM_IMPORT_STRATEGY]: {
    retain_extraction_mode: "chunks",
    retain_chunk_size: 8_000,
  },
};

/** Ensure the twin bank exists AND has observations enabled (Hindsight's
 *  evolution/temporal tracking) plus the verbatim-import strategy registered.
 *  Cached per-pod in the provider, so calling before each retain is cheap.
 *  Best-effort — retain still works if it fails. */
export async function ensureTwinBank(): Promise<void> {
  try {
    await memory.ensureBank(DIGITAL_TWIN_BANK_ID, {
      enableObservations: true,
      retainStrategies: TWIN_RETAIN_STRATEGIES,
    });
  } catch {
    /* non-fatal */
  }
}

/** The latest source-record timestamp backing a candidate — its representative
 *  EVENT time, passed to Hindsight so facts rank by when they happened (not when
 *  approved). Falls back to undefined → provider uses now(). */
export function pickEventTimestamp(sourceRefs: unknown): string | undefined {
  if (!Array.isArray(sourceRefs)) return undefined;
  let bestMs = 0;
  let bestIso: string | undefined;
  for (const r of sourceRefs) {
    const ts = (r as { ts?: unknown } | null)?.ts;
    if (typeof ts !== "string") continue;
    const t = Date.parse(ts);
    if (Number.isFinite(t) && t > bestMs) {
      bestMs = t;
      bestIso = new Date(t).toISOString();
    }
  }
  return bestIso;
}

/** Observation scope confining consolidation to ONE user's facts (shared bank
 *  safety — observations never mix users). */
export function twinObservationScopes(userId: string): string[][] {
  return [[`user:${userId}`]];
}

/** The `subsystem:<name>` tag's name, if the memory carries one. */
export function subsystemOfTags(tags: readonly string[] | undefined): string | undefined {
  return tags?.find((t) => t.startsWith("subsystem:"))?.slice("subsystem:".length);
}

/**
 * The user's memories in the twin bank. The bank is shared across all opted-in
 * users, so this is the authoritative re-filter: Hindsight over-matches tag
 * queries, so the `user:<id>` tag is re-checked client-side.
 */
export async function listUserTwinMemories(userId: string, limit: number): Promise<MemoryRecord[]> {
  const page = await memory.listMemories(DIGITAL_TWIN_BANK_ID, { tags: [`user:${userId}`], limit });
  return page.memories.filter((m) => (m.tags ?? []).includes(`user:${userId}`));
}

/**
 * Retain one approved fact into the twin bank under the user's tags and return
 * the provider's memory id (null when it returns none). Does NOT ensure the
 * bank — callers do that once, where they want its failure to land.
 *
 * `pipelineEventId` is the trace link: Hindsight's retain returns no usable id,
 * so the memory is tagged `pipeline:<id>` (returned by listMemories) instead of
 * relying on the (always-null) candidate.hindsightMemoryId.
 */
export async function retainTwinMemory(args: {
  userId: string;
  subsystem: string;
  content: string;
  sourceRefs: unknown;
  pipelineEventId: string | null;
}): Promise<string | null> {
  const { userId, subsystem, content, sourceRefs, pipelineEventId } = args;
  const eventTs = pickEventTimestamp(sourceRefs);
  const out = await memory.retain(DIGITAL_TWIN_BANK_ID, [{
    content,
    tags: [
      `user:${userId}`,
      `subsystem:${subsystem}`,
      "scope:user",
      ...(pipelineEventId ? [`pipeline:${pipelineEventId}`] : []),
    ],
    ...(eventTs ? { timestamp: eventTs } : {}),
    observationScopes: twinObservationScopes(userId),
  }]);
  return out?.[0]?.id ?? null;
}
