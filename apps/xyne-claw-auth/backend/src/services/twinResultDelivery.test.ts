import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  findBySessionId: vi.fn(),
  finalize: vi.fn(),
  chatCreate: vi.fn(),
  handleRunCompletion: vi.fn(),
  deleteSession: vi.fn(),
  spacesAppFetch: vi.fn(),
  spacesAppFetchMultipart: vi.fn(),
  recordPending: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("../db.js", () => ({ prisma: { user: { findUnique: mocks.userFindUnique } } }));
vi.mock("../repositories/index.js", () => ({
  agentRunRepository: { findBySessionId: mocks.findBySessionId, finalize: mocks.finalize },
  chatMessageRepository: { create: mocks.chatCreate },
}));
vi.mock("../queue/run-recovery-worker.js", () => ({ handleRunCompletion: mocks.handleRunCompletion }));
vi.mock("../lib/session-context.js", () => ({ deleteSession: mocks.deleteSession }));
vi.mock("../surfaces/spaces/client.js", () => ({
  spacesAppFetch: mocks.spacesAppFetch,
  spacesAppFetchMultipart: mocks.spacesAppFetchMultipart,
}));
vi.mock("./twinResponseFeedback.js", () => ({ recordTwinApprovalPending: mocks.recordPending }));
vi.mock("../logger.js", () => ({
  createLogger: () => ({
    info: mocks.logInfo,
    warn: mocks.logWarn,
    error: mocks.logError,
    debug: vi.fn(),
  }),
}));

import type { SessionContext } from "../lib/session-context.js";
import {
  handleTwinApprovalResult,
  mergeInvocationsForCitations,
  twinOutcomeText,
  withTwinSuffix,
} from "./twinResultDelivery.js";

const DRAFT_URL_SUFFIX = "/api/internal/twin-reply-draft";

function makeCtx(over: Partial<SessionContext> = {}): SessionContext {
  return {
    mentionedUserId: "owner-1",
    senderId: "sender-1",
    senderName: "Sam",
    channelId: "ch-1",
    channelName: "general",
    conversationId: "conv-1",
    sourceMessageId: "msg-1",
    task: "what is the ETA?",
    agentOrgId: "org-1",
    agentSlug: "digital-twin",
    responseMode: "approval",
    appToken: "app-token",
    spacesAppId: "app-1",
    spacesAppUserId: "app-user-1",
    workspaceId: "ws-1",
    ...over,
  };
}

const okResponse = () => ({ ok: true, status: 200, text: async () => "" });
const failResponse = (status: number, body = "") => ({ ok: false, status, text: async () => body });

describe("twinOutcomeText", () => {
  it("is 'stayed silent' when the model never delivered", () => {
    expect(twinOutcomeText(undefined)).toBe("_Stayed silent — not confident enough to reply._");
  });

  it("is 'chose not to reply' for ignore, even when a message rides along", () => {
    expect(twinOutcomeText({ action: "ignore" })).toBe("_Chose not to reply to this._");
    expect(twinOutcomeText({ action: "ignore", message: "m" })).toBe("_Chose not to reply to this._");
  });

  it("uses the trimmed reply text, prefixed by the emoji when there is one", () => {
    expect(twinOutcomeText({ action: "reply", message: " hi " })).toBe("hi");
    expect(twinOutcomeText({ action: "react_and_reply", emoji: "👍", message: " hi " })).toBe("👍 hi");
  });

  it("describes a react-only delivery by its emoji", () => {
    expect(twinOutcomeText({ action: "react", emoji: "👍" })).toBe("Reacted 👍");
  });

  it("falls back to 'drafted a reply' for a blank or non-string message with no emoji", () => {
    expect(twinOutcomeText({ action: "reply", message: "  " })).toBe("_Drafted a reply._");
    expect(twinOutcomeText({ action: "react", message: 42 } as never)).toBe("_Drafted a reply._");
  });

  it("does not throw on a non-string message next to an emoji (react passes isTwinDelivery)", () => {
    expect(twinOutcomeText({ action: "react", emoji: "👍", message: 42 } as never)).toBe("Reacted 👍");
  });
});

describe("mergeInvocationsForCitations", () => {
  it("keeps first-seen order and the first entry per toolCallId", () => {
    const a = { toolCallId: "a", n: 1 };
    const b = { toolCallId: "b", n: 2 };
    const a2 = { toolCallId: "a", n: 3 };
    expect(mergeInvocationsForCitations([a, b], [a2])).toEqual([a, b]);
  });

  it("upgrades an entry in place when a later one carries citations", () => {
    const plain = { toolCallId: "a" };
    const other = { toolCallId: "b" };
    const cited = { toolCallId: "a", citations: [{ id: 1 }] };
    const merged = mergeInvocationsForCitations([plain, other], [cited]);
    expect(merged).toEqual([cited, other]);
    expect(merged[0]).toBe(cited);
  });

  it("does not replace an entry that already has citations", () => {
    const cited = { toolCallId: "a", citations: [] };
    const later = { toolCallId: "a", citations: [{ id: 9 }] };
    expect(mergeInvocationsForCitations([cited], [later])).toEqual([cited]);
  });

  it("keeps every entry that has no usable id, and skips non-array lists", () => {
    const x = { name: "x" };
    const y = { toolCallId: "", name: "y" };
    const z = { toolCallId: 7, name: "z" };
    expect(mergeInvocationsForCitations([x, y], undefined, null, [z, "str", null])).toEqual([x, y, z, "str", null]);
  });
});

describe("withTwinSuffix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the text unchanged when the owner has no suffix", async () => {
    mocks.userFindUnique.mockResolvedValue({ digitalTwinResponseSuffix: null });
    expect(await withTwinSuffix("owner-1", "hello")).toBe("hello");
    expect(mocks.userFindUnique).toHaveBeenCalledWith({
      where: { id: "owner-1" },
      select: { digitalTwinResponseSuffix: true },
    });
  });

  it("returns the text unchanged for a whitespace-only suffix or a missing user", async () => {
    mocks.userFindUnique.mockResolvedValueOnce({ digitalTwinResponseSuffix: "   " });
    expect(await withTwinSuffix("owner-1", "hello")).toBe("hello");
    mocks.userFindUnique.mockResolvedValueOnce(null);
    expect(await withTwinSuffix("owner-1", "hello")).toBe("hello");
  });

  it("appends the trimmed suffix after a blank line", async () => {
    mocks.userFindUnique.mockResolvedValue({ digitalTwinResponseSuffix: "  — Sam's twin  " });
    expect(await withTwinSuffix("owner-1", "hello  \n")).toBe("hello\n\n— Sam's twin");
  });

  it("is idempotent when the text already ends with the suffix", async () => {
    mocks.userFindUnique.mockResolvedValue({ digitalTwinResponseSuffix: "— Sam's twin" });
    expect(await withTwinSuffix("owner-1", "hello\n\n— Sam's twin")).toBe("hello\n\n— Sam's twin");
  });

  it("returns the text as-is and warns when the lookup throws", async () => {
    mocks.userFindUnique.mockRejectedValue(new Error("db down"));
    expect(await withTwinSuffix("owner-1", "hello")).toBe("hello");
    expect(mocks.logWarn).toHaveBeenCalledWith("[webhook/result] Twin suffix lookup failed for user owner-1: db down");
  });
});

describe("handleTwinApprovalResult", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    mocks.userFindUnique.mockResolvedValue({ digitalTwinResponseSuffix: null });
    mocks.findBySessionId.mockResolvedValue(null);
    mocks.finalize.mockResolvedValue(undefined);
    mocks.chatCreate.mockResolvedValue({ id: "chat-msg-1" });
    mocks.handleRunCompletion.mockResolvedValue(undefined);
    mocks.deleteSession.mockResolvedValue(undefined);
    mocks.recordPending.mockResolvedValue(undefined);
    mocks.spacesAppFetch.mockImplementation(async (path: string) =>
      path === "/channel/openDm" ? { channelId: "dm-1" } : { messageId: "posted-1" },
    );
    mocks.spacesAppFetchMultipart.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("silent and ignore", () => {
    it("stays silent when the run carries no twinDelivery", async () => {
      await handleTwinApprovalResult(makeCtx(), {}, "sess-1");

      expect(fetchMock).not.toHaveBeenCalled();
      expect(mocks.spacesAppFetch).not.toHaveBeenCalled();
      expect(mocks.recordPending).not.toHaveBeenCalled();
      expect(mocks.chatCreate).toHaveBeenCalledWith(
        expect.objectContaining({ content: "_Stayed silent — not confident enough to reply._" }),
      );
      expect(mocks.logInfo).toHaveBeenCalledWith(
        "[webhook/result] Digital Twin stayed silent — no twin_deliver delivery (fail-closed), session sess-1",
      );
      expect(mocks.deleteSession).toHaveBeenCalledTimes(1);
      expect(mocks.deleteSession).toHaveBeenCalledWith("sess-1");
    });

    it("treats a malformed twinDelivery as silent", async () => {
      await handleTwinApprovalResult(makeCtx(), { twinDelivery: { action: "bogus" } as never }, "sess-1");

      expect(fetchMock).not.toHaveBeenCalled();
      expect(mocks.chatCreate).toHaveBeenCalledWith(
        expect.objectContaining({ content: "_Stayed silent — not confident enough to reply._" }),
      );
      expect(mocks.deleteSession).toHaveBeenCalledTimes(1);
    });

    it("drops an ignore delivery: no fetch, no pending row, session deleted once", async () => {
      await handleTwinApprovalResult(makeCtx(), { twinDelivery: { action: "ignore" } }, "sess-1");

      expect(fetchMock).not.toHaveBeenCalled();
      expect(mocks.spacesAppFetch).not.toHaveBeenCalled();
      expect(mocks.recordPending).not.toHaveBeenCalled();
      expect(mocks.chatCreate).toHaveBeenCalledWith(expect.objectContaining({ content: "_Chose not to reply to this._" }));
      expect(mocks.logInfo).toHaveBeenCalledWith(
        "[webhook/result] Digital Twin chose to ignore — dropping, no DM/post, session sess-1",
      );
      expect(mocks.deleteSession).toHaveBeenCalledTimes(1);
    });
  });

  describe("outcome row, finalize and run-recovery", () => {
    it("persists the outcome row, finalizes the run with its id, then settles run recovery", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const order: string[] = [];
      mocks.chatCreate.mockImplementation(async () => {
        order.push("chat");
        return { id: "chat-msg-1" };
      });
      mocks.finalize.mockImplementation(() => {
        order.push("finalize");
        return Promise.resolve();
      });
      mocks.handleRunCompletion.mockImplementation(async () => {
        order.push("settle");
      });

      await handleTwinApprovalResult(
        makeCtx(),
        {
          twinDelivery: { action: "reply", message: "on it" },
          reasoning: "because",
          provider: "litellm",
          model: "m1",
          toolsUsed: ["memory-search"],
          toolInvocations: [{ toolCallId: "t1" }],
          tokenUsage: { input: 1, output: 2 },
          latency: { totalMs: 10 },
          fastMode: false,
        },
        "sess-1",
      );

      expect(order).toEqual(["chat", "finalize", "settle"]);
      expect(mocks.chatCreate).toHaveBeenCalledWith({
        conversationId: "conv-1",
        agentSlug: "digital-twin",
        userId: "owner-1",
        orgId: "org-1",
        role: "assistant",
        content: "on it",
        status: "completed",
        reasoning: "because",
      });
      expect(mocks.finalize).toHaveBeenCalledWith("sess-1", {
        status: "completed",
        result: "on it",
        error: null,
        chatMessageId: "chat-msg-1",
        provider: "litellm",
        model: "m1",
        reasoning: "because",
        toolsUsed: ["memory-search"],
        toolInvocations: [{ toolCallId: "t1" }],
        tokenUsage: { input: 1, output: 2 },
        latency: { totalMs: 10 },
        fastMode: false,
      });
      expect(mocks.handleRunCompletion).toHaveBeenCalledWith("sess-1", "completed");
    });

    it("omits the optional finalize fields the payload did not carry", async () => {
      await handleTwinApprovalResult(makeCtx(), { twinDelivery: { action: "ignore" } }, "sess-1");

      expect(mocks.finalize).toHaveBeenCalledWith("sess-1", {
        status: "completed",
        result: null,
        error: null,
        chatMessageId: "chat-msg-1",
        toolsUsed: [],
      });
    });

    it("skips finalize and run-recovery without a sessionId, but still drops the delivery", async () => {
      await handleTwinApprovalResult(makeCtx(), { twinDelivery: { action: "ignore" } }, "");

      expect(mocks.finalize).not.toHaveBeenCalled();
      expect(mocks.handleRunCompletion).not.toHaveBeenCalled();
      expect(mocks.deleteSession).toHaveBeenCalledWith("");
    });

    it("skips the outcome row when the session lacks the owner / org identity", async () => {
      await handleTwinApprovalResult(makeCtx({ agentOrgId: null }), { twinDelivery: { action: "ignore" } }, "sess-1");

      expect(mocks.chatCreate).not.toHaveBeenCalled();
      const finalizeInput = mocks.finalize.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(finalizeInput).not.toHaveProperty("chatMessageId");
    });

    it("swallows an outcome-row failure and still finalizes without a chatMessageId", async () => {
      mocks.chatCreate.mockRejectedValue(new Error("insert failed"));

      await handleTwinApprovalResult(makeCtx(), { twinDelivery: { action: "ignore" } }, "sess-1");

      expect(mocks.logWarn).toHaveBeenCalledWith(
        "[webhook/result] Twin: failed to persist outcome chat message for sess-1: insert failed",
      );
      const finalizeInput = mocks.finalize.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(finalizeInput).not.toHaveProperty("chatMessageId");
      expect(mocks.deleteSession).toHaveBeenCalledTimes(1);
    });

    it("does not await finalize and swallows its rejection", async () => {
      mocks.finalize.mockReturnValue(new Promise(() => {})); // never settles
      await handleTwinApprovalResult(makeCtx(), { twinDelivery: { action: "ignore" } }, "sess-1");
      expect(mocks.handleRunCompletion).toHaveBeenCalledTimes(1);

      mocks.finalize.mockRejectedValue(new Error("boom"));
      await expect(
        handleTwinApprovalResult(makeCtx(), { twinDelivery: { action: "ignore" } }, "sess-2"),
      ).resolves.toBeUndefined();
    });

    it("warns and carries on when settling run recovery fails", async () => {
      mocks.handleRunCompletion.mockRejectedValue(new Error("settle failed"));

      await handleTwinApprovalResult(makeCtx(), { twinDelivery: { action: "ignore" } }, "sess-1");

      expect(mocks.logWarn).toHaveBeenCalledWith(
        "[webhook/result] Twin: failed to settle run recovery for sess-1:",
        "settle failed",
      );
      expect(mocks.deleteSession).toHaveBeenCalledTimes(1);
    });
  });

  describe("in-thread reply draft", () => {
    it("posts the draft to Spaces S2S, records the pending row and deletes the session", async () => {
      fetchMock.mockResolvedValue(okResponse());

      await handleTwinApprovalResult(
        makeCtx(),
        { twinDelivery: { action: "reply", message: "on it", reasoning: "because" } },
        "sess-1",
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
      expect(url.endsWith(DRAFT_URL_SUFFIX)).toBe(true);
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({
        conversationId: "conv-1",
        ownerUserId: "owner-1",
        channelId: "ch-1",
        action: "reply",
        message: "on it",
        reasoning: "because",
        destinationKind: "origin_thread",
        sourceMessageId: "msg-1",
        mentionedUserId: "owner-1",
        workspaceId: "ws-1",
        senderId: "sender-1",
        senderName: "Sam",
        channelName: "general",
        incomingTask: "what is the ETA?",
        agentSlug: "digital-twin",
        spacesAppId: "app-1",
        sessionId: "sess-1",
      });
      expect(mocks.spacesAppFetch).not.toHaveBeenCalled();
      expect(mocks.recordPending).toHaveBeenCalledTimes(1);
      expect(mocks.recordPending).toHaveBeenCalledWith({
        userId: "owner-1",
        conversationId: "conv-1",
        channelId: "ch-1",
        channelName: "general",
        sourceMessageId: "msg-1",
        incomingTask: "what is the ETA?",
        delivery: { action: "reply", message: "on it", reasoning: "because" },
      });
      expect(mocks.deleteSession).toHaveBeenCalledTimes(1);
      expect(mocks.deleteSession).toHaveBeenCalledWith("sess-1");
    });

    it("applies the owner's suffix to the reply body and to the pending row", async () => {
      fetchMock.mockResolvedValue(okResponse());
      mocks.userFindUnique.mockResolvedValue({ digitalTwinResponseSuffix: "— Sam's twin" });

      await handleTwinApprovalResult(makeCtx(), { twinDelivery: { action: "reply", message: "on it" } }, "sess-1");

      const init = fetchMock.mock.calls[0]?.[1] as { body: string };
      expect(JSON.parse(init.body).message).toBe("on it\n\n— Sam's twin");
      expect(mocks.recordPending).toHaveBeenCalledWith(
        expect.objectContaining({ delivery: { action: "reply", message: "on it\n\n— Sam's twin" } }),
      );
    });

    it("does not look up the suffix for a react-only delivery", async () => {
      fetchMock.mockResolvedValue(okResponse());

      await handleTwinApprovalResult(makeCtx(), { twinDelivery: { action: "react", emoji: "👍" } }, "sess-1");

      expect(mocks.userFindUnique).not.toHaveBeenCalled();
      const init = fetchMock.mock.calls[0]?.[1] as { body: string };
      expect(JSON.parse(init.body)).toMatchObject({ action: "react", emoji: "👍" });
    });

    it("appends the self-check line to the owner-only reasoning", async () => {
      fetchMock.mockResolvedValue(okResponse());

      await handleTwinApprovalResult(
        makeCtx(),
        {
          twinDelivery: {
            action: "reply",
            message: "on it",
            reasoning: "because",
            check: { answersAsk: 0.9, overall: 0.9, source: "jev", ms: 12 },
          },
        },
        "sess-1",
      );

      const init = fetchMock.mock.calls[0]?.[1] as { body: string };
      expect(JSON.parse(init.body).reasoning).toBe("because\n\nSelf-check: answers the ask 90%");
      expect(mocks.logInfo).toHaveBeenCalledWith("[webhook/result] Twin self-check overall=0.9 session sess-1");
    });

    it("routes DM destinations into the draft body", async () => {
      fetchMock.mockResolvedValue(okResponse());

      await handleTwinApprovalResult(
        makeCtx(),
        {
          twinDelivery: {
            action: "reply",
            message: "on it",
            destination: { kind: "dm", userId: "u-9", userName: "Ada" },
            destinationReason: "private",
          },
        },
        "sess-1",
      );

      const init = fetchMock.mock.calls[0]?.[1] as { body: string };
      expect(JSON.parse(init.body)).toMatchObject({
        destinationKind: "dm",
        destinationUserId: "u-9",
        destinationUserName: "Ada",
        destinationReason: "private",
      });
    });

    it.each([401, 404])("falls back to the legacy approval DM when the draft endpoint answers %i", async (status) => {
      fetchMock.mockResolvedValue(failResponse(status, "nope"));

      await handleTwinApprovalResult(makeCtx(), { twinDelivery: { action: "reply", message: "on it" } }, "sess-1");

      expect(mocks.logWarn).toHaveBeenCalledWith(
        `[webhook/result] Twin reply-draft endpoint unavailable (${status}) — falling back to approval DM, session sess-1`,
      );
      expect(mocks.spacesAppFetch).toHaveBeenCalledWith(
        "/channel/openDm",
        { targetUserId: "owner-1", workspaceId: "ws-1" },
        "app-token",
      );
      expect(mocks.spacesAppFetch).toHaveBeenCalledWith(
        "/chat/postMessage",
        expect.objectContaining({ channelId: "dm-1", userId: "app-user-1", flow: expect.anything() }),
        "app-token",
      );
      expect(mocks.spacesAppFetchMultipart).not.toHaveBeenCalled();
      expect(mocks.recordPending).toHaveBeenCalledTimes(1);
      expect(mocks.logInfo).toHaveBeenCalledWith(
        "[webhook/result] Digital Twin: sent approve/decline DM to owner-1 (asked by sender-1)",
      );
      expect(mocks.deleteSession).toHaveBeenCalledTimes(1);
      expect(mocks.deleteSession).toHaveBeenCalledWith("sess-1");
    });

    it("uploads callback attachments with the legacy DM card", async () => {
      fetchMock.mockResolvedValue(failResponse(404));
      const attachments = [{ fileName: "a.txt", mimeType: "text/plain", data: Buffer.from("hi").toString("base64") }];

      await handleTwinApprovalResult(
        makeCtx(),
        { twinDelivery: { action: "reply", message: "on it" }, attachments },
        "sess-1",
      );

      expect(mocks.spacesAppFetch).toHaveBeenCalledTimes(1); // openDm only
      expect(mocks.spacesAppFetchMultipart).toHaveBeenCalledTimes(1);
      const [path, form, token] = mocks.spacesAppFetchMultipart.mock.calls[0] as [string, FormData, string];
      expect(path).toBe("/files/filesUpload");
      expect(token).toBe("app-token");
      expect(form.get("channelId")).toBe("dm-1");
      expect(form.get("userId")).toBe("app-user-1");
      expect(form.getAll("files")).toHaveLength(1);
      expect(mocks.deleteSession).toHaveBeenCalledTimes(1);
    });

    it("stays silent on any other draft failure: no DM, no pending row, session deleted once", async () => {
      fetchMock.mockResolvedValue(failResponse(500, "boom"));

      await handleTwinApprovalResult(makeCtx(), { twinDelivery: { action: "reply", message: "on it" } }, "sess-1");

      expect(mocks.logError).toHaveBeenCalledWith(
        "[webhook/result] Twin reply-draft create failed: 500 boom — staying silent, session sess-1",
      );
      expect(mocks.spacesAppFetch).not.toHaveBeenCalled();
      expect(mocks.spacesAppFetchMultipart).not.toHaveBeenCalled();
      expect(mocks.recordPending).not.toHaveBeenCalled();
      expect(mocks.deleteSession).toHaveBeenCalledTimes(1);
      expect(mocks.deleteSession).toHaveBeenCalledWith("sess-1");
    });

    it("stays silent when the draft request itself throws", async () => {
      fetchMock.mockRejectedValue(new Error("network down"));

      await handleTwinApprovalResult(makeCtx(), { twinDelivery: { action: "reply", message: "on it" } }, "sess-1");

      expect(mocks.logError).toHaveBeenCalledWith(
        "[webhook/result] Twin reply-draft create error: network down — staying silent, session sess-1",
      );
      expect(mocks.spacesAppFetch).not.toHaveBeenCalled();
      expect(mocks.recordPending).not.toHaveBeenCalled();
      expect(mocks.deleteSession).toHaveBeenCalledTimes(1);
    });
  });
});
