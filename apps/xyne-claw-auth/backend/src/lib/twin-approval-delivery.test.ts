import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  resolveUnboundMentions: vi.fn(async (text: string) => `${text}|resolved`),
  expandSpacesMentions: vi.fn((text: string) => `${text}|expanded`),
  buildLookups: vi.fn((workspaceId?: string) => ({ workspaceId })),
}));

vi.mock("../config.js", () => ({ CONFIG: { spacesInternalUrl: "http://spaces.test" } }));
vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: mocks.info, warn: mocks.warn, error: mocks.error }),
}));
vi.mock("./mention-transform.js", () => ({
  resolveUnboundMentions: mocks.resolveUnboundMentions,
  expandSpacesMentions: mocks.expandSpacesMentions,
}));
vi.mock("./mention-lookups.js", () => ({ buildSpacesMentionLookupsDb: mocks.buildLookups }));

import { executeTwinApprovalDelivery, type TwinDeliveryContext } from "./twin-approval-delivery.js";

// executeTwinApprovalDelivery is the single execution path for an APPROVED twin
// delivery (legacy approval card + in-thread draft). These tests pin the exact
// Spaces S2S calls it makes and the result it returns.

const BASE = "http://spaces.test/api/internal";

const ctx = (over: Partial<TwinDeliveryContext> = {}): TwinDeliveryContext => ({
  mentionedUserId: "u_owner",
  workspaceId: "ws_1",
  targetChannelId: "ch_origin",
  targetConversationId: "conv_origin",
  sourceMessageId: "msg_1",
  messageContent: "  hello there  ",
  deliveryAction: "reply",
  deliveryEmoji: "thumbsup",
  destinationKind: "origin_thread",
  ...over,
});

type Reply = { status?: number; body?: string; json?: unknown };
let replies: Record<string, Reply>;
let fetchMock: ReturnType<typeof vi.fn>;

const calls = () => fetchMock.mock.calls as Array<[string, RequestInit]>;
const callTo = (path: string) => calls().find(([url]) => url === `${BASE}/${path}`);
const bodyOf = (path: string) => JSON.parse(callTo(path)![1].body as string) as Record<string, unknown>;

beforeEach(() => {
  vi.stubEnv("INTERNAL_S2S_KEY", "k");
  replies = {};
  fetchMock = vi.fn(async (url: string) => {
    const r = replies[url.slice(`${BASE}/`.length)] ?? {};
    return new Response(r.json !== undefined ? JSON.stringify(r.json) : (r.body ?? ""), { status: r.status ?? 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("executeTwinApprovalDelivery — react", () => {
  it("react-only posts one reactAsUser call with the exact url, headers, body and timeout", async () => {
    const result = await executeTwinApprovalDelivery(ctx({ deliveryAction: "react" }));

    expect(result).toEqual({ ok: true, doneMsg: "Reacted.", wasEdited: false, finalContent: "" });
    expect(calls()).toHaveLength(1);
    const [url, init] = calls()[0]!;
    expect(url).toBe(`${BASE}/reactAsUser`);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json", "x-s2s-key": "k" });
    expect(init.body).toBe(JSON.stringify({ messageId: "msg_1", emojiName: "thumbsup", userId: "u_owner" }));
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("react-only failure surfaces 'Failed to react: <status>' and logs the body", async () => {
    replies["reactAsUser"] = { status: 500, body: "boom" };
    const result = await executeTwinApprovalDelivery(ctx({ deliveryAction: "react" }));

    expect(result).toEqual({ ok: false, error: "Failed to react: 500" });
    expect(mocks.warn).toHaveBeenCalledWith("[twin-delivery] react failed: 500 boom");
  });

  it("react failure does not block the reply when the action is react_and_reply", async () => {
    replies["reactAsUser"] = { status: 500 };
    const result = await executeTwinApprovalDelivery(ctx({ deliveryAction: "react_and_reply" }));

    expect(result).toMatchObject({ ok: true, doneMsg: "Reacted & replied.", finalContent: "hello there" });
    expect(calls().map(([url]) => url)).toEqual([`${BASE}/reactAsUser`, `${BASE}/postAsUser`]);
  });

  it("skips the react call without a source message or emoji", async () => {
    const noMessage = await executeTwinApprovalDelivery(ctx({ deliveryAction: "react", sourceMessageId: undefined }));
    const noEmoji = await executeTwinApprovalDelivery(ctx({ deliveryAction: "react", deliveryEmoji: undefined }));

    expect(noMessage).toEqual({ ok: true, doneMsg: "Reacted.", wasEdited: false, finalContent: "" });
    expect(noEmoji).toEqual({ ok: true, doneMsg: "Reacted.", wasEdited: false, finalContent: "" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("react-only with no messageContent at all still succeeds", async () => {
    const result = await executeTwinApprovalDelivery(ctx({ deliveryAction: "react", messageContent: undefined }));

    expect(result).toEqual({ ok: true, doneMsg: "Reacted.", wasEdited: false, finalContent: "" });
  });
});

describe("executeTwinApprovalDelivery — reply", () => {
  it("posts to the origin thread with the exact url, headers, body key order and timeout", async () => {
    const result = await executeTwinApprovalDelivery(ctx());

    expect(result).toEqual({
      ok: true,
      doneMsg: "Response sent.",
      wasEdited: false,
      finalContent: "hello there",
      posted: { channelId: "ch_origin", conversationId: "conv_origin" },
    });
    expect(calls()).toHaveLength(1);
    const [url, init] = calls()[0]!;
    expect(url).toBe(`${BASE}/postAsUser`);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json", "x-s2s-key": "k" });
    expect(init.body).toBe(
      JSON.stringify({
        channelId: "ch_origin",
        conversationId: "conv_origin",
        markdownText: "hello there|resolved|expanded",
        userId: "u_owner",
        workspaceId: "ws_1",
        metadata: { contentFormat: "markdown" },
      }),
    );
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("resolves mentions scoped to the delivery workspace before expanding them", async () => {
    await executeTwinApprovalDelivery(ctx());

    expect(mocks.buildLookups).toHaveBeenCalledWith("ws_1");
    expect(mocks.resolveUnboundMentions).toHaveBeenCalledWith("hello there", { workspaceId: "ws_1" });
    expect(mocks.expandSpacesMentions).toHaveBeenCalledWith("hello there|resolved");
  });

  it("posts the text unchanged (expanded only) when mention resolution throws", async () => {
    mocks.resolveUnboundMentions.mockRejectedValueOnce(new Error("lookup down"));
    const result = await executeTwinApprovalDelivery(ctx());

    expect(result.ok).toBe(true);
    expect(bodyOf("postAsUser")["markdownText"]).toBe("hello there|expanded");
    expect(mocks.warn).toHaveBeenCalledWith("[twin-delivery] mention resolution failed — posting raw: lookup down");
  });

  it("origin_channel posts a new top-level message (no conversationId key)", async () => {
    const result = await executeTwinApprovalDelivery(ctx({ destinationKind: "origin_channel" }));

    expect(result).toMatchObject({ ok: true, posted: { channelId: "ch_origin" } });
    expect(bodyOf("postAsUser")).not.toHaveProperty("conversationId");
  });

  it("an unknown destination kind degrades to the origin thread", async () => {
    await executeTwinApprovalDelivery(ctx({ destinationKind: "somewhere_else" }));

    expect(bodyOf("postAsUser")).toMatchObject({ channelId: "ch_origin", conversationId: "conv_origin" });
  });

  it("postAsUser failure returns 'Failed to post: <status>' and logs the body", async () => {
    replies["postAsUser"] = { status: 403, body: "not a member" };
    const result = await executeTwinApprovalDelivery(ctx());

    expect(result).toEqual({ ok: false, error: "Failed to post: 403" });
    expect(mocks.error).toHaveBeenCalledWith("[twin-delivery] Failed to post as user: 403 not a member");
  });

  it("a reply with no content posts nothing but still reports success", async () => {
    const result = await executeTwinApprovalDelivery(ctx({ messageContent: "   " }));

    expect(result).toEqual({ ok: true, doneMsg: "Response sent.", wasEdited: false, finalContent: "" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("react_and_reply reacts first, then posts", async () => {
    const result = await executeTwinApprovalDelivery(ctx({ deliveryAction: "react_and_reply" }));

    expect(result).toMatchObject({ ok: true, doneMsg: "Reacted & replied." });
    expect(calls().map(([url]) => url)).toEqual([`${BASE}/reactAsUser`, `${BASE}/postAsUser`]);
  });
});

describe("executeTwinApprovalDelivery — edits", () => {
  it("an edited reply is posted and flagged wasEdited", async () => {
    const result = await executeTwinApprovalDelivery(ctx(), { editedContent: "  better words  " });

    expect(result).toMatchObject({ ok: true, wasEdited: true, finalContent: "better words" });
    expect(mocks.resolveUnboundMentions).toHaveBeenCalledWith("better words", expect.anything());
  });

  it("a blank edit falls back to the original (trimmed) and is not an edit", async () => {
    const result = await executeTwinApprovalDelivery(ctx(), { editedContent: "   " });

    expect(result).toMatchObject({ ok: true, wasEdited: false, finalContent: "hello there" });
  });

  it("an edit identical to the original (after trimming) is not an edit", async () => {
    const result = await executeTwinApprovalDelivery(ctx(), { editedContent: "hello there" });

    expect(result).toMatchObject({ ok: true, wasEdited: false, finalContent: "hello there" });
  });

  it("an edit on a react-only delivery is ignored", async () => {
    const result = await executeTwinApprovalDelivery(ctx({ deliveryAction: "react" }), { editedContent: "nope" });

    expect(result).toEqual({ ok: true, doneMsg: "Reacted.", wasEdited: false, finalContent: "" });
  });
});

describe("executeTwinApprovalDelivery — DM destinations", () => {
  it("dm_sender without a senderId cannot resolve who to DM", async () => {
    const result = await executeTwinApprovalDelivery(ctx({ destinationKind: "dm_sender" }));

    expect(result).toEqual({ ok: false, error: "Couldn't resolve who to DM" });
    expect(mocks.error).toHaveBeenCalledWith("[twin-delivery] DM has no target user (kind=dm_sender)");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("dm without a destinationUserId cannot resolve who to DM", async () => {
    const result = await executeTwinApprovalDelivery(ctx({ destinationKind: "dm", senderId: "u_sender" }));

    expect(result).toEqual({ ok: false, error: "Couldn't resolve who to DM" });
  });

  it("dm_sender opens a DM with the sender, then posts to the returned channel", async () => {
    replies["getOrCreateDm"] = { json: { channelId: "ch_dm" } };
    const result = await executeTwinApprovalDelivery(ctx({ destinationKind: "dm_sender", senderId: "u_sender" }));

    expect(result).toMatchObject({ ok: true, posted: { channelId: "ch_dm" } });
    expect(calls().map(([url]) => url)).toEqual([`${BASE}/getOrCreateDm`, `${BASE}/postAsUser`]);
    const [, init] = callTo("getOrCreateDm")!;
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json", "x-s2s-key": "k" });
    expect(init.body).toBe(JSON.stringify({ userId: "u_owner", targetUserId: "u_sender", workspaceId: "ws_1" }));
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(bodyOf("postAsUser")).toMatchObject({ channelId: "ch_dm", userId: "u_owner", workspaceId: "ws_1" });
    expect(bodyOf("postAsUser")).not.toHaveProperty("conversationId");
  });

  it("dm opens a DM with the destinationUserId the twin chose", async () => {
    replies["getOrCreateDm"] = { json: { channelId: "ch_dm2" } };
    await executeTwinApprovalDelivery(ctx({ destinationKind: "dm", senderId: "u_sender", destinationUserId: "u_pick" }));

    expect(bodyOf("getOrCreateDm")).toEqual({ userId: "u_owner", targetUserId: "u_pick", workspaceId: "ws_1" });
  });

  it("getOrCreateDm failure returns \"Couldn't open the DM: <status>\" and posts nothing", async () => {
    replies["getOrCreateDm"] = { status: 500, body: "dm down" };
    const result = await executeTwinApprovalDelivery(ctx({ destinationKind: "dm_sender", senderId: "u_sender" }));

    expect(result).toEqual({ ok: false, error: "Couldn't open the DM: 500" });
    expect(mocks.error).toHaveBeenCalledWith("[twin-delivery] Failed to open DM: 500 dm down");
    expect(callTo("postAsUser")).toBeUndefined();
  });

  it("a DM response without a channelId is reported as unresolved", async () => {
    replies["getOrCreateDm"] = { json: {} };
    const result = await executeTwinApprovalDelivery(ctx({ destinationKind: "dm_sender", senderId: "u_sender" }));

    expect(result).toEqual({ ok: false, error: "DM channel could not be resolved" });
    expect(callTo("postAsUser")).toBeUndefined();
  });
});
