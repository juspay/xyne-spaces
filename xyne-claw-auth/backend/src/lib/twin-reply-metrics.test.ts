import { describe, it, expect } from "vitest";
import {
  percentile,
  mean,
  computeReplyAgg,
  computeGateAgg,
  computeBehaviorAgg,
  computePerUser,
  type ReplyFeedbackRow,
  type GateEventRow,
  type BehaviorRow,
} from "./twin-reply-metrics.js";

// Pure aggregation core for the admin twin "Reply activity" metrics. No Prisma,
// no IO — verifies the rate math, response-time percentiles, gate status
// mapping, and per-user bucketing that the endpoint relies on.

const t = (iso: string): Date => new Date(iso);

describe("percentile / mean", () => {
  it("empty sample → null", () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(mean([])).toBeNull();
  });

  it("single value → that value", () => {
    expect(percentile([42], 0.9)).toBe(42);
    expect(mean([42])).toBe(42);
  });

  it("median + p90 interpolate", () => {
    const vals = [1, 2, 3, 4, 5];
    expect(percentile(vals, 0.5)).toBe(3);
    expect(percentile(vals, 0.9)).toBeCloseTo(4.6, 5);
    expect(mean(vals)).toBe(3);
  });
});

describe("computeReplyAgg", () => {
  const rows: ReplyFeedbackRow[] = [
    { userId: "u1", status: "accepted", deliveryAction: "reply", proposedAt: t("2026-01-01T00:00:00Z"), decidedAt: t("2026-01-01T00:00:10Z") }, // 10s
    { userId: "u1", status: "accepted_edited", deliveryAction: "reply", proposedAt: t("2026-01-01T00:00:00Z"), decidedAt: t("2026-01-01T00:00:30Z") }, // 30s
    { userId: "u1", status: "declined", deliveryAction: "react", proposedAt: t("2026-01-01T00:00:00Z"), decidedAt: t("2026-01-01T00:00:20Z") }, // 20s
    { userId: "u1", status: "ignored", deliveryAction: "reply", proposedAt: t("2026-01-01T00:00:00Z"), decidedAt: t("2026-01-01T12:00:00Z") }, // excluded from RT
    { userId: "u1", status: "pending", deliveryAction: "react_and_reply", proposedAt: t("2026-01-02T00:00:00Z"), decidedAt: null },
  ];
  const agg = computeReplyAgg(rows);

  it("counts each status", () => {
    expect(agg.total).toBe(5);
    expect(agg.accepted).toBe(1);
    expect(agg.acceptedEdited).toBe(1);
    expect(agg.totalApproved).toBe(2);
    expect(agg.declined).toBe(1);
    expect(agg.ignored).toBe(1);
    expect(agg.pending).toBe(1);
  });

  it("approval / edit / decline rates as fractions", () => {
    // approved 2 of (2 approved + 1 declined) = 2/3
    expect(agg.approvalRate).toBeCloseTo(2 / 3, 5);
    expect(agg.editRate).toBeCloseTo(1 / 2, 5); // 1 edited of 2 approvals
    expect(agg.declineRate).toBeCloseTo(1 / 3, 5);
  });

  it("response time excludes ignored (reconcile time)", () => {
    // Only the 10s/30s/20s explicit decisions count.
    expect(agg.responseTime.count).toBe(3);
    expect(agg.responseTime.medianSec).toBe(20);
    expect(agg.responseTime.avgSec).toBe(20);
  });

  it("byAction drops zero-count actions", () => {
    const byAction = Object.fromEntries(agg.byAction.map((a) => [a.action, a.count]));
    expect(byAction["reply"]).toBe(3);
    expect(byAction["react"]).toBe(1);
    expect(byAction["react_and_reply"]).toBe(1);
  });

  it("empty → nulls not NaN", () => {
    const e = computeReplyAgg([]);
    expect(e.approvalRate).toBeNull();
    expect(e.responseTime.medianSec).toBeNull();
  });
});

describe("computeGateAgg", () => {
  const rows: GateEventRow[] = [
    { userId: "u1", status: "ok", durationMs: 100, trace: { confidence: 0.9, decisionSource: "llm" } },
    { userId: "u1", status: "empty", durationMs: 200, trace: { confidence: 0.7, decisionSource: "llm" } },
    { userId: "u1", status: "empty", durationMs: 300, trace: { confidence: 0.5, decisionSource: "rule-thread" } },
    { userId: "u1", status: "error", durationMs: 0, trace: null },
  ];
  const agg = computeGateAgg(rows);

  it("maps status → respond/ignore/error", () => {
    expect(agg.respond).toBe(1);
    expect(agg.ignore).toBe(2);
    expect(agg.error).toBe(1);
    expect(agg.total).toBe(4);
  });

  it("respondRate excludes errors; errorRate over all", () => {
    expect(agg.respondRate).toBeCloseTo(1 / 3, 5); // 1 respond of 3 decisions
    expect(agg.errorRate).toBeCloseTo(1 / 4, 5);
  });

  it("confidence + duration from decisions only", () => {
    expect(agg.avgConfidence).toBeCloseTo((0.9 + 0.7 + 0.5) / 3, 5);
    expect(agg.medianDurationMs).toBe(200); // 100,200,300 (error 0 excluded)
  });

  it("byDecisionSource buckets", () => {
    const bySource = Object.fromEntries(agg.byDecisionSource.map((s) => [s.source, s]));
    expect(bySource["llm"]).toMatchObject({ respond: 1, ignore: 1 });
    expect(bySource["rule-thread"]).toMatchObject({ respond: 0, ignore: 1 });
  });
});

describe("computeBehaviorAgg", () => {
  it("counts responded / ignored / wrong-silences", () => {
    const rows: BehaviorRow[] = [
      { userId: "u1", outcome: "responded", gateDecision: "respond", shouldHaveResponded: false },
      { userId: "u1", outcome: "ignored", gateDecision: "ignore", shouldHaveResponded: false },
      { userId: "u1", outcome: "responded", gateDecision: "ignore", shouldHaveResponded: true },
    ];
    const agg = computeBehaviorAgg(rows);
    expect(agg).toMatchObject({ total: 3, responded: 2, ignored: 1, shouldHaveResponded: 1 });
  });
});

describe("computePerUser", () => {
  const users = [
    { id: "u1", name: "Alice", email: "a@x.ai" },
    { id: "u2", name: "Bob", email: "b@x.ai" },
    { id: "u3", name: "Zero", email: "z@x.ai" }, // no activity → dropped
  ];
  const reply: ReplyFeedbackRow[] = [
    { userId: "u1", status: "accepted", deliveryAction: "reply", proposedAt: t("2026-01-01T00:00:00Z"), decidedAt: t("2026-01-01T00:00:05Z") },
    { userId: "u2", status: "declined", deliveryAction: "reply", proposedAt: t("2026-01-01T00:00:00Z"), decidedAt: t("2026-01-01T00:00:05Z") },
  ];
  const gate: GateEventRow[] = [
    { userId: "u1", status: "ok", durationMs: 50, trace: { decisionSource: "llm" } },
    { userId: "u1", status: "empty", durationMs: 60, trace: { decisionSource: "llm" } },
  ];
  const behavior: BehaviorRow[] = [
    { userId: "u2", outcome: "ignored", gateDecision: "ignore", shouldHaveResponded: false },
  ];

  const perUser = computePerUser(users, reply, gate, behavior);

  it("drops zero-activity users and attaches identity", () => {
    expect(perUser.map((u) => u.userId).sort()).toEqual(["u1", "u2"]);
    expect(perUser.find((u) => u.userId === "u1")?.name).toBe("Alice");
  });

  it("sorts by activity desc (u1 has 3 events, u2 has 2)", () => {
    expect(perUser[0]?.userId).toBe("u1");
  });

  it("rolls up per-user reply + gate + behavior", () => {
    const u1 = perUser.find((u) => u.userId === "u1")!;
    expect(u1.replies.accepted).toBe(1);
    expect(u1.gate).toMatchObject({ respond: 1, ignore: 1, error: 0 });
    const u2 = perUser.find((u) => u.userId === "u2")!;
    expect(u2.replies.declined).toBe(1);
    expect(u2.behavior.ignored).toBe(1);
  });
});
