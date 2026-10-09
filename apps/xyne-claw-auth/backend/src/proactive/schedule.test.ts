import { describe, expect, it } from "vitest";
import { adjustWeight, deadlineNudgeAt, inQuietHours, nextAllowedAt, planLoop, updateReplyAverage } from "./schedule.js";

const now = new Date("2026-10-09T08:00:00.000Z");
const ctx = { now, lastInboundAt: new Date("2026-10-09T07:00:00.000Z"), lastUserReplyAt: null, replySlaHours: 24 };
const base = { title: "Confirm booking", ask: null, counterpart: "Taj", confidence: 0.9 };

describe("deadlineNudgeAt", () => {
  it("nudges two hours ahead of a far deadline", () => {
    expect(deadlineNudgeAt(new Date("2026-10-10T08:00:00Z"), now).toISOString()).toBe("2026-10-10T06:00:00.000Z");
  });

  it("nudges halfway when the deadline is close, and now when it has passed", () => {
    expect(deadlineNudgeAt(new Date("2026-10-09T09:00:00Z"), now).toISOString()).toBe("2026-10-09T08:30:00.000Z");
    expect(deadlineNudgeAt(new Date("2026-10-09T07:00:00Z"), now)).toBe(now);
  });
});

describe("planLoop", () => {
  it("schedules an unanswered message at the reply SLA", () => {
    const loop = planLoop({ ...base, kind: "awaiting_user", deadlineAt: null }, ctx);
    expect(loop.dueAt.toISOString()).toBe("2026-10-10T07:00:00.000Z");
    expect(loop.expiresAt.toISOString()).toBe("2026-10-23T08:00:00.000Z");
  });

  it("pulls an unanswered message earlier when its deadline comes first", () => {
    const loop = planLoop({ ...base, kind: "awaiting_user", deadlineAt: "2026-10-09T14:00:00Z" }, ctx);
    expect(loop.dueAt.toISOString()).toBe("2026-10-09T12:00:00.000Z");
  });

  it("turns a deadline loop without a date into a reply loop", () => {
    expect(planLoop({ ...base, kind: "deadline", deadlineAt: null }, ctx).kind).toBe("awaiting_user");
  });

  it("waits three days on the other side by default", () => {
    const loop = planLoop({ ...base, kind: "awaiting_them", deadlineAt: null }, ctx);
    expect(loop.dueAt.toISOString()).toBe("2026-10-12T08:00:00.000Z");
  });

  it("never schedules in the past", () => {
    const stale = { ...ctx, lastInboundAt: new Date("2026-10-01T00:00:00Z") };
    expect(planLoop({ ...base, kind: "awaiting_user", deadlineAt: null }, stale).dueAt).toEqual(now);
  });
});

describe("quiet hours", () => {
  const prefs = { timezone: "Asia/Kolkata", quietStartHour: 22, quietEndHour: 8 };

  it("detects an overnight window in the user's timezone", () => {
    expect(inQuietHours(new Date("2026-10-09T17:00:00Z"), prefs)).toBe(true);
    expect(inQuietHours(new Date("2026-10-09T08:00:00Z"), prefs)).toBe(false);
  });

  it("moves a quiet-time nudge to the end of the window", () => {
    expect(nextAllowedAt(new Date("2026-10-09T17:00:00Z"), prefs).toISOString()).toBe("2026-10-10T02:30:00.000Z");
    expect(nextAllowedAt(now, prefs)).toBe(now);
  });

  it("treats equal start and end as no quiet hours", () => {
    expect(inQuietHours(now, { ...prefs, quietStartHour: 9, quietEndHour: 9 })).toBe(false);
  });
});

describe("learning", () => {
  it("smooths reply latency", () => {
    expect(updateReplyAverage(null, 30)).toBe(30);
    expect(updateReplyAverage(30, 130)).toBeCloseTo(60);
  });

  it("moves contact weight within bounds", () => {
    expect(adjustWeight(0.95, "acted")).toBe(1);
    expect(adjustWeight(0.5, "dismissed")).toBeCloseTo(0.35);
    expect(adjustWeight(0.02, "ignored")).toBe(0);
  });
});
