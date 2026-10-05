/**
 * Pure aggregation helpers for the admin Digital-Twin "Reply activity" metrics.
 *
 * These functions take already-fetched rows (no Prisma, no IO) and roll them up
 * into the overall + per-user shapes the dashboard renders. Keeping them pure
 * makes them unit-testable without a DB (see twin-reply-metrics.test.ts).
 *
 * Three independent subsystems feed the page:
 *   1. TwinResponseFeedback  → the user's accept/edit/decline/ignore of a twin
 *      DRAFT + how long they took to decide (response time).
 *   2. DigitalTwinPipelineEvent (runType="gate") → the respond/ignore GATE:
 *      status "ok"=respond, "empty"=ignore, "error"=failed, + confidence /
 *      decisionSource in `trace`.
 *   3. TwinBehaviorSignal → ground-truth behaviour (responded/ignored) + wrong
 *      silences (gate stayed silent but the user replied themselves).
 *
 * Rates are returned as fractions in [0,1] so the frontend's `formatPct`
 * (which multiplies by 100) renders them correctly.
 */

// ── Row shapes (minimal projections of the Prisma models) ────────────────────

export interface ReplyFeedbackRow {
  userId: string;
  /** "pending" | "accepted" | "accepted_edited" | "declined" | "ignored". */
  status: string;
  /** "react" | "reply" | "react_and_reply". */
  deliveryAction: string;
  proposedAt: Date;
  decidedAt: Date | null;
}

export interface GateEventRow {
  userId: string;
  /** "ok"=respond | "empty"=ignore | "error". */
  status: string;
  durationMs: number;
  /** GateTrace JSON (or anything) — we defensively read confidence/decisionSource. */
  trace: unknown;
}

export interface BehaviorRow {
  userId: string;
  /** "responded" | "ignored" | "pending". */
  outcome: string;
  /** "respond" | "ignore" | null. */
  gateDecision: string | null;
  shouldHaveResponded: boolean;
}

// ── Output shapes ────────────────────────────────────────────────────────────

export interface ResponseTimeAgg {
  medianSec: number | null;
  p90Sec: number | null;
  avgSec: number | null;
  count: number;
}

export interface ReplyAgg {
  total: number;
  pending: number;
  accepted: number;
  acceptedEdited: number;
  totalApproved: number;
  declined: number;
  ignored: number;
  /** approved / (approved + declined). null when no explicit decisions. */
  approvalRate: number | null;
  /** editedApprovals / approvals. null when no approvals. */
  editRate: number | null;
  /** declined / (approved + declined). null when no explicit decisions. */
  declineRate: number | null;
  byAction: Array<{ action: string; count: number }>;
  responseTime: ResponseTimeAgg;
}

export interface DecisionSourceAgg {
  source: string;
  respond: number;
  ignore: number;
}

export interface GateAgg {
  total: number;
  respond: number;
  ignore: number;
  error: number;
  /** respond / (respond + ignore). Excludes errors. null when no decisions. */
  respondRate: number | null;
  /** error / total. null when no gate events. */
  errorRate: number | null;
  avgConfidence: number | null;
  avgDurationMs: number | null;
  medianDurationMs: number | null;
  byDecisionSource: DecisionSourceAgg[];
}

export interface BehaviorAgg {
  total: number;
  responded: number;
  ignored: number;
  shouldHaveResponded: number;
}

export interface PerUserRow {
  userId: string;
  name: string;
  email: string;
  replies: Pick<
    ReplyAgg,
    "accepted" | "acceptedEdited" | "declined" | "ignored" | "pending" | "totalApproved" | "approvalRate"
  > & { medianResponseSec: number | null };
  gate: Pick<GateAgg, "respond" | "ignore" | "error">;
  behavior: Pick<BehaviorAgg, "responded" | "ignored" | "shouldHaveResponded">;
  /** Total actioned events — used to sort the table by activity. */
  activity: number;
}

// ── Small numeric helpers ────────────────────────────────────────────────────

/** Linear-interpolated percentile (p in [0,1]) over a numeric sample. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const frac = idx - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/** One key off a JSON trace, without trusting its shape. */
function traceField(trace: unknown, key: string): unknown {
  return trace && typeof trace === "object" ? (trace as Record<string, unknown>)[key] : undefined;
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = map.get(k);
    if (bucket) bucket.push(row);
    else map.set(k, [row]);
  }
  return map;
}

function countBy<T>(rows: T[], key: (row: T) => string): Map<string, number> {
  return new Map([...groupBy(rows, key)].map(([k, group]) => [k, group.length]));
}

// ── Reply feedback aggregation ───────────────────────────────────────────────

const REPLY_ACTIONS = ["react", "reply", "react_and_reply"] as const;

// Response time is only meaningful for an explicit decision (accept/edit/
// decline). "ignored" rows have decidedAt set to the 12h reconcile time, so
// they'd wildly inflate the latency — exclude them.
const EXPLICIT_DECISION_STATUSES = new Set(["accepted", "accepted_edited", "declined"]);

export function computeReplyAgg(rows: ReplyFeedbackRow[]): ReplyAgg {
  const byStatus = countBy(rows, (r) => r.status);
  const byDelivery = countBy(rows, (r) => r.deliveryAction);
  const count = (status: string): number => byStatus.get(status) ?? 0;
  const accepted = count("accepted");
  const acceptedEdited = count("accepted_edited");
  const declined = count("declined");
  const totalApproved = accepted + acceptedEdited;
  const decided = totalApproved + declined;

  const responseSecs = rows
    .filter((r) => EXPLICIT_DECISION_STATUSES.has(r.status) && r.decidedAt)
    .map((r) => (r.decidedAt!.getTime() - r.proposedAt.getTime()) / 1000)
    .filter((sec) => sec >= 0);

  const byAction = REPLY_ACTIONS.map((action) => ({
    action,
    count: byDelivery.get(action) ?? 0,
  })).filter((a) => a.count > 0);

  return {
    total: rows.length,
    pending: count("pending"),
    accepted,
    acceptedEdited,
    totalApproved,
    declined,
    ignored: count("ignored"),
    approvalRate: ratio(totalApproved, decided),
    editRate: ratio(acceptedEdited, totalApproved),
    declineRate: ratio(declined, decided),
    byAction,
    responseTime: {
      medianSec: percentile(responseSecs, 0.5),
      p90Sec: percentile(responseSecs, 0.9),
      avgSec: mean(responseSecs),
      count: responseSecs.length,
    },
  };
}

// ── Weekly trend (R11: "is the twin getting better?") ────────────────────────

export interface WeeklyReplyPoint {
  /** Monday 00:00 UTC of the week, ISO date (YYYY-MM-DD). */
  weekStart: string;
  proposed: number;
  accepted: number;
  acceptedEdited: number;
  declined: number;
  ignored: number;
  /** approved / (approved + declined). null when no explicit decisions. */
  approvalRate: number | null;
  /** accepted as-is / (approved + declined): drafts good enough to send untouched. */
  cleanApprovalRate: number | null;
}

function weekStartUtc(d: Date): string {
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return monday.toISOString().slice(0, 10);
}

/**
 * Per-week approval trend, oldest first, bucketed by when the draft was
 * proposed. The one number that says whether accept/edit/decline feedback is
 * actually improving the twin over time.
 */
export function computeWeeklyTrend(rows: ReplyFeedbackRow[]): WeeklyReplyPoint[] {
  return [...groupBy(rows, (r) => weekStartUtc(r.proposedAt))]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, weekRows]) => {
      const a = computeReplyAgg(weekRows);
      return {
        weekStart,
        proposed: a.total,
        accepted: a.accepted,
        acceptedEdited: a.acceptedEdited,
        declined: a.declined,
        ignored: a.ignored,
        approvalRate: a.approvalRate,
        cleanApprovalRate: ratio(a.accepted, a.totalApproved + a.declined),
      };
    });
}

// ── Gate aggregation ─────────────────────────────────────────────────────────

export function computeGateAgg(rows: GateEventRow[]): GateAgg {
  const byStatus = countBy(rows, (r) => r.status);
  const respond = byStatus.get("ok") ?? 0;
  const ignore = byStatus.get("empty") ?? 0;
  const error = byStatus.get("error") ?? 0;
  const durations = rows.map((r) => r.durationMs).filter((ms) => typeof ms === "number" && ms > 0);

  // confidence / decisionSource live in the GateTrace, only on real decisions.
  const decisions = rows.filter((r) => r.status === "ok" || r.status === "empty");
  const confidences = decisions
    .map((r) => traceField(r.trace, "confidence"))
    .filter((c): c is number => typeof c === "number" && !Number.isNaN(c));
  // Plain object (not Map) + ||= (not ??=) on purpose: mirrors the old falsy check and Object.values keeps the pre-refactor order for ties.
  const bySource: Record<string, DecisionSourceAgg> = {};
  for (const r of decisions) {
    const decisionSource = traceField(r.trace, "decisionSource");
    const source = typeof decisionSource === "string" ? decisionSource : "unknown";
    const agg = (bySource[source] ||= { source, respond: 0, ignore: 0 });
    agg[r.status === "ok" ? "respond" : "ignore"] += 1;
  }

  return {
    total: rows.length,
    respond,
    ignore,
    error,
    respondRate: ratio(respond, respond + ignore),
    errorRate: ratio(error, rows.length),
    avgConfidence: mean(confidences),
    avgDurationMs: mean(durations),
    medianDurationMs: percentile(durations, 0.5),
    byDecisionSource: Object.values(bySource).sort((a, b) => b.respond + b.ignore - (a.respond + a.ignore)),
  };
}

// ── Behaviour aggregation ────────────────────────────────────────────────────

export function computeBehaviorAgg(rows: BehaviorRow[]): BehaviorAgg {
  const byOutcome = countBy(rows, (r) => r.outcome);
  return {
    total: rows.length,
    responded: byOutcome.get("responded") ?? 0,
    ignored: byOutcome.get("ignored") ?? 0,
    shouldHaveResponded: rows.filter((r) => r.shouldHaveResponded).length,
  };
}

// ── Per-user rollup ──────────────────────────────────────────────────────────

export interface UserIdentity {
  id: string;
  name: string;
  email: string;
}

/**
 * Build the per-user breakdown by bucketing every row by userId and reusing the
 * pure aggregators. Users with zero activity across all three subsystems are
 * dropped. Sorted by total activity desc.
 */
export function computePerUser(
  users: UserIdentity[],
  replyRows: ReplyFeedbackRow[],
  gateRows: GateEventRow[],
  behaviorRows: BehaviorRow[],
): PerUserRow[] {
  const identity = new Map(users.map((u) => [u.id, u]));
  const replyByUser = groupBy(replyRows, (r) => r.userId);
  const gateByUser = groupBy(gateRows, (r) => r.userId);
  const behaviorByUser = groupBy(behaviorRows, (r) => r.userId);

  const userIds = new Set<string>([
    ...replyByUser.keys(),
    ...gateByUser.keys(),
    ...behaviorByUser.keys(),
  ]);

  const out: PerUserRow[] = [];
  for (const userId of userIds) {
    const reply = computeReplyAgg(replyByUser.get(userId) ?? []);
    const gate = computeGateAgg(gateByUser.get(userId) ?? []);
    const behavior = computeBehaviorAgg(behaviorByUser.get(userId) ?? []);
    const who = identity.get(userId);

    const activity =
      reply.accepted +
      reply.acceptedEdited +
      reply.declined +
      reply.ignored +
      gate.total +
      behavior.total;
    if (activity === 0) continue;

    const { accepted, acceptedEdited, declined, ignored, pending, totalApproved, approvalRate } = reply;
    const medianResponseSec = reply.responseTime.medianSec;
    out.push({
      userId,
      name: who?.name ?? userId,
      email: who?.email ?? "",
      replies: { accepted, acceptedEdited, declined, ignored, pending, totalApproved, approvalRate, medianResponseSec },
      gate: { respond: gate.respond, ignore: gate.ignore, error: gate.error },
      behavior: {
        responded: behavior.responded,
        ignored: behavior.ignored,
        shouldHaveResponded: behavior.shouldHaveResponded,
      },
      activity,
    });
  }

  return out.sort((a, b) => b.activity - a.activity);
}
