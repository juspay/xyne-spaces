/**
 * Memory Cron Service (xyne-claw-auth)
 *
 * Runs at 2:00 AM IST (20:30 UTC) every day. Two passes:
 *
 *   1. Batch review creation
 *      Queries agent_runs for yesterday's completed sessions (per agentSlug
 *      that has memoryEnabled=true), runs the session-level heuristic, and
 *      creates one PendingBatchReview row per agent. Posts ONE Spaces digest
 *      per agent so an admin can approve the whole batch in one click (or
 *      cherry-pick via the Memory tab).
 *
 *      Nothing is retained to the memory provider yet — that happens at
 *      approval time. Rejected batches cost zero LLM extraction tokens.
 *
 *   2. Recall-hit ingest
 *      Reads data/recall-hits/<yesterday>.jsonl (appended by claw's
 *      prefetchMemory) and bulk-inserts into MemoryRecallHit. Drives the
 *      "hot memories" panel in the Memory tab.
 *
 * Transcripts are read from the agent_runs table (Postgres), which the run
 * pipeline already writes for every completed session. No disk-based
 * transcript dump or shared-PVC requirement.
 *
 * Self-scheduling via setTimeout — no external cron daemon. Disable by
 * leaving HINDSIGHT_URL (and MEMORY_PROVIDER) unset; all passes become no-ops.
 */

import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { Prisma } from "@prisma/client";
import { bankIdForAgent, getMemoryProvider } from "xyne-claw-shared";
import { prisma } from "../db.js";
import { createLogger, createTraceId } from "../logger.js";
import { acquireCronLeaderLock } from "../lib/cron-leader-lock.js";
import { shouldReviewSession } from "./sessionHeuristic.js";
import { distillSession } from "./sessionCurator.js";

const logger = createLogger("memory-cron", createTraceId());

// ── Config ─────────────────────────────────────────────────────────────────

const XYNE_CLAW_DATA_DIR = process.env["XYNE_CLAW_DATA_DIR"] ?? "./data";

const MEMORY_ENABLED = Boolean(process.env["HINDSIGHT_URL"] || process.env["MEMORY_PROVIDER"]);

const memory = getMemoryProvider();

// ── Transcript shape (assembled from agent_runs rows) ──────────────────────

interface ToolInvocation {
  name?: string;
  args?: unknown;
  result?: unknown;
  durationMs?: number;
  isError?: boolean;
}

export interface SessionTranscript {
  sessionId: string;
  userId: string;
  agentSlug: string;
  orgId: string;
  conversationId: string | null;
  channelId: string | null;
  task: string;
  result: string;
  toolsUsed: string[];
  toolInvocations: ToolInvocation[];
  tokensIn: number;
  tokensOut: number;
  approvalStrategy: string;
  startedAt: Date;
  completedAt: Date | null;
}

// ── Batch review creation ──────────────────────────────────────────────────
//
// The cron is fully autonomous: it creates a PendingBatchReview, runs every
// included session through the curator, and writes per-candidate
// PendingMemoryReview rows. Humans only review the resulting candidates
// (not the batches themselves). The previous "send a Spaces digest, wait
// for ✅/❌ click" step has been removed — the batches were not actionable
// in the current UX and the digest just generated noise.

async function createBatchReviews(
  dateStr: string,
  opts: { agentFilter?: string } = {},
): Promise<{
  batchesCreated: number;
  sessionsIncluded: number;
  sessionsSkipped: number;
  transcriptsFound: boolean;
}> {
  // UTC day window — agent_runs.startedAt is timestamptz, dateStr is YYYY-MM-DD UTC.
  const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const runs = await prisma.agentRun.findMany({
    where: {
      status: "completed",
      startedAt: { gte: dayStart, lt: dayEnd },
      ...(opts.agentFilter ? { agentSlug: opts.agentFilter } : {}),
    },
    select: {
      sessionId: true,
      userId: true,
      agentSlug: true,
      orgId: true,
      conversationId: true,
      channelId: true,
      task: true,
      result: true,
      toolsUsed: true,
      toolInvocations: true,
      tokensIn: true,
      tokensOut: true,
      startedAt: true,
      completedAt: true,
    },
  });

  if (runs.length === 0) {
    logger.info("[memory-cron] No completed agent runs for date — nothing to batch", {
      dateStr,
      ...(opts.agentFilter ? { agentFilter: opts.agentFilter } : {}),
    });
    return { batchesCreated: 0, sessionsIncluded: 0, sessionsSkipped: 0, transcriptsFound: false };
  }

  logger.info("[memory-cron] Building batches from agent_runs", {
    count: runs.length,
    dateStr,
    ...(opts.agentFilter ? { agentFilter: opts.agentFilter } : {}),
  });

  // Group by (orgId, agentSlug) so same-slug agents in different orgs never
  // share memory batches, cooldowns, or curation work.
  const byAgent = new Map<string, typeof runs>();
  for (const r of runs) {
    const key = `${r.orgId}\u0000${r.agentSlug}`;
    if (!byAgent.has(key)) byAgent.set(key, []);
    byAgent.get(key)!.push(r);
  }

  let batchesCreated = 0;
  let sessionsIncluded = 0;
  let sessionsSkipped = 0;

  for (const [_key, agentRuns] of byAgent) {
    const orgId = agentRuns[0]!.orgId;
    const agentSlug = agentRuns[0]!.agentSlug;
    // Check the agent's memoryEnabled flag before doing anything. Even if old
    // agent_runs rows exist from before the toggle was disabled, skip them.
    const agent = await prisma.agent.findUnique({
      where: { orgId_slug: { orgId, slug: agentSlug } },
      select: { config: true },
    });
    const config = (agent?.config ?? null) as Record<string, unknown> | null;
    const memoryEnabled = config?.["memoryEnabled"] === true || config?.["memoryEnabled"] === "true";
    if (!memoryEnabled) {
      logger.info("[memory-cron] Skipping agent — memory not enabled", {
        orgId,
        agentSlug,
        completedRuns: agentRuns.length,
      });
      continue;
    }
    const approvalStrategy = String(config?.["memoryApprovalStrategy"] ?? "HUMAN_ONLY");

    const included: string[] = [];
    const skipped: Array<{ sessionId: string; reason: string }> = [];
    const toolMix: Record<string, number> = {};

    for (const run of agentRuns) {
      const verdict = shouldReviewSession({
        sessionId: run.sessionId,
        task: run.task,
        result: run.result ?? "",
        toolsUsed: run.toolsUsed,
        tokensIn: run.tokensIn ?? 0,
        tokensOut: run.tokensOut ?? 0,
      });

      if (!verdict.include) {
        skipped.push({ sessionId: run.sessionId, reason: verdict.reason ?? "filtered" });
        continue;
      }

      included.push(run.sessionId);
      for (const tool of run.toolsUsed) {
        toolMix[tool] = (toolMix[tool] ?? 0) + 1;
      }
    }

    if (included.length === 0) {
      logger.info("[memory-cron] All sessions filtered for agent — no batch created", {
        orgId,
        agentSlug,
        skipped: skipped.length,
      });
      sessionsSkipped += skipped.length;
      continue;
    }

    // Preserve admin decisions: don't overwrite an existing batch unless it's
    // still "pending". An approved or rejected batch is a deliberate human
    // call; a backfill re-run shouldn't reset it.
    const existing = await prisma.pendingBatchReview.findFirst({
      where: { orgId, agentSlug, reviewDate: dateStr },
    });
    if (existing && existing.status !== "pending") {
      logger.info("[memory-cron] Existing non-pending batch — leaving untouched", {
        orgId,
        agentSlug,
        reviewDate: dateStr,
        existingStatus: existing.status,
      });
      sessionsIncluded += included.length;
      sessionsSkipped += skipped.length;
      continue;
    }

    try {
      const heuristicSkippedJson: Prisma.InputJsonValue | undefined =
        skipped.length > 0 ? (skipped as unknown as Prisma.InputJsonValue) : undefined;
      const batch = existing
        ? await prisma.pendingBatchReview.update({
          where: { id: existing.id },
          data: {
            sessionIds: included,
            ...(heuristicSkippedJson !== undefined ? { heuristicSkipped: heuristicSkippedJson } : {}),
            status: "pending",
            approvalStrategy,
          },
        })
        : await prisma.pendingBatchReview.create({
          data: {
            agentSlug,
            orgId,
            reviewDate: dateStr,
            status: "pending",
            sessionIds: included,
            ...(heuristicSkippedJson !== undefined ? { heuristicSkipped: heuristicSkippedJson } : {}),
            approvalStrategy,
          },
        });

      batchesCreated++;
      sessionsIncluded += included.length;
      sessionsSkipped += skipped.length;
      logger.info("[memory-cron] Batch created", {
        orgId,
        agentSlug,
        reviewDate: dateStr,
        batchId: batch.id,
        included: included.length,
        skipped: skipped.length,
        strategy: approvalStrategy,
      });

      // Auto-curate: every batch the cron creates immediately runs every
      // included session through the curator and lands its candidates in
      // PendingMemoryReview, where humans still approve them individually.
      // The intermediate "batch waiting for human" step is gone — the user
      // never has to click "Approve all sessions" anymore, only the
      // resulting per-candidate memory rows.
      //
      // Previously we'd send a Spaces digest for HUMAN_ONLY / EVALS_THEN_HUMAN
      // and wait for a click; that step is removed (the digests were noise
      // and blocked candidate creation).
      try {
        await runBatchCuration(batch.id, included, dateStr, agentSlug);
      } catch (err) {
        logger.error("[memory-cron] Auto-curation failed for batch — batch left as 'pending' for retry", {
          agentSlug,
          batchId: batch.id,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    } catch (err) {
      logger.error("[memory-cron] Failed to create batch row", {
        orgId,
        agentSlug,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { batchesCreated, sessionsIncluded, sessionsSkipped, transcriptsFound: true };
}

/**
 * Run every session in a freshly-created batch through the curator and
 * persist per-candidate PendingMemoryReview rows. Marks the batch as
 * `auto_approved` (or `partial` if some sessions had no transcript on
 * disk). Mirrors the manual `approveBatch` path in routes/memory.ts but
 * skips human-approval bookkeeping (no approvedBy / Spaces digest).
 *
 * Idempotent at the row level — curateApprovedTranscript creates fresh
 * PendingMemoryReview rows each time it runs, so a re-run produces
 * duplicates. The cron guards against this by only ever calling this
 * once per batch (the batch's status transitions away from "pending"
 * after the first auto-curation).
 */
async function runBatchCuration(
  batchId: string,
  sessionIds: string[],
  reviewDate: string,
  agentSlug: string,
): Promise<void> {
  const retainedByid: Record<string, string[]> = {};
  const failedSessions: string[] = [];
  let totalCandidates = 0;
  let curated = 0;

  for (const sid of sessionIds) {
    const transcript = await readSessionTranscript(sid);
    if (!transcript) {
      logger.warn("[memory-cron] Session has no transcript on disk — skipping curate", {
        batchId,
        sessionId: sid,
      });
      failedSessions.push(sid);
      continue;
    }
    try {
      const reviewIds = await curateApprovedTranscript(transcript, reviewDate);
      retainedByid[sid] = reviewIds;
      totalCandidates += reviewIds.length;
      curated++;
    } catch (err) {
      logger.error("[memory-cron] Auto-curate failed for session", {
        batchId,
        sessionId: sid,
        err: err instanceof Error ? err.message : String(err),
      });
      failedSessions.push(sid);
    }
  }

  const allFailed = failedSessions.length === sessionIds.length;
  const status = allFailed
    ? "pending" // Leave it as-is so a future re-run can retry.
    : failedSessions.length > 0
      ? "partial"
      : "auto_approved";

  await prisma.pendingBatchReview.update({
    where: { id: batchId },
    data: {
      status,
      approvedSessionIds: sessionIds.filter((s) => !failedSessions.includes(s)),
      retainedMemoryIds: retainedByid,
      updatedAt: new Date(),
    },
  });

  logger.info("[memory-cron] Batch auto-curated", {
    agentSlug,
    batchId,
    sessions: sessionIds.length,
    curated,
    failed: failedSessions.length,
    candidates: totalCandidates,
    status,
  });
}

// ── Backfill API (used by admin "trigger memory creation for past N days") ─

/**
 * Run batch creation across an explicit date range for one agent.
 * `from` and `to` are inclusive ISO dates (YYYY-MM-DD); `to` defaults to today.
 * Idempotent — existing non-pending batches are preserved.
 */
export async function backfillBatches(
  agentSlug: string,
  range: { from: string; to: string },
): Promise<{
  daysProcessed: number;
  daysWithTranscripts: number;
  batchesCreated: number;
  sessionsIncluded: number;
  sessionsSkipped: number;
  skippedDays: string[];
  from: string;
  to: string;
}> {
  const fromDate = parseIsoDate(range.from);
  const toDate = parseIsoDate(range.to);
  if (fromDate > toDate) {
    throw new Error(`backfillBatches: 'from' (${range.from}) must be ≤ 'to' (${range.to})`);
  }

  let batchesCreated = 0;
  let sessionsIncluded = 0;
  let sessionsSkipped = 0;
  let daysWithTranscripts = 0;
  let daysProcessed = 0;
  const skippedDays: string[] = [];

  for (const d = new Date(fromDate); d <= toDate; d.setUTCDate(d.getUTCDate() + 1)) {
    daysProcessed++;
    const dateStr = d.toISOString().slice(0, 10);
    try {
      const r = await createBatchReviews(dateStr, { agentFilter: agentSlug });
      if (!r.transcriptsFound) {
        skippedDays.push(dateStr);
        continue;
      }
      daysWithTranscripts++;
      batchesCreated += r.batchesCreated;
      sessionsIncluded += r.sessionsIncluded;
      sessionsSkipped += r.sessionsSkipped;
    } catch (err) {
      logger.error("[memory-cron] Backfill day failed", {
        agentSlug,
        dateStr,
        err: err instanceof Error ? err.message : String(err),
      });
      skippedDays.push(dateStr);
    }
  }

  logger.info("[memory-cron] Backfill complete", {
    agentSlug,
    from: range.from,
    to: range.to,
    daysProcessed,
    daysWithTranscripts,
    batchesCreated,
    sessionsIncluded,
    sessionsSkipped,
    skippedDayCount: skippedDays.length,
  });

  return {
    daysProcessed,
    daysWithTranscripts,
    batchesCreated,
    sessionsIncluded,
    sessionsSkipped,
    skippedDays,
    from: range.from,
    to: range.to,
  };
}

function parseIsoDate(s: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error(`Invalid date '${s}'; expected YYYY-MM-DD`);
  }
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  if (Number.isNaN(dt.getTime())) throw new Error(`Invalid date '${s}'`);
  return dt;
}

// ── Main sync function ─────────────────────────────────────────────────────

async function runMemorySync(): Promise<void> {
  if (!MEMORY_ENABLED) {
    logger.info("[memory-cron] Skipping sync — no memory provider configured");
    return;
  }

  logger.info("[memory-cron] Starting nightly memory sync", { provider: memory.name });

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().slice(0, 10);

  // Pass 1: build batch reviews from yesterday's agent_runs. Failed cron runs
  // can simply retry tomorrow — agent_runs is persistent in Postgres.
  try {
    const summary = await createBatchReviews(dateStr);
    logger.info("[memory-cron] Batch creation complete", {
      dateStr,
      batches: summary.batchesCreated,
      included: summary.sessionsIncluded,
      skipped: summary.sessionsSkipped,
    });
  } catch (err) {
    logger.error("[memory-cron] Batch creation pass failed — will retry tomorrow", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // Pass 2: ingest yesterday's recall-hits into the MemoryRecallHit table.
  await ingestRecallHits(dateStr);
}

// ── Recall-hit ingest ──────────────────────────────────────────────────────

interface RecallHitLine {
  agentSlug: string;
  hindsightMemoryId: string;
  userId: string;
  sessionId: string;
  scope: "user" | "shared";
  rank: number;
  recalledAt: string;
}

async function ingestRecallHits(dateStr: string): Promise<void> {
  const file = join(XYNE_CLAW_DATA_DIR, "recall-hits", `${dateStr}.jsonl`);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    logger.info("[memory-cron] No recall-hits file to ingest", { dateStr });
    return;
  }

  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const rows: Array<{
    agentSlug: string;
    hindsightMemoryId: string;
    userId: string;
    sessionId: string;
    scope: string;
    rank: number | null;
    recalledAt: Date;
    orgId: string | undefined;
  }> = [];

  let parseFailed = 0;
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as RecallHitLine;
      if (!parsed.agentSlug || !parsed.hindsightMemoryId || !parsed.userId || !parsed.sessionId || !parsed.scope) {
        parseFailed++;
        continue;
      }
      rows.push({
        agentSlug: parsed.agentSlug,
        hindsightMemoryId: parsed.hindsightMemoryId,
        userId: parsed.userId,
        sessionId: parsed.sessionId,
        scope: parsed.scope,
        rank: typeof parsed.rank === "number" ? parsed.rank : null,
        recalledAt: new Date(parsed.recalledAt),
        orgId: undefined,
      });
    } catch {
      parseFailed++;
    }
  }

  const sessionOrgRows = await prisma.agentRun.findMany({
    where: { sessionId: { in: [...new Set(rows.map((r) => r.sessionId))] } },
    select: { sessionId: true, orgId: true },
  });
  const orgBySession = new Map(sessionOrgRows.map((r) => [r.sessionId, r.orgId]));
  for (const row of rows) row.orgId = orgBySession.get(row.sessionId);
  const rowsWithOrg = rows.flatMap((r) => r.orgId ? [{ ...r, orgId: r.orgId }] : []);

  if (rows.length === 0) {
    logger.info("[memory-cron] Recall-hits file empty after parse", { dateStr, parseFailed });
    await unlink(file).catch(() => {});
    return;
  }

  try {
    const result = await prisma.memoryRecallHit.createMany({ data: rowsWithOrg, skipDuplicates: true });
    logger.info("[memory-cron] Recall-hits ingested", {
      dateStr,
      inserted: result.count,
      parsed: rows.length,
      skippedMissingOrg: rows.length - rowsWithOrg.length,
      parseFailed,
    });
    await unlink(file).catch(() => {});
  } catch (err) {
    logger.error("[memory-cron] Failed to bulk-insert recall hits — leaving file for next run", {
      err: err instanceof Error ? err.message : String(err),
      dateStr,
      rows: rows.length,
    });
  }
}

// ── Scheduling ─────────────────────────────────────────────────────────────

function scheduleNextRun(): void {
  const now = new Date();
  // 2 AM IST = 20:30 UTC (previous calendar day in UTC)
  const nextRunUTC = new Date(now);
  nextRunUTC.setUTCHours(20, 30, 0, 0);
  if (nextRunUTC <= now) {
    nextRunUTC.setUTCDate(nextRunUTC.getUTCDate() + 1);
  }

  const msUntilRun = nextRunUTC.getTime() - now.getTime();
  logger.info("[memory-cron] Next memory sync scheduled", {
    nextRun: nextRunUTC.toISOString(),
    inMs: String(msUntilRun),
  });

  setTimeout(async () => {
    try {
      // Multi-replica guard: every pod arms this timer; only the pod that wins
      // the date-scoped Redis lock actually runs the sync (cron-leader-lock.ts).
      if (await acquireCronLeaderLock("memory-cron")) {
        await runMemorySync();
      } else {
        logger.info("[memory-cron] Skipped — another replica is running tonight's sync");
      }
    } catch (err) {
      logger.error("[memory-cron] Unhandled error in nightly sync", {
        err: err instanceof Error ? err.message : String(err),
      });
    } finally {
      scheduleNextRun();
    }
  }, msUntilRun);
}

/** Initialise the memory cron. Call once from main.ts at startup. */
export function initMemoryCron(): void {
  if (!MEMORY_ENABLED) {
    logger.info("[memory-cron] Disabled — no memory provider configured. Set HINDSIGHT_URL or MEMORY_PROVIDER to enable.");
    return;
  }
  logger.info("[memory-cron] Initialising nightly memory sync (2 AM IST)", { provider: memory.name });
  scheduleNextRun();
}

/**
 * Internal helper for the batch-approval endpoint: run an approved session
 * through the curator and write per-candidate PendingMemoryReview rows
 * (status="pending"). Nothing is retained to Hindsight here — that happens
 * per-candidate when the admin approves a specific review row.
 *
 * Returns the inserted review IDs so the batch can record them in
 * pending_batch_reviews.retainedMemoryIds for audit. Empty array if the
 * curator returned no candidates (most sessions should end up here).
 *
 * Exported so the routes layer can call it without going through the cron.
 */
export async function curateApprovedTranscript(
  transcript: SessionTranscript,
  reviewDate: string,
): Promise<string[]> {
  const candidates = await distillSession({
    sessionId: transcript.sessionId,
    agentSlug: transcript.agentSlug,
    userId: transcript.userId,
    task: transcript.task,
    result: transcript.result,
    toolsUsed: transcript.toolsUsed,
    transcript: buildTranscriptBlob(transcript),
  });

  if (candidates.length === 0) {
    logger.info("[memory-cron] Curator returned 0 subsystem updates — no review rows created", {
      agentSlug: transcript.agentSlug,
      sessionId: transcript.sessionId,
      reviewDate,
    });
    return [];
  }

  const reviewIds: string[] = [];
  for (const c of candidates) {
    // Memory is agent-wide and subsystem-scoped. The candidate proposes either
    // a brand-new subsystem (action=create, isNewSubsystem=true) or an update
    // to an existing one (action=update, replacesMemoryId set). On approve,
    // the routes layer retains the new content and deletes the replaced
    // memory atomically, preserving "one memory per subsystem".
    const created = await prisma.pendingMemoryReview.create({
      data: {
        agentSlug: transcript.agentSlug,
        orgId: transcript.orgId,
        userId: null,
        sessionId: transcript.sessionId,
        scope: "shared",
        subsystem: c.subsystem,
        action: c.action,
        replacesMemoryId: c.replacesMemoryId,
        isNewSubsystem: c.isNewSubsystem,
        content: c.proposedContent,
        curatorReasoning: c.reasoning,
        curatorConfidence: c.confidence,
        tokensIn: transcript.tokensIn,
        tokensOut: transcript.tokensOut,
        toolCount: transcript.toolInvocations.length,
        status: "pending",
      },
    });
    reviewIds.push(created.id);
  }

  logger.info("[memory-cron] Curator subsystem candidates queued for review", {
    agentSlug: transcript.agentSlug,
    sessionId: transcript.sessionId,
    reviewDate,
    candidates: reviewIds.length,
    newSubsystems: candidates.filter((c) => c.isNewSubsystem).length,
  });

  return reviewIds;
}

const MAX_ARGS_CHARS = 500;
const MAX_RESULT_CHARS = 500;

function safeStringify(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function buildTranscriptBlob(t: SessionTranscript): string {
  const lines: string[] = [];
  lines.push(`Agent: ${t.agentSlug}`);
  lines.push(`User: ${t.userId}`);
  lines.push(`Started: ${t.startedAt.toISOString()}`);
  if (t.completedAt) {
    const durationMs = t.completedAt.getTime() - t.startedAt.getTime();
    lines.push(`Ended:   ${t.completedAt.toISOString()} (${Math.round(durationMs / 1000)}s)`);
  }
  lines.push("");
  lines.push("Task:");
  lines.push(t.task);
  lines.push("");

  if (t.toolInvocations.length > 0) {
    lines.push(`Tools called (in order, ${t.toolInvocations.length} total):`);
    t.toolInvocations.forEach((inv, i) => {
      const name = inv.name ?? "(unnamed)";
      lines.push(`${i + 1}. ${name}${inv.isError ? "  [ERROR]" : ""}`);
      const args = safeStringify(inv.args);
      if (args) lines.push(`   args: ${args.slice(0, MAX_ARGS_CHARS)}`);
      const result = safeStringify(inv.result);
      if (result) lines.push(`   result: ${result.slice(0, MAX_RESULT_CHARS)}`);
      if (typeof inv.durationMs === "number") lines.push(`   duration: ${inv.durationMs}ms`);
    });
    lines.push("");
  } else if (t.toolsUsed.length > 0) {
    // Fallback when toolInvocations isn't populated but toolsUsed is.
    lines.push(`Tools used: ${t.toolsUsed.join(", ")}`);
    lines.push("");
  }

  lines.push("Outcome:");
  lines.push(t.result);
  return lines.join("\n");
}

/**
 * Look up one session's full transcript from agent_runs.
 * Returns null if the session doesn't exist or isn't completed.
 */
export async function readSessionTranscript(sessionId: string): Promise<SessionTranscript | null> {
  const run = await prisma.agentRun.findUnique({
    where: { sessionId },
    select: {
      sessionId: true,
      userId: true,
      agentSlug: true,
      orgId: true,
      conversationId: true,
      channelId: true,
      task: true,
      result: true,
      toolsUsed: true,
      toolInvocations: true,
      tokensIn: true,
      tokensOut: true,
      startedAt: true,
      completedAt: true,
    },
  });
  if (!run) return null;

  // Resolve the agent's current approvalStrategy from its config blob.
  const agent = await prisma.agent.findUnique({
    where: { orgId_slug: { orgId: run.orgId, slug: run.agentSlug } },
    select: { config: true },
  });
  const config = (agent?.config ?? null) as Record<string, unknown> | null;
  const approvalStrategy = String(config?.["memoryApprovalStrategy"] ?? "HUMAN_ONLY");

  return {
    sessionId: run.sessionId,
    userId: run.userId,
    agentSlug: run.agentSlug,
    orgId: run.orgId,
    conversationId: run.conversationId,
    channelId: run.channelId,
    task: run.task,
    result: run.result ?? "",
    toolsUsed: run.toolsUsed,
    toolInvocations: ((run.toolInvocations as Prisma.JsonValue) as ToolInvocation[] | null) ?? [],
    tokensIn: run.tokensIn ?? 0,
    tokensOut: run.tokensOut ?? 0,
    approvalStrategy,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  };
}
