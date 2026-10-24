import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
const redis = {
  get: vi.fn(async (key: string) => store.get(key) ?? null),
  set: vi.fn(async (key: string, value: string) => {
    store.set(key, value);
    return "OK";
  }),
  del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
};
const spacesAppFetch = vi.fn(async (_path: string, _body: Record<string, unknown>, _token?: string): Promise<unknown> => ({}));
const findUnique = vi.fn(async (_args: unknown): Promise<unknown> => ({ spacesAppToken: "enc-token", spacesAppUserId: "bot-1" }));

vi.mock("../redis.js", () => ({ redisService: { getConnection: () => redis } }));
vi.mock("../db.js", () => ({ prisma: { agent: { findUnique } } }));
vi.mock("../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("../surfaces/spaces/client.js", () => ({
  spacesAppFetch,
  decryptStoredField: (value: string) => `dec:${value}`,
}));
vi.mock("./message-queue.js", () => ({ QUEUE_CAP: 10 }));

const {
  droppedNoticeText,
  postDroppedNotice,
  publishQueueNotice,
  queueEventFor,
  queueNoticeTargetFor,
  queueNoticeText,
  refreshQueueNotice,
} = await import("./queue-notice.js");

const target = {
  conversationId: "conv-1",
  agentSlug: "xyne",
  channelId: "ch-1",
  orgId: "org-1",
  spacesAppUserId: "bot-1",
  appToken: "tok",
};

const calls = (path: string) => spacesAppFetch.mock.calls.filter(([p]) => p === path);

beforeEach(() => {
  store.clear();
  spacesAppFetch.mockReset();
  spacesAppFetch.mockImplementation(async (path: string) => (path === "/chat/postMessage" ? { messageId: "notice-1" } : {}));
  findUnique.mockClear();
});

describe("queueNoticeText", () => {
  it("counts what is waiting and promises in-order replies", () => {
    expect(queueNoticeText({ kind: "queued", depth: 1 })).toBe(
      "_**Queued (1).** I'll reply to it as soon as the current reply is done._",
    );
    expect(queueNoticeText({ kind: "queued", depth: 3 })).toContain("**Queued (3).** I'll reply to each one, in order,");
    expect(queueNoticeText({ kind: "queued", depth: 2, interrupted: true })).toContain("Finishing the current reply first");
  });

  it("says when the latest message could not be queued", () => {
    const full = queueNoticeText({ kind: "queued", depth: 10, rejected: "full" });
    expect(full).toContain("**Queued (10).**");
    expect(full).toContain("queue is full at 10");
    expect(queueNoticeText({ kind: "queued", depth: 0, rejected: "failed" })).toBe(
      "_Your latest message could not be queued. Please resend it in a moment._",
    );
  });

  it("closes the notice when the queue drains or is cleared", () => {
    expect(queueNoticeText({ kind: "drained" })).toBe("_**Queue done.** Every queued message has been picked up._");
    expect(queueNoticeText({ kind: "cleared", discarded: 2 })).toBe("_**Queue cleared.** 2 queued messages will not be answered._");
    expect(queueNoticeText({ kind: "cleared", discarded: 0 })).toBe("_**Queue cleared.**_");
  });

  it("maps an enqueue result to the notice event", () => {
    expect(queueEventFor({ enqueued: true, position: 2, deduped: false, full: false }, false)).toEqual({ kind: "queued", depth: 2, interrupted: false });
    expect(queueEventFor({ enqueued: false, position: 2, deduped: true, full: false }, false)).toEqual({ kind: "queued", depth: 2, interrupted: false });
    expect(queueEventFor({ enqueued: false, position: 10, deduped: false, full: true }, false)).toEqual({ kind: "queued", depth: 10, rejected: "full" });
    expect(queueEventFor({ enqueued: false, position: 0, deduped: false, full: false }, false)).toEqual({ kind: "queued", depth: 0, rejected: "failed" });
  });

  it("words the dropped notice for one or many", () => {
    expect(droppedNoticeText(1, "It could not be started.")).toBe("_**A queued message was dropped.** It could not be started. Please resend it._");
    expect(droppedNoticeText(3, "The run failed.")).toBe("_**3 queued messages were dropped.** The run failed. Please resend them._");
  });
});

describe("publishQueueNotice", () => {
  it("posts one notice per conversation and edits it as more messages queue", async () => {
    await publishQueueNotice(target, { kind: "queued", depth: 1 });
    await publishQueueNotice(target, { kind: "queued", depth: 2 });
    await publishQueueNotice(target, { kind: "queued", depth: 3 });

    expect(calls("/chat/postMessage")).toHaveLength(1);
    expect(calls("/chat/postMessage")[0]![1]).toMatchObject({ channelId: "ch-1", conversationId: "conv-1", userId: "bot-1" });
    const edits = calls("/chat/updateMessage");
    expect(edits).toHaveLength(2);
    expect(edits[1]![1]).toMatchObject({ messageId: "notice-1", channelId: "ch-1", userId: "bot-1" });
    expect(String(edits[1]![1]["markdownText"])).toContain("Queued (3)");
  });

  it("keeps notices separate per conversation and per agent", async () => {
    await publishQueueNotice(target, { kind: "queued", depth: 1 });
    await publishQueueNotice({ ...target, conversationId: "conv-2" }, { kind: "queued", depth: 1 });
    await publishQueueNotice({ ...target, agentSlug: "other" }, { kind: "queued", depth: 1 });
    expect(calls("/chat/postMessage")).toHaveLength(3);
  });

  it("posts a fresh notice when the old one can no longer be edited", async () => {
    await publishQueueNotice(target, { kind: "queued", depth: 1 });
    spacesAppFetch.mockImplementation(async (path: string) => {
      if (path === "/chat/updateMessage") throw new Error("message deleted");
      return { messageId: "notice-2" };
    });
    await publishQueueNotice(target, { kind: "queued", depth: 2 });
    expect(calls("/chat/postMessage")).toHaveLength(2);
    expect([...store.values()].join()).toContain("notice-2");
  });

  it("never throws when Spaces is down", async () => {
    spacesAppFetch.mockRejectedValue(new Error("down"));
    await expect(publishQueueNotice(target, { kind: "queued", depth: 1 })).resolves.toBeUndefined();
  });
});

describe("refreshQueueNotice", () => {
  const scope = { conversationId: "conv-1", agentSlug: "xyne" };

  it("does nothing when the conversation has no notice", async () => {
    await refreshQueueNotice(scope, { kind: "drained" });
    expect(spacesAppFetch).not.toHaveBeenCalled();
  });

  it("edits the notice as the queue drains, using the agent's own token", async () => {
    await publishQueueNotice(target, { kind: "queued", depth: 2 });
    await refreshQueueNotice(scope, { kind: "queued", depth: 1 });
    const edit = calls("/chat/updateMessage").at(-1)!;
    expect(edit[2]).toBe("dec:enc-token");
    expect(edit[1]).toMatchObject({ messageId: "notice-1", userId: "bot-1" });
    expect(String(edit[1]["markdownText"])).toContain("Queued (1)");
    expect(findUnique).toHaveBeenCalledWith({
      where: { orgId_slug: { orgId: "org-1", slug: "xyne" } },
      select: { spacesAppToken: true },
    });
  });

  it("marks the notice done when the queue empties and starts a new one next time", async () => {
    await publishQueueNotice(target, { kind: "queued", depth: 1 });
    await refreshQueueNotice(scope, { kind: "drained" });
    expect(String(calls("/chat/updateMessage").at(-1)![1]["markdownText"])).toContain("Queue done.");
    expect(store.size).toBe(0);

    await publishQueueNotice(target, { kind: "queued", depth: 1 });
    expect(calls("/chat/postMessage")).toHaveLength(2);
  });

  it("forgets a notice it can no longer edit", async () => {
    await publishQueueNotice(target, { kind: "queued", depth: 2 });
    spacesAppFetch.mockRejectedValue(new Error("gone"));
    await refreshQueueNotice(scope, { kind: "queued", depth: 1 });
    expect(store.size).toBe(0);
  });
});

describe("postDroppedNotice", () => {
  it("posts a separate, explicit notice for dropped messages", async () => {
    await postDroppedNotice(target, 1, "It could not be started after the previous reply finished.");
    const post = calls("/chat/postMessage")[0]!;
    expect(post[1]).toMatchObject({ channelId: "ch-1", conversationId: "conv-1", userId: "bot-1" });
    expect(String(post[1]["markdownText"])).toContain("A queued message was dropped.");
  });

  it("stays quiet when nothing was dropped", async () => {
    await postDroppedNotice(target, 0, "n/a");
    expect(spacesAppFetch).not.toHaveBeenCalled();
  });
});

describe("queueNoticeTargetFor", () => {
  const msg = {
    eventId: "e1",
    conversationId: "conv-1",
    channelId: "ch-1",
    userId: "u1",
    agentSlug: "xyne",
    orgId: "org-1",
    task: "hi",
    eventType: "APP_MENTIONED",
    ts: 0,
  };

  it("uses the identity a replayable message already carries", async () => {
    const t = await queueNoticeTargetFor({ ...msg, sessionContext: { appToken: "ctx-token", spacesAppUserId: "ctx-bot" } });
    expect(t).toMatchObject({ appToken: "ctx-token", spacesAppUserId: "ctx-bot", channelId: "ch-1" });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("looks the agent up otherwise, and gives up without an org", async () => {
    expect(await queueNoticeTargetFor(msg)).toMatchObject({ appToken: "dec:enc-token", spacesAppUserId: "bot-1", orgId: "org-1" });
    const { orgId: _orgId, ...withoutOrg } = msg;
    expect(await queueNoticeTargetFor(withoutOrg)).toBeNull();
  });
});
