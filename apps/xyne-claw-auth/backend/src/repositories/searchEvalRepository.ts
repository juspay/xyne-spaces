import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

/** One row parsed from an uploaded CSV. `goldId` is the gold doc's own Vespa
 *  docId — the same id transformHit()/resultTransform.ts put in a result's
 *  top-level `id` for every entity type (see mapper.ts's docId assignments:
 *  messageId for a message, the file's own id, channelId, callId, the email's
 *  own id, or a ticket's internal id). */
export interface SearchEvalQueryInput {
  query: string;
  goldAnswer?: string | null;
  goldId: string;
}

/** One of up to 20 fetched hits kept alongside a run result, for manual
 *  review/debugging — the first 10 are what's actually scored for hit/rank;
 *  10-20 exist purely so a "miss" row can show where the gold doc really
 *  landed instead of just "not in the top 10". `id` is the result's own
 *  Vespa docId — the same value goldId is scored against — `xyneId` is a
 *  ticket's human-facing number when the hit is a ticket. `messageId`/
 *  `conversationId` are kept for message-specific display. */
export interface SearchEvalTopResult {
  id?: string | null;
  xyneId?: string | null;
  messageId?: string | null;
  conversationId?: string | null;
  relevanceScore?: number | null;
  snippet?: string | null;
  /** Full untouched result object (title, type, subtitle, metadata, the
   *  complete searchContext) — everything the search API returned for this
   *  hit, for switching between and inspecting each of the top-20 in full. */
  raw?: Record<string, unknown> | null;
}

/** One captured Vespa query stage, kept for manual confirmation in the UI. */
export interface SearchEvalDebugPayload {
  stage: string;
  yql: string;
  vespaParams: Record<string, unknown>;
}

interface TopKStat {
  count: number;
  pct: number | null;
}

export interface SearchEvalRunSummary {
  queriesTotal: number;
  queriesScored: number;
  top1: TopKStat;
  top3: TopKStat;
  top10: TopKStat;
  mrr: number | null;
}

/**
 * Top1/Top3/Top10 count+% and Mean Reciprocal Rank over a run's per-query
 * outcomes. `scored` rows are ones the worker has actually processed (hit is
 * non-null) — percentages and MRR are denominated over that set, not the full
 * sheet, so an in-progress run's numbers reflect what's actually been run so
 * far. TOP_K in the worker is 10, so "top10" is every hit; MRR treats a miss
 * as contributing 0 (the standard convention).
 */
export function computeSearchEvalSummary(
  rows: Array<{ hit: boolean | null; rank: number | null }>,
): SearchEvalRunSummary {
  const scored = rows.filter((r) => r.hit !== null);
  const hits = scored.filter((r) => r.hit === true && r.rank != null);
  const n = scored.length;
  const stat = (count: number): TopKStat => ({ count, pct: n > 0 ? count / n : null });
  const top1 = hits.filter((r) => r.rank === 1).length;
  const top3 = hits.filter((r) => r.rank !== null && r.rank <= 3).length;
  const top10 = hits.length;
  const mrr = n > 0 ? hits.reduce((sum, r) => sum + 1 / (r.rank as number), 0) / n : null;
  return {
    queriesTotal: rows.length,
    queriesScored: n,
    top1: stat(top1),
    top3: stat(top3),
    top10: stat(top10),
    mrr,
  };
}

/** Reshapes the flat summary columns on a SearchEvalRun row back into the
 *  nested {top1: {count, pct}, ...} shape callers (and the frontend) work
 *  with. `queriesTotal` isn't stored (it's just the sheet's query count, always
 *  the same for a given sheet since sheets are upload-once/immutable) — pass
 *  it in from whatever query already loaded the sheet's rows. */
export function toMetricsSummary(
  row: {
    queriesScored: number | null;
    top1Count: number | null;
    top1Pct: number | null;
    top3Count: number | null;
    top3Pct: number | null;
    top10Count: number | null;
    top10Pct: number | null;
    mrr: number | null;
  },
  queriesTotal: number,
): SearchEvalRunSummary {
  return {
    queriesTotal,
    queriesScored: row.queriesScored ?? 0,
    top1: { count: row.top1Count ?? 0, pct: row.top1Pct },
    top3: { count: row.top3Count ?? 0, pct: row.top3Pct },
    top10: { count: row.top10Count ?? 0, pct: row.top10Pct },
    mrr: row.mrr,
  };
}

export const searchEvalRepository = {
  // ── Sheets ────────────────────────────────────────────────────────────
  createSheet: (input: {
    name: string;
    description?: string | null;
    orgId: string;
    permissionMode: "with" | "without";
    asOfTimestamp?: Date | null;
    createdBy?: string | null;
    queries: SearchEvalQueryInput[];
  }) =>
    prisma.searchEvalSheet.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        orgId: input.orgId,
        permissionMode: input.permissionMode,
        asOfTimestamp: input.asOfTimestamp ?? null,
        ...(input.createdBy ? { createdBy: input.createdBy } : {}),
        queries: { create: input.queries },
      },
      include: { _count: { select: { queries: true } } },
    }),

  /** All sheets for an org, with query counts and most recent run status. */
  listSheets: (orgId: string) =>
    prisma.searchEvalSheet.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { queries: true } },
        runs: { orderBy: { startedAt: "desc" }, take: 1 },
      },
    }),

  getSheet: (id: string) =>
    prisma.searchEvalSheet.findUnique({
      where: { id },
      include: { queries: true },
    }),

  // ── Runs ──────────────────────────────────────────────────────────────
  createRun: (input: {
    sheetId: string;
    orgId: string;
    queryType: string[];
    rankProfile?: string | null;
    rankProfileInputs?: Record<string, number> | null;
    permissionMode: "with" | "without";
    asOfTimestamp?: Date | null;
    createdBy?: string | null;
  }) =>
    prisma.searchEvalRun.create({
      data: {
        sheetId: input.sheetId,
        orgId: input.orgId,
        queryType: input.queryType,
        rankProfile: input.rankProfile ?? null,
        rankProfileInputs: (input.rankProfileInputs ?? undefined) as unknown as Prisma.InputJsonValue,
        permissionMode: input.permissionMode,
        asOfTimestamp: input.asOfTimestamp ?? null,
        ...(input.createdBy ? { createdBy: input.createdBy } : {}),
      },
    }),

  /** `summary`, when given, is written alongside `completedAt` — the
   *  persisted Top1/Top3/Top10/MRR snapshot for the run (see
   *  computeSearchEvalSummary/toMetricsSummary). */
  updateRunStatus: (runId: string, status: "running" | "completed" | "failed", summary?: SearchEvalRunSummary) =>
    prisma.searchEvalRun.update({
      where: { id: runId },
      data: {
        status,
        ...(status !== "running" ? { completedAt: new Date() } : {}),
        ...(summary
          ? {
              queriesScored: summary.queriesScored,
              top1Count: summary.top1.count,
              top1Pct: summary.top1.pct,
              top3Count: summary.top3.count,
              top3Pct: summary.top3.pct,
              top10Count: summary.top10.count,
              top10Pct: summary.top10.pct,
              mrr: summary.mrr,
            }
          : {}),
      },
    }),

  getRun: (runId: string) => prisma.searchEvalRun.findUnique({ where: { id: runId } }),

  /** Full run history for a sheet, newest first — the "chat list" of past runs. */
  listRunsForSheet: (sheetId: string) =>
    prisma.searchEvalRun.findMany({
      where: { sheetId },
      orderBy: { startedAt: "desc" },
      include: { _count: { select: { results: true } } },
    }),

  /** Run + its sheet's queries + any results written so far, for the polling/detail view. */
  getRunWithResults: (runId: string) =>
    prisma.searchEvalRun.findUnique({
      where: { id: runId },
      include: {
        sheet: { include: { queries: true } },
        results: true,
      },
    }),

  // ── Results ───────────────────────────────────────────────────────────
  upsertResult: (input: {
    runId: string;
    queryId: string;
    hit: boolean;
    rank?: number | null;
    topResults: SearchEvalTopResult[];
    debug?: SearchEvalDebugPayload[];
  }) =>
    prisma.searchEvalResult.upsert({
      where: { runId_queryId: { runId: input.runId, queryId: input.queryId } },
      create: {
        runId: input.runId,
        queryId: input.queryId,
        hit: input.hit,
        rank: input.rank ?? null,
        topResults: input.topResults as unknown as Prisma.InputJsonValue,
        debug: (input.debug ?? []) as unknown as Prisma.InputJsonValue,
      },
      update: {
        hit: input.hit,
        rank: input.rank ?? null,
        topResults: input.topResults as unknown as Prisma.InputJsonValue,
        debug: (input.debug ?? []) as unknown as Prisma.InputJsonValue,
      },
    }),
};
