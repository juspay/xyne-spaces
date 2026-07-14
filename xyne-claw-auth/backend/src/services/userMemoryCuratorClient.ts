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

import { bankIdForAgent, getMemoryProvider } from "xyne-claw-shared";
import { CONFIG } from "../config.js";
import { prisma } from "../db.js";
import { createLogger, createTraceId } from "../logger.js";
import type {
  ExistingUserMemory,
  UserMemoryCandidatePayload,
  UserMemoryDistillRequest,
  UserMemoryDistillResponse,
  UserMemoryRecord,
} from "xyne-claw-shared";

const logger = createLogger("user-memory-curator-client", createTraceId());
const DISTILL_TIMEOUT_MS = Number(
  process.env["USER_MEMORY_CURATOR_TIMEOUT_MS"] ?? 600_000,
);
const TWIN_BANK_ID = bankIdForAgent("digital-twin");
const memory = getMemoryProvider();
const DEFAULT_AUTO_APPROVE_MIN_SCORE = 0.9;

interface SourceRef {
  type: "message" | "call" | "canvas" | "mention_reply";
  id: string;
  channelId?: string;
  ts: string;
}

export async function distillUserMemoryViaClaw(
  req: UserMemoryDistillRequest,
): Promise<UserMemoryCandidatePayload[]> {
  if (!CONFIG.xyneClawS2sKey) {
    logger.warn(
      "[user-memory-curator-client] XYNE_CLAW_S2S_KEY not set — refusing call",
    );
    return [];
  }
  const url = `${CONFIG.xyneClawUrl.replace(/\/$/, "")}/internal/user-memory/distill`;
  const tStart = Date.now();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-s2s-key": CONFIG.xyneClawS2sKey,
      },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(DISTILL_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn("[user-memory-curator-client] non-OK from claw", {
        status: res.status,
        body: body.slice(0, 300),
        userId: req.userId,
        recordsCount: req.records.length,
        durationMs: Date.now() - tStart,
      });
      return [];
    }
    const data = (await res.json()) as UserMemoryDistillResponse;
    if (!data.success || !Array.isArray(data.candidates)) {
      logger.warn("[user-memory-curator-client] malformed response", {
        error: data.error,
        userId: req.userId,
        recordsCount: req.records.length,
      });
      return [];
    }
    return data.candidates;
  } catch (err) {
    // Include enough context to tell apart: timeout (90s), connection
    // refused, TLS error, JSON parse, AbortError. Earlier this catch only
    // logged err.message which the MCP log viewer was stripping, so we
    // couldn't distinguish a fetch throw from a JSON.parse throw from a
    // signal abort.
    logger.error("[user-memory-curator-client] call failed", {
      err: err instanceof Error ? err.message : String(err),
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
    });
    return [];
  }
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
      err: err instanceof Error ? err.message : String(err),
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
export async function curateAndPersistBatch(args: {
  userId: string;
  window: { from: Date; to: Date };
  records: UserMemoryRecord[];
  /** "backfill:<jobId>:<source>:<YYYY-MM>" or "daily:<YYYY-MM-DD>:<source>" or "upload:<filename>" */
  source: string;
}): Promise<number> {
  const { userId, window, records, source } = args;
  if (records.length === 0) return 0;

  const existingMemories = await fetchExistingUserMemories(userId);

  const candidates = await distillUserMemoryViaClaw({
    userId,
    window: { from: window.from.toISOString(), to: window.to.toISOString() },
    records,
    existingMemories,
  });

  if (candidates.length === 0) return 0;

  // Resolve groundedOnIds → sourceRefs using the input batch we sent.
  const byId = new Map(records.map((r) => [r.id, r]));
  const candidateRows = candidates.map((c) => {
    const refs: SourceRef[] = [];
    for (const id of c.groundedOnIds) {
      const r = byId.get(id);
      if (!r) continue;
      refs.push({
        type: r.type,
        id: r.id,
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
  if (writable.length === 0) return 0;

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

  let autoApproved = 0;
  const rows: Array<Record<string, unknown>> = [];

  for (const row of writable) {
    if (autoApproveEnabled && row.signalScore >= minScore) {
      try {
        const content = row.text.slice(0, 1500);
        const tags = [
          `user:${userId}`,
          `subsystem:${row.subsystem}`,
          "scope:user",
        ];
        const out = await memory.retain(TWIN_BANK_ID, [{ content, tags }]);
        rows.push({
          ...row,
          status: "approved",
          approvedAt: now,
          hindsightMemoryId: out?.[0]?.id ?? null,
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
            err: err instanceof Error ? err.message : String(err),
          },
        );
      }
    }

    rows.push({ ...row, status: "pending" });
  }

  const result = await (prisma.userMemoryCandidate.createMany as any)({
    data: rows,
  });
  logger.info("[user-memory-curator-client] candidates persisted", {
    userId,
    source,
    received: candidates.length,
    inserted: result.count,
    autoApproved,
    approvalMode: user?.digitalTwinMemoryApprovalMode ?? "manual",
    minScore,
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
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
