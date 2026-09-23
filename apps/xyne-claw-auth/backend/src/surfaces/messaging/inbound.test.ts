/**
 * The pipeline end to end: per-chat queue → sender resolution →
 * policy → control commands → rate limit → routing → dispatch. The pieces are
 * unit-tested next door; what is pinned here is the order they run in and who
 * gets answered, which is where the behaviour people actually notice lives.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const enqueueOutbound = vi.fn(async (_accountId: string, _item: Record<string, unknown>) => undefined);
const dispatchChannelRun = vi.fn(async (_input: Record<string, unknown>) => "sess-1");
const resolveIdentity = vi.fn(async (_input: Record<string, unknown>) => "user-1" as string | null);
const redisStore = new Map<string, string>();

vi.mock("../../config.js", () => ({ CONFIG: { internalUrl: "http://localhost", xyneClawS2sKey: "" } }));
vi.mock("../../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("../../redis.js", () => ({
  redisService: {
    getConnection: () => ({
      set: async (k: string, v: string, ..._rest: unknown[]) => {
        const existed = redisStore.has(k);
        redisStore.set(k, v);
        // Emulates SET NX: the dedupe and notice guards rely on it.
        return existed && _rest.includes("NX") ? null : "OK";
      },
      get: async (k: string) => redisStore.get(k) ?? null,
      del: async (k: string) => redisStore.delete(k),
      incr: async (k: string) => {
        const n = Number(redisStore.get(k) ?? 0) + 1;
        redisStore.set(k, String(n));
        return n;
      },
      expire: async () => 1,
      lrange: async () => [],
      ltrim: async () => undefined,
    }),
  },
}));
vi.mock("./delivery.js", () => ({
  enqueueOutbound,
  typingStarted: vi.fn(async () => undefined),
  typingFinished: vi.fn(async () => true),
  typingCancelled: vi.fn(async () => undefined),
}));
// Mocked outright, not partially: dispatch.ts reaches object storage at import
// time, which a unit test has no business standing up.
vi.mock("./dispatch.js", () => ({ dispatchChannelRun }));
vi.mock("./approvals.js", () => ({ redeemApproval: vi.fn() }));
vi.mock("./agent-tools.js", () => ({ agentActionGatesOf: () => ({ sendToOtherChats: false, reactions: true, listGroups: true }) }));
vi.mock("./identity.js", () => ({ resolveIdentity }));
vi.mock("./store.js", () => ({
  findDefaultAgent: async () => ({ agent: { id: "a1", slug: "assistant", name: "Assistant", enabled: true, config: null } }),
  findOrgAgentBySlug: async () => null,
  listOrgAgents: async () => [],
}));
vi.mock("xyne-claw-shared", () => ({ isAgentInvocableBy: () => true }));

const { handleInbound } = await import("./inbound.js");

const account = {
  id: "acc-1",
  orgId: "org-1",
  surfaceId: "whatsapp",
  accountKey: "acct_1",
  channel: "whatsapp",
  config: { label: "mine", dmPolicy: "linked", requireMention: false, channel: {} },
} as never;

const plugin = {
  key: "whatsapp",
  accountScope: "user",
  capabilities: { groups: true, reactions: true, typing: true, media: true, maxTextChars: 4000 },
} as never;

const ctx = { account, plugin } as never;

const msg = (over: Record<string, unknown> = {}) =>
  ({
    messageId: `m-${Math.random()}`,
    chatId: "919@s.whatsapp.net",
    senderId: "919",
    text: "hello",
    isGroup: false,
    mentionedSelf: false,
    replyToSelf: false,
    ref: { chatId: "919@s.whatsapp.net", messageId: "m" },
    ...over,
  }) as never;

/** Let the queued turn settle. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(1000);
  await vi.advanceTimersByTimeAsync(0);
}

describe("handleInbound", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    redisStore.clear();
    enqueueOutbound.mockClear();
    dispatchChannelRun.mockClear();
    resolveIdentity.mockClear();
    resolveIdentity.mockResolvedValue("user-1");
  });

  it("dispatches without waiting", async () => {
    await handleInbound(ctx, msg({ text: "what is the deploy status" }));
    // Deliberately no timer advance: the message must be on its way already.
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatchChannelRun).toHaveBeenCalledTimes(1);
  });

  it("dispatches a linked sender's message", async () => {
    await handleInbound(ctx, msg({ text: "what is the deploy status" }));
    await settle();
    expect(dispatchChannelRun).toHaveBeenCalledTimes(1);
    expect(dispatchChannelRun.mock.calls[0]?.[0]).toMatchObject({
      userId: "user-1",
      task: "what is the deploy status",
    });
  });

  it("answers three quick lines as three turns, in order", async () => {
    // Each line is its own run, so none of them sees the others. What the
    // per-chat queue guarantees is the ORDER, not that they are merged.
    await handleInbound(ctx, msg({ text: "hey" }));
    await handleInbound(ctx, msg({ text: "check the deploy" }));
    await handleInbound(ctx, msg({ text: "the staging one" }));
    await settle();
    expect(dispatchChannelRun).toHaveBeenCalledTimes(3);
    expect(dispatchChannelRun.mock.calls.map((c) => (c[0] as { task: string }).task)).toEqual([
      "hey",
      "check the deploy",
      "the staging one",
    ]);
  });

  it("ignores its own echo and an empty message", async () => {
    await handleInbound(ctx, msg({ fromSelf: true, text: "my own reply" }));
    await handleInbound(ctx, msg({ text: "   " }));
    await settle();
    expect(dispatchChannelRun).not.toHaveBeenCalled();
  });

  it("handles the same message id only once", async () => {
    const duplicate = msg({ messageId: "same", text: "hello" });
    await handleInbound(ctx, duplicate);
    await handleInbound(ctx, duplicate);
    await settle();
    expect(dispatchChannelRun).toHaveBeenCalledTimes(1);
  });

  it("stays silent to an unlinked stranger on a personal number", async () => {
    resolveIdentity.mockResolvedValue(null);
    await handleInbound(ctx, msg({ text: "hi" }));
    await settle();
    expect(dispatchChannelRun).not.toHaveBeenCalled();
    const texts = enqueueOutbound.mock.calls.map((c) => (c[1] as { text?: string } | undefined)?.text);
    expect(texts.some((t) => t?.includes("isn't linked"))).toBe(false);
  });

  it("starts typing before paying for the attachment, not after", async () => {
    // A slow download used to happen first, so nothing showed until it was
    // done — exactly the wait that needs a signal.
    const order: string[] = [];
    const loadAttachments = vi.fn(async () => {
      order.push("download");
      return [];
    });
    enqueueOutbound.mockImplementation(async (_a: string, item: Record<string, unknown>) => {
      if (item["kind"] === "typing" && item["on"] === true) order.push("typing");
      return undefined;
    });
    await handleInbound(ctx, msg({ text: "read this", loadAttachments }));
    await settle();
    expect(order).toEqual(["typing", "download"]);
    enqueueOutbound.mockImplementation(async () => undefined);
  });

  it("acknowledges before dispatching, so the sender sees it landed", async () => {
    await handleInbound(ctx, msg({ text: "find the runbook" }));
    await settle();
    const kinds = enqueueOutbound.mock.calls.map((c) => (c[1] as { kind?: string } | undefined)?.kind);
    expect(kinds).toContain("typing");
    expect(kinds).toContain("react");
  });

  it("answers /status without starting a run", async () => {
    await handleInbound(ctx, msg({ text: "/status" }));
    await settle();
    expect(dispatchChannelRun).not.toHaveBeenCalled();
    const texts = enqueueOutbound.mock.calls.map((c) => (c[1] as { text?: string } | undefined)?.text);
    expect(texts.some((t) => t?.includes("Nothing running"))).toBe(true);
  });

  it("does not make a control command wait out the debounce", async () => {
    await handleInbound(ctx, msg({ text: "/status" }));
    // No timer advance at all: it should already have been answered.
    await vi.advanceTimersByTimeAsync(0);
    expect(enqueueOutbound).toHaveBeenCalled();
  });

  it("stops answering past the rate limit, and says so once", async () => {
    for (let i = 0; i < 14; i++) {
      await handleInbound(ctx, msg({ messageId: `burst-${i}`, text: `line ${i}` }));
      await settle();
    }
    expect(dispatchChannelRun).toHaveBeenCalledTimes(10);
    const throttled = enqueueOutbound.mock.calls
      .map((c) => (c[1] as { text?: string } | undefined)?.text)
      .filter((t) => t?.includes("That's a lot at once"));
    expect(throttled).toHaveLength(1);
  });

  it("asks the channel who the sender really is, once the chat is answerable", async () => {
    const resolveSenderId = vi.fn(async () => "919888");
    await handleInbound(ctx, msg({ text: "hello", resolveSenderId }));
    await settle();
    expect(resolveSenderId).toHaveBeenCalledTimes(1);
    expect(resolveIdentity.mock.calls[0]?.[0]).toMatchObject({ senderId: "919888" });
  });

  it("does not look the sender up in a group it ignores", async () => {
    const resolveSenderId = vi.fn(async () => "919888");
    await handleInbound(ctx, msg({ isGroup: true, chatId: "120@g.us", text: "chatter", resolveSenderId }));
    await settle();
    expect(resolveSenderId).not.toHaveBeenCalled();
    expect(dispatchChannelRun).not.toHaveBeenCalled();
  });

  it("does not download a photo it is going to ignore", async () => {
    const loadAttachments = vi.fn(async () => []);
    await handleInbound(ctx, msg({ isGroup: true, chatId: "120@g.us", text: "", loadAttachments }));
    await settle();
    expect(loadAttachments).not.toHaveBeenCalled();
  });
});
