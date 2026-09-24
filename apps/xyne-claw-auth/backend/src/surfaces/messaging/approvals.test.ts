import { describe, expect, it, vi, beforeEach } from "vitest";

const created = vi.fn();
const executeApprovedWrite = vi.fn();
const enqueueOutbound = vi.fn();

vi.mock("../../repositories/index.js", () => ({ chatMessageRepository: { create: created } }));
vi.mock("../../lib/approved-write.js", () => ({ executeApprovedWrite }));
vi.mock("./delivery.js", () => ({ enqueueOutbound }));
vi.mock("./identity.js", () => ({ resolveIdentity: async () => null }));
vi.mock("./cards.js", () => ({ newCardToken: () => "t", parkOptions: vi.fn() }));

const { redeemApproval } = await import("./approvals.js");

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
