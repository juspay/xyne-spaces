/**
 * FailureCurator hourly worker.
 *
 * Every FAILURE_CURATOR_TICK_MS (default 1h):
 *   1. List "active" agents — anything with ≥1 run in last 24h
 *   2. For each: pull lastProcessedAt from agent_curator_state (or NOW()-24h)
 *   3. Run selectNegativeSessions(since=lastProcessedAt, now)
 *   4. Skip if count < MIN_BATCH
 *   5. POST to claw /internal/failure-curator/distill with newNegatives +
 *      a 7-day contextWindow + the agent's current systemPrompt
 *   6. Upsert candidates into agent_improvement_candidates with dedupe-merge
 *      on (agentSlug, bucket, rootCause) + overlapping evidence
 *   7. Advance lastProcessedAt to the max(completedAt) seen
 *
 * Standalone — uses setInterval rather than BullMQ for simplicity. Honours
 * an in-flight guard so two ticks can't overlap if a previous one runs long.
 */

import { Prisma } from "@prisma/client";
import { errMsg } from "../lib/errors.js";
import { prisma } from "../db.js";
import { CONFIG } from "../config.js";
import { selectNegativeSessions, type NegativeSession } from "./failure-curator-detection.js";

import { createLogger } from "../logger.js";
const log = createLogger("failure-curator-worker");

const TICK_MS = Number(process.env["FAILURE_CURATOR_TICK_MS"] ?? 60 * 60 * 1000); // 1h
// Dropped from 3 to 2 after first prod backfill showed 0/19 agents processed —
// healthy workspaces produce few negatives per agent, so a high MIN_BATCH
// silently skips everyone. The LLM curator itself enforces ≥2 evidence
// sessionIds per candidate, so we don't lose statistical rigor.
const MIN_BATCH = Number(process.env["FAILURE_CURATOR_MIN_BATCH"] ?? 2);
const CLAW_URL = (process.env["XYNE_CLAW_URL"] ?? process.env["CLAW_URL"] ?? "http://xyne-claw:3001").replace(/\/+$/, "");
// claw's validateS2SKey reads from req.headers["x-s2s-key"], so we use the
// same xyneClawS2sKey value claw-auth uses elsewhere when calling claw.
const S2S_KEY = CONFIG.xyneClawS2sKey ?? "";
const MAX_CONTEXT_WINDOW_DAYS = 7;
const MAX_CONTEXT_SESSIONS = 15;

interface CuratorCandidate {
  bucket: "agent_unable_to_do_work" | "failure" | "user_frustrated";
  rootCause: string;
  finding: string;
  evidence: string[];
  proposedFix: { type: string; description: string };
  confidence: "high" | "medium" | "low";
}

let running = false;
let timer: ReturnType<typeof setInterval> | null = null;

export function initFailureCuratorWorker(): void {
  if (timer) return;
  log.info(`[failure-curator-worker] starting, tick=${TICK_MS}ms, minBatch=${MIN_BATCH}`);
  timer = setInterval(() => { void tickOnce(); }, TICK_MS);
  // Don't keep the process alive just for the worker.
  timer.unref?.();
  // Run once at startup so the first results land in minutes, not an hour.
  // Delayed 30s so the rest of the app has time to settle.
  setTimeout(() => { void tickOnce(); }, 30_000).unref?.();
}

export function closeFailureCuratorWorker(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

async function tickOnce(): Promise<void> {
  if (running) {
    log.info("[failure-curator-worker] previous tick still running, skipping");
    return;
  }
  running = true;
  const tStart = Date.now();
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const active = await prisma.$queryRaw<Array<{ orgId: string; agentSlug: string }>>`
      SELECT DISTINCT "orgId", "agentSlug" FROM "agent_runs"
       WHERE "completedAt" >= ${since}
         AND "orgId" IS NOT NULL
       LIMIT 200
    `;
    let processed = 0;
    let totalCandidates = 0;
    for (const { orgId, agentSlug } of active) {
      try {
        const n = await processAgent(orgId, agentSlug);
        if (n >= 0) processed++;
        totalCandidates += Math.max(0, n);
      } catch (err) {
        log.warn(`[failure-curator-worker] orgId=${orgId} agent=${agentSlug} failed:`, errMsg(err));
      }
    }
    log.info(`[failure-curator-worker] tick done: ${processed}/${active.length} agents processed, ${totalCandidates} candidates in ${Date.now() - tStart}ms`);
  } finally {
    running = false;
  }
}

/** Returns the number of NEW candidates emitted, or -1 if we skipped early. */
async function processAgent(orgId: string, agentSlug: string): Promise<number> {
  // 1. Watermark lookup
  const state = await prisma.agentCuratorState.findFirst({ where: { orgId, agentSlug } });
  const now = new Date();
  const fallbackSince = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const since = state?.lastProcessedAt ?? fallbackSince;

  const { emitted, advanceTo } = await processAgentRange(orgId, agentSlug, since, now, /*advanceWatermark=*/true);
  if (emitted === -1) return -1;

  // Watermark advance happens inside processAgentRange when advanceWatermark=true.
  // Returning here for symmetry with the existing caller.
  void advanceTo;
  return emitted;
}

/**
 * Watermark-agnostic core. Given an explicit (since, now) window, runs the
 * full negative-detection → curator-call → dedupe-merge pipeline. The
 * watermark is only touched when `advanceWatermark` is true.
 *
 * Exposed because the backfill endpoint reuses it for "process last 7 days
 * regardless of watermark" without disturbing the hourly worker's state.
 *
 * Returns { emitted: number, advanceTo: Date | null }. `emitted = -1` means
 * we skipped early (too few negatives, LLM error, etc.) — the caller decides
 * whether that's a noop or a soft error.
 */
export async function processAgentRange(
  orgId: string,
  agentSlug: string,
  since: Date,
  now: Date,
  advanceWatermark = false,
): Promise<{ emitted: number; advanceTo: Date | null }> {
  const agentRow = await prisma.agent.findUnique({
    where: { orgId_slug: { orgId, slug: agentSlug } },
    select: { orgId: true, systemPrompt: true },
  });
  if (!agentRow) {
    log.warn(`[failure-curator-worker] missing agent slug=${agentSlug} orgId=${orgId}; skipping curator run`);
    return { emitted: -1, advanceTo: null };
  }

  // 2. Detect negatives
  const negatives = await selectNegativeSessions({ orgId, agentSlug, since, now, maxPerBucket: 40 });
  if (negatives.length < MIN_BATCH) {
    // Diagnostic log so we can see exactly how many negatives each agent
    // produced, and which bucket. Without this the only signal is "0/N
    // agents processed" which leaves us guessing whether to loosen
    // thresholds or MIN_BATCH.
    if (negatives.length > 0) {
      const byBucket: Record<string, number> = {};
      for (const n of negatives) byBucket[n.bucket] = (byBucket[n.bucket] ?? 0) + 1;
      log.info(`[failure-curator-worker] skip orgId=${orgId} agent=${agentSlug}: ${negatives.length} negatives below MIN_BATCH=${MIN_BATCH} (${JSON.stringify(byBucket)})`);
    }
    // Don't advance the watermark — accumulate until we have enough.
    return { emitted: -1, advanceTo: null };
  }
  log.info(`[failure-curator-worker] process orgId=${orgId} agent=${agentSlug}: ${negatives.length} negatives, calling curator`);

  // 3. Pull contextWindow for pattern context (NOT used as evidence by the LLM)
  const ctxSince = new Date(Math.max(now.getTime() - MAX_CONTEXT_WINDOW_DAYS * 24 * 60 * 60 * 1000, 0));
  const context = await prisma.agentRun.findMany({
    where: { orgId: agentRow.orgId, agentSlug, completedAt: { gte: ctxSince, lt: now } },
    select: { sessionId: true, status: true, task: true, totalMs: true, completedAt: true, llmTotalMs: true, toolMs: true, llmRetries: true, lastRetryReason: true, result: true, error: true },
    orderBy: { completedAt: "desc" },
    take: MAX_CONTEXT_SESSIONS,
  });

  // 4. Resolve current systemPrompt so the curator doesn't propose duplicate rules
  // 5. Call claw curator
  const payload = {
    agentSlug,
    systemPrompt: agentRow?.systemPrompt ?? undefined,
    newNegatives: negatives.map((n) => trimForCurator(n)),
    contextWindow: context.map((c) => ({
      sessionId: c.sessionId,
      completedAt: c.completedAt!.toISOString(),
      status: c.status,
      task: c.task,
      result: c.result,
      error: c.error,
      totalMs: c.totalMs,
      llmTotalMs: c.llmTotalMs,
      toolMs: c.toolMs,
      llmRetries: c.llmRetries,
      lastRetryReason: c.lastRetryReason,
    })),
  };

  let candidates: CuratorCandidate[] = [];
  try {
    const res = await fetch(`${CLAW_URL}/internal/failure-curator/distill`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-s2s-key": S2S_KEY },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      log.warn(`[failure-curator-worker] claw responded ${res.status} for orgId=${orgId} agent=${agentSlug}`);
      return { emitted: -1, advanceTo: null }; // don't advance — try again next tick
    }
    const json = await res.json() as { success?: boolean; candidates?: CuratorCandidate[] };
    candidates = json.candidates ?? [];
  } catch (err) {
    log.warn(`[failure-curator-worker] claw call failed for orgId=${orgId} agent=${agentSlug}:`, errMsg(err));
    return { emitted: -1, advanceTo: null };
  }

  // 6. Dedupe-merge and upsert
  const newWatermark = negatives.reduce((m, n) => (n.completedAt.getTime() > m.getTime() ? n.completedAt : m), since);
  let emitted = 0;
  for (const c of candidates) {
    const merged = await dedupeMergeOrInsert(agentSlug, agentRow.orgId, c);
    if (merged === "inserted") emitted++;
  }

  // 7. Advance watermark only if caller asked. Backfill skips this so the
  //    hourly worker's incremental scan isn't disturbed.
  if (advanceWatermark) {
    const existingState = await prisma.agentCuratorState.findFirst({ where: { orgId: agentRow.orgId, agentSlug } });
    if (existingState) {
      await prisma.agentCuratorState.update({
        where: { agentSlug: existingState.agentSlug },
        data: {
          lastProcessedAt: newWatermark,
          lastRunAt: now,
          invocationCount: { increment: 1 },
          candidateCount: { increment: emitted },
        },
      });
    } else {
      try {
        await prisma.agentCuratorState.create({
          data: {
            agentSlug,
            orgId: agentRow.orgId,
            lastProcessedAt: newWatermark,
            lastRunAt: now,
            invocationCount: 1,
            candidateCount: emitted,
            updatedAt: now,
          },
        });
      } catch (err) {
        log.error(`[failure-curator-worker] state create failed orgId=${agentRow.orgId} agent=${agentSlug}; schema lacks orgId_agentSlug unique key`, errMsg(err));
      }
    }
  }

  return { emitted, advanceTo: newWatermark };
}

export interface BackfillReport {
  windowStart: string;
  windowEnd: string;
  agentsConsidered: number;
  agentsProcessed: number;
  agentsSkipped: number;
  candidatesEmitted: number;
  perAgent: Array<{ orgId: string; agentSlug: string; emitted: number; skippedReason?: string }>;
}

/**
 * Manually re-run the curator over the last N days for all (or one) agent.
 * Backfill never advances the watermark — it's purely additive: new
 * candidates land if the curator finds patterns, existing pending
 * candidates absorb new evidence via dedupe-merge.
 *
 * Concurrency cap CONCURRENCY (default 3) limits parallel LLM calls so we
 * don't blow LiteLLM quota when run against a large workspace.
 */
const CONCURRENCY = Number(process.env["FAILURE_CURATOR_BACKFILL_CONCURRENCY"] ?? 3);

export async function backfillFailureCurator(opts: {
  /** When set, only process this agent. */
  agentSlug?: string;
  /** How many days back to look. Default 7. */
  days?: number;
}): Promise<BackfillReport> {
  const days = Math.max(1, Math.min(30, opts.days ?? 7));
  const now = new Date();
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  // Decide the agent set
  let agentPairs: Array<{ orgId: string; agentSlug: string }>;
  if (opts.agentSlug) {
    agentPairs = await prisma.agent.findMany({
      where: { slug: opts.agentSlug },
      select: { orgId: true, slug: true },
    }).then((rows) => rows.map((row) => ({ orgId: row.orgId, agentSlug: row.slug })));
  } else {
    agentPairs = await prisma.$queryRaw<Array<{ orgId: string; agentSlug: string }>>`
      SELECT DISTINCT "orgId", "agentSlug" FROM "agent_runs"
       WHERE "completedAt" >= ${since}
         AND "orgId" IS NOT NULL
    `;
    agentPairs = agentPairs.sort((a, b) => a.agentSlug.localeCompare(b.agentSlug) || a.orgId.localeCompare(b.orgId));
  }

  const perAgent: BackfillReport["perAgent"] = [];
  let processed = 0;
  let skipped = 0;
  let totalEmitted = 0;

  // Run with a bounded concurrency. Simple semaphore via Promise.all on
  // chunks — clean enough for ≤200 agents (the realistic ceiling).
  for (let i = 0; i < agentPairs.length; i += CONCURRENCY) {
    const chunk = agentPairs.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(async ({ orgId, agentSlug: slug }) => {
      try {
        const { emitted } = await processAgentRange(orgId, slug, since, now, /*advanceWatermark=*/false);
        return { orgId, slug, emitted, skippedReason: undefined as string | undefined };
      } catch (err) {
        return { orgId, slug, emitted: -1, skippedReason: errMsg(err) };
      }
    }));
    for (const r of results) {
      if (r.emitted < 0) {
        skipped++;
        perAgent.push({
          orgId: r.orgId,
          agentSlug: r.slug,
          emitted: 0,
          ...(r.skippedReason ? { skippedReason: r.skippedReason } : { skippedReason: `too few negatives (<${MIN_BATCH}) or LLM error` }),
        });
      } else {
        processed++;
        totalEmitted += r.emitted;
        perAgent.push({ orgId: r.orgId, agentSlug: r.slug, emitted: r.emitted });
      }
    }
  }

  return {
    windowStart: since.toISOString(),
    windowEnd: now.toISOString(),
    agentsConsidered: agentPairs.length,
    agentsProcessed: processed,
    agentsSkipped: skipped,
    candidatesEmitted: totalEmitted,
    perAgent: perAgent.sort((a, b) => b.emitted - a.emitted),
  };
}

function trimForCurator(n: NegativeSession) {
  // Curator on claw expects a simpler shape (toolInvocations as a small
  // array of {toolName, durationMs, isError}). Map JSON safely.
  const invs = Array.isArray(n.toolInvocations) ? n.toolInvocations : [];
  const tools = invs
    .slice(0, 12)
    .map((inv) => {
      const o = inv as Record<string, unknown>;
      return {
        toolName: typeof o["toolName"] === "string" ? (o["toolName"] as string) : "(unknown)",
        ...(typeof o["durationMs"] === "number" ? { durationMs: o["durationMs"] as number } : {}),
        ...(o["isError"] === true ? { isError: true } : {}),
      };
    });
  return {
    sessionId: n.sessionId,
    bucket: n.bucket,
    completedAt: n.completedAt.toISOString(),
    status: n.status,
    task: n.task,
    result: n.result,
    error: n.error,
    totalMs: n.totalMs,
    llmTotalMs: n.llmTotalMs,
    toolMs: n.toolMs,
    llmRetries: n.llmRetries,
    lastRetryReason: n.lastRetryReason,
    toolInvocations: tools,
    frustrationFollowup: n.frustrationFollowup?.text ?? null,
  };
}

/**
 * Dedupe-merge: find an existing pending candidate with same (agentSlug,
 * bucket, rootCause) that overlaps on evidence sessionIds. If found, merge
 * evidence into it (union, capped), bump confidence if appropriate, and
 * touch updatedAt. Otherwise insert a fresh row.
 *
 * Returns "inserted" or "merged" — caller uses that for the candidateCount.
 */
async function dedupeMergeOrInsert(agentSlug: string, orgId: string, c: CuratorCandidate): Promise<"inserted" | "merged" | "suppressed"> {
  // Suppression: if a recent dismiss for this (bucket, rootCause) is still
  // within its 7-day cool-down, skip silently.
  const cool = await prisma.agentImprovementCandidate.findFirst({
    where: {
      orgId,
      agentSlug,
      bucket: c.bucket,
      rootCause: c.rootCause,
      status: "dismissed",
      updatedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    },
    select: { id: true },
  });
  if (cool) return "suppressed";

  // Find pending overlap
  const existing = await prisma.agentImprovementCandidate.findMany({
    where: { orgId, agentSlug, bucket: c.bucket, rootCause: c.rootCause, status: "pending" },
    select: { id: true, evidence: true, confidence: true, metadata: true },
    orderBy: { updatedAt: "desc" },
    take: 5,
  });

  const newEv = new Set(c.evidence);
  for (const e of existing) {
    const evArr = Array.isArray(e.evidence) ? (e.evidence as string[]) : [];
    const overlap = evArr.some((s) => newEv.has(s));
    if (!overlap) continue;
    // Merge
    const mergedEv = Array.from(new Set([...evArr, ...c.evidence])).slice(0, 24);
    const meta = (e.metadata as Record<string, unknown> | null) ?? {};
    const mergeCount = typeof meta["mergeCount"] === "number" ? (meta["mergeCount"] as number) + 1 : 2;
    const nextConfidence: "high" | "medium" | "low" =
      mergedEv.length >= 4 ? "high" : mergedEv.length >= 2 ? "medium" : "low";
    await prisma.agentImprovementCandidate.update({
      where: { id: e.id },
      data: {
        evidence: mergedEv as unknown as Prisma.InputJsonValue,
        confidence: nextConfidence,
        metadata: { ...meta, mergeCount } as unknown as Prisma.InputJsonValue,
      },
    });
    return "merged";
  }

  await prisma.agentImprovementCandidate.create({
    data: {
      agentSlug,
      orgId,
      bucket: c.bucket,
      rootCause: c.rootCause,
      finding: c.finding,
      evidence: c.evidence as unknown as Prisma.InputJsonValue,
      proposedFix: c.proposedFix as unknown as Prisma.InputJsonValue,
      confidence: c.confidence,
      metadata: { mergeCount: 1 } as unknown as Prisma.InputJsonValue,
    },
  });
  return "inserted";
}
