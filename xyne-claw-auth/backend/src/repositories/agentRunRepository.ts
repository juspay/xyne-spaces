import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { formatDayIST } from "../lib/ist-time.js";

/** Inclusive window for time-series padding. `null` = all time (unbounded left). */
export type TimeWindow = { start: Date; end: Date } | null;

export interface StartRunInput {
  sessionId: string;
  userId: string;
  agentSlug: string;
  triggerSource: "spaces" | "scheduled" | "chat" | "api";
  task: string;
  conversationId?: string | null;
  scheduledJobId?: string | null;
  channelId?: string | null;
  projectId?: string | null;
  projectName?: string | null;
}

export interface FinalizeRunInput {
  status: "completed" | "failed" | "cancelled";
  result?: string | null;
  error?: string | null;
  toolsUsed?: string[];
  toolInvocations?: unknown;    // Prisma JSON — array of tool call details
  tokenUsage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  /** Wall-clock breakdown from claw — see xyne-claw LatencyMetrics. */
  latency?: {
    totalMs?: number;
    llmTotalMs?: number;
    llmDecodeMs?: number;
    llmWaitMs?: number;
    llmTurns?: number;
    llmRetries?: number;
    firstTurnTtftMs?: number;
    tokensPerSec?: number;
    toolMs?: number;
    lastRetryReason?: string;
  };
}

export const agentRunRepository = {
  start: (input: StartRunInput) =>
    prisma.agentRun.create({
      data: {
        sessionId: input.sessionId,
        userId: input.userId,
        agentSlug: input.agentSlug,
        triggerSource: input.triggerSource,
        task: input.task,
        status: "running",
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        ...(input.scheduledJobId ? { scheduledJobId: input.scheduledJobId } : {}),
        ...(input.channelId ? { channelId: input.channelId } : {}),
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(input.projectName ? { projectName: input.projectName } : {}),
      },
    }),

  updateProgress: (sessionId: string, currentToolLabel: string) =>
    prisma.agentRun.updateMany({
      where: { sessionId },
      data: { currentToolLabel },
    }),

  finalize: async (sessionId: string, input: FinalizeRunInput) => {
    // Merge toolInvocations instead of overwriting: the live-streamed array
    // (built via appendToolInvocation on every progress event) includes
    // nested subagent children. The callback's input.toolInvocations contains
    // only the parent agent's own calls. A naive overwrite would drop all
    // child rows on completion, making a just-reloaded chat look different
    // from what the user saw while streaming.
    let finalInvocations: unknown[] | undefined;
    // Always merge once the run is finalizing, even if the callback didn't
    // include its own toolInvocations — we still need to sweep stale
    // "running" placeholders (see below).
    const existingRow = await prisma.agentRun.findUnique({
      where: { sessionId },
      select: { toolInvocations: true },
    });
    const existing = Array.isArray(existingRow?.toolInvocations)
      ? (existingRow!.toolInvocations as Array<Record<string, unknown>>)
      : [];
    const incoming = Array.isArray(input.toolInvocations)
      ? (input.toolInvocations as Array<Record<string, unknown>>)
      : [];
    // Dedupe union keyed by toolCallId (falls back to name+startedAt when the
    // provider didn't include a toolCallId). Preserve insertion order from the
    // existing (streamed) list — that's the temporal order the user saw.
    const keyFor = (inv: Record<string, unknown>): string =>
      String(inv["toolCallId"] ?? `${inv["toolName"] ?? ""}-${inv["startedAt"] ?? ""}`);
    const seen = new Set<string>();
    const merged: Array<Record<string, unknown>> = [];
    for (const inv of existing) {
      const k = keyFor(inv);
      if (!seen.has(k)) { seen.add(k); merged.push(inv); }
    }
    for (const inv of incoming) {
      const k = keyFor(inv);
      if (!seen.has(k)) { seen.add(k); merged.push(inv); }
    }
    // Sweep stale "running" placeholders: by the time finalize fires the run
    // is terminal, so nothing can still be in flight. A lingering "running"
    // row is proof of a dropped tool_execution_end push (network blip, proc
    // restart). Mark it completed with an explanatory result so the UI stops
    // showing a spinner and the child counts ("N done · M running") are honest.
    if (merged.length > 0) {
      for (const inv of merged) {
        if (inv["status"] === "running") {
          inv["status"] = "completed";
          if (!inv["result"]) inv["result"] = "(no result — tool end event was not received)";
        }
      }
      finalInvocations = merged;
    } else if (input.toolInvocations !== undefined) {
      finalInvocations = merged;
    }

    return prisma.agentRun.updateMany({
      where: { sessionId },
      data: {
        status: input.status,
        ...(input.result !== undefined ? { result: input.result } : {}),
        ...(input.error !== undefined ? { error: input.error } : {}),
        ...(input.toolsUsed ? { toolsUsed: input.toolsUsed } : {}),
        ...(finalInvocations !== undefined ? { toolInvocations: finalInvocations as Prisma.InputJsonValue } : {}),
        ...(input.tokenUsage ? {
          tokensIn: input.tokenUsage.input ?? null,
          tokensOut: input.tokenUsage.output ?? null,
          tokensCacheRead: input.tokenUsage.cacheRead ?? null,
          tokensCacheWrite: input.tokenUsage.cacheWrite ?? null,
        } : {}),
        ...(input.latency ? {
          totalMs: input.latency.totalMs ?? null,
          llmTotalMs: input.latency.llmTotalMs ?? null,
          llmDecodeMs: input.latency.llmDecodeMs ?? null,
          llmWaitMs: input.latency.llmWaitMs ?? null,
          llmTurns: input.latency.llmTurns ?? null,
          llmRetries: input.latency.llmRetries ?? null,
          ttftMs: input.latency.firstTurnTtftMs ?? null,
          tokensPerSec: input.latency.tokensPerSec ?? null,
          toolMs: input.latency.toolMs ?? null,
          lastRetryReason: input.latency.lastRetryReason ?? null,
        } : {}),
        completedAt: new Date(),
        currentToolLabel: null,
      },
    });
  },

  rate: (sessionId: string, userId: string, rating: "up" | "down", comment?: string | null) =>
    prisma.agentRun.updateMany({
      where: { sessionId, userId },
      data: { rating, ratingComment: comment ?? null, ratedAt: new Date() },
    }),

  appendToolInvocation: async (sessionId: string, invocation: unknown) => {
    // Read-modify-write with merge-by-toolCallId semantics:
    //   - A "running" placeholder is pushed on tool_execution_start
    //   - A "completed" row is pushed on tool_execution_end with the SAME toolCallId
    // We replace the placeholder in place so the JSON column mirrors the live
    // frontend state (single row per tool call, not duplicated).
    const run = await prisma.agentRun.findUnique({ where: { sessionId }, select: { toolInvocations: true } });
    const existing = Array.isArray(run?.toolInvocations) ? (run!.toolInvocations as Array<Record<string, unknown>>) : [];
    const inv = invocation as Record<string, unknown>;
    const incomingId = inv["toolCallId"];
    let next: unknown[];
    if (incomingId && existing.some((p) => p["toolCallId"] === incomingId)) {
      next = existing.map((p) => p["toolCallId"] === incomingId ? inv : p);
    } else {
      next = [...existing, inv];
    }
    await prisma.agentRun.update({
      where: { sessionId },
      data: { toolInvocations: next as Prisma.InputJsonValue },
    });
  },

  listByUser: (userId: string, opts?: { status?: string; limit?: number; conversationId?: string; agentSlug?: string }) =>
    prisma.agentRun.findMany({
      where: {
        userId,
        ...(opts?.status ? { status: opts.status } : {}),
        ...(opts?.conversationId ? { conversationId: opts.conversationId } : {}),
        ...(opts?.agentSlug ? { agentSlug: opts.agentSlug } : {}),
      },
      orderBy: { startedAt: "desc" },
      take: opts?.limit ?? 50,
    }),

  findBySessionId: (sessionId: string) =>
    prisma.agentRun.findUnique({ where: { sessionId } }),

  /**
   * Lightweight variant of listByUser for the v3 home page.
   *
   * The home page only needs the 6 fields below to compute:
   *   - calendar-day "runs started today"
   *   - top-3 agents by frequency (across whatever window the caller asked for)
   *   - the last run + the activity chart
   *   - the recent sessions list
   *
   * The full `agent_runs` row carries `toolInvocations` (JSON, often hundreds
   * of KB per row), `task` (full prompt text) and `result` (full assistant
   * reply). Selecting * for 200+ rows on every home page load was shipping
   * 10-40 MB to the browser for data that's never rendered. This method
   * exists so we never accidentally regress that.
   *
   * `since` filters by `startedAt >= since` — the home chart's 7-day window
   * is self-limiting by time, so callers usually don't need a row cap. We
   * still allow `limit` as a defensive ceiling for very long histories.
   */
  listByUserLight: (
    userId: string,
    opts?: { since?: Date; limit?: number; status?: string },
  ) =>
    prisma.agentRun.findMany({
      where: {
        userId,
        ...(opts?.status ? { status: opts.status } : {}),
        ...(opts?.since ? { startedAt: { gte: opts.since } } : {}),
      },
      select: {
        sessionId: true,
        agentSlug: true,
        status: true,
        triggerSource: true,
        startedAt: true,
        completedAt: true,
        // Small ID columns — kept here because the chart + insight strip
        // build chat-deep-links from them. Adding 2 short text columns
        // doesn't meaningfully change the payload size.
        conversationId: true,
        channelId: true,
      },
      orderBy: { startedAt: "desc" },
      take: opts?.limit ?? 500,
    }),

  /**
   * Aggregate rating stats per agent within a window. Null cutoff = all time.
   * Returns totalRuns, ratedCount, upCount, downCount per agentSlug, sorted by downCount DESC.
   */
  ratingStatsByAgent: async (cutoff: Date | null) => {
    const where = cutoff ? { startedAt: { gte: cutoff } } : {};
    const rows = await prisma.agentRun.groupBy({
      by: ["agentSlug", "rating"],
      where,
      _count: { _all: true },
    });
    const map = new Map<string, { agentSlug: string; totalRuns: number; upCount: number; downCount: number; ratedCount: number }>();
    for (const r of rows) {
      const entry = map.get(r.agentSlug) ?? { agentSlug: r.agentSlug, totalRuns: 0, upCount: 0, downCount: 0, ratedCount: 0 };
      entry.totalRuns += r._count._all;
      if (r.rating === "up") { entry.upCount += r._count._all; entry.ratedCount += r._count._all; }
      if (r.rating === "down") { entry.downCount += r._count._all; entry.ratedCount += r._count._all; }
      map.set(r.agentSlug, entry);
    }
    return [...map.values()]
      .map((e) => ({ ...e, negativeRate: e.ratedCount > 0 ? e.downCount / e.ratedCount : 0 }))
      .sort((a, b) => b.downCount - a.downCount || b.ratedCount - a.ratedCount);
  },

  /** Most recent thumbs-down runs with user email joined. */
  recentDownRuns: async (cutoff: Date | null, limit: number) => {
    const rows = await prisma.agentRun.findMany({
      where: {
        rating: "down",
        ...(cutoff ? { ratedAt: { gte: cutoff } } : {}),
      },
      orderBy: { ratedAt: "desc" },
      take: limit,
      select: {
        sessionId: true,
        agentSlug: true,
        userId: true,
        task: true,
        ratingComment: true,
        ratedAt: true,
        conversationId: true,
      },
    });
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const users = userIds.length > 0
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } })
      : [];
    const emailById = new Map(users.map((u) => [u.id, u.email] as const));
    return rows.map((r) => ({
      sessionId: r.sessionId,
      agentSlug: r.agentSlug,
      userId: r.userId,
      userEmail: emailById.get(r.userId) ?? null,
      task: r.task.length > 200 ? r.task.slice(0, 200) + "…" : r.task,
      ratingComment: r.ratingComment,
      ratedAt: r.ratedAt,
      conversationId: r.conversationId,
    }));
  },

  /**
   * Aggregate usage stats per agent within a window. Null cutoff = all time.
   * Sums tokensIn, tokensOut, tokensCacheRead, tokensCacheWrite and counts
   * total runs per agentSlug. Sorted by tokensIn+tokensOut descending so
   * heaviest consumers float to the top.
   */
  usageStatsByAgent: async (cutoff: Date | null) => {
    const where = cutoff ? { startedAt: { gte: cutoff } } : {};
    const rows = await prisma.agentRun.groupBy({
      by: ["agentSlug"],
      where,
      _count: { _all: true },
      _sum: {
        tokensIn: true,
        tokensOut: true,
        tokensCacheRead: true,
        tokensCacheWrite: true,
      },
    });
    return rows
      .map((r) => ({
        agentSlug: r.agentSlug,
        runs: r._count._all,
        tokensIn: r._sum.tokensIn ?? 0,
        tokensOut: r._sum.tokensOut ?? 0,
        tokensCacheRead: r._sum.tokensCacheRead ?? 0,
        tokensCacheWrite: r._sum.tokensCacheWrite ?? 0,
      }))
      .sort((a, b) => (b.tokensIn + b.tokensOut) - (a.tokensIn + a.tokensOut));
  },

  /** High-level global overview suitable for dashboard header cards. */
  globalOverviewStats: async (cutoff: Date | null) => {
    type Row = {
      total_runs: bigint;
      completed_runs: bigint;
      failed_runs: bigint;
      cancelled_runs: bigint;
      running_runs: bigint;
      unique_users: bigint;
      total_tokens_in: bigint;
      total_tokens_out: bigint;
    };
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT
        COUNT(*)                        AS total_runs,
        COUNT(*) FILTER (WHERE status = 'completed')  AS completed_runs,
        COUNT(*) FILTER (WHERE status = 'failed')     AS failed_runs,
        COUNT(*) FILTER (WHERE status = 'cancelled')  AS cancelled_runs,
        COUNT(*) FILTER (WHERE status = 'running')    AS running_runs,
        COUNT(DISTINCT "userId")        AS unique_users,
        COALESCE(SUM("tokensIn"),  0)   AS total_tokens_in,
        COALESCE(SUM("tokensOut"), 0)   AS total_tokens_out
      FROM agent_runs
      WHERE "agentSlug" IN (SELECT slug FROM agents WHERE scope = 'global')
      ${cutoff ? Prisma.sql`AND "startedAt" >= ${cutoff}` : Prisma.empty}
    `;
    const r = rows[0]!;
    return {
      totalRuns: Number(r.total_runs),
      completedRuns: Number(r.completed_runs),
      failedRuns: Number(r.failed_runs),
      cancelledRuns: Number(r.cancelled_runs),
      runningRuns: Number(r.running_runs),
      uniqueUsers: Number(r.unique_users),
      totalTokensIn: Number(r.total_tokens_in),
      totalTokensOut: Number(r.total_tokens_out),
    };
  },

  /** Per-agent stats sorted by total runs desc. */
  runStatsByAgent: async (cutoff: Date | null) => {
    type Row = {
      agent_slug: string;
      total_runs: bigint;
      unique_users: bigint;
      completed_runs: bigint;
      failed_runs: bigint;
      avg_duration_ms: number | null;
      total_tokens_in: bigint;
      total_tokens_out: bigint;
    };
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT
        "agentSlug"                       AS agent_slug,
        COUNT(*)                          AS total_runs,
        COUNT(DISTINCT "userId")          AS unique_users,
        COUNT(*) FILTER (WHERE status = 'completed')   AS completed_runs,
        COUNT(*) FILTER (WHERE status = 'failed')      AS failed_runs,
        ROUND(AVG(
          EXTRACT(EPOCH FROM ("completedAt" - "startedAt")) * 1000
        ) FILTER (WHERE "completedAt" IS NOT NULL))    AS avg_duration_ms,
        COALESCE(SUM("tokensIn"),  0)     AS total_tokens_in,
        COALESCE(SUM("tokensOut"), 0)     AS total_tokens_out
      FROM agent_runs
      ${cutoff ? Prisma.sql`WHERE "startedAt" >= ${cutoff}` : Prisma.empty}
      GROUP BY "agentSlug"
      ORDER BY total_runs DESC
    `;
    return rows.map((r) => ({
      agentSlug: r.agent_slug,
      totalRuns: Number(r.total_runs),
      uniqueUsers: Number(r.unique_users),
      completedRuns: Number(r.completed_runs),
      failedRuns: Number(r.failed_runs),
      avgDurationMs: r.avg_duration_ms != null ? Math.round(Number(r.avg_duration_ms)) : null,
      totalTokensIn: Number(r.total_tokens_in),
      totalTokensOut: Number(r.total_tokens_out),
    }));
  },

  /** Top N users by run count within window, including email. */
  topUsersByRuns: async (cutoff: Date | null, limit: number) => {
    type Row = {
      user_id: string;
      run_count: bigint;
      unique_agents: bigint;
      total_tokens: bigint;
    };
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT
        "userId"                              AS user_id,
        COUNT(*)                              AS run_count,
        COUNT(DISTINCT "agentSlug")           AS unique_agents,
        COALESCE(SUM(COALESCE("tokensIn", 0) + COALESCE("tokensOut", 0)), 0) AS total_tokens
      FROM agent_runs
      ${cutoff ? Prisma.sql`WHERE "startedAt" >= ${cutoff}` : Prisma.empty}
      GROUP BY "userId"
      ORDER BY run_count DESC
      LIMIT ${limit}
    `;
    const userIds = rows.map((r) => r.user_id);
    const users = userIds.length > 0
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true, name: true } })
      : [];
    const infoById = new Map(users.map((u) => [u.id, u] as const));
    return rows.map((r) => ({
      userId: r.user_id,
      email: infoById.get(r.user_id)?.email ?? null,
      name: infoById.get(r.user_id)?.name ?? null,
      runCount: Number(r.run_count),
      uniqueAgents: Number(r.unique_agents),
      totalTokens: Number(r.total_tokens),
    }));
  },

  /** Daily run counts + success/failure breakdown for time-series chart (zero-padded). */
  runTimeSeries: async (window: TimeWindow) => {
    type Row = {
      day: Date;
      total: bigint;
      completed: bigint;
      failed: bigint;
    };
    const startTs = window?.start ?? null;
    const endTs = window?.end ?? null;
    const rows = await prisma.$queryRaw<Row[]>`
      WITH bounds AS (
        SELECT
          COALESCE(${startTs}::timestamptz, (SELECT MIN("startedAt") FROM agent_runs)) AS start_ts,
          COALESCE(${endTs}::timestamptz, NOW()) AS end_ts
      ),
      bucket_range AS (
        SELECT generate_series(
          DATE_TRUNC('day', (SELECT start_ts FROM bounds)),
          DATE_TRUNC('day', (SELECT end_ts   FROM bounds)),
          '1 day'
        ) AS day
      ),
      agg AS (
        SELECT
          DATE_TRUNC('day', "startedAt") AS day,
          COUNT(*)::bigint AS total,
          COUNT(*) FILTER (WHERE status = 'completed')::bigint AS completed,
          COUNT(*) FILTER (WHERE status = 'failed')::bigint AS failed
        FROM agent_runs
        WHERE "startedAt" >= (SELECT start_ts FROM bounds)
          AND "startedAt" <  (SELECT end_ts FROM bounds) + INTERVAL '1 day'
        GROUP BY 1
      )
      SELECT
        br.day AS day,
        COALESCE(agg.total,     0)::bigint AS total,
        COALESCE(agg.completed, 0)::bigint AS completed,
        COALESCE(agg.failed,    0)::bigint AS failed
      FROM bucket_range br
      LEFT JOIN agg USING (day)
      ORDER BY br.day ASC
    `;
    return rows.map((r) => ({
      day: formatDayIST(r.day),
      total: Number(r.total),
      completed: Number(r.completed),
      failed: Number(r.failed),
    }));
  },

  /** Run counts broken down by trigger source. */
  triggerSourceStats: async (cutoff: Date | null) => {
    type Row = { trigger_source: string; count: bigint };
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT "triggerSource" AS trigger_source, COUNT(*) AS count
      FROM agent_runs
      ${cutoff ? Prisma.sql`WHERE "startedAt" >= ${cutoff}` : Prisma.empty}
      GROUP BY "triggerSource"
      ORDER BY count DESC
    `;
    return rows.map((r) => ({ triggerSource: r.trigger_source, count: Number(r.count) }));
  },

  // ── User-scoped aggregates ──────────────────────────────────────────

  /** Overview stats scoped to a single user. */
  userOverviewStats: async (userId: string, cutoff: Date | null) => {
    type Row = {
      total_runs: bigint;
      completed_runs: bigint;
      failed_runs: bigint;
      cancelled_runs: bigint;
      running_runs: bigint;
      total_tokens_in: bigint;
      total_tokens_out: bigint;
    };
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT
        COUNT(*)                                              AS total_runs,
        COUNT(*) FILTER (WHERE status = 'completed')         AS completed_runs,
        COUNT(*) FILTER (WHERE status = 'failed')            AS failed_runs,
        COUNT(*) FILTER (WHERE status = 'cancelled')         AS cancelled_runs,
        COUNT(*) FILTER (WHERE status = 'running')           AS running_runs,
        COALESCE(SUM("tokensIn"),  0)                        AS total_tokens_in,
        COALESCE(SUM("tokensOut"), 0)                        AS total_tokens_out
      FROM agent_runs
      WHERE "userId" = ${userId}
      ${cutoff ? Prisma.sql`AND "startedAt" >= ${cutoff}` : Prisma.empty}
    `;
    const r = rows[0]!;
    return {
      totalRuns: Number(r.total_runs),
      completedRuns: Number(r.completed_runs),
      failedRuns: Number(r.failed_runs),
      cancelledRuns: Number(r.cancelled_runs),
      runningRuns: Number(r.running_runs),
      uniqueUsers: 1,
      totalTokensIn: Number(r.total_tokens_in),
      totalTokensOut: Number(r.total_tokens_out),
    };
  },

  /** Per-agent stats for a single user. */
  runStatsByAgentForUser: async (userId: string, cutoff: Date | null) => {
    type Row = {
      agent_slug: string;
      total_runs: bigint;
      completed_runs: bigint;
      failed_runs: bigint;
      avg_duration_ms: number | null;
      total_tokens_in: bigint;
      total_tokens_out: bigint;
      last_run_at: Date | null;
    };
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT
        "agentSlug"                       AS agent_slug,
        COUNT(*)                          AS total_runs,
        COUNT(*) FILTER (WHERE status = 'completed')   AS completed_runs,
        COUNT(*) FILTER (WHERE status = 'failed')      AS failed_runs,
        ROUND(AVG(
          EXTRACT(EPOCH FROM ("completedAt" - "startedAt")) * 1000
        ) FILTER (WHERE "completedAt" IS NOT NULL))    AS avg_duration_ms,
        COALESCE(SUM("tokensIn"),  0)     AS total_tokens_in,
        COALESCE(SUM("tokensOut"), 0)     AS total_tokens_out,
        MAX("startedAt")                  AS last_run_at
      FROM agent_runs
      WHERE "userId" = ${userId}
      ${cutoff ? Prisma.sql`AND "startedAt" >= ${cutoff}` : Prisma.empty}
      GROUP BY "agentSlug"
      ORDER BY total_runs DESC
    `;
    return rows.map((r) => ({
      agentSlug: r.agent_slug,
      totalRuns: Number(r.total_runs),
      uniqueUsers: 1,
      completedRuns: Number(r.completed_runs),
      failedRuns: Number(r.failed_runs),
      avgDurationMs: r.avg_duration_ms != null ? Math.round(Number(r.avg_duration_ms)) : null,
      totalTokensIn: Number(r.total_tokens_in),
      totalTokensOut: Number(r.total_tokens_out),
      lastRunAt: r.last_run_at ? formatDayIST(r.last_run_at) : null,
    }));
  },

  /** Daily time-series for a single user (zero-padded). */
  runTimeSeriesForUser: async (userId: string, window: TimeWindow) => {
    type Row = { day: Date; total: bigint; completed: bigint; failed: bigint };
    const startTs = window?.start ?? null;
    const endTs = window?.end ?? null;
    const rows = await prisma.$queryRaw<Row[]>`
      WITH bounds AS (
        SELECT
          COALESCE(${startTs}::timestamptz, (SELECT MIN("startedAt") FROM agent_runs WHERE "userId" = ${userId})) AS start_ts,
          COALESCE(${endTs}::timestamptz, NOW()) AS end_ts
      ),
      bucket_range AS (
        SELECT generate_series(
          DATE_TRUNC('day', (SELECT start_ts FROM bounds)),
          DATE_TRUNC('day', (SELECT end_ts   FROM bounds)),
          '1 day'
        ) AS day
      ),
      agg AS (
        SELECT
          DATE_TRUNC('day', "startedAt") AS day,
          COUNT(*)::bigint AS total,
          COUNT(*) FILTER (WHERE status = 'completed')::bigint AS completed,
          COUNT(*) FILTER (WHERE status = 'failed')::bigint AS failed
        FROM agent_runs
        WHERE "userId" = ${userId}
          AND "startedAt" >= (SELECT start_ts FROM bounds)
          AND "startedAt" <  (SELECT end_ts FROM bounds) + INTERVAL '1 day'
        GROUP BY 1
      )
      SELECT
        br.day AS day,
        COALESCE(agg.total,     0)::bigint AS total,
        COALESCE(agg.completed, 0)::bigint AS completed,
        COALESCE(agg.failed,    0)::bigint AS failed
      FROM bucket_range br
      LEFT JOIN agg USING (day)
      ORDER BY br.day ASC
    `;
    return rows.map((r) => ({
      day: formatDayIST(r.day),
      total: Number(r.total),
      completed: Number(r.completed),
      failed: Number(r.failed),
    }));
  },

  /** Trigger-source breakdown for a single user. */
  triggerSourceStatsForUser: async (userId: string, cutoff: Date | null) => {
    type Row = { trigger_source: string; count: bigint };
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT "triggerSource" AS trigger_source, COUNT(*) AS count
      FROM agent_runs
      WHERE "userId" = ${userId}
      ${cutoff ? Prisma.sql`AND "startedAt" >= ${cutoff}` : Prisma.empty}
      GROUP BY "triggerSource"
      ORDER BY count DESC
    `;
    return rows.map((r) => ({ triggerSource: r.trigger_source, count: Number(r.count) }));
  },

  /** Rating stats per agent scoped to a single user. */
  ratingStatsByAgentForUser: async (userId: string, cutoff: Date | null) => {
    const where = {
      userId,
      ...(cutoff ? { startedAt: { gte: cutoff } } : {}),
    };
    const rows = await prisma.agentRun.groupBy({
      by: ["agentSlug", "rating"],
      where,
      _count: { _all: true },
    });
    const map = new Map<string, { agentSlug: string; totalRuns: number; upCount: number; downCount: number; ratedCount: number }>();
    for (const r of rows) {
      const entry = map.get(r.agentSlug) ?? { agentSlug: r.agentSlug, totalRuns: 0, upCount: 0, downCount: 0, ratedCount: 0 };
      entry.totalRuns += r._count._all;
      if (r.rating === "up") { entry.upCount += r._count._all; entry.ratedCount += r._count._all; }
      if (r.rating === "down") { entry.downCount += r._count._all; entry.ratedCount += r._count._all; }
      map.set(r.agentSlug, entry);
    }
    return [...map.values()]
      .map((e) => ({ ...e, negativeRate: e.ratedCount > 0 ? e.downCount / e.ratedCount : 0 }))
      .sort((a, b) => b.downCount - a.downCount || b.ratedCount - a.ratedCount);
  },

  /**
   * Top-N users with per-agent run breakdown for admin unified users table.
   * Returns top users by run count + per-user/per-agent group-by merged in JS.
   */
  userActivityBreakdown: async (cutoff: Date | null, limit: number) => {
    type UserRow = { user_id: string; run_count: bigint; unique_agents: bigint; total_tokens_in: bigint; total_tokens_out: bigint };
    const userRows = await prisma.$queryRaw<UserRow[]>`
      SELECT
        "userId"                              AS user_id,
        COUNT(*)                              AS run_count,
        COUNT(DISTINCT "agentSlug")           AS unique_agents,
        COALESCE(SUM("tokensIn"), 0)          AS total_tokens_in,
        COALESCE(SUM("tokensOut"), 0)         AS total_tokens_out
      FROM agent_runs
      WHERE "agentSlug" IN (SELECT slug FROM agents WHERE scope = 'global')
      ${cutoff ? Prisma.sql`AND "startedAt" >= ${cutoff}` : Prisma.empty}
      GROUP BY "userId"
      ORDER BY run_count DESC
      LIMIT ${limit}
    `;

    if (userRows.length === 0) return [];

    const topUserIds = userRows.map((r) => r.user_id);

    type PerAgentRow = {
      user_id: string;
      agent_slug: string;
      run_count: bigint;
      completed_runs: bigint;
      failed_runs: bigint;
      avg_duration_ms: number | null;
      tokens_in: bigint;
      tokens_out: bigint;
      last_run_at: Date | null;
    };
    const perAgentRows = await prisma.$queryRaw<PerAgentRow[]>`
      SELECT
        "userId"                        AS user_id,
        "agentSlug"                     AS agent_slug,
        COUNT(*)                        AS run_count,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed_runs,
        COUNT(*) FILTER (WHERE status = 'failed')    AS failed_runs,
        ROUND(AVG(
          EXTRACT(EPOCH FROM ("completedAt" - "startedAt")) * 1000
        ) FILTER (WHERE "completedAt" IS NOT NULL))  AS avg_duration_ms,
        COALESCE(SUM("tokensIn"),  0)   AS tokens_in,
        COALESCE(SUM("tokensOut"), 0)   AS tokens_out,
        MAX("startedAt")                AS last_run_at
      FROM agent_runs
      WHERE "userId" = ANY(${topUserIds}::text[])
        AND "agentSlug" IN (SELECT slug FROM agents WHERE scope = 'global')
      ${cutoff ? Prisma.sql`AND "startedAt" >= ${cutoff}` : Prisma.empty}
      GROUP BY "userId", "agentSlug"
      ORDER BY run_count DESC
    `;

    const users = await prisma.user.findMany({
      where: { id: { in: topUserIds } },
      select: { id: true, email: true, name: true },
    });
    const infoById = new Map(users.map((u) => [u.id, u] as const));

    // Group perAgentRows by userId
    const perAgentByUser = new Map<string, typeof perAgentRows>();
    for (const r of perAgentRows) {
      const arr = perAgentByUser.get(r.user_id) ?? [];
      arr.push(r);
      perAgentByUser.set(r.user_id, arr);
    }

    return userRows.map((u) => ({
      userId: u.user_id,
      email: infoById.get(u.user_id)?.email ?? null,
      name: infoById.get(u.user_id)?.name ?? null,
      totalRuns: Number(u.run_count),
      uniqueAgents: Number(u.unique_agents),
      totalTokensIn: Number(u.total_tokens_in),
      totalTokensOut: Number(u.total_tokens_out),
      perAgent: (perAgentByUser.get(u.user_id) ?? []).sort((a, b) => Number(b.run_count) - Number(a.run_count)).map((a) => ({
        agentSlug: a.agent_slug,
        runCount: Number(a.run_count),
        completedRuns: Number(a.completed_runs),
        failedRuns: Number(a.failed_runs),
        avgDurationMs: a.avg_duration_ms != null ? Math.round(Number(a.avg_duration_ms)) : null,
        tokensIn: Number(a.tokens_in),
        tokensOut: Number(a.tokens_out),
        lastRunAt: a.last_run_at ? formatDayIST(a.last_run_at) : null,
      })),
    }));
  },

  // ── Project-scoped aggregates ──────────────────────────────────────────

  /**
   * Distinct projects seen in agent_runs (for the project picker /
   * aggregate donut). For each project we return the four metrics the
   * Projects-page donut can slice by:
   *
   *   • runCount       — volume distribution
   *   • totalTokens    — spend distribution  (in + out)
   *   • uniqueUsers    — adoption breadth
   *   • failedRuns     — risk / triage distribution
   *
   * All metrics respect the `cutoff` time window so the header's days
   * filter affects every lens consistently.
   *
   * Ordered by runCount DESC so slice color assignment is stable across
   * metric toggles (the same project keeps the same color regardless of
   * which value drives the slice sizes).
   */
  listProjectsForDashboard: async (cutoff: Date | null) => {
    type Row = {
      project_id: string;
      project_name: string | null;
      run_count: bigint;
      total_tokens: bigint;
      unique_users: bigint;
      failed_runs: bigint;
    };
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT
        "projectId"                                                AS project_id,
        MAX("projectName")                                         AS project_name,
        COUNT(*)::bigint                                           AS run_count,
        (COALESCE(SUM("tokensIn"),  0) +
         COALESCE(SUM("tokensOut"), 0))::bigint                    AS total_tokens,
        COUNT(DISTINCT "userId")::bigint                           AS unique_users,
        (COUNT(*) FILTER (WHERE status = 'failed'))::bigint        AS failed_runs
      FROM agent_runs
      WHERE "projectId" IS NOT NULL
      ${cutoff ? Prisma.sql`AND "startedAt" >= ${cutoff}` : Prisma.empty}
      GROUP BY "projectId"
      ORDER BY run_count DESC
    `;
    return rows.map((r) => ({
      projectId: r.project_id,
      projectName: r.project_name,
      runCount: Number(r.run_count),
      totalTokens: Number(r.total_tokens),
      uniqueUsers: Number(r.unique_users),
      failedRuns: Number(r.failed_runs),
    }));
  },

  /** Per-agent run stats filtered to a specific project. */
  projectAgentUsage: async (projectId: string, cutoff: Date | null) => {
    type Row = {
      agent_slug: string;
      total_runs: bigint;
      unique_users: bigint;
      completed_runs: bigint;
      failed_runs: bigint;
      avg_duration_ms: number | null;
      total_tokens_in: bigint;
      total_tokens_out: bigint;
      last_run_at: Date | null;
    };
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT
        "agentSlug"                        AS agent_slug,
        COUNT(*)                           AS total_runs,
        COUNT(DISTINCT "userId")           AS unique_users,
        COUNT(*) FILTER (WHERE status = 'completed')  AS completed_runs,
        COUNT(*) FILTER (WHERE status = 'failed')     AS failed_runs,
        ROUND(AVG(
          EXTRACT(EPOCH FROM ("completedAt" - "startedAt")) * 1000
        ) FILTER (WHERE "completedAt" IS NOT NULL))   AS avg_duration_ms,
        COALESCE(SUM("tokensIn"),  0)      AS total_tokens_in,
        COALESCE(SUM("tokensOut"), 0)      AS total_tokens_out,
        MAX("startedAt")                   AS last_run_at
      FROM agent_runs
      WHERE "projectId" = ${projectId}
      ${cutoff ? Prisma.sql`AND "startedAt" >= ${cutoff}` : Prisma.empty}
      GROUP BY "agentSlug"
      ORDER BY total_runs DESC
    `;
    return rows.map((r) => ({
      agentSlug: r.agent_slug,
      totalRuns: Number(r.total_runs),
      uniqueUsers: Number(r.unique_users),
      completedRuns: Number(r.completed_runs),
      failedRuns: Number(r.failed_runs),
      avgDurationMs: r.avg_duration_ms != null ? Math.round(Number(r.avg_duration_ms)) : null,
      totalTokensIn: Number(r.total_tokens_in),
      totalTokensOut: Number(r.total_tokens_out),
      lastRunAt: r.last_run_at ? formatDayIST(r.last_run_at) : null,
    }));
  },

  /** Top-N users by run count within a specific project. */
  projectTopUsers: async (projectId: string, cutoff: Date | null, limit: number) => {
    type Row = {
      user_id: string;
      run_count: bigint;
      unique_agents: bigint;
      total_tokens_in: bigint;
      total_tokens_out: bigint;
    };
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT
        "userId"                              AS user_id,
        COUNT(*)                              AS run_count,
        COUNT(DISTINCT "agentSlug")           AS unique_agents,
        COALESCE(SUM("tokensIn"),  0)         AS total_tokens_in,
        COALESCE(SUM("tokensOut"), 0)         AS total_tokens_out
      FROM agent_runs
      WHERE "projectId" = ${projectId}
      ${cutoff ? Prisma.sql`AND "startedAt" >= ${cutoff}` : Prisma.empty}
      GROUP BY "userId"
      ORDER BY run_count DESC
      LIMIT ${limit}
    `;
    if (rows.length === 0) return [];
    const userIds = rows.map((r) => r.user_id);

    // Per-user per-agent breakdown within the project
    type PerAgentRow = {
      user_id: string;
      agent_slug: string;
      run_count: bigint;
      completed_runs: bigint;
      failed_runs: bigint;
      avg_duration_ms: number | null;
      tokens_in: bigint;
      tokens_out: bigint;
      last_run_at: Date | null;
    };
    const [users, perAgentRows, agentMeta] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true, name: true },
      }),
      prisma.$queryRaw<PerAgentRow[]>`
        SELECT
          "userId"                        AS user_id,
          "agentSlug"                     AS agent_slug,
          COUNT(*)                        AS run_count,
          COUNT(*) FILTER (WHERE status = 'completed') AS completed_runs,
          COUNT(*) FILTER (WHERE status = 'failed')    AS failed_runs,
          ROUND(AVG(
            EXTRACT(EPOCH FROM ("completedAt" - "startedAt")) * 1000
          ) FILTER (WHERE "completedAt" IS NOT NULL))  AS avg_duration_ms,
          COALESCE(SUM("tokensIn"),  0)   AS tokens_in,
          COALESCE(SUM("tokensOut"), 0)   AS tokens_out,
          MAX("startedAt")                AS last_run_at
        FROM agent_runs
        WHERE "projectId" = ${projectId}
          AND "userId" = ANY(${userIds}::text[])
        ${cutoff ? Prisma.sql`AND "startedAt" >= ${cutoff}` : Prisma.empty}
        GROUP BY "userId", "agentSlug"
        ORDER BY run_count DESC
      `,
      prisma.agent.findMany({
        where: {},
        select: { slug: true, name: true, scope: true, enabled: true, spacesAppId: true },
      }),
    ]);

    const infoById = new Map(users.map((u) => [u.id, u] as const));
    const metaBySlug = new Map(agentMeta.map((a) => [a.slug, a] as const));

    // Group per-agent rows by user
    const perAgentByUser = new Map<string, PerAgentRow[]>();
    for (const r of perAgentRows) {
      const arr = perAgentByUser.get(r.user_id) ?? [];
      arr.push(r);
      perAgentByUser.set(r.user_id, arr);
    }

    return rows.map((r) => ({
      userId: r.user_id,
      email: infoById.get(r.user_id)?.email ?? null,
      name: infoById.get(r.user_id)?.name ?? null,
      runCount: Number(r.run_count),
      uniqueAgents: Number(r.unique_agents),
      totalTokensIn: Number(r.total_tokens_in),
      totalTokensOut: Number(r.total_tokens_out),
      agents: (perAgentByUser.get(r.user_id) ?? []).map((a) => ({
        agentSlug: a.agent_slug,
        agentName: metaBySlug.get(a.agent_slug)?.name ?? a.agent_slug,
        agentScope: (metaBySlug.get(a.agent_slug)?.scope ?? null) as "global" | "personal" | null,
        agentEnabled: metaBySlug.get(a.agent_slug)?.enabled ?? null,
        agentRegistered: metaBySlug.get(a.agent_slug)?.spacesAppId != null,
        owned: false,
        runCount: Number(a.run_count),
        completedRuns: Number(a.completed_runs),
        failedRuns: Number(a.failed_runs),
        avgDurationMs: a.avg_duration_ms != null ? Math.round(Number(a.avg_duration_ms)) : null,
        lastRunAt: a.last_run_at ? formatDayIST(a.last_run_at) : null,
        totalTokens: Number(a.tokens_in) + Number(a.tokens_out),
      })),
    }));
  },

  /**
   * Skills used by agents that ran within a specific project.
   * Joins agent_runs -> agents -> agent_skills -> skills.
   */
  projectSubagentUsage: async (projectId: string, cutoff: Date | null) => {
    type Row = {
      subagent_name: string;
      agent_count: bigint;
      agent_names: string;
    };
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT
        subagent_name,
        COUNT(DISTINCT a.id)::bigint                       AS agent_count,
        STRING_AGG(DISTINCT a.name, ', ' ORDER BY a.name) AS agent_names
      FROM (
        SELECT DISTINCT "agentSlug"
        FROM agent_runs
        WHERE "projectId" = ${projectId}
        ${cutoff ? Prisma.sql`AND "startedAt" >= ${cutoff}` : Prisma.empty}
      ) AS ar
      JOIN agents a ON a.slug = ar."agentSlug",
        jsonb_array_elements_text(
          COALESCE(a.config->'tools'->'subagents', '[]'::jsonb)
        ) AS subagent_name
      WHERE a.config->'tools'->'subagents' IS NOT NULL
        AND jsonb_array_length(a.config->'tools'->'subagents') > 0
      GROUP BY subagent_name
      ORDER BY agent_count DESC, subagent_name ASC
    `;
    return rows.map((r) => ({
      subagentName: r.subagent_name,
      agentCount: Number(r.agent_count),
      agentNames: r.agent_names ? r.agent_names.split(", ") : [],
    }));
  },

  projectSkillUsage: async (projectId: string, cutoff: Date | null) => {
    type Row = {
      skill_id: string;
      skill_slug: string;
      skill_name: string;
      skill_source: string;
      agent_count: bigint;
      agent_names: string;
    };
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT
        s.id                                               AS skill_id,
        s.slug                                             AS skill_slug,
        s.name                                             AS skill_name,
        s.source                                           AS skill_source,
        COUNT(DISTINCT a.id)::bigint                       AS agent_count,
        STRING_AGG(DISTINCT a.name, ', ' ORDER BY a.name) AS agent_names
      FROM (
        SELECT DISTINCT "agentSlug"
        FROM agent_runs
        WHERE "projectId" = ${projectId}
        ${cutoff ? Prisma.sql`AND "startedAt" >= ${cutoff}` : Prisma.empty}
      ) AS ar
      JOIN agents a ON a.slug = ar."agentSlug"
      JOIN agent_skills aks ON aks."agentId" = a.id
      JOIN skills s ON s.id = aks."skillId"
      GROUP BY s.id, s.slug, s.name, s.source
      ORDER BY agent_count DESC, s.name ASC
    `;
    return rows.map((r) => ({
      skillId: r.skill_id,
      skillSlug: r.skill_slug,
      skillName: r.skill_name,
      skillSource: r.skill_source,
      agentCount: Number(r.agent_count),
      agentNames: r.agent_names ? r.agent_names.split(", ") : [],
    }));
  },
};
