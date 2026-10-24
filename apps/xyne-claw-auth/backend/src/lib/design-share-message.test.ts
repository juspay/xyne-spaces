import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
const redis = {
  get: vi.fn(async (key: string) => store.get(key) ?? null),
  set: vi.fn(async (key: string, value: string) => {
    store.set(key, value);
    return "OK";
  }),
};
const spacesAppFetch = vi.fn(async (_path: string, _body: Record<string, unknown>, _token?: string): Promise<unknown> => ({}));

vi.mock("../redis.js", () => ({ redisService: { getConnection: () => redis } }));
vi.mock("../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("../surfaces/spaces/client.js", () => ({ spacesAppFetch }));

const { designShareMessageText, publishDesignShareMessage } = await import("./design-share-message.js");

const target = { channelId: "ch-1", conversationId: "conv-1", spacesAppUserId: "bot-1", appToken: "tok" };
const share = { id: "share-1", link: "https://spaces.local/s/abc", command: "design" };
const calls = (path: string) => spacesAppFetch.mock.calls.filter(([p]) => p === path);
let posted = 0;

beforeEach(() => {
  store.clear();
  posted = 0;
  spacesAppFetch.mockReset();
  spacesAppFetch.mockImplementation(async (path: string) => (path === "/chat/postMessage" ? { messageId: `msg-${++posted}` } : {}));
});

describe("designShareMessageText", () => {
  it("keeps the original wording for the first revision", () => {
    expect(designShareMessageText("design", share.link, 1, new Date())).toBe(
      `**Live design:** ${share.link}\nOpens the rendered snapshot in the browser — the same link updates with future revisions in this thread.`,
    );
  });

  it("adds the revision number and the update time after that", () => {
    const text = designShareMessageText("dashboard", share.link, 3, new Date("2026-10-22T12:05:00Z"));
    expect(text).toContain(`**Live dashboard · revision 3:** ${share.link}`);
    expect(text).toContain("Updated 22 Oct, 12:05 UTC.");
  });
});

describe("publishDesignShareMessage", () => {
  it("posts once, then edits the same message on every revision", async () => {
    expect(await publishDesignShareMessage(target, share, new Date("2026-10-22T12:00:00Z"))).toBe("posted");
    expect(await publishDesignShareMessage(target, share, new Date("2026-10-22T12:10:00Z"))).toBe("edited");
    expect(await publishDesignShareMessage(target, share, new Date("2026-10-22T12:20:00Z"))).toBe("edited");

    expect(calls("/chat/postMessage")).toHaveLength(1);
    const edits = calls("/chat/updateMessage");
    expect(edits).toHaveLength(2);
    expect(edits[1]![1]).toMatchObject({ messageId: "msg-1", channelId: "ch-1", userId: "bot-1" });
    expect(String(edits[1]![1]["markdownText"])).toContain("revision 3");
    expect(String(edits[1]![1]["markdownText"])).toContain("12:20 UTC");
  });

  it("keeps separate messages per thread", async () => {
    await publishDesignShareMessage(target, share);
    await publishDesignShareMessage({ ...target, conversationId: "conv-2" }, share);
    expect(calls("/chat/postMessage")).toHaveLength(2);
  });

  it("posts a fresh message, and keeps counting, when the old one can't be edited", async () => {
    await publishDesignShareMessage(target, share);
    spacesAppFetch.mockImplementation(async (path: string) => {
      if (path === "/chat/updateMessage") throw new Error("deleted");
      return { messageId: `msg-${++posted}` };
    });
    expect(await publishDesignShareMessage(target, share)).toBe("posted");
    expect(String(calls("/chat/postMessage").at(-1)![1]["markdownText"])).toContain("revision 2");
    expect(JSON.parse([...store.values()][0]!)).toMatchObject({ messageId: "msg-2", revision: 2 });
  });
});
