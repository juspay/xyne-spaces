import { describe, expect, it, vi, beforeEach } from "vitest";

const readGroupContext = vi.fn(async (_a: string, _c: string) => [] as Array<Record<string, unknown>>);

vi.mock("../../config.js", () => ({ CONFIG: { internalUrl: "http://localhost" } }));
vi.mock("../../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("../../redis.js", () => ({ redisService: { getConnection: () => ({}) } }));
vi.mock("./group-context.js", () => ({ readGroupContext }));
vi.mock("./delivery.js", () => ({ enqueueAndWait: vi.fn() }));
// The tool list is capability-driven, and no plugins are registered in a unit
// test — so stand in for the registry rather than asserting on an empty one.
vi.mock("./plugin.js", async () => {
  const actual = await vi.importActual<typeof import("./plugin.js")>("./plugin.js");
  return {
    ...actual,
    getChannel: (key: string) =>
      key === "whatsapp"
        ? { accountScope: "user", capabilities: { groups: true, reactions: true } }
        : { accountScope: "org", capabilities: { groups: false, reactions: true } },
  };
});
vi.mock("./store.js", () => ({
  getAccount: async () => ({ id: "acc", status: "ACTIVE" }),
  toChannelAccount: () => ({ id: "acc", channelConfig: {} }),
}));

const { handleChannelAgentTool, channelAgentTools } = await import("./agent-tools.js");

const target = (over: Record<string, unknown> = {}) =>
  ({ channel: "whatsapp", connectedSurfaceId: "acc", chatId: "120@g.us", isGroup: true, ...over }) as never;

const call = (t: unknown) =>
  handleChannelAgentTool({ target: t as never, tool: "whatsapp_read_recent", params: {} }).then(JSON.parse);

describe("read_recent", () => {
  beforeEach(() => readGroupContext.mockReset().mockResolvedValue([]));

  it("returns what the agent overheard, named and timestamped", async () => {
    readGroupContext.mockResolvedValue([
      { senderId: "919028716240@s.whatsapp.net", senderName: "Priya", text: "staging is down", at: 1_700_000_000_000 },
      { senderId: "918667338331@s.whatsapp.net", text: "looking", at: 1_700_000_060_000 },
    ]);
    const out = await call(target());
    expect(out.ok).toBe(true);
    expect(out.messages).toEqual([
      { from: "Priya", text: "staging is down", at: new Date(1_700_000_000_000).toISOString() },
      // No pushname — fall back to the number rather than showing a raw JID.
      { from: "+918667338331", text: "looking", at: new Date(1_700_000_060_000).toISOString() },
    ]);
  });

  it("does not consume the buffer — the next reply still needs it", async () => {
    readGroupContext.mockResolvedValue([{ senderId: "919", text: "hi", at: 1 }]);
    await call(target());
    await call(target());
    expect(readGroupContext).toHaveBeenCalledTimes(2);
  });

  it("says plainly when there is nothing, instead of inviting a guess", async () => {
    const out = await call(target());
    expect(out.messages).toEqual([]);
    expect(out.note).toContain("say that rather than looking somewhere else");
  });

  it("is a no-op in a one-to-one chat", async () => {
    const out = await call(target({ isGroup: false, chatId: "919@s.whatsapp.net" }));
    expect(out.messages).toEqual([]);
    expect(readGroupContext).not.toHaveBeenCalled();
  });

  it("is offered only on a channel that has groups", () => {
    const names = channelAgentTools("whatsapp").map((t) => t.name);
    expect(names).toContain("whatsapp_read_recent");
    // Business numbers cannot join groups, so the tool would always be empty.
    const cloud = channelAgentTools("whatsapp-cloud").map((t) => t.name);
    expect(cloud).not.toContain("whatsapp_cloud_read_recent");
  });
});
