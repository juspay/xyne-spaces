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
