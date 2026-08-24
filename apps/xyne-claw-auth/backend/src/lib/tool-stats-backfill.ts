/**
 * Backfill `agent_runs.toolStats` for runs finalised before the column existed.
 *
 * Runs with a NULL `toolStats` are invisible to the precomputed read path, so
 * until this completes every fast-path number under-reports its window. The
 * read side exposes `fetchToolStatsCoverage` for exactly that reason — check it
 * before trusting a backfilled window.
 *
 * ── Why it is shaped this way ─────────────────────────────────────────────
 * The summary is computed in TypeScript by the same `summarizeToolInvocations`
 * the live write path uses, so backfilled and freshly-written rows can never
 * diverge — an equivalent SQL reimplementation would be a second definition to
 * keep in sync.
 *
 * The cost is unavoidable: producing the summary requires reading the blob it
 * summarises, so the backfill pays the same detoast the queries used to pay,
 * once, forever. It is therefore chunked by primary key with a bounded batch
 * size and an explicit inter-batch pause, so it can run against a live database
 * without starving the agent write path.
 *
 * Resumable and CONVERGENT: it selects only rows where `toolStats IS NULL`, and
 * every row it touches leaves that set — including rows with nothing to
 * summarise, which are written as `[]`. Leaving those NULL would make each
 * batch re-read the same rows at the head of the id order, so the run would
 * never finish and `fetchToolStatsCoverage` could never reach 1.0.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { summarizeToolInvocations } from "./tool-stats.js";
import { createLogger } from "../logger.js";

const log = createLogger("tool-stats-backfill");

export interface BackfillOptions {
  /** Rows per batch. Larger batches detoast more per statement. */
  batchSize?: number;
  /** Stop after this many rows. Omit to run to completion. */
  maxRows?: number;
  /** Idle pause between batches, giving the write path room. */
  pauseMs?: number;
  /** Only consider runs completed on or after this instant. */
  since?: Date;
}

export interface BackfillReport {
  scanned: number;
  summarised: number;
  /**
   * Runs whose invocations yielded no per-tool rows — an empty array, a
   * non-array value, or entries with no toolName. Written as `[]`, NOT left
   * NULL: a NULL row still matches the selection predicate, so it would be
   * re-read on every batch, the run would never terminate, and coverage could
   * never reach 1.0. `[]` reads identically to NULL in every aggregate and
   * correctly means "summarised: this run used no tools".
   */
  emptied: number;
  batches: number;
  durationMs: number;
}

const DEFAULTS = { batchSize: 200, pauseMs: 50 } as const;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Summarise every un-summarised run, oldest first.
 *
 * Returns counts rather than throwing on a single bad row: one malformed
 * invocations blob should not abort a backfill over months of history.
 */
export async function backfillToolStats(opts: BackfillOptions = {}): Promise<BackfillReport> {
  const batchSize = opts.batchSize ?? DEFAULTS.batchSize;
  const pauseMs = opts.pauseMs ?? DEFAULTS.pauseMs;
  const startedAt = Date.now();

  let scanned = 0;
  let summarised = 0;
  let emptied = 0;
  let batches = 0;
  let cursor: string | undefined;

  for (;;) {
    if (opts.maxRows !== undefined && scanned >= opts.maxRows) break;

    const take = opts.maxRows !== undefined ? Math.min(batchSize, opts.maxRows - scanned) : batchSize;
    const rows = await prisma.agentRun.findMany({
      where: {
        // Prisma.DbNull is SQL NULL; a bare `null` would mean the JSON value
        // `null`, which is a different thing and matches nothing here.
        toolStats: { equals: Prisma.DbNull },
        toolInvocations: { not: Prisma.DbNull },
        ...(opts.since ? { completedAt: { gte: opts.since } } : {}),
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true, result: true, toolInvocations: true },
      orderBy: { id: "asc" },
      take,
    });

    if (rows.length === 0) break;
    batches += 1;
    scanned += rows.length;
    cursor = rows[rows.length - 1]!.id;

    for (const row of rows) {
      try {
        const stats = summarizeToolInvocations(row.toolInvocations, row.result);
        await prisma.agentRun.update({
          where: { id: row.id },
          data: { toolStats: stats ?? [] },
        });
        if (stats) summarised += 1;
        else emptied += 1;
      } catch (err) {
        // Still mark it, or a single malformed blob blocks the cursor forever.
        emptied += 1;
        log.warn(`[backfill] run ${row.id} not summarisable: ${err instanceof Error ? err.message : String(err)}`);
        await prisma.agentRun
          .update({ where: { id: row.id }, data: { toolStats: [] } })
          .catch(() => {});
      }
    }

    log.info(`[backfill] batch ${batches}: scanned=${scanned} summarised=${summarised} emptied=${emptied}`);
    if (pauseMs > 0) await sleep(pauseMs);
  }

  const report: BackfillReport = { scanned, summarised, emptied, batches, durationMs: Date.now() - startedAt };
  log.info(`[backfill] done: ${JSON.stringify(report)}`);
  return report;
}
