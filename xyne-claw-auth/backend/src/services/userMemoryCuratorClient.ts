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
  UserMemoryCandidatePayload,
  UserMemoryDistillRequest,
  UserMemoryDistillResponse,
  UserMemoryRecord,
} from "xyne-claw-shared";

const logger = createLogger("user-memory-curator-client", createTraceId());
const DISTILL_TIMEOUT_MS = Number(
  process.env["USER_MEMORY_CURATOR_TIMEOUT_MS"] ?? 90_000,
);
const TWIN_BANK_ID = bankIdForAgent("digital-twin");
const memory = getMemoryProvider();
const DEFAULT_AUTO_APPROVE_MIN_SCORE = 0.9;

interface SourceRef {
  type: "message" | "call" | "canvas";
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

  const candidates = await distillUserMemoryViaClaw({
    userId,
    window: { from: window.from.toISOString(), to: window.to.toISOString() },
    records,
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
