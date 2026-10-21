import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tryAcquireSlot = vi.fn(async (..._args: unknown[]) => "tok-1" as string | null);
const getSlotOwner = vi.fn(async (..._args: unknown[]) => ({ userId: "u1", sessionId: "sess-old" }) as { userId?: string; sessionId?: string } | null);
const enqueueMessage = vi.fn(async (_msg: Record<string, unknown>) => ({ enqueued: true, position: 1, deduped: false, full: false }));
const fetchMock = vi.fn(async (..._args: unknown[]) => ({ ok: true, status: 200, text: async () => "" }));

vi.mock("../config.js", () => ({ CONFIG: { internalUrl: "http://claw", xyneClawS2sKey: "" } }));
vi.mock("../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("./message-queue.js", () => ({ QUEUE_CAP: 10, enqueueMessage, getSlotOwner, tryAcquireSlot }));

const { claimOrQueue, queuedNotice } = await import("./conversation-gate.js");

const message = {
  eventId: "evt-1",
  conversationId: "conv-1",
  channelId: "ch-1",
  userId: "u1",
  agentSlug: "xyne",
  task: "and staging?",
  eventType: "DIRECT_MESSAGE",
};

beforeEach(() => {
  for (const m of [tryAcquireSlot, getSlotOwner, enqueueMessage, fetchMock]) m.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("claimOrQueue", () => {
  it("claims a free conversation without queueing", async () => {
    await expect(claimOrQueue({ message })).resolves.toEqual({ kind: "run", slotToken: "tok-1" });
    expect(tryAcquireSlot).toHaveBeenCalledWith("conv-1", "xyne", undefined, "u1");
    expect(enqueueMessage).not.toHaveBeenCalled();
  });

  it("queues behind a running reply and asks it to wrap up", async () => {
    tryAcquireSlot.mockResolvedValueOnce(null);
    const gate = await claimOrQueue({ message });
    expect(enqueueMessage.mock.calls[0]?.[0]).toMatchObject({ ...message, queueReason: "interrupt_followup", interruptMode: "interrupt_with_reply" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://claw/claw/api/v1/internal/run/sess-old/interrupt-with-reply");
    expect(gate).toMatchObject({ kind: "queued", accepted: true, interrupted: true });
    expect((gate as { notice: string }).notice).toContain("Finishing the current reply first");
  });

  it("only queues for an explicit /queue or when the running reply has no session yet", async () => {
    tryAcquireSlot.mockResolvedValue(null);
    const explicit = await claimOrQueue({ message, explicitQueueOnly: true });
    getSlotOwner.mockResolvedValueOnce({ userId: "u1" });
    const noSession = await claimOrQueue({ message });
    tryAcquireSlot.mockResolvedValue("tok-1");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(enqueueMessage.mock.calls.map((c) => c[0]["queueReason"])).toEqual(["explicit_queue", "busy"]);
    expect((explicit as { notice: string }).notice).toContain("Queued behind the current run");
    expect((noSession as { notice: string }).notice).toContain("queued at position 1");
  });

  it("does not interrupt when the message could not be queued", async () => {
    tryAcquireSlot.mockResolvedValueOnce(null);
    enqueueMessage.mockResolvedValueOnce({ enqueued: false, position: 0, deduped: false, full: true });
    const gate = await claimOrQueue({ message, place: "chat" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(gate).toMatchObject({ kind: "queued", accepted: false, interrupted: false });
    expect((gate as { notice: string }).notice).toContain("this chat's queue is full at 10");
  });
});

describe("queuedNotice", () => {
  it("says a duplicate is already queued", () => {
    expect(queuedNotice({ enqueued: false, position: 0, deduped: true, full: false }, false, false, "thread")).toContain("Already queued");
  });
});
