/**
 * TEMPORARY — remove once the prod toolStats backfill is finished.
 *
 * Existed for one job: driving `backfillToolStats` over ~100k historical
 * `agent_runs` from an operator's laptop, in bounded steps, without saturating
 * the database the live agent write path shares.
 *
 * ── To remove ─────────────────────────────────────────────────────────────
 *   1. delete this file
 *   2. delete the import and the `app.use(.../internal/backfill, ...)` line in
 *      main.ts (both are tagged TEMP-BACKFILL)
 * Nothing else references it. `lib/tool-stats-backfill.ts` STAYS — it is the
 * mechanism, and a future column addition will want it again.
 *
 * ── Why an endpoint rather than a one-shot job ────────────────────────────
 * Each POST does a bounded amount of work and returns how much is left, so the
 * client — not the server — controls pacing. That keeps every request short
 * enough to survive an ingress timeout, makes the work resumable after any
 * failure, and lets the operator watch `remaining` fall and stop at any point.
 *
 * ── Auth ──────────────────────────────────────────────────────────────────
 * Mounted under `/internal` behind `requireStrictS2S`, so it needs the service
 * key and is unreachable from a logged-in browser. That is also what makes it
 * runnable from a laptop: no session cookie required.
 */

import { Router, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { backfillToolStats } from "../lib/tool-stats-backfill.js";
import { createLogger } from "../logger.js";

const log = createLogger("backfill-temp");

export const backfillTempRouter = Router();

/** Ceilings, so a typo in a curl cannot ask for an unbounded pass. */
const LIMITS = {
  maxRows: { def: 500, min: 1, max: 5000 },
  batchSize: { def: 200, min: 1, max: 1000 },
  pauseMs: { def: 100, min: 0, max: 10_000 },
} as const;

function clamp(raw: unknown, spec: { def: number; min: number; max: number }): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return spec.def;
  return Math.min(Math.max(Math.trunc(n), spec.min), spec.max);
}

/**
 * Rows still needing a summary.
 *
 * Same predicate the backfill selects on and the same denominator
 * `fetchToolStatsCoverage` uses, so `remaining === 0` and `coverage === 1` mean
 * the same thing and cannot disagree.
 */
async function counts(): Promise<{ total: number; done: number; remaining: number; coverage: number }> {
  const [row] = await prisma.$queryRaw<Array<{ total: bigint; done: bigint }>>(Prisma.sql`
    SELECT count(*) AS total,
           count(*) FILTER (WHERE "toolStats" IS NOT NULL) AS done
    FROM "agent_runs"
    WHERE "toolInvocations" IS NOT NULL
  `);
  const total = Number(row?.total ?? 0);
  const done = Number(row?.done ?? 0);
  return { total, done, remaining: total - done, coverage: total > 0 ? done / total : 1 };
}

/** GET /claw/api/v1/internal/backfill/status — how much is left. Read-only. */
backfillTempRouter.get("/status", async (_req: Request, res: Response) => {
  try {
    res.json(await counts());
  } catch (err) {
    log.error("[backfill/status] error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

/**
 * POST /claw/api/v1/internal/backfill/run — one bounded step.
 *
 * Body: { maxRows?, batchSize?, pauseMs?, sinceDays? }
 *
 * Safe to call repeatedly and safe to interrupt: the selection predicate is
 * "not yet summarised", so a re-run resumes rather than redoing. Returns
 * `remaining` so the caller knows when to stop.
 */
backfillTempRouter.post("/run", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const maxRows = clamp(body["maxRows"], LIMITS.maxRows);
  const batchSize = clamp(body["batchSize"], LIMITS.batchSize);
  const pauseMs = clamp(body["pauseMs"], LIMITS.pauseMs);
  const sinceDays = Number(body["sinceDays"]);

  try {
    const report = await backfillToolStats({
      maxRows,
      batchSize,
      pauseMs,
      ...(Number.isFinite(sinceDays) && sinceDays > 0
        ? { since: new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000) }
        : {}),
    });
    const after = await counts();
    log.info(`[backfill/run] ${JSON.stringify({ ...report, remaining: after.remaining })}`);
    res.json({ ...report, ...after });
  } catch (err) {
    log.error("[backfill/run] error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});
