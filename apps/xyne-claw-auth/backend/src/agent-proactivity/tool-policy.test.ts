import { beforeEach, describe, expect, it, vi } from "vitest";

const scopes = new Map<string, { channelId: string; workspaceId: string; isPublic: boolean } | null>();
const guests = new Set<string>();
// Spaces' rule (bypassAcl/proactivityServices.ts), over the scopes below.
vi.mock("./spaces-scope.js", () => ({
  roomAllows: vi.fn(async (_bot: unknown, room: string, refs: Array<{ kind: string; id: string }>) => {
    const roomScope = scopes.get(`channel:${room}`);
    if (!roomScope) return false;
    const publicAllowed = !guests.has(room);
    return refs.every((ref) => {
      const scope = scopes.get(`${ref.kind}:${ref.id}`);
      return (
        !!scope &&
        scope.workspaceId === roomScope.workspaceId &&
        (scope.channelId === room || (publicAllowed && scope.isPublic))
      );
    });
  }),
}));

const { checkProactivityCall } = await import("./tool-policy.js");

const ROOM = "room";
const call = (tool: string, params: Record<string, unknown> = {}, over: Partial<Parameters<typeof checkProactivityCall>[0]> = {}) =>
  checkProactivityCall({
    serverType: "xyne-spaces-app-tools",
    tool,
    params,
    isWriteTool: false,
    isAgentConnector: false,
    roomChannelId: ROOM,
    bot: { userId: "bot", workspaceId: "w1" },
    ...over,
  });

beforeEach(() => {
  scopes.clear();
  guests.clear();
  const ws = "w1";
  scopes.set(`channel:${ROOM}`, { channelId: ROOM, workspaceId: ws, isPublic: false });
  scopes.set("channel:public", { channelId: "public", workspaceId: ws, isPublic: true });
  scopes.set("channel:other-workspace", { channelId: "other-workspace", workspaceId: "w2", isPublic: true });
  scopes.set("channel:private", { channelId: "private", workspaceId: ws, isPublic: false });
  scopes.set("conversation:in-room", { channelId: ROOM, workspaceId: ws, isPublic: false });
  scopes.set("conversation:in-private", { channelId: "private", workspaceId: ws, isPublic: false });
  scopes.set("message:in-public", { channelId: "public", workspaceId: ws, isPublic: true });
  scopes.set("ticket:T-1", { channelId: "private", workspaceId: ws, isPublic: false });
});

describe("writes", () => {
  it("refuses every write tool, instead of queueing an approval nobody will click", async () => {
    expect((await call("spaces-create-ticket", {}, { isWriteTool: true })).allow).toBe(false);
  });

  it("refuses posting as the bot, which the app-tools adapter does not mark as a write", async () => {
    expect((await call("apps-send-message", { channelId: ROOM })).allow).toBe(false);
  });
});

describe("connectors", () => {
  it("allows the agent's own connectors and nothing else outside Spaces", async () => {
    expect((await call("query", {}, { serverType: "grafana", isAgentConnector: true })).allow).toBe(true);
    expect((await call("query", {}, { serverType: "grafana", isAgentConnector: false })).allow).toBe(false);
  });
});

describe("Spaces reads stay in the room", () => {
  it("scopes a search to the room when it names no channel", async () => {
    const verdict = await call("spaces-vespa-search", { searchArea: "message", query: "rate limit" });
    expect(verdict).toEqual({
      allow: true,
      params: { searchArea: "message", query: "rate limit", filters: { channelId: { contains: ROOM } } },
    });
  });

  it("allows searching public channels, and refuses a private one", async () => {
    expect((await call("spaces-vespa-search", { filters: { channelId: { in: [ROOM, "public"] } } })).allow).toBe(true);
    expect((await call("spaces-vespa-search", { filters: { channelId: { contains: "private" } } })).allow).toBe(false);
  });

  it("keeps a room with a guest to itself: guests don't see public channels", async () => {
    guests.add(ROOM);
    expect((await call("spaces-vespa-search", { filters: { channelId: { contains: "public" } } })).allow).toBe(false);
    expect((await call("spaces-message-detail", { messageId: "in-public" })).allow).toBe(false);
    expect((await call("spaces-messages", { conversationId: "in-room" })).allow).toBe(true);
    expect((await call("spaces-vespa-search", {})).allow).toBe(true);
  });

  it("refuses a public channel in another workspace", async () => {
    expect((await call("spaces-vespa-search", { filters: { channelId: { contains: "other-workspace" } } })).allow).toBe(false);
  });

  it("refuses an exclusion filter, which would mean everywhere else", async () => {
    expect((await call("spaces-vespa-search", { filters: { channelId: { nin: [ROOM] } } })).allow).toBe(false);
  });

  it("reads threads and messages only where they live in the room or a public channel", async () => {
    expect((await call("spaces-messages", { conversationId: "in-room" })).allow).toBe(true);
    expect((await call("spaces-messages", { conversationId: "in-private" })).allow).toBe(false);
    expect((await call("spaces-message-detail", { messageId: "in-public" })).allow).toBe(true);
    expect((await call("spaces-messages", { conversationId: "unknown" })).allow).toBe(false);
  });

  it("keeps ticket lists to the room and refuses a ticket from a private channel", async () => {
    expect(await call("spaces-tickets", { status: "TODO" })).toEqual({
      allow: true,
      params: { status: "TODO", channelId: ROOM },
    });
    expect((await call("spaces-tickets", { ticketId: "T-1" })).allow).toBe(false);
  });

  it("refuses Spaces tools that read beyond what they name", async () => {
    expect((await call("spaces-canvases", { search: "payouts" })).allow).toBe(false);
    expect((await call("spaces-my-items")).allow).toBe(false);
  });

  it("allows metadata lookups", async () => {
    expect((await call("spaces-users", { name: "Tom" })).allow).toBe(true);
  });

  it("refuses everything in Spaces without a room", async () => {
    expect((await call("spaces-users", {}, { roomChannelId: "" })).allow).toBe(false);
  });
});
