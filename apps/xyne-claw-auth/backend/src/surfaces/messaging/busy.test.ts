import { beforeEach, describe, expect, it, vi } from "vitest";

const buildChannelRun = vi.fn(async (_input: Record<string, unknown>) => ({
  body: { task: "hi", channelDelivery: { channel: "whatsapp-cloud" } },
  sessionContext: { conversationId: "conv-1", channelDelivery: { channel: "whatsapp-cloud" } },
}));
const postChannelRun = vi.fn(async (_run: unknown) => "sess-new");
const claimOrQueue = vi.fn(
  async (_input: Record<string, unknown>) =>
    ({ kind: "run", slotToken: "tok-1" }) as { kind: "run"; slotToken: string } | { kind: "queued"; accepted: boolean; interrupted: boolean; notice: string },
);
const attachSlotSession = vi.fn(async (..._args: unknown[]) => undefined);
const releaseSlot = vi.fn(async (..._args: unknown[]) => undefined);
const drainNextQueued = vi.fn(async (..._args: unknown[]) => undefined);
const enqueueOutbound = vi.fn(async (..._args: unknown[]) => undefined);
const typingFinished = vi.fn(async (..._args: unknown[]) => false);

vi.mock("../../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("../../lib/conversation-gate.js", () => ({ claimOrQueue }));
vi.mock("../../lib/message-queue.js", () => ({ attachSlotSession, releaseSlot }));
vi.mock("./dispatch.js", () => ({ buildChannelRun, postChannelRun }));
vi.mock("./delivery.js", () => ({ enqueueOutbound, typingFinished }));
vi.mock("../../routes/webhook.js", () => ({ drainNextQueued }));

const { dispatchOrQueueChannelRun, notifyChannelRunLocked, LOCKED_NOTICE } = await import("./busy.js");

const target = { channel: "whatsapp-cloud", connectedSurfaceId: "acc", accountKey: "k", chatId: "919", senderId: "919", isGroup: false };
const input = {
  agent: { id: "a1", slug: "xyne", orgId: "org-1", config: null },
  userId: "user-1",
  task: "hi",
  conversationId: "conv-1",
  eventType: "DIRECT_MESSAGE",
  idempotencyKey: "whatsapp-cloud:acc:m1",
  target,
} as never;

beforeEach(() => {
  for (const m of [buildChannelRun, postChannelRun, claimOrQueue, attachSlotSession, releaseSlot, drainNextQueued, enqueueOutbound, typingFinished]) m.mockClear();
});

describe("dispatchOrQueueChannelRun", () => {
  it("dispatches and records the session on the slot when the chat is free", async () => {
    await expect(dispatchOrQueueChannelRun(input)).resolves.toEqual({ kind: "dispatched", sessionId: "sess-new" });
    expect(attachSlotSession).toHaveBeenCalledWith("conv-1", "xyne", "sess-new");
  });

  it("queues the full request so the replay keeps the chat's delivery", async () => {
    claimOrQueue.mockResolvedValueOnce({ kind: "queued", accepted: true, interrupted: true, notice: "wrap up" });
    await expect(dispatchOrQueueChannelRun(input)).resolves.toEqual({ kind: "queued", accepted: true, notice: "wrap up" });
    expect(postChannelRun).not.toHaveBeenCalled();
    expect(claimOrQueue.mock.calls[0]?.[0]).toMatchObject({
      place: "chat",
      message: {
        eventId: "whatsapp-cloud:acc:m1",
        conversationId: "conv-1",
        agentSlug: "xyne",
        dispatchPayload: { channelDelivery: { channel: "whatsapp-cloud" } },
        sessionContext: { channelDelivery: { channel: "whatsapp-cloud" } },
      },
    });
  });

  it("hands the slot on when the dispatch itself fails", async () => {
    postChannelRun.mockRejectedValueOnce(new Error("HTTP 500"));
    await expect(dispatchOrQueueChannelRun(input)).rejects.toThrow("HTTP 500");
    expect(drainNextQueued).toHaveBeenCalledWith("conv-1", "xyne", "tok-1");
  });
});

describe("notifyChannelRunLocked", () => {
  it("answers the message instead of dropping it, leaving typing on while another run works", async () => {
    await notifyChannelRunLocked(target as never);
    expect(enqueueOutbound).toHaveBeenCalledWith("acc", expect.objectContaining({ kind: "result", chatId: "919", result: LOCKED_NOTICE, stopTyping: false }));
  });
});
