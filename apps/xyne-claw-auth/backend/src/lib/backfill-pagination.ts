/**
 * Pure query-validation and response-summary helpers for the
 * admin signing-secret backfill route. Kept IO-free so the route's
 * behavior is unit-testable without a database.
 */

export const BACKFILL_MIN_LIMIT = 1;
export const BACKFILL_DEFAULT_LIMIT = 100;
export const BACKFILL_MAX_LIMIT = 500;

export type BackfillLimitParse =
  | {
      ok: true;
      limit: number;
    }
  | {
      ok: false;
      error: string;
    };

export function parseBackfillLimit(
  rawLimit: unknown,
): BackfillLimitParse {
  if (rawLimit === undefined) {
    return {
      ok: true,
      limit: BACKFILL_DEFAULT_LIMIT,
    };
  }

  if (
    typeof rawLimit !== "string" ||
    !/^[1-9][0-9]*$/.test(rawLimit)
  ) {
    return {
      ok: false,
      error: "limit must be a positive integer",
    };
  }

  const limit = Number(rawLimit);

  if (
    !Number.isSafeInteger(limit) ||
    limit < BACKFILL_MIN_LIMIT ||
    limit > BACKFILL_MAX_LIMIT
  ) {
    return {
      ok: false,
      error: `limit must be between ${BACKFILL_MIN_LIMIT} and ${BACKFILL_MAX_LIMIT}`,
    };
  }

  return {
    ok: true,
    limit,
  };
}

export interface BackfillPagePlan<T> {
  page: T[];
  hasMore: boolean;
  nextAfter: string | null;
}

/**
 * The route fetches up to limit + 1 rows. The extra row only
 * signals that another page exists and is never processed, so a
 * final page that happens to contain exactly `limit` rows does
 * not emit a phantom cursor.
 */
export function planBackfillPage<T extends { id: string }>(
  rows: T[],
  limit: number,
): BackfillPagePlan<T> {
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const lastProcessed = page.at(-1);

  return {
    page,
    hasMore,
    nextAfter:
      hasMore && lastProcessed
        ? lastProcessed.id
        : null,
  };
}

export type BackfillRowResult =
  | {
      slug: string;
      agentId: string;
      ok: true;
      action: "validated" | "updated";
    }
  | {
      slug: string;
      agentId: string;
      ok: false;
      reason: string;
    };

export interface BackfillBatchResponse {
  success: boolean;
  data: {
    partialFailure: boolean;
    dryRun: boolean;
    overwrite: boolean;
    slug: string | null;
    after: string | null;
    limit: number;
    nextAfter: string | null;
    total: number;
    ok: number;
    failed: number;
    results: BackfillRowResult[];
  };
}

/**
 * Top-level success is false whenever any row failed, while the
 * full per-agent result set (including successful rows) is always
 * returned. A zero-row batch with zero failures succeeds.
 */
export function buildBackfillBatchResponse(args: {
  dryRun: boolean;
  overwrite: boolean;
  slug: string | null;
  after: string | null;
  limit: number;
  nextAfter: string | null;
  results: BackfillRowResult[];
}): BackfillBatchResponse {
  const okCount = args.results.filter(
    (result) => result.ok,
  ).length;

  const failCount = args.results.length - okCount;

  return {
    success: failCount === 0,
    data: {
      partialFailure: failCount > 0,
      dryRun: args.dryRun,
      overwrite: args.overwrite,
      slug: args.slug,
      after: args.after,
      limit: args.limit,
      nextAfter: args.nextAfter,
      total: args.results.length,
      ok: okCount,
      failed: failCount,
      results: args.results,
    },
  };
}
