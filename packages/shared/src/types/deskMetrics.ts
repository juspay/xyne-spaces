/**
 * Desk metrics dashboard payload — GET /api/channels/:channelId/metrics.
 *
 * All metrics are computed from the ticket_activities table (single query
 * source, scoped by the denormalized channelId), so they are forward-only:
 * they cover activity recorded since the desk-metrics feature was deployed.
 */

/** Per-ticket drill-down row (newest cohort tickets). */
export interface DeskMetricsTicketRow {
  ticketId: string;
  xyneId: string | null;
  channelId: string;
  title: string | null;
  createdAt: number; // epoch ms
  priority: string;
  stageName: string | null;
  statusV2: string;
  assigneeId: string | null;
  assigneeName: string | null;
  frtSeconds: number | null;
  rtSeconds: number | null;
  csatScore: number | null; // 1..5
  csatRating: string | null; // GOOD | BAD
  customFields: Record<string, string> | null; // form field name → value; only fields with non-empty values included
  tags: Array<{ tagCategory: string; tag: string }> | null; // desk-email tags from the ticket's conversation
}

/** Ticket metrics use current ownership; emailReplies uses the sending actor. */
export interface DeskMetricsAgentRow {
  assigneeId: string | null; // null = the Unassigned bucket
  assigneeName: string | null;
  assigned: number;
  stageCounts: Array<{ stageName: string; count: number }>;
  responded: number;
  resolved: number;
  reopened: number;
  avgFrtSeconds: number | null;
  avgRtSeconds: number | null;
  csatAvgScore: number | null; // 1..5
  csatScoredResponses: number;
  csatGood: number;
  csatBad: number;
  emailReplies: number;
}

export interface DeskMetricsResponse {
  range: { from: string; to: string }; // ISO strings, resolved from timeRange
  frt: {
    avgSeconds: number | null;
    respondedTickets: number;
  };
  rt: {
    avgSeconds: number | null;
    resolvedTickets: number;
  };
  csat: {
    avgScore: number | null; // 1..5
    scoredResponses: number;
    good: number;
    bad: number;
  };
  counts: {
    openedInRange: number;
    emailRepliesInRange: number;
    stageCounts: Array<{ stageName: string; count: number }>;
  };
  priority: Array<{ priority: string; count: number }>;
  /** Daily opened vs closed counts for the trend chart. */
  trend: Array<{ date: string; opened: number; closed: number }>;
  /** Tag category breakdown — count of distinct tickets per category. Level-1 "By Tags" chart data. */
  tagCategories: Array<{ tagCategory: string; count: number }>;
  /** Per-tag breakdown across all categories — Level-2/3 "By Tags" chart data. */
  tagBreakdown: Array<{ tag: string; tagCategory: string; count: number }>;
  tickets: DeskMetricsTicketRow[];
  agents: DeskMetricsAgentRow[];
}

export interface DeskMetricsPerDeskRow {
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
}

export type DeskMetricsSkipReason = 'not_found' | 'forbidden' | 'metrics_disabled' | 'error';

export interface DeskMetricsSkippedDesk {
  channelId: string;
  reason: DeskMetricsSkipReason;
}

export interface DeskMetricsAggregateResponse extends DeskMetricsResponse {
  perDesk: DeskMetricsPerDeskRow[];
  skipped: DeskMetricsSkippedDesk[];
}

export const DESK_METRICS_MAX_AGGREGATE_DESKS = 20;
// Agent-facing API — GET /api/desk-metrics/desks and
// POST /api/desk-metrics/claw/query, behind the spaces-desk-metrics MCP tool.
export const DESK_METRIC_KEYS = [
  'frt',
  'rt',
  'csat',
  'counts',
  'priority',
  'trend',
  'agents',
  'tags',
  'aiCategories',
  'customFields',
  'tickets',
] as const;
export type DeskMetricKey = (typeof DESK_METRIC_KEYS)[number];
export const DEFAULT_DESK_METRIC_KEYS: DeskMetricKey[] = ['frt', 'rt', 'csat', 'counts'];

/** A metrics run with only the requested slices populated. */
export interface DeskMetricsPartial {
  range: { from: string; to: string };
  frt?: DeskMetricsResponse['frt'];
  rt?: DeskMetricsResponse['rt'];
  csat?: DeskMetricsResponse['csat'];
  counts?: DeskMetricsResponse['counts'];
  priority?: DeskMetricsResponse['priority'];
  trend?: DeskMetricsResponse['trend'];
  agents?: DeskMetricsAgentRow[];
  tagCategories?: DeskMetricsResponse['tagCategories'];
  tagBreakdown?: DeskMetricsResponse['tagBreakdown'];
  customFields?: DeskMetricsCustomFieldSummary[];
  customFieldBreakdown?: DeskMetricsCustomFieldBreakdown[];
  aiCategoryCounts?: DeskMetricsAiCategoryCount[];
  aiSubCategoryCounts?: DeskMetricsAiSubCategoryCount[];
  tickets?: DeskMetricsTicketRow[];
  ticketsTruncated?: boolean;
}


export interface DeskMetricsAiCategoryCount {
  aiCategory: string;
  count: number;
}

export interface DeskMetricsAiSubCategoryCount {
  aiCategory: string;
  aiSubCategory: string;
  count: number;
}

export const UNCLASSIFIED_AI_CATEGORY = 'Unclassified';

export interface DeskMetricsCustomFieldSummary {
  field: string;
  multiValue: boolean;
  ticketsWithValue: number;
  distinctValues: number;
}

/** Value distribution for one custom field across the cohort. */
export interface DeskMetricsCustomFieldBreakdown {
  field: string;
  multiValue: boolean;
  values: Array<{ value: string; tickets: number }>;
  truncated?: boolean;
}

/** One desk the caller can read metrics for. */
export interface DeskMetricsDeskSummary {
  channelId: string;
  channelName: string | null;
  deskType: string;
  metricsEnabled: boolean;
}

export interface DeskMetricsDeskListResponse {
  desks: DeskMetricsDeskSummary[];
}

/**
 * Per-desk row on the agent-facing query response. Metric fields are optional:
 * absent means "not requested", which a hard zero cannot express.
 */
export interface DeskMetricsQueryPerDeskRow {
  channelId: string;
  channelName: string | null;
  avgFrtSeconds?: number | null;
  respondedTickets?: number;
  avgRtSeconds?: number | null;
  resolvedTickets?: number;
  csatAvgScore?: number | null;
  csatGood?: number;
  csatBad?: number;
  openedInRange?: number;
  emailRepliesInRange?: number;
}

export interface DeskMetricsQueryResponse extends DeskMetricsPartial {
  desks: DeskMetricsDeskSummary[];
  skipped: DeskMetricsSkippedDesk[];
  perDesk?: DeskMetricsQueryPerDeskRow[];
  notes: string[];
}
