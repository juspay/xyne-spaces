/**
 * The one place claw-auth metrics run raw SQL. Their aggregates (percentile_cont,
 * FILTER, day bins, jsonb expansion) have no query-builder form; every query is
 * read-only and scoped by windowPredicate or statsWindowPredicate in metrics-core.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

/** Shared DB with the live run path: analytics must fail fast. */
const DEFAULT_TIMEOUT_MS = 8_000;

export const MAX_ANALYTICS_WORK_MEM_MB = 128;

export interface RunAnalyticsOptions {
  timeoutMs?: number;
  customPlan?: boolean;
  /** work_mem in MB, clamped to 1..MAX_ANALYTICS_WORK_MEM_MB; it is per sort/hash node per process. */
  workMemMb?: number;
}

/**
 * Runs one statement in a transaction after transaction-local settings:
 * statement_timeout, jit off (it cost 0.5-1.3 s on these aggregates), optionally
 * force_custom_plan (the generic plan was 100x slower on skewed probes) and work_mem.
 */
export async function runAnalytics<T>(query: Prisma.Sql, opts: RunAnalyticsOptions = {}): Promise<T[]> {
  const timeoutMs = Math.max(1, Math.trunc(Number.isFinite(opts.timeoutMs) ? (opts.timeoutMs as number) : DEFAULT_TIMEOUT_MS));
  const workMemMb = Number.isFinite(opts.workMemMb)
    ? Math.min(Math.max(Math.trunc(opts.workMemMb as number), 1), MAX_ANALYTICS_WORK_MEM_MB)
    : undefined;
  const settings = [
    Prisma.sql`set_config('statement_timeout', ${String(timeoutMs)}, true)`,
    Prisma.sql`set_config('jit', 'off', true)`,
    ...(opts.customPlan ? [Prisma.sql`set_config('plan_cache_mode', 'force_custom_plan', true)`] : []),
    ...(workMemMb !== undefined ? [Prisma.sql`set_config('work_mem', ${`${workMemMb}MB`}, true)`] : []),
  ];
  const [, rows] = await prisma.$transaction([prisma.$queryRaw(Prisma.sql`SELECT ${Prisma.join(settings)}`), prisma.$queryRaw<T[]>(query)]);
  return rows;
}
