import { beforeEach, describe, expect, it, vi } from "vitest";

const interact = vi.fn();
vi.mock("../mcp/servers/xyne-spaces-client.js", () => ({ interact: (...args: unknown[]) => interact(...args) }));
vi.mock("../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

const { getSpacesPostTarget, spacesConversationExists, directMessageMemberIds, looksLikeMemberIdList } = await import("./spaces-post-target.js");

const auth = { token: "t", workspaceId: "ws" };
const rowsFor: Record<string, unknown[]> = {
  conversation: [{ conversationId: "eed03881", channelId: "ch-general" }],
  message: [{ content: "<p>Build agents</p>", senderId: "usr-samit" }],
  user: [{ name: "Samit Barai" }],
  channel: [{ name: "general" }],
};

beforeEach(() => {
  interact.mockReset();
  interact.mockImplementation(async (ast: { model: string }) => rowsFor[ast.model] ?? []);
});

describe("getSpacesPostTarget", () => {
  it("resolves a thread's channel, author and opening post through the query gateway", async () => {
    await expect(getSpacesPostTarget({ conversationId: "eed03881" }, auth)).resolves.toEqual({
      channelName: "general",
      thread: { author: "Samit Barai", html: "<p>Build agents</p>" },
    });
    expect(interact.mock.calls.map((c) => (c[0] as { model: string }).model)).toEqual(["conversation", "message", "user", "channel"]);
    expect(interact.mock.calls.every((c) => c[1] === auth)).toBe(true);
  });

  it("names a channel target and returns null when the gateway fails", async () => {
    await expect(getSpacesPostTarget({ channelId: "ch-general" }, auth)).resolves.toEqual({ channelName: "general" });
    interact.mockRejectedValue(new Error("Spaces API 500"));
    await expect(getSpacesPostTarget({ channelId: "ch-general" }, auth)).resolves.toBeNull();
  });

  it("names a recipientUserId DM target by the recipient's display name", async () => {
    await expect(getSpacesPostTarget({ recipientUserId: "usr-samit" }, auth)).resolves.toEqual({
      channelName: null,
      directMessage: { with: ["Samit Barai"] },
    });
    expect(interact.mock.calls.map((c) => (c[0] as { model: string }).model)).toEqual(["user"]);
  });
});

describe("spacesConversationExists", () => {
  it("is true for a found conversation, false for none, null on error", async () => {
    await expect(spacesConversationExists("eed03881", auth)).resolves.toBe(true);
    interact.mockResolvedValueOnce([]);
    await expect(spacesConversationExists("missing", auth)).resolves.toBe(false);
    interact.mockRejectedValueOnce(new Error("boom"));
    await expect(spacesConversationExists("x", auth)).resolves.toBeNull();
  });
});

describe("direct messages", () => {
  it("resolves the other members' names and never returns the id-list name", async () => {
    interact.mockImplementation(async (ast: { model: string; where: { id: { equals?: string; in?: string[] } } }) => {
      if (ast.model === "channel") return [{ name: "usr-anurag000000000,usr-venkat00000000", scopeType: "DM" }];
      if (ast.model === "user") return (ast.where.id.in ?? []).map((id) => ({ name: id === "usr-venkat00000000" ? "Venkatesan S" : "Anurag Dwivedi" }));
      return [];
    });
    await expect(getSpacesPostTarget({ channelId: "dm-1" }, auth, "usr-anurag000000000")).resolves.toEqual({
      channelName: null,
      directMessage: { with: ["Venkatesan S"] },
    });
    const userQuery = interact.mock.calls.find((c) => (c[0] as { model: string }).model === "user")?.[0] as { where: { id: { in: string[] } } };
    expect(userQuery.where.id.in).toEqual(["usr-venkat00000000"]);
  });

  it("recognises DMs by scope type or by an id-list name, and leaves normal channels alone", () => {
    expect(directMessageMemberIds({ name: "a1b2c3d4e5,f6g7h8i9j0", scopeType: "DEFAULT" })).toEqual(["a1b2c3d4e5", "f6g7h8i9j0"]);
    expect(directMessageMemberIds({ name: "Team chat", scopeType: "GROUP_DM" })).toEqual([]);
    expect(directMessageMemberIds({ name: "xyne-spaces", scopeType: "DEFAULT" })).toBeNull();
    expect(looksLikeMemberIdList("xyne-spaces")).toBe(false);
    expect(looksLikeMemberIdList("cmgjlq6rb003o3uq3p6siynu8,i2okgxo3r0px2trepfsq6f9b")).toBe(true);
  });
});
