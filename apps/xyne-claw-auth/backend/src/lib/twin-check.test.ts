import { describe, expect, it } from "vitest";
import { formatTwinCheck, reasoningWithCheck } from "./twin-check.js";
import { computeWeeklyTrend } from "./twin-reply-metrics.js";

describe("twin self-check line", () => {
  it("summarises the scores in plain words and flags low confidence", () => {
    expect(formatTwinCheck({ answersAsk: 0.91, grounded: 0.72, overall: 0.72, source: "jev", ms: 400 })).toBe(
      "Self-check: answers the ask 91% · grounded 72%",
    );
    expect(formatTwinCheck({ actionFits: 0.2, overall: 0.2, source: "jev", ms: 1 })).toBe(
      "Self-check: action fits 20% — low confidence, review carefully",
    );
    expect(formatTwinCheck(undefined)).toBeNull();
  });

  it("appends to reasoning, or stands alone", () => {
    const check = { answersAsk: 0.8, overall: 0.8, source: "jev" as const, ms: 1 };
    expect(reasoningWithCheck("Because [clf-a#1].", check)).toBe("Because [clf-a#1].\n\nSelf-check: answers the ask 80%");
    expect(reasoningWithCheck(undefined, check)).toBe("Self-check: answers the ask 80%");
    expect(reasoningWithCheck("r", undefined)).toBe("r");
  });
});

describe("weekly approval trend", () => {
  it("buckets by Monday (UTC) and computes approval and sent-untouched rates", () => {
    const row = (status: string, iso: string) => ({ userId: "u", status, deliveryAction: "reply", proposedAt: new Date(iso), decidedAt: null });
    const weeks = computeWeeklyTrend([
      row("accepted", "2026-09-21T10:00:00Z"), // Mon
      row("declined", "2026-09-27T23:00:00Z"), // Sun, same week
      row("accepted_edited", "2026-09-28T01:00:00Z"), // next Mon
      row("accepted", "2026-09-29T01:00:00Z"),
      row("ignored", "2026-09-29T02:00:00Z"),
    ]);
    expect(weeks.map((w) => w.weekStart)).toEqual(["2026-09-21", "2026-09-28"]);
    expect(weeks[0]).toMatchObject({ proposed: 2, accepted: 1, declined: 1, approvalRate: 0.5, cleanApprovalRate: 0.5 });
    expect(weeks[1]).toMatchObject({ proposed: 3, acceptedEdited: 1, accepted: 1, ignored: 1, approvalRate: 1, cleanApprovalRate: 0.5 });
  });
});
