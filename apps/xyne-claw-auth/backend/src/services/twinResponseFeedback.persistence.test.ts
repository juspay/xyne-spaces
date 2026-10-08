import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Pins the two prisma writers of twinResponseFeedback (args + logs), with a frozen
// clock, so the service can be restructured without a behavior change.
const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  create: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("../db.js", () => ({
  prisma: { twinResponseFeedback: { upsert: mocks.upsert, create: mocks.create } },
}));
vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: mocks.info, warn: mocks.warn, error: vi.fn(), debug: vi.fn() }),
}));

import { recordTwinApprovalOutcome, recordTwinApprovalPending } from "./twinResponseFeedback.js";

type PendingRow = Parameters<typeof recordTwinApprovalPending>[0];

const NOW = new Date("2026-03-03T03:03:03.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mocks.upsert.mockReset().mockResolvedValue({});
  mocks.create.mockReset().mockResolvedValue({});
  mocks.info.mockReset();
  mocks.warn.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("recordTwinApprovalPending", () => {
  it("writes nothing without a userId or without a sourceMessageId", async () => {
    await recordTwinApprovalPending({ userId: "", conversationId: "c", sourceMessageId: "s", delivery: { action: "reply" } } as PendingRow);
    await recordTwinApprovalPending({ userId: "u", conversationId: "c", delivery: { action: "reply" } } as PendingRow);
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("upserts a create-only pending row, clipping the task to 2000 and the draft to 4000 chars", async () => {
    await recordTwinApprovalPending({
      userId: "u",
      conversationId: "c",
      channelId: "ch",
      channelName: "n",
      sourceMessageId: "s1",
      incomingTask: "x".repeat(2100),
      delivery: { action: "react_and_reply", emoji: "👍", destination: { kind: "thread" }, message: "m".repeat(4100) },
    } as PendingRow);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.upsert.mock.calls[0]![0]).toStrictEqual({
      where: { userId_sourceMessageId: { userId: "u", sourceMessageId: "s1" } },
      update: {},
      create: {
        userId: "u",
        conversationId: "c",
        channelId: "ch",
        channelName: "n",
        sourceMessageId: "s1",
        incomingTask: "x".repeat(2000),
        deliveryAction: "react_and_reply",
        deliveryEmoji: "👍",
        destinationKind: "thread",
        draftMessage: "m".repeat(4000),
        status: "pending",
      },
    });
    expect(mocks.info).not.toHaveBeenCalled();
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("stores null for an empty task/message and defaults the optional fields", async () => {
    await recordTwinApprovalPending({
      userId: "u",
      conversationId: "c",
      sourceMessageId: "s2",
      incomingTask: "",
      delivery: { action: "react", message: "" },
    } as PendingRow);
    expect(mocks.upsert.mock.calls[0]![0]).toStrictEqual({
      where: { userId_sourceMessageId: { userId: "u", sourceMessageId: "s2" } },
      update: {},
      create: {
        userId: "u",
        conversationId: "c",
        channelId: null,
        channelName: null,
        sourceMessageId: "s2",
        incomingTask: null,
        deliveryAction: "react",
        deliveryEmoji: null,
        destinationKind: "origin_thread",
        draftMessage: null,
        status: "pending",
      },
    });
  });

  it("swallows a prisma failure into a warn log", async () => {
    mocks.upsert.mockRejectedValue(new Error("boom upsert"));
    await recordTwinApprovalPending({ userId: "u", conversationId: "c", sourceMessageId: "s3", delivery: { action: "reply" } } as PendingRow);
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(mocks.warn).toHaveBeenCalledWith("[twin-feedback] pending write failed", {
      userId: "u",
      sourceMessageId: "s3",
      err: "boom upsert",
    });
  });

  it("a non-string delivery message throws inside the try: no upsert, one warn", async () => {
    await recordTwinApprovalPending({
      userId: "u",
      conversationId: "c",
      sourceMessageId: "s4",
      delivery: { action: "react", emoji: "x", message: 123 },
    } as unknown as PendingRow);
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(mocks.warn).toHaveBeenCalledWith("[twin-feedback] pending write failed", {
      userId: "u",
      sourceMessageId: "s4",
      err: "row.delivery.message.slice is not a function",
    });
  });
});

describe("recordTwinApprovalOutcome", () => {
  const full = {
    mentionedUserId: "u1",
    sourceMessageId: "sm",
    targetConversationId: "tc",
    targetChannelId: "tch",
    channelName: "eng",
    incomingTask: "t".repeat(2500),
    deliveryAction: "react_and_reply",
    deliveryEmoji: "x",
    destinationKind: "origin_thread",
    messageContent: "d".repeat(4500),
  };

  it("upserts with a full create payload; the update carries only the decision", async () => {
    await recordTwinApprovalOutcome(full, "accepted_edited", "f".repeat(4200));
    const decided = { status: "accepted_edited", decidedAt: NOW, finalMessage: "f".repeat(4000) };
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.upsert.mock.calls[0]![0]).toStrictEqual({
      where: { userId_sourceMessageId: { userId: "u1", sourceMessageId: "sm" } },
      update: decided,
      create: {
        userId: "u1",
        conversationId: "tc",
        channelId: "tch",
        channelName: "eng",
        sourceMessageId: "sm",
        incomingTask: "t".repeat(2000),
        deliveryAction: "react_and_reply",
        deliveryEmoji: "x",
        destinationKind: "origin_thread",
        draftMessage: "d".repeat(4000),
        ...decided,
      },
    });
    expect(mocks.info).toHaveBeenCalledTimes(1);
    expect(mocks.info).toHaveBeenCalledWith("[twin-feedback] recorded outcome", {
      userId: "u1",
      sourceMessageId: "sm",
      status: "accepted_edited",
    });
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("omits finalMessage from the decision when none is given", async () => {
    await recordTwinApprovalOutcome(full, "declined");
    const decided = { status: "declined", decidedAt: NOW };
    const args = mocks.upsert.mock.calls[0]![0];
    expect(args.update).toStrictEqual(decided);
    expect(args.create).toMatchObject(decided);
    expect(args.create).not.toHaveProperty("finalMessage");
  });

  it("without a sourceMessageId creates a slim row (no channel/task/emoji/destination)", async () => {
    await recordTwinApprovalOutcome({ ...full, sourceMessageId: undefined }, "accepted_edited", "f".repeat(4200));
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0]![0]).toStrictEqual({
      data: {
        userId: "u1",
        conversationId: "tc",
        deliveryAction: "react_and_reply",
        draftMessage: "d".repeat(4000),
        status: "accepted_edited",
        decidedAt: NOW,
        finalMessage: "f".repeat(4000),
      },
    });
    expect(mocks.info).toHaveBeenCalledWith("[twin-feedback] recorded outcome", {
      userId: "u1",
      sourceMessageId: "(none)",
      status: "accepted_edited",
    });
  });

  it("an empty-string sourceMessageId is treated as missing, and a missing deliveryAction defaults to reply", async () => {
    await recordTwinApprovalOutcome({ ...full, sourceMessageId: "", deliveryAction: undefined }, "declined");
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.create.mock.calls[0]![0]).toStrictEqual({
      data: {
        userId: "u1",
        conversationId: "tc",
        deliveryAction: "reply",
        draftMessage: "d".repeat(4000),
        status: "declined",
        decidedAt: NOW,
      },
    });
  });

  it("keeps an empty incomingTask as '' but nulls a non-string messageContent", async () => {
    await recordTwinApprovalOutcome({ ...full, incomingTask: "", messageContent: 5 }, "declined");
    const args = mocks.upsert.mock.calls[0]![0];
    expect(args.create.incomingTask).toBe("");
    expect(args.create.draftMessage).toBeNull();
  });

  it("keeps an empty messageContent as ''", async () => {
    await recordTwinApprovalOutcome({ ...full, messageContent: "" }, "declined");
    expect(mocks.upsert.mock.calls[0]![0].create.draftMessage).toBe("");
  });

  it("defaults a minimal payload (only mentionedUserId)", async () => {
    await recordTwinApprovalOutcome({ mentionedUserId: "u2" }, "accepted");
    expect(mocks.create.mock.calls[0]![0]).toStrictEqual({
      data: {
        userId: "u2",
        conversationId: "",
        deliveryAction: "reply",
        draftMessage: null,
        status: "accepted",
        decidedAt: NOW,
      },
    });
  });

  it("upsert create defaults the optional channel/emoji/destination fields to null", async () => {
    await recordTwinApprovalOutcome({ mentionedUserId: "u3", sourceMessageId: "sm3" }, "accepted");
    expect(mocks.upsert.mock.calls[0]![0].create).toStrictEqual({
      userId: "u3",
      conversationId: "",
      channelId: null,
      channelName: null,
      sourceMessageId: "sm3",
      incomingTask: null,
      deliveryAction: "reply",
      deliveryEmoji: null,
      destinationKind: null,
      draftMessage: null,
      status: "accepted",
      decidedAt: NOW,
    });
  });

  it("does nothing when mentionedUserId is missing, empty or not a string", async () => {
    await recordTwinApprovalOutcome({ ...full, mentionedUserId: undefined }, "accepted");
    await recordTwinApprovalOutcome({ ...full, mentionedUserId: "" }, "accepted");
    await recordTwinApprovalOutcome({ ...full, mentionedUserId: 7 }, "accepted");
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("swallows a prisma failure (upsert and create paths) into a warn log", async () => {
    mocks.upsert.mockRejectedValue(new Error("boom upsert"));
    mocks.create.mockRejectedValue(new Error("boom create"));
    await recordTwinApprovalOutcome(full, "declined");
    await recordTwinApprovalOutcome({ ...full, sourceMessageId: undefined }, "accepted");
    expect(mocks.info).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledTimes(2);
    expect(mocks.warn).toHaveBeenNthCalledWith(1, "[twin-feedback] outcome write failed", {
      userId: "u1",
      sourceMessageId: "sm",
      status: "declined",
      err: "boom upsert",
    });
    expect(mocks.warn).toHaveBeenNthCalledWith(2, "[twin-feedback] outcome write failed", {
      userId: "u1",
      sourceMessageId: "(none)",
      status: "accepted",
      err: "boom create",
    });
  });

  it("a non-string finalMessage rejects before prisma is touched", async () => {
    await expect(recordTwinApprovalOutcome(full, "accepted_edited", 5 as unknown as string)).rejects.toThrow(
      "finalMessage.slice is not a function",
    );
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
    expect(mocks.warn).not.toHaveBeenCalled();
  });
});
