/**
 * The pipeline end to end: per-chat queue → sender resolution →
 * policy → control commands → rate limit → routing → dispatch. The pieces are
 * unit-tested next door; what is pinned here is the order they run in and who
 * gets answered, which is where the behaviour people actually notice lives.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const enqueueOutbound = vi.fn(async (_accountId: string, _item: Record<string, unknown>) => undefined);
const dispatchChannelRun = vi.fn(
  async (_input: Record<string, unknown>) =>
    ({ kind: "dispatched", sessionId: "sess-1" }) as
      | { kind: "dispatched"; sessionId: string }
      | { kind: "queued"; accepted: boolean; notice: string },
);
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
vi.mock("./busy.js", () => ({ dispatchOrQueueChannelRun: dispatchChannelRun }));
vi.mock("./approvals.js", () => ({ redeemApproval: vi.fn() }));
vi.mock("./agent-tools.js", () => ({ agentActionGatesOf: () => ({ sendToOtherChats: false, reactions: true, listGroups: true }) }));
vi.mock("./identity.js", () => ({ resolveIdentity }));
vi.mock("./store.js", () => ({
  findDefaultAgent: async () => ({ agent: { id: "a1", slug: "assistant", name: "Assistant", enabled: true, config: null } }),
  findOrgAgentBySlug: async () => null,
  listOrgAgents: async () => [],
}));
vi.mock("xyne-claw-shared", () => ({
  isAgentInvocableBy: () => true,
  IMMEDIATE_TASK_COMMAND_RE: /^\/(?:explainer|record-skill|design|dashboard|spec|review|learn)(?:\s|$)/i,
}));
vi.mock("./shared-number.js", () => ({ accountForSender: async (ctx: { account: unknown }) => ctx.account }));
type Outcome = { kind: "next" } | { kind: "done"; task: string; agentSlug?: string } | { kind: "stale" };
const pendingQuestion = vi.fn(async (..._args: unknown[]) => null as Record<string, unknown> | null);
const answerPendingQuestion = vi.fn(async (..._args: unknown[]): Promise<Outcome> => ({ kind: "next" }));
const answerFromFormReply = vi.fn(async (..._args: unknown[]): Promise<Outcome> => ({ kind: "stale" }));
const clearPendingQuestion = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("./questions.js", () => ({
  pendingQuestion,
  answerPendingQuestion,
  answerFromFormReply,
  clearPendingQuestion,
  interpretTypedAnswer: (_q: unknown, text: string) => `typed:${text}`,
}));
// The shared slash-command layer (lib/webhook-commands) is exercised in its
// own tests; here only "did the chat hand the command to it" matters.
type CommandOutcome =
  | { kind: "handled" }
  | { kind: "dispatch"; task: string; compactBeforeRun: boolean; explicitQueueOnly: boolean; pendingGoalStart: { condition: string } | null };
const runChatSlashCommand = vi.fn(async (input: { text: string; account: { id: string }; target: { chatId: string } }): Promise<CommandOutcome> => {
  await enqueueOutbound(input.account.id, { kind: "text", chatId: input.target.chatId, text: `handled ${input.text}` });
  return { kind: "handled" };
});
vi.mock("./commands.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./commands.js")>()),
  runChatSlashCommand,
}));
vi.mock("../../services/goalRelooper.js", () => ({ persistGoalStart: vi.fn(async () => undefined) }));
// The connector half pulls the whole MCP catalogue in at import.
const sendConnectorLink = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("./widgets.js", () => ({ sendConnectorLink }));

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
    pendingQuestion.mockReset();
    pendingQuestion.mockResolvedValue(null);
    answerPendingQuestion.mockReset();
    answerFromFormReply.mockReset();
    clearPendingQuestion.mockClear();
    sendConnectorLink.mockClear();
    runChatSlashCommand.mockClear();
  });

  describe("with a question waiting", () => {
    const asked = { questionId: "qs", index: 0, formToken: undefined, questions: [{ id: "q1", question: "Which env?", type: "single_choice" }] };

    it("reads a typed reply as the answer and only dispatches once the set is done", async () => {
      pendingQuestion.mockResolvedValue(asked);
      answerPendingQuestion.mockResolvedValueOnce({ kind: "next" });
      await handleInbound(ctx, msg({ text: "2" }));
      await settle();
      expect(answerPendingQuestion).toHaveBeenCalledWith(asked, "typed:2");
      expect(dispatchChannelRun).not.toHaveBeenCalled();

      answerPendingQuestion.mockResolvedValueOnce({ kind: "done", task: "The user answered your questions." });
      await handleInbound(ctx, msg({ text: "prod" }));
      await settle();
      expect(dispatchChannelRun.mock.calls[0]?.[0]).toMatchObject({ task: "The user answered your questions." });
    });

    it("lets a /slug request and control commands through, clearing the questions on /new", async () => {
      pendingQuestion.mockResolvedValue(asked);
      await handleInbound(ctx, msg({ text: "/new" }));
      await settle();
      expect(clearPendingQuestion).toHaveBeenCalledWith("acc-1", "919@s.whatsapp.net", "919");
      expect(answerPendingQuestion).not.toHaveBeenCalled();
    });

    it("answers the whole set from a submitted form", async () => {
      pendingQuestion.mockResolvedValue({ ...asked, formToken: "tok" });
      answerFromFormReply.mockResolvedValueOnce({ kind: "done", task: "answers" });
      await handleInbound(ctx, msg({ text: "", formReply: { token: "tok", fields: { q0_one: "1" } } }));
      await settle();
      expect(dispatchChannelRun.mock.calls[0]?.[0]).toMatchObject({ task: "answers" });
    });

    it("drops a form submission nothing is waiting on", async () => {
      await handleInbound(ctx, msg({ text: "", formReply: { token: "old", fields: {} } }));
      await settle();
      expect(dispatchChannelRun).not.toHaveBeenCalled();
    });
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

  it("tells the person when a message waits behind a running reply", async () => {
    dispatchChannelRun.mockResolvedValueOnce({ kind: "queued", accepted: true, notice: "wrapping up first" });
    await handleInbound(ctx, msg({ text: "and the staging one?" }));
    await settle();
    const texts = enqueueOutbound.mock.calls.map((c) => c[1]).filter((item) => item["kind"] === "text");
    expect(texts).toEqual([expect.objectContaining({ text: "wrapping up first" })]);
    expect(enqueueOutbound.mock.calls.some((c) => c[1]["kind"] === "typing" && c[1]["on"] === false)).toBe(false);
    expect([...redisStore.keys()].some((k) => k.includes(":run:"))).toBe(false);
  });

  it("stops typing when a busy chat could not take the message", async () => {
    dispatchChannelRun.mockResolvedValueOnce({ kind: "queued", accepted: false, notice: "queue full" });
    await handleInbound(ctx, msg({ text: "one more" }));
    await settle();
    expect(enqueueOutbound.mock.calls.some((c) => c[1]["kind"] === "typing" && c[1]["on"] === false)).toBe(true);
    expect(enqueueOutbound.mock.calls.some((c) => c[1]["kind"] === "text" && c[1]["text"] === "queue full")).toBe(true);
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

  it("asks what to do when only tagged, without leaving typing on", async () => {
    const openGroups = {
      account: { ...(account as object), config: { label: "mine", dmPolicy: "linked", groupPolicy: "open", requireMention: true, channel: {} } },
      plugin,
    } as never;
    await handleInbound(openGroups, msg({ text: "", isGroup: true, chatId: "g@g.us", mentionedSelf: true }));
    await settle();
    expect(dispatchChannelRun).not.toHaveBeenCalled();
    const items = enqueueOutbound.mock.calls.map((c) => c[1] as { kind?: string; text?: string });
    expect(items.map((i) => i.text)).toContain("What would you like /assistant to do?");
    expect(items.some((i) => i.kind === "typing")).toBe(false);
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
    expect(runChatSlashCommand).toHaveBeenCalledWith(expect.objectContaining({ text: "/status" }));
  });

  it("hands Spaces slash commands to the shared layer instead of reading them as agent names", async () => {
    for (const text of ["/debug", "/debug all", "/help", "/stop", "/cancel", "/queue", "/goal status", "/experiment status", "/fast"]) {
      runChatSlashCommand.mockClear();
      await handleInbound(ctx, msg({ text }));
      await settle();
      expect(runChatSlashCommand, text).toHaveBeenCalledTimes(1);
    }
    expect(dispatchChannelRun).not.toHaveBeenCalled();
    const texts = enqueueOutbound.mock.calls.map((c) => (c[1] as { text?: string } | undefined)?.text ?? "");
    expect(texts.some((t) => t.includes("I don't know an agent called"))).toBe(false);
  });

  it("runs a command's task verbatim on the chat's agent, with its flags", async () => {
    runChatSlashCommand.mockResolvedValueOnce({ kind: "dispatch", task: "/design a landing page", compactBeforeRun: false, explicitQueueOnly: false, pendingGoalStart: null });
    await handleInbound(ctx, msg({ text: "/design a landing page" }));
    await settle();
    expect(dispatchChannelRun.mock.calls[0]?.[0]).toMatchObject({ task: "/design a landing page" });
    expect((dispatchChannelRun.mock.calls[0]?.[0] as { agent: { slug: string } }).agent.slug).toBe("assistant");

    runChatSlashCommand.mockResolvedValueOnce({ kind: "dispatch", task: "summarize", compactBeforeRun: true, explicitQueueOnly: false, pendingGoalStart: null });
    await handleInbound(ctx, msg({ text: "/compact" }));
    await settle();
    expect(dispatchChannelRun.mock.calls[1]?.[0]).toMatchObject({ task: "summarize", compactBeforeRun: true });
  });

  it("still routes /slug messages to that agent", async () => {
    await handleInbound(ctx, msg({ text: "/someone do a thing" }));
    await settle();
    expect(runChatSlashCommand).not.toHaveBeenCalledWith(expect.objectContaining({ text: "/someone do a thing" }));
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
