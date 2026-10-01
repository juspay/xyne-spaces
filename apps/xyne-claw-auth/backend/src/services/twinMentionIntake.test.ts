import { beforeEach, describe, expect, it, vi } from "vitest";

// Characterization tests for the Digital Twin mention intake the webhook runs
// for USER_MENTIONED: which mentioned users are eligible for a twin run, and
// whether the learned respond/ignore gate lets the dispatch proceed. They pin
// the skip log texts, the exact shouldTwinRespond / recordTwinSilence args and
// the fail-closed fall-through.

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  getSpacesAuthForUser: vi.fn(),
  shouldTwinRespond: vi.fn(),
  recordTwinSilence: vi.fn(),
  FAIL_CLOSED: {
    respond: false,
    confidence: 0,
    reason: "gate unavailable — stay silent (fail-closed)",
    source: "fail-closed",
  },
}));

vi.mock("../repositories/index.js", () => ({ userRepository: { findById: mocks.findById } }));
vi.mock("../lib/spaces-db.js", () => ({ getSpacesAuthForUser: mocks.getSpacesAuthForUser }));
vi.mock("./twinRespondGate.js", () => ({
  shouldTwinRespond: mocks.shouldTwinRespond,
  recordTwinSilence: mocks.recordTwinSilence,
  FAIL_CLOSED: mocks.FAIL_CLOSED,
}));

import type { Logger } from "../logger.js";
import { findEligibleTwins, twinGateAllowsDispatch, type TwinMentionPayload } from "./twinMentionIntake.js";

const info = vi.fn();
const log = { info } as unknown as Logger;

const PAYLOAD: TwinMentionPayload = {
  conversationId: "conv-1",
  messageId: "msg-1",
  content: "<p>@twin hello</p>",
  cleanContent: "@twin hello",
  createdAt: "2026-01-02T03:04:05.000Z",
  userId: "sender-1",
  channelId: "chan-1",
  senderName: "Sam",
  channelName: "general",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findById.mockResolvedValue({ digitalTwinEnabled: true, digitalTwinRespondPolicy: "always" });
  mocks.getSpacesAuthForUser.mockResolvedValue({ workspaceId: "ws-1" });
  mocks.recordTwinSilence.mockResolvedValue(undefined);
});

describe("findEligibleTwins", () => {
  it("returns an eligible user with its workspace and respond policy", async () => {
    const out = await findEligibleTwins(["u1"], log);

    expect(out).toEqual([{ userId: "u1", workspaceId: "ws-1", respondPolicy: "always" }]);
    expect(mocks.findById).toHaveBeenCalledWith("u1");
    expect(mocks.getSpacesAuthForUser).toHaveBeenCalledWith("u1", "webhook");
    expect(info).not.toHaveBeenCalled();
  });

  it("defaults the respond policy to learned when the row carries none", async () => {
    mocks.findById.mockResolvedValue({ digitalTwinEnabled: true });

    const out = await findEligibleTwins(["u1"], log);

    expect(out).toEqual([{ userId: "u1", workspaceId: "ws-1", respondPolicy: "learned" }]);
  });

  it("skips an unregistered user (lookup null or rejected) and logs why", async () => {
    mocks.findById.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("db down"));

    const out = await findEligibleTwins(["u1", "u2"], log);

    expect(out).toEqual([]);
    expect(info).toHaveBeenCalledWith("Twin: skipping u1 — not registered in claw-auth");
    expect(info).toHaveBeenCalledWith("Twin: skipping u2 — not registered in claw-auth");
    expect(mocks.getSpacesAuthForUser).not.toHaveBeenCalled();
  });

  it("skips a user whose Digital Twin is disabled without resolving their workspace", async () => {
    mocks.findById.mockResolvedValue({ digitalTwinEnabled: false });

    const out = await findEligibleTwins(["u1"], log);

    expect(out).toEqual([]);
    expect(info).toHaveBeenCalledWith("Twin: skipping u1 — Digital Twin disabled");
    expect(mocks.getSpacesAuthForUser).not.toHaveBeenCalled();
  });

  it("skips a user with no resolvable workspaceId (null auth, empty id or rejected lookup)", async () => {
    mocks.getSpacesAuthForUser
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ workspaceId: "" })
      .mockRejectedValueOnce(new Error("spaces down"));

    const out = await findEligibleTwins(["u1", "u2", "u3"], log);

    expect(out).toEqual([]);
    for (const uid of ["u1", "u2", "u3"]) {
      expect(info).toHaveBeenCalledWith(`Twin: skipping ${uid} — no resolvable workspaceId (no active Spaces session)`);
    }
  });

  it("logs the nothing-to-dispatch line when nobody is eligible", async () => {
    mocks.findById.mockResolvedValue(null);

    await findEligibleTwins(["u1", "u2"], log);

    expect(info).toHaveBeenLastCalledWith("Twin: no eligible mentioned users among [u1, u2] — nothing to dispatch");
  });

  it("does not log the nothing-to-dispatch line when at least one user is eligible", async () => {
    mocks.findById.mockResolvedValueOnce(null).mockResolvedValueOnce({ digitalTwinEnabled: true });

    const out = await findEligibleTwins(["u1", "u2"], log);

    expect(out.map((t) => t.userId)).toEqual(["u2"]);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).not.toHaveBeenCalledWith(expect.stringContaining("no eligible mentioned users"));
  });

  it("dedupes repeated ids: one lookup, and the nothing-to-dispatch line lists the id once", async () => {
    mocks.findById.mockResolvedValue(null);

    await findEligibleTwins(["u1", "u1", "u2", "u1"], log);

    expect(mocks.findById).toHaveBeenCalledTimes(2);
    expect(info).toHaveBeenLastCalledWith("Twin: no eligible mentioned users among [u1, u2] — nothing to dispatch");
  });

  it("keeps first-mention order among eligible users", async () => {
    const out = await findEligibleTwins(["b", "a", "b", "c"], log);

    expect(out.map((t) => t.userId)).toEqual(["b", "a", "c"]);
  });
});

describe("twinGateAllowsDispatch", () => {
  it("returns true and logs proceeding when the gate says respond", async () => {
    mocks.shouldTwinRespond.mockResolvedValue({ respond: true, confidence: 0.876, reason: "asked a question", source: "llm" });

    await expect(twinGateAllowsDispatch("u1", PAYLOAD, log)).resolves.toBe(true);

    expect(info).toHaveBeenCalledWith("Twin: proceeding for u1 — gate=llm respond=true conf=0.88");
    expect(mocks.recordTwinSilence).not.toHaveBeenCalled();
  });

  it("passes the exact gate args for a fully populated payload", async () => {
    mocks.shouldTwinRespond.mockResolvedValue({ respond: true, confidence: 1, reason: "", source: "llm" });

    await twinGateAllowsDispatch("u1", PAYLOAD, log);

    expect(mocks.shouldTwinRespond).toHaveBeenCalledWith("u1", {
      incoming: "<p>@twin hello</p>",
      channelName: "general",
      channelId: "chan-1",
      conversationId: "conv-1",
      senderName: "Sam",
      senderId: "sender-1",
      sourceMessageId: "msg-1",
    });
  });

  it("omits empty-string optional fields from the gate args", async () => {
    mocks.shouldTwinRespond.mockResolvedValue({ respond: true, confidence: 1, reason: "", source: "llm" });
    const { senderName: _senderName, ...noSender } = PAYLOAD;

    await twinGateAllowsDispatch("u1", { ...noSender, channelName: "", channelId: "", userId: "" }, log);

    expect(mocks.shouldTwinRespond).toHaveBeenCalledWith("u1", {
      incoming: "<p>@twin hello</p>",
      conversationId: "conv-1",
      sourceMessageId: "msg-1",
    });
  });

  it("returns false, logs the ignore reason and records the silence when the gate says ignore", async () => {
    const decision = { respond: false, confidence: 0.9, reason: "FYI broadcast", source: "llm" };
    mocks.shouldTwinRespond.mockResolvedValue(decision);

    await expect(twinGateAllowsDispatch("u1", PAYLOAD, log)).resolves.toBe(false);

    expect(info).toHaveBeenCalledWith("Twin: staying silent for u1 — gate ignore (conf 0.90): FYI broadcast");
    expect(mocks.recordTwinSilence).toHaveBeenCalledWith(
      "u1",
      {
        sourceMessageId: "msg-1",
        channelId: "chan-1",
        channelName: "general",
        senderId: "sender-1",
        occurredAt: "2026-01-02T03:04:05.000Z",
        triggerPreview: "@twin hello",
      },
      decision,
    );
  });

  it("fails closed when the gate rejects: returns false and records the silence with FAIL_CLOSED", async () => {
    mocks.shouldTwinRespond.mockRejectedValue(new Error("gate timeout"));

    await expect(twinGateAllowsDispatch("u1", PAYLOAD, log)).resolves.toBe(false);

    expect(info).toHaveBeenCalledWith("Twin: staying silent for u1 — gate unavailable (fail-closed)");
    expect(mocks.recordTwinSilence).toHaveBeenCalledTimes(1);
    expect(mocks.recordTwinSilence.mock.calls[0]![2]).toBe(mocks.FAIL_CLOSED);
  });

  it("fails closed when the gate resolves null", async () => {
    mocks.shouldTwinRespond.mockResolvedValue(null);

    await expect(twinGateAllowsDispatch("u1", PAYLOAD, log)).resolves.toBe(false);

    expect(mocks.recordTwinSilence.mock.calls[0]![2]).toBe(mocks.FAIL_CLOSED);
  });

  it("falls back to raw content for the trigger preview and drops empty optionals from the silence record", async () => {
    mocks.shouldTwinRespond.mockResolvedValue(null);

    await twinGateAllowsDispatch("u1", { ...PAYLOAD, cleanContent: "", channelName: "", userId: "" }, log);

    expect(mocks.recordTwinSilence.mock.calls[0]![1]).toEqual({
      sourceMessageId: "msg-1",
      channelId: "chan-1",
      occurredAt: "2026-01-02T03:04:05.000Z",
      triggerPreview: "<p>@twin hello</p>",
    });
  });

  it("still returns false when recording the silence rejects", async () => {
    mocks.shouldTwinRespond.mockResolvedValue(null);
    mocks.recordTwinSilence.mockRejectedValue(new Error("db down"));

    await expect(twinGateAllowsDispatch("u1", PAYLOAD, log)).resolves.toBe(false);
  });

  it("awaits the silence record before returning", async () => {
    mocks.shouldTwinRespond.mockResolvedValue(null);
    let release: () => void = () => {};
    mocks.recordTwinSilence.mockReturnValue(new Promise<void>((resolve) => { release = resolve; }));

    let settled = false;
    const pending = twinGateAllowsDispatch("u1", PAYLOAD, log).then((allowed) => {
      settled = true;
      return allowed;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);

    release();
    await expect(pending).resolves.toBe(false);
  });
});
