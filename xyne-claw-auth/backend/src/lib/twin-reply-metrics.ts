/**
 * Pure aggregation helpers for the admin Digital-Twin "Reply activity" metrics.
 *
 * These functions take already-fetched rows (no Prisma, no IO) and roll them up
 * into the overall + per-user shapes the dashboard renders. Keeping them pure
 * makes them unit-testable without a DB (see scripts/twin-reply-metrics.test.ts)
 * — the memory-starved dev box OOMs on ts-jest + Prisma, so we verify with tsx.
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
  replies: {
    accepted: number;
    acceptedEdited: number;
    declined: number;
    ignored: number;
    pending: number;
    totalApproved: number;
    approvalRate: number | null;
    medianResponseSec: number | null;
  };
  gate: { respond: number; ignore: number; error: number };
  behavior: { responded: number; ignored: number; shouldHaveResponded: number };
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

function traceString(trace: unknown, key: string): string | null {
  if (trace && typeof trace === "object" && key in (trace as Record<string, unknown>)) {
    const v = (trace as Record<string, unknown>)[key];
    return typeof v === "string" ? v : null;
  }
  return null;
}

function traceNumber(trace: unknown, key: string): number | null {
  if (trace && typeof trace === "object" && key in (trace as Record<string, unknown>)) {
    const v = (trace as Record<string, unknown>)[key];
    return typeof v === "number" && !Number.isNaN(v) ? v : null;
  }
  return null;
}

// ── Reply feedback aggregation ───────────────────────────────────────────────

const REPLY_ACTIONS = ["react", "reply", "react_and_reply"] as const;

export function computeReplyAgg(rows: ReplyFeedbackRow[]): ReplyAgg {
  let pending = 0;
  let accepted = 0;
  let acceptedEdited = 0;
  let declined = 0;
  let ignored = 0;
  const actionCounts: Record<string, number> = {};
  const responseSecs: number[] = [];

  for (const r of rows) {
    switch (r.status) {
      case "pending":
        pending += 1;
        break;
      case "accepted":
        accepted += 1;
        break;
      case "accepted_edited":
        acceptedEdited += 1;
        break;
      case "declined":
        declined += 1;
        break;
      case "ignored":
        ignored += 1;
        break;
      default:
        break;
    }
    actionCounts[r.deliveryAction] = (actionCounts[r.deliveryAction] ?? 0) + 1;

    // Response time is only meaningful for an explicit decision (accept/edit/
    // decline). "ignored" rows have decidedAt set to the 12h reconcile time, so
    // they'd wildly inflate the latency — exclude them.
    const explicitlyDecided =
      r.status === "accepted" || r.status === "accepted_edited" || r.status === "declined";
    if (explicitlyDecided && r.decidedAt) {
      const sec = (r.decidedAt.getTime() - r.proposedAt.getTime()) / 1000;
      if (sec >= 0) responseSecs.push(sec);
    }
  }

  const totalApproved = accepted + acceptedEdited;
  const decided = totalApproved + declined;

  const byAction = REPLY_ACTIONS.map((action) => ({
    action,
    count: actionCounts[action] ?? 0,
  })).filter((a) => a.count > 0);

  return {
    total: rows.length,
    pending,
    accepted,
    acceptedEdited,
    totalApproved,
    declined,
    ignored,
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

// ── Gate aggregation ─────────────────────────────────────────────────────────

export function computeGateAgg(rows: GateEventRow[]): GateAgg {
  let respond = 0;
  let ignore = 0;
  let error = 0;
  const durations: number[] = [];
  const confidences: number[] = [];
  const sourceMap: Record<string, { respond: number; ignore: number }> = {};

  for (const r of rows) {
    if (r.status === "ok") respond += 1;
    else if (r.status === "empty") ignore += 1;
    else if (r.status === "error") error += 1;

    if (typeof r.durationMs === "number" && r.durationMs > 0) durations.push(r.durationMs);

    // confidence / decisionSource live in the GateTrace, only on real decisions.
    if (r.status === "ok" || r.status === "empty") {
      const conf = traceNumber(r.trace, "confidence");
      if (conf !== null) confidences.push(conf);
      const src = traceString(r.trace, "decisionSource") ?? "unknown";
      if (!sourceMap[src]) sourceMap[src] = { respond: 0, ignore: 0 };
      if (r.status === "ok") sourceMap[src].respond += 1;
      else sourceMap[src].ignore += 1;
    }
  }

  const decisions = respond + ignore;
  const byDecisionSource = Object.entries(sourceMap)
    .map(([source, c]) => ({ source, respond: c.respond, ignore: c.ignore }))
    .sort((a, b) => b.respond + b.ignore - (a.respond + a.ignore));

  return {
    total: rows.length,
    respond,
    ignore,
    error,
    respondRate: ratio(respond, decisions),
    errorRate: ratio(error, rows.length),
    avgConfidence: mean(confidences),
    avgDurationMs: mean(durations),
    medianDurationMs: percentile(durations, 0.5),
    byDecisionSource,
  };
}

// ── Behaviour aggregation ────────────────────────────────────────────────────

export function computeBehaviorAgg(rows: BehaviorRow[]): BehaviorAgg {
  let responded = 0;
  let ignored = 0;
  let shouldHaveResponded = 0;
  for (const r of rows) {
    if (r.outcome === "responded") responded += 1;
    else if (r.outcome === "ignored") ignored += 1;
    if (r.shouldHaveResponded) shouldHaveResponded += 1;
  }
  return { total: rows.length, responded, ignored, shouldHaveResponded };
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

    out.push({
      userId,
      name: who?.name ?? userId,
      email: who?.email ?? "",
      replies: {
        accepted: reply.accepted,
        acceptedEdited: reply.acceptedEdited,
        declined: reply.declined,
        ignored: reply.ignored,
        pending: reply.pending,
        totalApproved: reply.totalApproved,
        approvalRate: reply.approvalRate,
        medianResponseSec: reply.responseTime.medianSec,
      },
      gate: { respond: gate.respond, ignore: gate.ignore, error: gate.error },
      behavior: {
        responded: behavior.responded,
        ignored: behavior.ignored,
        shouldHaveResponded: behavior.shouldHaveResponded,
      },
      activity,
    });
  }

  out.sort((a, b) => b.activity - a.activity);
  return out;
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
