/**
 * Desk metrics dashboard payload — GET /api/channels/:channelId/metrics.
 *
 * All metrics are computed from the ticket_activities table (single query
 * source, scoped by the denormalized channelId), so they are forward-only:
 * they cover activity recorded since the desk-metrics feature was deployed.
 * The one exception is counts.stageCounts, a live snapshot from tickets.
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
    good: number;
    bad: number;
  };
  counts: {
    openedInRange: number;
    emailRepliesInRange: number;
    /** Live snapshot — current ticket count per stage (not range-scoped). */
    stageCounts: Array<{ stageName: string; count: number }>;
  };
  priority: Array<{ priority: string; count: number }>;
  /** Daily opened vs closed counts for the trend chart. */
  trend: Array<{ date: string; opened: number; closed: number }>;
  tickets: DeskMetricsTicketRow[];
}
