import { describe, it, expect, afterEach, vi } from "vitest";

// state.ts pulls in redis → config, which read required env at import time.
// The pure helpers under test touch neither, so stub the import chain.
vi.mock("../../../config.js", () => ({ CONFIG: {} }));
vi.mock("../../../redis.js", () => ({ redisService: { getConnection: () => ({}) } }));
vi.mock("../../../logger.js", () => ({ createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) }));

const { threadsEnabled } = await import("./config.js");
const { taskConversationId, channelConversationId } = await import("../ids.js");
const { renderStateBlock } = await import("./state.js");

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
