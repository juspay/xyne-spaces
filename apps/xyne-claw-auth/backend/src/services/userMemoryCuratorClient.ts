/**
 * Thin HTTP client for claw's /internal/user-memory/distill endpoint.
 *
 * Why on claw: LITELLM_API_KEY lives on claw. Same "LLM-on-claw-only"
 * invariant as the session curator (sessionCurator.ts).
 *
 * Returns [] on any failure (claw down, S2S mismatch, timeout, bad JSON,
 * etc). The caller handles the empty result — never crashes the pipeline.
 *
 * This module also persists the returned candidates into
 * `user_memory_candidates` with sourceRefs resolved from the input batch.
 */

import { Agent } from "undici";
import { errMsg } from "../lib/errors.js";
import { bankIdForAgent, getMemoryProvider } from "xyne-claw-shared";
import { baseRecordId } from "./userMemoryBatcher.js";
import { CONFIG } from "../config.js";
import { prisma } from "../db.js";
import { createLogger, createTraceId } from "../logger.js";
import type {
  ExistingUserMemory,
  UserMemoryCandidatePayload,
  UserMemoryCuratorTrace,
  UserMemoryDistillRequest,
  UserMemoryDistillResponse,
  UserMemoryRecord,
} from "xyne-claw-shared";
import {
  startCuratorBatchEvent,
  updateCuratorBatchAttempt,
  finishCuratorBatchEvent,
  type PipelineRecordPreview,
} from "./digitalTwinPipelineEvents.js";

const logger = createLogger("user-memory-curator-client", createTraceId());
// claw's /distill runs its OWN retry ladder internally: up to
// USER_MEMORY_CURATOR_MAX_ATTEMPTS LLM calls, each timeout escalating by
// USER_MEMORY_CURATOR_TIMEOUT_STEP_MS (10m → 12m → 14m). This client fetch wraps
// that whole ladder in ONE request, so it must outlast the SUM of those
// per-attempt timeouts — otherwise it aborts a still-working curator before its
// later (longer) retries can finish. Compute from the same knobs (keep them in
// sync across both services) + a buffer for network/gateway overhead.
const CURATOR_BASE_MS = Number(process.env["USER_MEMORY_CURATOR_TIMEOUT_MS"] ?? 600_000);
const CURATOR_STEP_MS = Number(process.env["USER_MEMORY_CURATOR_TIMEOUT_STEP_MS"] ?? 120_000);
const CURATOR_ATTEMPTS = Math.max(1, Number(process.env["USER_MEMORY_CURATOR_MAX_ATTEMPTS"] ?? 3));
// Σ per-attempt timeouts = attempts·base + step·(0+1+…+(attempts−1)); +15% buffer.
const DISTILL_TIMEOUT_MS = Number(
  process.env["USER_MEMORY_CLIENT_TIMEOUT_MS"] ??
    Math.round(
      (CURATOR_ATTEMPTS * CURATOR_BASE_MS +
        CURATOR_STEP_MS * ((CURATOR_ATTEMPTS * (CURATOR_ATTEMPTS - 1)) / 2)) *
        1.15,
    ),
);

// The distill call is NON-streaming: claw sends response headers only AFTER the
// full LLM distill finishes (10–14 min). undici's default headersTimeout AND
// bodyTimeout are 300s (5 min), so the fetch would abort at ~5 min via a
// "Headers Timeout Error" REGARDLESS of the AbortSignal above — this is the real
// "5-minute timeout" we kept hitting. Disable both (0) so the AbortSignal is the
// sole clock; keep connectTimeout so a genuinely dead pod still fails fast.
const distillDispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0, connectTimeout: 10_000 });
const TWIN_BANK_ID = bankIdForAgent("digital-twin");
const memory = getMemoryProvider();
const DEFAULT_AUTO_APPROVE_MIN_SCORE = 0.9;

interface SourceRef {
  type: "message" | "call" | "canvas" | "mention_reply" | "conversation";
  id: string;
  channelId?: string;
  ts: string;
}

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
    await memory.ensureBank(TWIN_BANK_ID, {
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

/** Client-side attempts for the claw distill S2S call. The curator LLM already
 *  retries internally (no-tool-call / bad-json / 5xx); THIS layer covers
 *  TRANSPORT failures — claw restart, a connection dropped by an intermediate
 *  idle-timeout on a long call, or a 5xx — which otherwise silently lose the
 *  whole batch (trace=null, 0 candidates), exactly the "24 → 0, no trace" case. */
const DISTILL_CLIENT_ATTEMPTS = Math.max(1, Number(process.env["USER_MEMORY_CLIENT_MAX_ATTEMPTS"] ?? 3));

export async function distillUserMemoryViaClaw(
  req: UserMemoryDistillRequest,
  /** Fired at the START of each attempt so callers can surface live "running /
   *  retrying attempt N/M" state. `prevError` is set from attempt 2 onward. */
  onAttempt?: (attempt: number, maxAttempts: number, prevError?: string) => void,
): Promise<{ candidates: UserMemoryCandidatePayload[]; trace: UserMemoryCuratorTrace | null }> {
  if (!CONFIG.xyneClawS2sKey) {
    logger.warn("[user-memory-curator-client] XYNE_CLAW_S2S_KEY not set — refusing call");
    return { candidates: [], trace: null };
  }
  const url = `${CONFIG.xyneClawUrl.replace(/\/$/, "")}/internal/user-memory/distill`;

  let prevError: string | undefined;
  for (let attempt = 1; attempt <= DISTILL_CLIENT_ATTEMPTS; attempt++) {
    onAttempt?.(attempt, DISTILL_CLIENT_ATTEMPTS, prevError);
    const tStart = Date.now();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-s2s-key": CONFIG.xyneClawS2sKey,
        },
        body: JSON.stringify({ ...req, includeTrace: true }),
        signal: AbortSignal.timeout(DISTILL_TIMEOUT_MS),
        // `dispatcher` is an undici extension not in the DOM RequestInit type.
        dispatcher: distillDispatcher,
      } as unknown as RequestInit);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        logger.warn("[user-memory-curator-client] non-OK from claw", {
          status: res.status,
          body: body.slice(0, 300),
          userId: req.userId,
          recordsCount: req.records.length,
          durationMs: Date.now() - tStart,
          attempt,
          maxAttempts: DISTILL_CLIENT_ATTEMPTS,
        });
        // 5xx/gateway = transient → retry; 4xx is a real request problem → don't.
        if (res.status >= 500 && attempt < DISTILL_CLIENT_ATTEMPTS) {
          prevError = `claw ${res.status}`;
          await new Promise((r) => setTimeout(r, 2000 * attempt));
          continue;
        }
        return { candidates: [], trace: null };
      }
      const data = (await res.json()) as UserMemoryDistillResponse;
      if (!data.success || !Array.isArray(data.candidates)) {
        // claw responded (not a transport failure) — malformed body; don't retry.
        logger.warn("[user-memory-curator-client] malformed response", {
          error: data.error,
          userId: req.userId,
          recordsCount: req.records.length,
        });
        return { candidates: [], trace: null };
      }
      if (attempt > 1) {
        logger.info("[user-memory-curator-client] distill succeeded on retry", { userId: req.userId, attempt });
      }
      return { candidates: data.candidates, trace: data.trace ?? null };
    } catch (err) {
      // Transport failure: timeout / connection reset / dropped by an
      // intermediate proxy on a long call — the failure that was losing whole
      // batches. Retry with backoff; only give up after the last attempt.
      const isLast = attempt >= DISTILL_CLIENT_ATTEMPTS;
      logger.error("[user-memory-curator-client] call failed", {
        err: errMsg(err),
        name: err instanceof Error ? err.name : "unknown",
        cause:
          err instanceof Error && (err as { cause?: unknown }).cause
            ? String((err as { cause?: unknown }).cause)
            : undefined,
        url,
        userId: req.userId,
        recordsCount: req.records.length,
        durationMs: Date.now() - tStart,
        timeoutMs: DISTILL_TIMEOUT_MS,
        attempt,
        maxAttempts: DISTILL_CLIENT_ATTEMPTS,
        willRetry: !isLast,
      });
      if (!isLast) {
        prevError = errMsg(err);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      return { candidates: [], trace: null };
    }
  }
  return { candidates: [], trace: null };
}

/** How many of the user's existing memories to pull for update-vs-create
 *  reconciliation. Note: the twin bank is shared across all opted-in users and
 *  Hindsight's list endpoint can't tag-filter server-side, so listMemories
 *  fetches a wide page then filters to `user:<id>` client-side. 200 comfortably
 *  covers a single user at today's opt-in scale; if the shared bank grows large
 *  enough that a user's memories fall outside the first page, switch this to a
 *  tag-scoped recall() (server-side filtered) keyed off the batch gist. */
const MAX_EXISTING_MEMORIES = 200;

/**
 * Pull this user's already-approved memories from the twin bank so the curator
 * can update an existing fact instead of emitting a near-duplicate. Best-effort:
 * on any provider error we return [] and the curator simply creates as before.
 */
async function fetchExistingUserMemories(userId: string): Promise<ExistingUserMemory[]> {
  try {
    const page = await memory.listMemories(TWIN_BANK_ID, {
      tags: [`user:${userId}`],
      limit: MAX_EXISTING_MEMORIES,
    });
    const out: ExistingUserMemory[] = [];
    for (const m of page.memories) {
      if (!m.id) continue;
      const subsystem = (m.tags ?? [])
        .find((t) => t.startsWith("subsystem:"))
        ?.slice("subsystem:".length);
      if (!subsystem) continue;  // no subsystem tag → can't reconcile safely
      out.push({ id: m.id, subsystem, text: m.content ?? "" });
    }
    return out;
  } catch (err) {
    logger.warn("[user-memory-curator-client] fetchExistingUserMemories failed — curator will create-only", {
      userId,
      err: errMsg(err),
    });
    return [];
  }
}

/**
 * High-level: take a record batch, run it through the curator, persist
 * candidates with resolved sourceRefs. Used by both the backfill worker (per
 * month-window) and the daily worker (per day).
 *
 * Returns the inserted candidate count for logging/progress UI.
 */
/** First 300 chars of each fed record, for the pipeline-event preview. */
function recordPreviews(records: UserMemoryRecord[]): PipelineRecordPreview[] {
  return records.map((r) => ({
    id: r.id,
    type: r.type,
    ts: r.ts,
    ...(r.channelId ? { channelId: r.channelId } : {}),
    ...(r.channelName ? { channelName: r.channelName } : {}),
    ...(r.title ? { title: r.title } : {}),
    textPreview: (r.text ?? "").slice(0, 300),
  }));
}

export async function curateAndPersistBatch(args: {
  userId: string;
  window: { from: Date; to: Date };
  records: UserMemoryRecord[];
  /** "backfill:<jobId>:<source>:<YYYY-MM>" or "daily:<YYYY-MM-DD>:<source>" or "upload:<filename>" */
  source: string;
}): Promise<number> {
  const { userId, window, records, source } = args;
  if (records.length === 0) return 0;

  const tStart = Date.now();
  const previews = recordPreviews(records);
  // "running" event BEFORE the slow distill call so the pipeline feed shows the
  // batch immediately (reload-survivably) instead of going silent for minutes.
  // Its id is reused to stamp candidates AND to write the terminal event below
  // (single row, no double-write).
  const eventId = await startCuratorBatchEvent({
    userId,
    source,
    window,
    recordCount: records.length,
    records: previews,
    maxAttempts: DISTILL_CLIENT_ATTEMPTS,
  });
  const existingMemories = await fetchExistingUserMemories(userId);

  const { candidates, trace } = await distillUserMemoryViaClaw(
    {
      userId,
      window: { from: window.from.toISOString(), to: window.to.toISOString() },
      records,
      existingMemories,
    },
    // Surface each distill attempt/retry on the running event.
    (attempt, maxAttempts, prevError) => {
      void updateCuratorBatchAttempt(eventId, attempt, maxAttempts, prevError);
    },
  );

  const emittedCount = trace?.emitted.length ?? 0;
  const keptCount = trace?.emitted.filter((e) => e.verdict === "kept").length ?? 0;

  if (candidates.length === 0) {
    await finishCuratorBatchEvent(eventId, {
      userId,
      source,
      window,
      status: trace?.error ? "error" : "empty",
      recordCount: records.length,
      records: previews,
      existingMemoryCount: existingMemories.length,
      emittedCount,
      keptCount,
      candidatesCreated: 0,
      autoApproved: 0,
      durationMs: Date.now() - tStart,
      error: trace?.error ?? null,
      trace,
    });
    return 0;
  }

  // Resolve groundedOnIds → sourceRefs using the input batch we sent. Records
  // may carry a `#pN` sub-chunk id (a batching artefact, see userMemoryBatcher);
  // strip it back to the real record id and dedupe so two sub-chunks of the same
  // unit don't produce duplicate sourceRefs.
  const byId = new Map(records.map((r) => [r.id, r]));
  const candidateRows = candidates.map((c) => {
    const refs: SourceRef[] = [];
    const seenIds = new Set<string>();
    for (const id of c.groundedOnIds) {
      const r = byId.get(id);
      if (!r) continue;
      const baseId = baseRecordId(r.id);
      if (seenIds.has(baseId)) continue;
      seenIds.add(baseId);
      refs.push({
        type: r.type,
        id: baseId,
        ...(r.channelId ? { channelId: r.channelId } : {}),
        ts: r.ts,
      });
    }
    return {
      userId,
      subsystem: c.subsystem,
      text: c.text,
      sourceRefs: refs,
      signalScore: c.signalScore,
      source,
    };
  });

  // Skip if for some reason every candidate lost its grounding mid-flight.
  const writable = candidateRows.filter(
    (r) =>
      Array.isArray(r.sourceRefs) &&
      (r.sourceRefs as unknown as SourceRef[]).length > 0,
  );
  if (writable.length === 0) {
    await finishCuratorBatchEvent(eventId, {
      userId,
      source,
      window,
      status: "empty",
      recordCount: records.length,
      records: previews,
      existingMemoryCount: existingMemories.length,
      emittedCount,
      keptCount,
      candidatesCreated: 0,
      autoApproved: 0,
      durationMs: Date.now() - tStart,
      error: null,
      trace,
    });
    return 0;
  }

  const user = await (prisma.user.findUnique as any)({
    where: { id: userId },
    select: {
      digitalTwinMemoryApprovalMode: true,
      digitalTwinMemoryAutoApproveMinScore: true,
    },
  });
  const autoApproveEnabled = user?.digitalTwinMemoryApprovalMode === "auto";
  const minScore =
    user?.digitalTwinMemoryAutoApproveMinScore ??
    DEFAULT_AUTO_APPROVE_MIN_SCORE;
  const now = new Date();

  // Record the pipeline event FIRST — its id (a) is stamped onto every
  // candidate row and (b) is added as a `pipeline:<id>` TAG on any memory we
  // auto-retain. The tag is how the memories list finds the trace: Hindsight's
  // retain returns no usable id, so candidate.hindsightMemoryId is unreliable —
  // the tag travels with the memory and is returned by listMemories.
  // `writable.length` is the create count: createMany below inserts every row.
  const pipelineEventId = await finishCuratorBatchEvent(eventId, {
    userId,
    source,
    window,
    status: writable.length > 0 ? "ok" : "empty",
    recordCount: records.length,
    records: previews,
    existingMemoryCount: existingMemories.length,
    emittedCount,
    keptCount,
    candidatesCreated: writable.length,
    autoApproved: 0, // fixed up in the log below; not persisted per-row
    durationMs: Date.now() - tStart,
    error: null,
    trace,
  });

  let autoApproved = 0;
  const rows: Array<Record<string, unknown>> = [];

  // Make sure the twin bank has observations enabled before we retain (cached).
  if (autoApproveEnabled) await ensureTwinBank();

  for (const row of writable) {
    if (autoApproveEnabled && row.signalScore >= minScore) {
      try {
        const content = row.text;
        const tags = [
          `user:${userId}`,
          `subsystem:${row.subsystem}`,
          "scope:user",
          ...(pipelineEventId ? [`pipeline:${pipelineEventId}`] : []),
        ];
        const eventTs = pickEventTimestamp(row.sourceRefs);
        const out = await memory.retain(TWIN_BANK_ID, [{
          content,
          tags,
          ...(eventTs ? { timestamp: eventTs } : {}),
          observationScopes: twinObservationScopes(userId),
        }]);
        rows.push({
          ...row,
          status: "approved",
          approvedAt: now,
          hindsightMemoryId: out?.[0]?.id ?? null,
          pipelineEventId,
        });
        autoApproved += 1;
        continue;
      } catch (err) {
        // Fail closed: if provider retention fails, keep the candidate in the
        // normal human review queue rather than dropping it or marking it
        // approved without a durable Hindsight memory.
        logger.warn(
          "[user-memory-curator-client] auto-approval retain failed; keeping pending",
          {
            userId,
            source,
            subsystem: row.subsystem,
            signalScore: row.signalScore,
            err: errMsg(err),
          },
        );
      }
    }

    rows.push({ ...row, status: "pending", pipelineEventId });
  }

  const result = await (prisma.userMemoryCandidate.createMany as any)({
    data: rows,
  });

  // The event was recorded before the retain loop (so its id could tag the
  // auto-approved memories); patch the real auto-approved count back now.
  if (pipelineEventId && autoApproved > 0) {
    await (prisma.digitalTwinPipelineEvent.update as any)({
      where: { id: pipelineEventId },
      data: { autoApproved },
    }).catch(() => {});
  }

  logger.info("[user-memory-curator-client] candidates persisted", {
    userId,
    source,
    received: candidates.length,
    inserted: result.count,
    autoApproved,
    approvalMode: user?.digitalTwinMemoryApprovalMode ?? "manual",
    minScore,
    pipelineEventId,
  });

  return result.count;
}

/** Ops kill-switch for the forward loop. On by default; set to "false" to stop
 *  learning from twin replies without a redeploy of the approve path. */
const LEARN_FROM_REPLIES = process.env["DIGITAL_TWIN_LEARN_FROM_REPLIES"] !== "false";
/** Cap each side of the pair so the combined record stays well under the
 *  curator's 1500-char/record ceiling. */
const MAX_PAIR_PART_CHARS = 650;

/**
 * Forward learning. When a user approves (or edits) a Digital Twin draft and it
 * posts as them, that (incoming message → the user's final reply) pair is the
 * single highest-signal example of how they actually respond. Feed it through
 * the SAME curator so the twin's own outcomes refine the user's style /
 * relationship memories — the self-learning loop that runs alongside the daily
 * + backfill pipeline.
 *
 * Fire-and-forget from the approve handler: never awaited in the request path,
 * never throws out. Uses only the final approved/edited text (the user's real
 * voice), not the twin's draft. Respects the user's approval mode via
 * curateAndPersistBatch (auto-approve vs pending review).
 */
export async function learnFromTwinReply(args: {
  /** The impersonated (mentioned) user — whose memory this refines. */
  userId: string;
  /** The incoming message that mentioned the user. */
  incomingTask: string;
  /** The final text posted as the user (edited or the approved draft). */
  reply: string;
  conversationId: string;
  channelId?: string;
  channelName?: string;
}): Promise<void> {
  if (!LEARN_FROM_REPLIES) return;
  const incoming = (args.incomingTask ?? "").trim();
  const reply = (args.reply ?? "").trim();
  if (!args.userId || !incoming || !reply) return;

  const nowIso = new Date().toISOString();
  const text = [
    `Someone mentioned the user${args.channelName ? ` in #${args.channelName}` : ""}. Incoming message:`,
    `"${incoming.slice(0, MAX_PAIR_PART_CHARS)}"`,
    "",
    "The user's actual reply, posted as themselves:",
    `"${reply.slice(0, MAX_PAIR_PART_CHARS)}"`,
  ].join("\n");

  const record: UserMemoryRecord = {
    id: `twin-reply:${args.conversationId}:${nowIso}`,
    type: "mention_reply",
    ts: nowIso,
    ...(args.channelId ? { channelId: args.channelId } : {}),
    ...(args.channelName ? { channelName: args.channelName } : {}),
    text,
  };

  try {
    const now = new Date();
    const inserted = await curateAndPersistBatch({
      userId: args.userId,
      window: { from: now, to: now },
      records: [record],
      source: `twin-approval:${args.conversationId}`,
    });
    logger.info("[user-memory-curator-client] learned from twin reply", {
      userId: args.userId,
      conversationId: args.conversationId,
      candidates: inserted,
    });
  } catch (err) {
    logger.warn("[user-memory-curator-client] learnFromTwinReply failed", {
      userId: args.userId,
      conversationId: args.conversationId,
      err: errMsg(err),
    });
  }
}
