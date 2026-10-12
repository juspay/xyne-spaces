import { afterEach, describe, expect, it, vi } from "vitest";
import { coalesceQueuedMessages, isChatBufferingEnabled, isCoalescible, leadingBatchSize } from "./message-buffer.js";
import type { QueuedMessage } from "./message-queue.js";

const base = (over: Partial<QueuedMessage> = {}): QueuedMessage => ({
  eventId: "e1",
  conversationId: "conv-1",
  channelId: "ch-1",
  userId: "u1",
  agentSlug: "xyne",
  task: "hi",
  eventType: "APP_MENTIONED",
  ts: 1,
  ...over,
});

afterEach(() => vi.unstubAllEnvs());

describe("isChatBufferingEnabled", () => {
  it("is off by default and on for 1/true", () => {
    vi.stubEnv("CLAW_MSG_BUFFER_ENABLED", "");
    expect(isChatBufferingEnabled()).toBe(false);
    vi.stubEnv("CLAW_MSG_BUFFER_ENABLED", "1");
    expect(isChatBufferingEnabled()).toBe(true);
    vi.stubEnv("CLAW_MSG_BUFFER_ENABLED", "true");
    expect(isChatBufferingEnabled()).toBe(true);
  });
});

describe("isCoalescible", () => {
  it("accepts thin conversation-mode entries", () => {
    expect(isCoalescible(base())).toBe(true);
  });
  it.each<[string, Partial<QueuedMessage>]>([
    ["replay blobs (twin / channel)", { dispatchPayload: {}, sessionContext: {} }],
    ["lock-contention retries", { alreadyPersisted: true }],
    ["experiments", { experiment: { id: "x", epoch: 1, deadlineAt: "t" } }],
    ["recordings", { recordingRefs: [{ attachmentId: "a", fileName: "f", mimeType: "m", fileSize: 1 }] }],
    ["twin scope", { twinUserScopeId: "u9" }],
    ["explicit /queue", { queueReason: "explicit_queue" }],
    ["approval mode", { responseMode: "approval" }],
    ["empty task", { task: "  " }],
  ])("rejects %s", (_label, over) => {
    expect(isCoalescible(base(over))).toBe(false);
  });
});

describe("leadingBatchSize", () => {
  it("is 0 for empty and 1 for a non-coalescible head", () => {
    expect(leadingBatchSize([])).toBe(0);
    expect(leadingBatchSize([base({ alreadyPersisted: true }), base()])).toBe(1);
  });
  it("groups consecutive same-sender messages and stops at a different sender", () => {
    const q = [base({ eventId: "a" }), base({ eventId: "b" }), base({ eventId: "c", userId: "u2" }), base({ eventId: "d" })];
    expect(leadingBatchSize(q)).toBe(2);
  });
  it("stops at an explicit /queue entry to keep its strict ordering", () => {
    expect(leadingBatchSize([base(), base({ queueReason: "explicit_queue" }), base()])).toBe(1);
  });
});

describe("coalesceQueuedMessages", () => {
  it("returns a single message unchanged", () => {
    const m = base();
    expect(coalesceQueuedMessages([m])).toBe(m);
  });
  it("merges tasks in order, keeps identity, and takes the newest context", () => {
    const merged = coalesceQueuedMessages([
      base({ eventId: "a", task: "check prod", context: "old", ts: 1 }),
      base({ eventId: "b", task: "and staging?", ts: 2, queueReason: "interrupt_followup" }),
      base({ eventId: "c", task: "actually only staging", context: "new", ts: 3 }),
    ]);
    expect(merged.userId).toBe("u1");
    expect(merged.eventId).toBe("buffer:a,b,c");
    expect(merged.context).toBe("new");
    expect(merged.ts).toBe(3);
    expect(merged.queueReason).toBe("interrupt_followup");
    expect(merged.task).toContain("3 more messages");
    expect(merged.task.indexOf("[1/3] check prod")).toBeLessThan(merged.task.indexOf("[3/3] actually only staging"));
  });
  it("throws on an empty batch", () => {
    expect(() => coalesceQueuedMessages([])).toThrow();
  });
});
