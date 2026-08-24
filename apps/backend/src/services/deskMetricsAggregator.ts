import type {
  DeskMetricKey,
  DeskMetricsAgentRow,
  DeskMetricsAiCategoryCount,
  DeskMetricsAiSubCategoryCount,
  DeskMetricsCustomFieldBreakdown,
  DeskMetricsCustomFieldSummary,
  DeskMetricsPartial,
  DeskMetricsPerDeskRow,
  DeskMetricsQueryPerDeskRow,
  DeskMetricsResponse,
  DeskMetricsTicketRow,
} from '@xyne/shared';

export interface DeskMetricsContribution {
  channelId: string;
  channelName: string | null;
  metrics: DeskMetricsResponse;
}

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

const mergeTagCategories = (contributions: DeskMetricsContribution[]): DeskMetricsResponse['tagCategories'] => {
  const totals = new Map<string, number>();
  for (const { metrics } of contributions) {
    for (const row of metrics.tagCategories) {
      totals.set(row.tagCategory, (totals.get(row.tagCategory) ?? 0) + row.count);
    }
  }
  return [...totals.entries()].map(([tagCategory, count]) => ({ tagCategory, count })).sort((a, b) => b.count - a.count);
};

const mergeTagBreakdown = (contributions: DeskMetricsContribution[]): DeskMetricsResponse['tagBreakdown'] => {
  const totals = new Map<string, { tag: string; tagCategory: string; count: number }>();
  for (const { metrics } of contributions) {
    for (const row of metrics.tagBreakdown) {
      const key = `${row.tagCategory}::${row.tag}`;
      const existing = totals.get(key);
      totals.set(key, { tag: row.tag, tagCategory: row.tagCategory, count: (existing?.count ?? 0) + row.count });
    }
  }
  return [...totals.values()].sort((a, b) => b.count - a.count);
};

const mergeTickets = (contributions: DeskMetricsContribution[]): DeskMetricsTicketRow[] =>
  contributions
    .flatMap(({ metrics }) => metrics.tickets)
    .sort((a, b) => b.createdAt - a.createdAt);

export const fillDeskMetrics = (partial: DeskMetricsPartial): DeskMetricsResponse => ({
  range: partial.range,
  frt: partial.frt ?? { avgSeconds: null, respondedTickets: 0 },
  rt: partial.rt ?? { avgSeconds: null, resolvedTickets: 0 },
  csat: partial.csat ?? { avgScore: null, scoredResponses: 0, good: 0, bad: 0 },
  counts: partial.counts ?? { openedInRange: 0, emailRepliesInRange: 0, stageCounts: [] },
  priority: partial.priority ?? [],
  trend: partial.trend ?? [],
  tagCategories: partial.tagCategories ?? [],
  tagBreakdown: partial.tagBreakdown ?? [],
  tickets: partial.tickets ?? [],
  agents: partial.agents ?? [],
});


export const mergeCustomFieldSlices = (
  partials: DeskMetricsPartial[],
): {
  customFields?: DeskMetricsCustomFieldSummary[];
  customFieldBreakdown?: DeskMetricsCustomFieldBreakdown[];
} => {
  const summaries = new Map<string, DeskMetricsCustomFieldSummary>();
  let sawSummary = false;
  for (const p of partials) {
    if (!p.customFields) continue;
    sawSummary = true;
    for (const f of p.customFields) {
      const existing = summaries.get(f.field);
      if (!existing) {
        summaries.set(f.field, { ...f });
        continue;
      }
      existing.multiValue = existing.multiValue || f.multiValue;
      existing.ticketsWithValue += f.ticketsWithValue;
      existing.distinctValues = Math.max(existing.distinctValues, f.distinctValues);
    }
  }

  const breakdowns = new Map<string, { multiValue: boolean; values: Map<string, number> }>();
  let sawBreakdown = false;
  for (const p of partials) {
    if (!p.customFieldBreakdown) continue;
    sawBreakdown = true;
    for (const b of p.customFieldBreakdown) {
      const entry = breakdowns.get(b.field) ?? { multiValue: false, values: new Map() };
      entry.multiValue = entry.multiValue || b.multiValue;
      for (const v of b.values) {
        entry.values.set(v.value, (entry.values.get(v.value) ?? 0) + v.tickets);
      }
      breakdowns.set(b.field, entry);
    }
  }

  return {
    ...(sawSummary
      ? {
          customFields: [...summaries.values()].sort(
            (a, b) => b.ticketsWithValue - a.ticketsWithValue || a.field.localeCompare(b.field),
          ),
        }
      : {}),
    ...(sawBreakdown
      ? {
          customFieldBreakdown: [...breakdowns.entries()]
            .map(([field, e]) => ({
              field,
              multiValue: e.multiValue,
              values: [...e.values.entries()]
                .map(([value, tickets]) => ({ value, tickets }))
                .sort((a, b) => b.tickets - a.tickets || a.value.localeCompare(b.value)),
            }))
            .sort((a, b) => a.field.localeCompare(b.field)),
        }
      : {}),
  };
};

/**
 * Merge the AI-classification slices across desks.
 */
export const mergeAiCategorySlices = (
  partials: DeskMetricsPartial[],
): {
  aiCategoryCounts?: DeskMetricsAiCategoryCount[];
  aiSubCategoryCounts?: DeskMetricsAiSubCategoryCount[];
} => {
  const categories = new Map<string, number>();
  const subCategories = new Map<string, { cat: string; sub: string; count: number }>();
  let sawCategories = false;
  let sawSub = false;

  for (const p of partials) {
    if (p.aiCategoryCounts) {
      sawCategories = true;
      for (const r of p.aiCategoryCounts) {
        categories.set(r.aiCategory, (categories.get(r.aiCategory) ?? 0) + r.count);
      }
    }
    if (p.aiSubCategoryCounts) {
      sawSub = true;
      for (const r of p.aiSubCategoryCounts) {
        const key = `${r.aiCategory}::${r.aiSubCategory}`;
        const existing = subCategories.get(key);
        subCategories.set(key, {
          cat: r.aiCategory,
          sub: r.aiSubCategory,
          count: (existing?.count ?? 0) + r.count,
        });
      }
    }
  }

  return {
    ...(sawCategories
      ? {
          aiCategoryCounts: [...categories.entries()]
            .map(([aiCategory, count]) => ({ aiCategory, count }))
            .sort((a, b) => b.count - a.count || a.aiCategory.localeCompare(b.aiCategory)),
        }
      : {}),
    ...(sawSub
      ? {
          aiSubCategoryCounts: [...subCategories.values()]
            .map(v => ({ aiCategory: v.cat, aiSubCategory: v.sub, count: v.count }))
            .sort(
              (a, b) =>
                b.count - a.count ||
                a.aiCategory.localeCompare(b.aiCategory) ||
                a.aiSubCategory.localeCompare(b.aiSubCategory),
            ),
        }
      : {}),
  };
};

/**
 * Drop per-desk fields whose metric was never requested. fillDeskMetrics
 * zero-fills those slices so aggregateDeskMetrics can run, and without this
 * the placeholders reach the caller as real measurements.
 */
export const prunePerDesk = (
  rows: DeskMetricsPerDeskRow[],
  wanted: Set<DeskMetricKey>,
): DeskMetricsQueryPerDeskRow[] =>
  rows.map(row => ({
    channelId: row.channelId,
    channelName: row.channelName,
    ...(wanted.has('frt')
      ? { avgFrtSeconds: row.avgFrtSeconds, respondedTickets: row.respondedTickets }
      : {}),
    ...(wanted.has('rt')
      ? { avgRtSeconds: row.avgRtSeconds, resolvedTickets: row.resolvedTickets }
      : {}),
    ...(wanted.has('csat')
      ? { csatAvgScore: row.csatAvgScore, csatGood: row.csatGood, csatBad: row.csatBad }
      : {}),
    ...(wanted.has('counts')
      ? { openedInRange: row.openedInRange, emailRepliesInRange: row.emailRepliesInRange }
      : {}),
  }));

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
    tagCategories: mergeTagCategories(contributions),
    tagBreakdown: mergeTagBreakdown(contributions),
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
