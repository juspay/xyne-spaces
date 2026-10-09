import { describe, expect, it } from "vitest";
import { buildInterruptState, fallbackDecision, finalDecision, nudgeTask, type LoopFacts } from "./policy.js";
import { buildTriageState, isHit } from "./triage.js";
import { parsePushEnvelope } from "./sources.js";
import type { ParsedMessage } from "./gmail-message.js";

const now = new Date("2026-10-09T08:00:00.000Z");
const loop: LoopFacts = {
  kind: "awaiting_user",
  title: "Confirm hotel booking #4411",
  ask: "Reply to confirm",
  counterpart: "Taj reservations",
  deadlineAt: null,
  confidence: 0.8,
  nudgeCount: 0,
};

const parsed: ParsedMessage = {
  id: "m1",
  threadId: "t1",
  at: now,
  from: { key: "res@taj.example", name: "Taj reservations" },
  to: [{ key: "me@example.com", name: null }],
  cc: [],
  subject: "Booking #4411",
  snippet: "Please confirm your booking by Wednesday.",
  labels: ["INBOX", "IMPORTANT"],
  fromUser: false,
  important: true,
  noise: false,
  userRole: "to",
};

const thresholds = { hitImportance: 0.5, hitNeedsReply: 0.6, hitDeadline: 0.6 };

describe("triage", () => {
  it("describes the sender's history in the state", () => {
    const state = buildTriageState(parsed, { inboundCount: 4, userReplyCount: 3, avgReplyMins: 42, weight: 0.6 });
    expect(state).toContain("the user replied to 3 of 4 earlier messages, usually within 42 minutes");
    expect(state).toContain("Gmail marked important: yes");
  });

  it("counts a hit only for important messages that need a reply or have a deadline", () => {
    expect(isHit({ importance: 0.8, needsReply: 0.9, hasDeadline: 0.1, kind: "ask" }, parsed, thresholds)).toBe(true);
    expect(isHit({ importance: 0.3, needsReply: 0.9, hasDeadline: 0.1, kind: "ask" }, parsed, thresholds)).toBe(false);
    expect(isHit({ importance: 0.9, needsReply: 0.9, hasDeadline: 0.9, kind: "fyi" }, parsed, thresholds)).toBe(false);
  });

  it("falls back to Gmail's important label when Jev is unavailable", () => {
    expect(isHit(null, parsed, thresholds)).toBe(true);
    expect(isHit(null, { ...parsed, userRole: "cc" }, thresholds)).toBe(false);
  });
});

describe("interrupt policy", () => {
  it("texts for a close deadline or an important unanswered message, otherwise waits", () => {
    expect(fallbackDecision({ loop: { ...loop, deadlineAt: new Date("2026-10-09T12:00:00Z") }, importance: 0.2, now })).toBe("text");
    expect(fallbackDecision({ loop, importance: 0.8, now })).toBe("text");
    expect(fallbackDecision({ loop, importance: 0.4, now })).toBe("later");
  });

  it("ignores low-confidence loops and stops deferring forever", () => {
    expect(finalDecision({ proposed: "text", loop: { ...loop, confidence: 0.2 }, laterCount: 0, maxLater: 3 })).toBe("ignore");
    expect(finalDecision({ proposed: "later", loop, laterCount: 3, maxLater: 3 })).toBe("text");
    expect(finalDecision({ proposed: "later", loop: { ...loop, confidence: 0.5 }, laterCount: 3, maxLater: 3 })).toBe("ignore");
    expect(finalDecision({ proposed: "later", loop, laterCount: 1, maxLater: 3 })).toBe("later");
  });

  it("gives the judge the waiting time, budget and local hour", () => {
    const state = buildInterruptState({
      loop,
      thread: { subject: "Booking #4411", summary: null, importance: 0.82, lastInboundAt: new Date("2026-10-08T06:00:00Z") },
      contact: null,
      textsLast24h: 1,
      maxPerDay: 3,
      timezone: "Asia/Kolkata",
      now,
    });
    expect(state).toContain("Last message from them: 26 hours ago");
    expect(state).toContain("Texts sent to the user in the last 24 hours: 1 of 3 allowed");
    expect(state).toContain("User's local hour: 13:00");
  });

  it("tells the agent the check-in is automated and not to act", () => {
    const task = nudgeTask({ loop, thread: null, threadExternalId: "18c0", now });
    expect(task.startsWith("[Automated proactive check-in.")).toBe(true);
    expect(task).toContain("Do not send emails");
    expect(task).toContain("Gmail thread id: 18c0");
  });
});

describe("parsePushEnvelope", () => {
  it("decodes the Pub/Sub message data", () => {
    const data = Buffer.from(JSON.stringify({ emailAddress: "Me@Example.com", historyId: 9876 })).toString("base64");
    expect(parsePushEnvelope({ message: { data } })).toEqual({ emailAddress: "me@example.com", historyId: "9876" });
  });

  it("rejects malformed envelopes", () => {
    expect(parsePushEnvelope({})).toBeNull();
    expect(parsePushEnvelope({ message: { data: Buffer.from("nope").toString("base64") } })).toBeNull();
  });
});
