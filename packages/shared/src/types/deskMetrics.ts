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

/**
 * Per-agent performance row. "Agent" = the user a ticket is assigned to.
 *
 * assigned, responded, resolved, reopened, the averages and the CSAT fields are
 * OWNERSHIP-attributed: they cover the cohort tickets (created in range)
 * currently assigned to this agent.
 * emailReplies is ACTOR-attributed: replies this user personally sent in range,
 * regardless of who owns the ticket — on a shared desk many agents reply to
 * tickets they do not own, and ownership would hide that work.
 */
export interface DeskMetricsAgentRow {
  assigneeId: string | null; // null = the Unassigned bucket
  assigneeName: string | null;
  assigned: number;
  /** Current stage distribution of this agent's cohort tickets. */
  stageCounts: Array<{ stageName: string; count: number }>;
  responded: number;
  resolved: number;
  /** Distinct cohort tickets reopened at least once within the selected range. */
  reopened: number;
  avgFrtSeconds: number | null;
  avgRtSeconds: number | null;
  csatAvgScore: number | null; // 1..5
  /** Number of non-null numeric scores included in csatAvgScore. */
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
    /** Number of non-null numeric scores included in avgScore. */
    scoredResponses: number;
    good: number;
    bad: number;
  };
  counts: {
    openedInRange: number;
    emailRepliesInRange: number;
    /** Current stage of the cohort tickets (range-scoped, excludes archived). */
    stageCounts: Array<{ stageName: string; count: number }>;
  };
  priority: Array<{ priority: string; count: number }>;
  /** Daily opened vs closed counts for the trend chart. */
  trend: Array<{ date: string; opened: number; closed: number }>;
  tickets: DeskMetricsTicketRow[];
  /** Agent-level performance leaderboard, highest workload first. */
  agents: DeskMetricsAgentRow[];
}

/**
 * Headline numbers for one desk inside a multi-desk aggregate, so the UI can
 * rank/compare desks side by side. Mirrors the scalar parts of
 * DeskMetricsResponse; the arrays are only returned in aggregated form.
 */
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

/** Why a requested desk contributed nothing to the aggregate. */
export type DeskMetricsSkipReason = 'not_found' | 'forbidden' | 'metrics_disabled' | 'error';

export interface DeskMetricsSkippedDesk {
  channelId: string;
  reason: DeskMetricsSkipReason;
}

/**
 * GET /api/desk-metrics/aggregate?channelIds=a,b,c
 *
 * Same shape as DeskMetricsResponse so the existing dashboard renders it
 * unchanged, plus a per-desk breakdown and the list of desks that were
 * skipped (no access / metrics never enabled), which the UI must surface so a
 * silently-missing desk is never mistaken for a desk with zero activity.
 */
export interface DeskMetricsAggregateResponse extends DeskMetricsResponse {
  perDesk: DeskMetricsPerDeskRow[];
  skipped: DeskMetricsSkippedDesk[];
}

/** Shared API/UI limit for one multi-desk metrics request. */
export const DESK_METRICS_MAX_AGGREGATE_DESKS = 20;
