/**
 * Combines several single-desk DeskMetricsResponse payloads into one.
 *
 * Why aggregate in JS instead of widening the repository SQL to `channelId IN
 * (...)`: every desk carries its own frtStageNames preference and its own
 * board-resolved "resolved" stage names, so a single query would have to encode
 * per-desk stage sets to keep FRT/resolution correct. Fanning out to the
 * existing (indexed, tested) per-desk query preserves those semantics exactly.
 *
 * Averages are recombined as weighted means using each desk's own denominator,
 * never as a mean-of-means — a desk with 2 tickets must not pull the same
 * weight as a desk with 2000.
 */

import type {
  DeskMetricsAgentRow,
  DeskMetricsResponse,
  DeskMetricsTicketRow,
} from '@xyne/shared';

/** One desk's contribution to the aggregate. */
export interface DeskMetricsContribution {
  channelId: string;
  channelName: string | null;
  metrics: DeskMetricsResponse;
}

/**
 * Weighted mean of (value, weight) pairs. Entries with a null value or a
 * non-positive weight contribute nothing. Returns null when no entry carries
 * weight, so "no data" stays distinguishable from a genuine 0.
 */
const weightedMean = (entries: Array<{ value: number | null; weight: number }>): number | null => {
  let weightedTotal = 0;
  let weightSum = 0;
  for (const { value, weight } of entries) {
    if (value === null || !Number.isFinite(value) || weight <= 0) continue;
    weightedTotal += value * weight;
    weightSum += weight;
  }
  return weightSum > 0 ? weightedTotal / weightSum : null;
};

/** Sums counts keyed by `key`, preserving the first-seen display label. */
const mergeCounts = <T extends string>(
  groups: Array<Array<Record<string, unknown>>>,
  keyField: T,
  normalizeKey: (key: string) => string = key => key,
): Array<{ count: number } & Record<T, string>> => {
  const totals = new Map<string, { displayKey: string; count: number }>();
  for (const group of groups) {
    for (const row of group) {
      const key = row[keyField];
      const count = row['count'];
      if (typeof key !== 'string' || typeof count !== 'number') continue;
      const displayKey = key.trim() || key;
      const normalizedKey = normalizeKey(displayKey);
      const existing = totals.get(normalizedKey);
      totals.set(normalizedKey, {
        displayKey: existing?.displayKey ?? displayKey,
        count: (existing?.count ?? 0) + count,
      });
    }
  }
  return [...totals.values()]
    .sort((a, b) => b.count - a.count)
    .map(
      ({ displayKey, count }) =>
        ({ [keyField]: displayKey, count }) as { count: number } & Record<T, string>,
    );
};

const normalizeStageKey = (stageName: string): string => stageName.trim().toLowerCase();

const mergeTrend = (
  contributions: DeskMetricsContribution[],
): DeskMetricsResponse['trend'] => {
  const byDate = new Map<string, { opened: number; closed: number }>();
  for (const { metrics } of contributions) {
    for (const point of metrics.trend) {
      const existing = byDate.get(point.date) ?? { opened: 0, closed: 0 };
      existing.opened += point.opened;
      existing.closed += point.closed;
      byDate.set(point.date, existing);
    }
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, v]) => ({ date, opened: v.opened, closed: v.closed }));
};

const mergeAgentStageCounts = (
  left: DeskMetricsAgentRow['stageCounts'],
  right: DeskMetricsAgentRow['stageCounts'],
): DeskMetricsAgentRow['stageCounts'] => {
  const totals = new Map<string, { stageName: string; count: number }>();
  for (const row of [...left, ...right]) {
    const stageName = row.stageName.trim() || 'Unassigned';
    const key = normalizeStageKey(stageName);
    const existing = totals.get(key);
    totals.set(key, {
      stageName: existing?.stageName ?? stageName,
      count: (existing?.count ?? 0) + row.count,
    });
  }
  return [...totals.values()]
    .sort((a, b) => b.count - a.count || a.stageName.localeCompare(b.stageName));
};

/**
 * Merges agent rows across desks by assigneeId. The same person working two
 * desks becomes one row whose averages are weighted by that person's own
 * per-desk denominators (responded for FRT, resolved for RT, responses for
 * CSAT). The `null` assigneeId (Unassigned) bucket merges like any other.
 */
const mergeAgents = (contributions: DeskMetricsContribution[]): DeskMetricsAgentRow[] => {
  type Accumulator = {
    row: DeskMetricsAgentRow;
    frt: Array<{ value: number | null; weight: number }>;
    rt: Array<{ value: number | null; weight: number }>;
    csat: Array<{ value: number | null; weight: number }>;
  };
  const byAssignee = new Map<string, Accumulator>();

  for (const { metrics } of contributions) {
    for (const agent of metrics.agents) {
      // Distinct sentinel: a real assignee id can never be the empty string.
      const key = agent.assigneeId ?? '';
      const existing = byAssignee.get(key);
      if (!existing) {
        byAssignee.set(key, {
          row: {
            assigneeId: agent.assigneeId,
            assigneeName: agent.assigneeName,
            assigned: agent.assigned,
            stageCounts: mergeAgentStageCounts([], agent.stageCounts),
            responded: agent.responded,
            resolved: agent.resolved,
            reopened: agent.reopened,
            avgFrtSeconds: null,
            avgRtSeconds: null,
            csatAvgScore: null,
            csatScoredResponses: agent.csatScoredResponses,
            csatGood: agent.csatGood,
            csatBad: agent.csatBad,
            emailReplies: agent.emailReplies,
          },
          frt: [{ value: agent.avgFrtSeconds, weight: agent.responded }],
          rt: [{ value: agent.avgRtSeconds, weight: agent.resolved }],
          csat: [{ value: agent.csatAvgScore, weight: agent.csatScoredResponses }],
        });
        continue;
      }
      existing.row.assigned += agent.assigned;
      existing.row.stageCounts = mergeAgentStageCounts(existing.row.stageCounts, agent.stageCounts);
      existing.row.responded += agent.responded;
      existing.row.resolved += agent.resolved;
      existing.row.reopened += agent.reopened;
      existing.row.csatScoredResponses += agent.csatScoredResponses;
      existing.row.csatGood += agent.csatGood;
      existing.row.csatBad += agent.csatBad;
      existing.row.emailReplies += agent.emailReplies;
      existing.row.assigneeName = existing.row.assigneeName ?? agent.assigneeName;
      existing.frt.push({ value: agent.avgFrtSeconds, weight: agent.responded });
      existing.rt.push({ value: agent.avgRtSeconds, weight: agent.resolved });
      existing.csat.push({ value: agent.csatAvgScore, weight: agent.csatScoredResponses });
    }
  }

  return [...byAssignee.values()]
    .map(({ row, frt, rt, csat }) => ({
      ...row,
      avgFrtSeconds: weightedMean(frt),
      avgRtSeconds: weightedMean(rt),
      csatAvgScore: weightedMean(csat),
    }))
    .sort((a, b) => b.assigned - a.assigned || b.emailReplies - a.emailReplies);
};

/** Merged drill-down rows, newest first. */
const mergeTickets = (contributions: DeskMetricsContribution[]): DeskMetricsTicketRow[] =>
  contributions
    .flatMap(({ metrics }) => metrics.tickets)
    .sort((a, b) => b.createdAt - a.createdAt);

/**
 * Aggregates one-or-more desks. `contributions` must be non-empty; the caller
 * is responsible for the all-desks-skipped case, which has no range to report.
 */
export const aggregateDeskMetrics = (
  contributions: DeskMetricsContribution[],
): Omit<DeskMetricsResponse, never> & {
  perDesk: Array<{
    channelId: string;
    channelName: string | null;
    avgFrtSeconds: number | null;
    respondedTickets: number;
    avgRtSeconds: number | null;
    resolvedTickets: number;
    csatAvgScore: number | null;
    csatGood: number;
    csatBad: number;
    openedInRange: number;
    emailRepliesInRange: number;
  }>;
} => {
  const first = contributions[0];
  if (!first) {
    throw new Error('aggregateDeskMetrics requires at least one contribution');
  }

  const sum = (pick: (m: DeskMetricsResponse) => number): number =>
    contributions.reduce((total, { metrics }) => total + pick(metrics), 0);

  return {
    // Every fan-out call used the same resolved timeRange, so any desk's range
    // is the aggregate range.
    range: first.metrics.range,
    frt: {
      avgSeconds: weightedMean(
        contributions.map(({ metrics }) => ({
          value: metrics.frt.avgSeconds,
          weight: metrics.frt.respondedTickets,
        })),
      ),
      respondedTickets: sum(m => m.frt.respondedTickets),
    },
    rt: {
      avgSeconds: weightedMean(
        contributions.map(({ metrics }) => ({
          value: metrics.rt.avgSeconds,
          weight: metrics.rt.resolvedTickets,
        })),
      ),
      resolvedTickets: sum(m => m.rt.resolvedTickets),
    },
    csat: {
      avgScore: weightedMean(
        contributions.map(({ metrics }) => ({
          value: metrics.csat.avgScore,
          weight: metrics.csat.scoredResponses,
        })),
      ),
      scoredResponses: sum(m => m.csat.scoredResponses),
      good: sum(m => m.csat.good),
      bad: sum(m => m.csat.bad),
    },
    counts: {
      openedInRange: sum(m => m.counts.openedInRange),
      emailRepliesInRange: sum(m => m.counts.emailRepliesInRange),
      stageCounts: mergeCounts(
        contributions.map(({ metrics }) => metrics.counts.stageCounts),
        'stageName',
        normalizeStageKey,
      ),
    },
    priority: mergeCounts(
      contributions.map(({ metrics }) => metrics.priority),
      'priority',
    ),
    trend: mergeTrend(contributions),
    tickets: mergeTickets(contributions),
    agents: mergeAgents(contributions),
    perDesk: contributions
      .map(({ channelId, channelName, metrics }) => ({
        channelId,
        channelName,
        avgFrtSeconds: metrics.frt.avgSeconds,
        respondedTickets: metrics.frt.respondedTickets,
        avgRtSeconds: metrics.rt.avgSeconds,
        resolvedTickets: metrics.rt.resolvedTickets,
        csatAvgScore: metrics.csat.avgScore,
        csatGood: metrics.csat.good,
        csatBad: metrics.csat.bad,
        openedInRange: metrics.counts.openedInRange,
        emailRepliesInRange: metrics.counts.emailRepliesInRange,
      }))
      .sort((a, b) => b.openedInRange - a.openedInRange),
  };
};
