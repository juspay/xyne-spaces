import { describe, expect, it, vi, beforeEach } from "vitest";

const canUserAccessConversation = vi.fn();
vi.mock("./spaces-db.js", () => ({ canUserAccessConversation }));

const { baseConversationId, conversationAccessError } = await import("./conversation-access.js");

describe("baseConversationId", () => {
  it("returns the id unchanged when not branched", () => {
    expect(baseConversationId("conv-123")).toBe("conv-123");
  });
  it("strips the __branch__ suffix to the base conversationId", () => {
    expect(baseConversationId("conv-123__branch__msg-9")).toBe("conv-123");
  });
  it("returns undefined for empty / nullish", () => {
    expect(baseConversationId(undefined)).toBeUndefined();
    expect(baseConversationId("")).toBeUndefined();
    expect(baseConversationId("   ")).toBeUndefined();
  });
});

describe("conversationAccessError", () => {
  beforeEach(() => canUserAccessConversation.mockReset());

  it("passes when verdict is ok", async () => {
    canUserAccessConversation.mockResolvedValue("ok");
    expect(await conversationAccessError("u1", ["conv-1"])).toBeNull();
  });

  it("passes when verdict is unknown (new/non-existent conversation)", async () => {
    canUserAccessConversation.mockResolvedValue("unknown");
    expect(await conversationAccessError("u1", ["conv-new"])).toBeNull();
  });

  it("denies when any id is denied", async () => {
    canUserAccessConversation.mockResolvedValue("denied");
    expect(await conversationAccessError("u1", ["conv-victim"])).toBe(
      "You don't have access to that conversation",
    );
  });

  it("checks the base of a branched piSessionConversationId", async () => {
    canUserAccessConversation.mockResolvedValue("denied");
    expect(await conversationAccessError("u1", [undefined, "conv-v__branch__m1"])).toBe(
      "You don't have access to that conversation",
    );
    expect(canUserAccessConversation).toHaveBeenCalledWith("conv-v", "u1");
  });

  it("dedupes ids that share a base", async () => {
    canUserAccessConversation.mockResolvedValue("ok");
    await conversationAccessError("u1", ["conv-1", "conv-1__branch__m2"]);
    expect(canUserAccessConversation).toHaveBeenCalledTimes(1);
  });
});
