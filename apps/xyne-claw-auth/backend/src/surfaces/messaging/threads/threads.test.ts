import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

// state.ts pulls in redis → config, which read required env at import time.
// The pure helpers under test touch neither, so stub the import chain.
vi.mock("../../../config.js", () => ({ CONFIG: {} }));
vi.mock("../../../redis.js", () => ({ redisService: { getConnection: () => ({}) } }));
vi.mock("../../../logger.js", () => ({ createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) }));

// The orchestrator's collaborators, so its routing can be read off the dispatches.
type Dispatched = { task: string; conversationId: string };
const dispatchOrQueueChannelRun = vi.fn(async (_input: Dispatched) => ({ kind: "dispatched" as const, sessionId: "s1" }));
vi.mock("../busy.js", () => ({ dispatchOrQueueChannelRun }));
const isSlotBusy = vi.fn(async (..._args: unknown[]) => false);
vi.mock("../../../lib/message-queue.js", () => ({ isSlotBusy }));
vi.mock("../commands.js", () => ({ rememberActiveRun: vi.fn(async () => undefined) }));
vi.mock("../delivery.js", () => ({ enqueueOutbound: vi.fn(async () => undefined) }));
const planInbound = vi.fn();
vi.mock("./planner.js", () => ({ planInbound }));
type Task = { conversationId: string; agentSlug: string; label: string; originMessageId: string; createdAt: number };
const openTasks = vi.fn(async (..._args: unknown[]): Promise<Task[]> => []);
vi.mock("./registry.js", () => ({ openTasks, createTask: vi.fn(async () => undefined), taskForReply: vi.fn(async () => null) }));

const { threadsEnabled } = await import("./config.js");
const { taskConversationId, channelConversationId } = await import("../ids.js");
const { renderStateBlock } = await import("./state.js");
const { handleThreaded, taskText } = await import("./orchestrator.js");

const ENV = process.env["WA_CONCURRENT_THREADS"];
afterEach(() => {
  if (ENV === undefined) delete process.env["WA_CONCURRENT_THREADS"];
  else process.env["WA_CONCURRENT_THREADS"] = ENV;
});

const account = { id: "acc_123", accountKey: "15551234567" };

describe("threadsEnabled", () => {
  it("is off by default", () => {
    delete process.env["WA_CONCURRENT_THREADS"];
    expect(threadsEnabled(account)).toBe(false);
  });
  it("is off for explicit off/false/0/empty", () => {
    for (const v of ["off", "false", "0", ""]) {
      process.env["WA_CONCURRENT_THREADS"] = v;
      expect(threadsEnabled(account)).toBe(false);
    }
  });
  it("is on for on/all/true/1", () => {
    for (const v of ["on", "all", "true", "1", "ON"]) {
      process.env["WA_CONCURRENT_THREADS"] = v;
      expect(threadsEnabled(account)).toBe(true);
    }
  });
  it("matches a specific account id or key in a list", () => {
    process.env["WA_CONCURRENT_THREADS"] = "other,15551234567";
    expect(threadsEnabled(account)).toBe(true);
    process.env["WA_CONCURRENT_THREADS"] = "ACC_123";
    expect(threadsEnabled(account)).toBe(true);
    process.env["WA_CONCURRENT_THREADS"] = "someone-else";
    expect(threadsEnabled(account)).toBe(false);
  });
});

describe("taskConversationId", () => {
  it("extends the chat conversation id with a sanitized task discriminator", () => {
    const base = channelConversationId("whatsapp-cloud", "15551234567", "concierge", "chat-1");
    const task = taskConversationId("whatsapp-cloud", "15551234567", "concierge", "chat-1", "ab/cd 12");
    expect(task.startsWith(`${base}-t-`)).toBe(true);
    expect(task).toBe(`${base}-t-ab_cd_12`);
  });
  it("gives distinct ids for distinct tasks in the same chat", () => {
    const a = taskConversationId("whatsapp-cloud", "k", "s", "chat", "t1");
    const b = taskConversationId("whatsapp-cloud", "k", "s", "chat", "t2");
    expect(a).not.toBe(b);
  });
});

describe("renderStateBlock", () => {
  it("is empty when nothing is known", () => {
    expect(renderStateBlock({ slots: {}, updatedAt: 0 })).toBe("");
  });
  it("lists the known facts for the model", () => {
    const block = renderStateBlock({ slots: { destination: "Kolkata", date: "tomorrow" }, updatedAt: 1 });
    expect(block).toContain("destination: Kolkata");
    expect(block).toContain("date: tomorrow");
  });
});

describe("taskText", () => {
  it("keeps the person's words, unrewritten, when the run has the chat's history", () => {
    expect(taskText("What is 10 + 10", "20", { split: false, hasHistory: true })).toBe("What is 10 + 10");
  });
  it("adds the planner's reading only as a hint to a run that starts without history", () => {
    const text = taskText("also hotels", "find hotels in Kolkata from tomorrow", { split: false, hasHistory: false });
    expect(text.startsWith("also hotels\n\n")).toBe(true);
    expect(text).toContain("find hotels in Kolkata from tomorrow");
    expect(text).toContain("go by the message");
  });
  it("tells each run of a split message which part is its own", () => {
    const text = taskText("flights to Goa and a cab", "book a cab", { split: true, hasHistory: true });
    expect(text.startsWith("flights to Goa and a cab\n\n")).toBe(true);
    expect(text).toContain("only this part of that message: book a cab");
    expect(text).toContain("book a cab");
  });
  it("adds nothing when the reading is empty or says the same", () => {
    expect(taskText("hi", "  ", { split: true, hasHistory: false })).toBe("hi");
    expect(taskText("hi", "hi", { split: false, hasHistory: false })).toBe("hi");
  });
});

describe("handleThreaded", () => {
  const home = channelConversationId("whatsapp-cloud", "15550001111", "concierge", "chat-1");
  const args = (rawTask: string) =>
    ({
      plugin: { capabilities: { concurrentThreads: { maxParallel: 3 } } },
      account: { id: "acc-1", channel: "whatsapp-cloud", accountKey: "15550001111" },
      agent: { slug: "concierge", orgId: "org-1" },
      userId: "u1",
      msg: { chatId: "chat-1", messageId: "m1", isGroup: false, ref: { chatId: "chat-1", messageId: "m1" } },
      rawTask,
      contextBlock: "",
      target: { channel: "whatsapp-cloud", connectedSurfaceId: "acc-1", chatId: "chat-1", senderId: "s1" },
    }) as never;
  const dispatched = () => dispatchOrQueueChannelRun.mock.calls.map((call) => call[0]);

  beforeEach(() => {
    dispatchOrQueueChannelRun.mockClear();
    isSlotBusy.mockResolvedValue(false);
    openTasks.mockResolvedValue([]);
  });

  it("sends the person's own words into the chat's conversation when it is free", async () => {
    planInbound.mockResolvedValue({ slots: {}, actions: [{ request: "20", label: "math", continueIndex: null }] });
    await handleThreaded(args("What is 10 + 10"));
    expect(dispatched()).toEqual([expect.objectContaining({ conversationId: home, task: "What is 10 + 10" })]);
  });

  it("forks a task conversation only while the chat's own is busy, with the reading as a hint", async () => {
    isSlotBusy.mockResolvedValue(true);
    planInbound.mockResolvedValue({ slots: {}, actions: [{ request: "find hotels in Kolkata", label: "hotels", continueIndex: null }] });
    await handleThreaded(args("also hotels"));
    const [run] = dispatched();
    expect(run!.conversationId.startsWith(`${home}-t-`)).toBe(true);
    expect(run!.task.startsWith("also hotels\n\n")).toBe(true);
    expect(run!.task).toContain("find hotels in Kolkata");
  });

  it("continues an open task with the person's own words", async () => {
    openTasks.mockResolvedValue([
      { conversationId: `${home}-t-abc`, agentSlug: "concierge", label: "flights", originMessageId: "m0", createdAt: 1 },
    ]);
    planInbound.mockResolvedValue({ slots: {}, actions: [{ request: "find flights for 2 people", label: "flights", continueIndex: 1 }] });
    await handleThreaded(args("make it 2 people"));
    expect(dispatched()).toEqual([expect.objectContaining({ conversationId: `${home}-t-abc`, task: "make it 2 people" })]);
  });

  it("gives the chat's conversation to only the first new task of a split message", async () => {
    planInbound.mockResolvedValue({
      slots: {},
      actions: [
        { request: "flights to Goa", label: "flights", continueIndex: null },
        { request: "hotels in Goa", label: "hotels", continueIndex: null },
      ],
    });
    await handleThreaded(args("flights and hotels in Goa"));
    const [first, second] = dispatched();
    expect(first!.conversationId).toBe(home);
    expect(first!.task).toContain("only this part of that message: flights to Goa");
    expect(second!.conversationId.startsWith(`${home}-t-`)).toBe(true);
    expect(second!.task).toContain("hotels in Goa");
  });
});
