import { beforeEach, describe, expect, it, vi } from "vitest";

const interact = vi.fn();
vi.mock("../mcp/servers/xyne-spaces-client.js", () => ({ interact: (...args: unknown[]) => interact(...args) }));
vi.mock("../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

const { getSpacesPostTarget, spacesConversationExists } = await import("./spaces-post-target.js");

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
