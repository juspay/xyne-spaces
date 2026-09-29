import { describe, expect, it, vi, beforeEach } from "vitest";

const created = vi.fn();
const executeApprovedWrite = vi.fn();
const enqueueOutbound = vi.fn();

vi.mock("../../repositories/index.js", () => ({ chatMessageRepository: { create: created } }));
vi.mock("../../lib/approved-write.js", () => ({ executeApprovedWrite }));
vi.mock("./delivery.js", () => ({ enqueueOutbound }));
vi.mock("./identity.js", () => ({ resolveIdentity: async () => null }));
vi.mock("./cards.js", () => ({ newCardToken: () => "t", parkOptions: vi.fn() }));
const getSpacesPostTarget = vi.fn();
const getSpacesAuthForUser = vi.fn(async () => ({ token: "t", sessionId: "s", workspaceId: "ws" }));
vi.mock("../../lib/spaces-post-target.js", () => ({ getSpacesPostTarget }));
vi.mock("../../lib/spaces-db.js", () => ({ getSpacesAuthForUser }));

const { redeemApproval, enqueueApprovalCards, describeWriteAction } = await import("./approvals.js");

const account = { id: "acc", orgId: "org1", surfaceId: "whatsapp", accountKey: "acct_1" } as never;
const base = {
  chatId: "chat",
  senderId: "919",
  userId: "u1",
  conversationId: "whatsapp-acct_1-assistant-chat",
  agentSlug: "assistant",
};

describe("redeemApproval", () => {
  beforeEach(() => {
    created.mockReset();
    executeApprovedWrite.mockReset();
    enqueueOutbound.mockReset();
  });

  it("records the approval so the next turn knows it happened", async () => {
    executeApprovedWrite.mockResolvedValue({ ok: true, message: "Created ticket ENG-42" });
    await redeemApproval({
      account,
      option: { ...base, action: { kind: "approve-write", label: "spaces-create-ticket" }, write: {} as never },
      senderId: base.senderId,
      chatId: base.chatId,
    });
    expect(created).toHaveBeenCalledTimes(2);
    expect(created.mock.calls[0]?.[0]).toMatchObject({
      conversationId: base.conversationId,
      orgId: "org1",
      role: "user",
      content: "Approved: spaces-create-ticket",
    });
    expect(created.mock.calls[1]?.[0]).toMatchObject({ role: "assistant", content: "Created ticket ENG-42" });
  });

  it("records a decline too", async () => {
    await redeemApproval({
      account,
      option: { ...base, action: { kind: "decline-write", label: "spaces-create-ticket" } },
      senderId: base.senderId,
      chatId: base.chatId,
    });
    expect(created.mock.calls[0]?.[0]).toMatchObject({ content: "Declined: spaces-create-ticket" });
    expect(executeApprovedWrite).not.toHaveBeenCalled();
  });

  it("still replies when the history write fails", async () => {
    executeApprovedWrite.mockResolvedValue({ ok: true, message: "Created ticket ENG-43" });
    created.mockRejectedValue(new Error("db down"));
    await redeemApproval({
      account,
      option: { ...base, action: { kind: "approve-write", label: "spaces-create-ticket" }, write: {} as never },
      senderId: base.senderId,
      chatId: base.chatId,
    });
    expect(enqueueOutbound).toHaveBeenCalledWith("acc", expect.objectContaining({ text: "✅ Created ticket ENG-43" }));
  });

  it("skips the record when the run had no conversation", async () => {
    executeApprovedWrite.mockResolvedValue({ ok: true, message: "done" });
    const { conversationId: _drop, ...noConversation } = base;
    await redeemApproval({
      account,
      option: { ...noConversation, action: { kind: "approve-write", label: "x" }, write: {} as never },
      senderId: base.senderId,
      chatId: base.chatId,
    });
    expect(created).not.toHaveBeenCalled();
  });
});

describe("user-send-message approval card", () => {
  const signed = (params: Record<string, unknown>) => ({
    serverType: "xyne-spaces",
    tool: "user-send-message",
    userId: "u1",
    signature: "sig",
    params,
  });
  const target = { channel: "whatsapp-cloud", connectedSurfaceId: "acc", accountKey: "k", chatId: "chat", senderId: "919", isGroup: false } as never;

  beforeEach(() => {
    enqueueOutbound.mockReset();
    getSpacesPostTarget.mockReset();
  });

  it("names the channel instead of its id", async () => {
    getSpacesPostTarget.mockResolvedValue({ channelName: "general" });
    await enqueueApprovalCards({ target, userId: "u1", pendingActions: [signed({ channelId: "cmi345s9b07pmk5k4en17sbuy", content: "Go <b>try</b> it" })] });
    const card = enqueueOutbound.mock.calls[0]?.[1].card;
    expect(card.body).toBe('Send this message as you to *#general*:\n\n"Go *try* it"');
    expect(getSpacesPostTarget).toHaveBeenCalledWith({ channelId: "cmi345s9b07pmk5k4en17sbuy" }, { token: "t", sessionId: "s", workspaceId: "ws" });
    expect(getSpacesAuthForUser).toHaveBeenCalledWith("u1", "write-action");
  });

  it("shows which thread a reply lands in: channel, author and the post it answers", () => {
    const body = describeWriteAction("user-send-message", { conversationId: "eed03881", content: "Adding to this 🚀" }, {
      channelName: "general",
      thread: { author: "Samit Barai", html: '<p class="m-0">Build agents for your team.<br>Enable your team to do <i>deep</i> work.</p>' },
    });
    expect(body).toBe(
      'Reply as you in the thread in *#general* started by *Samit Barai*:\n> Build agents for your team. Enable your team to do _deep_ work.\n\nYour reply:\n\n"Adding to this 🚀"',
    );
  });

  it("falls back to ids when the Spaces DB has nothing", () => {
    expect(describeWriteAction("user-send-message", { channelId: "ch1", content: "hi" }, null)).toBe('Send this message as you to #ch1:\n\n"hi"');
    expect(describeWriteAction("user-send-message", { conversationId: "c1", content: "hi" }, null)).toBe('Reply as you in an existing thread:\n\n"hi"');
  });
});
