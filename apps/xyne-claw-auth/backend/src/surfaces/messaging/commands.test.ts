import { describe, expect, it, vi } from "vitest";

vi.mock("../../config.js", () => ({ CONFIG: { internalUrl: "http://localhost", xyneClawS2sKey: "k" } }));
vi.mock("../../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
const store = new Map<string, string>();
vi.mock("../../redis.js", () => ({
  redisService: {
    getConnection: () => ({
      get: async (k: string) => store.get(k) ?? null,
      set: async (k: string, v: string) => {
        store.set(k, v);
        return "OK";
      },
      del: async (k: string) => (store.delete(k) ? 1 : 0),
    }),
  },
}));
vi.mock("xyne-claw-shared", () => ({
  IMMEDIATE_TASK_COMMAND_RE: /^\/(?:explainer|record-skill|design|dashboard|spec|review|learn)(?:\s|$)/i,
}));
const enqueueOutbound = vi.fn(async (..._args: unknown[]) => undefined);
const typingCancelled = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("./delivery.js", () => ({ enqueueOutbound, typingCancelled }));
const handleWebhookCommands = vi.fn();
vi.mock("../../lib/webhook-commands/index.js", () => ({ handleWebhookCommands }));
const reconcileStoppedRuns = vi.fn();
vi.mock("../../routes/webhook.js", () => ({ reconcileStoppedRuns }));
const sendGeneratedFile = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("./hosted-files.js", () => ({ sendGeneratedFile }));

const { parseControlCommand, describeElapsed, isSlashCommand, rememberChatTarget, chatTargetFor, runChatSlashCommand } =
  await import("./commands.js");

describe("parseControlCommand", () => {
  it("recognises the three commands and their aliases", () => {
    expect(parseControlCommand("/new")).toBe("new");
    expect(parseControlCommand("/reset")).toBe("new");
    // `/clear` is what Spaces calls it; one thing should not have two names.
    expect(parseControlCommand("/clear")).toBe("new");
    expect(parseControlCommand("/stop")).toBe("stop");
    expect(parseControlCommand("/cancel")).toBe("stop");
    expect(parseControlCommand("/abort")).toBe("stop");
    expect(parseControlCommand("/status")).toBe("status");
  });

  it("accepts odd spacing and case", () => {
    expect(parseControlCommand("  /stop  ")).toBe("stop");
    expect(parseControlCommand("/STATUS")).toBe("status");
  });

  it("reads a leading @ as a mention of a person, not a command", () => {
    expect(parseControlCommand("@stop")).toBeNull();
  });

  it("leaves anything with an argument alone", () => {
    // "/new ticket for the outage" is a request, not a command.
    expect(parseControlCommand("/new ticket for the outage")).toBeNull();
    expect(parseControlCommand("/stop the deploy")).toBeNull();
  });

  it("is not fooled by a word that merely contains one", () => {
    expect(parseControlCommand("stop")).toBeNull();
    expect(parseControlCommand("/newsletter")).toBeNull();
    expect(parseControlCommand("can you /stop")).toBeNull();
  });
});

describe("describeElapsed", () => {
  it("reads as a person would say it", () => {
    expect(describeElapsed(Date.now() - 1_000)).toBe("1 second");
    expect(describeElapsed(Date.now() - 40_000)).toBe("40 seconds");
    // Seconds stay seconds up to 90, so "2 minutes" never means 91 seconds.
    expect(describeElapsed(Date.now() - 60_000)).toBe("60 seconds");
    expect(describeElapsed(Date.now() - 120_000)).toBe("2 minutes");
    expect(describeElapsed(Date.now() - 180_000)).toBe("3 minutes");
  });
});

describe("isSlashCommand", () => {
  it("knows the Spaces commands, the /experiment family and claw's task commands", () => {
    for (const text of ["/debug", "/debug all", "/debug chain", "/status", "/help", "/stop", "/clear", "/compact keep the API notes",
      "/queue", "/queue clear", "/queue later please", "/goal tests pass", "/goal status", "/fast", "/fast off", "/fast check prod",
      "/eval what is 2+2", "/experiment 2h focus", "/understanding the auth flow", "/design a landing page", "/spec ENG-12"]) {
      expect(isSlashCommand(text), text).toBe(true);
    }
  });

  it("leaves agent routes and prose alone", () => {
    for (const text of ["/pr-bot review this", "/standup", "hello", "check the /debug endpoint please", "/designer make it pop"]) {
      expect(isSlashCommand(text), text).toBe(false);
    }
  });
});

const target = {
  channel: "whatsapp-cloud" as const,
  connectedSurfaceId: "acc",
  accountKey: "acct_1",
  chatId: "919",
  senderId: "919",
  isGroup: false,
  quoted: { chatId: "919", messageId: "wamid.1" },
  statusReactions: true,
};

describe("chat targets", () => {
  it("remembers where a conversation answers, without the message that started it", async () => {
    await rememberChatTarget("whatsapp-cloud-acct_1-assistant-919", target);
    const found = await chatTargetFor("whatsapp-cloud-acct_1-assistant-919");
    expect(found).toEqual({ channel: "whatsapp-cloud", connectedSurfaceId: "acc", accountKey: "acct_1", chatId: "919", senderId: "919", isGroup: false });
    expect(await chatTargetFor("unknown")).toBeNull();
    expect(await chatTargetFor(undefined)).toBeNull();
  });
});

describe("runChatSlashCommand", () => {
  const account = { id: "acc", orgId: "org", channel: "whatsapp-cloud", accountKey: "acct_1" } as never;
  const agent = { id: "a1", slug: "assistant", name: "Assistant", orgId: "org", config: { autoGoal: true }, enabled: true, delegationTier: "standard" };

  it("runs the shared handlers against the chat's conversation, answering into the chat", async () => {
    handleWebhookCommands.mockImplementationOnce(async (ctx: Record<string, unknown>) => {
      await (ctx["reply"] as (t: string, l: string) => Promise<void>)("**Debug trace** — …", "label");
      await (ctx["attach"] as (f: unknown) => Promise<void>)({ fileName: "debug.html", mimeType: "text/html", content: "<html/>", summary: "trace" });
      return { kind: "handled" };
    });
    const out = await runChatSlashCommand({ account, target, userId: "u1", agent, text: " /debug " });
    expect(out).toEqual({ kind: "handled" });
    const ctx = handleWebhookCommands.mock.calls[0]![0] as Record<string, unknown>;
    expect(ctx).toMatchObject({
      payload: { conversationId: "whatsapp-cloud-acct_1-assistant-919", channelId: "919", userId: "u1" },
      userText: "/debug",
      autoGoalEnabled: true,
      isTwin: false,
      channelDelivery: target,
      agent: { id: "a1", slug: "assistant", orgId: "org", appToken: "" },
    });
    expect(enqueueOutbound).toHaveBeenCalledWith("acc", { kind: "text", chatId: "919", text: "**Debug trace** — …" });
    expect(sendGeneratedFile).toHaveBeenCalledWith(target, expect.objectContaining({ fileName: "debug.html" }));
    // Remembered before the command ran, so what it starts can find the chat.
    expect((await chatTargetFor("whatsapp-cloud-acct_1-assistant-919"))?.chatId).toBe("919");
  });

  it("treats /cancel as /stop and switches typing off afterwards", async () => {
    handleWebhookCommands.mockResolvedValueOnce({ kind: "handled" });
    enqueueOutbound.mockClear();
    await runChatSlashCommand({ account, target, userId: "u1", agent, text: "/cancel" });
    expect((handleWebhookCommands.mock.calls.at(-1)![0] as { userText: string }).userText).toBe("/stop");
    expect(typingCancelled).toHaveBeenCalledWith("acc", "919");
    expect(enqueueOutbound).toHaveBeenCalledWith("acc", { kind: "typing", chatId: "919", on: false });
  });

  it("passes a dispatch back with its flags", async () => {
    handleWebhookCommands.mockResolvedValueOnce({
      kind: "dispatch",
      task: "The user ran /compact.",
      compactBeforeRun: true,
      explicitQueueOnly: false,
      pendingGoalStart: null,
    });
    expect(await runChatSlashCommand({ account, target, userId: "u1", agent, text: "/compact" })).toEqual({
      kind: "dispatch",
      task: "The user ran /compact.",
      compactBeforeRun: true,
      explicitQueueOnly: false,
      pendingGoalStart: null,
    });
  });
});

