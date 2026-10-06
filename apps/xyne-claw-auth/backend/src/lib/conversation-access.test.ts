import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("../config.js", () => ({ CONFIG: { spacesInternalUrl: "http://spaces.test" } }));
vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { baseConversationId, conversationAccessError } = await import("./conversation-access.js");

function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  } as unknown as Response);
}

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
  afterEach(() => vi.unstubAllGlobals());

  it("passes when the user can access (exists + canAccess)", async () => {
    vi.stubGlobal("fetch", mockFetch({ exists: true, canAccess: true }));
    expect(await conversationAccessError("u1", ["conv-1"])).toBeNull();
  });

  it("passes when the conversation does not exist (new conversation)", async () => {
    vi.stubGlobal("fetch", mockFetch({ exists: false, canAccess: false }));
    expect(await conversationAccessError("u1", ["conv-new"])).toBeNull();
  });

  it("passes (fail-open) when Spaces returns a non-200", async () => {
    vi.stubGlobal("fetch", mockFetch({}, false, 500));
    expect(await conversationAccessError("u1", ["conv-1"])).toBeNull();
  });

  it("passes (fail-open) when the Spaces call throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    expect(await conversationAccessError("u1", ["conv-1"])).toBeNull();
  });

  it("denies when exists + !canAccess", async () => {
    vi.stubGlobal("fetch", mockFetch({ exists: true, canAccess: false }));
    expect(await conversationAccessError("u1", ["conv-victim"])).toBe(
      "You don't have access to that conversation",
    );
  });

  it("checks the base of a branched piSessionConversationId", async () => {
    const f = mockFetch({ exists: true, canAccess: false });
    vi.stubGlobal("fetch", f);
    expect(await conversationAccessError("u1", [undefined, "conv-v__branch__m1"])).toBe(
      "You don't have access to that conversation",
    );
    const sentBody = JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string);
    expect(sentBody.conversationId).toBe("conv-v");
  });

  it("dedupes ids that share a base", async () => {
    const f = mockFetch({ exists: true, canAccess: true });
    vi.stubGlobal("fetch", f);
    await conversationAccessError("u1", ["conv-1", "conv-1__branch__m2"]);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
