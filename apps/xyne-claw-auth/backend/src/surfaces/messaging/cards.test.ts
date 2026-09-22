import { describe, expect, it, vi, beforeEach } from "vitest";

const store = new Map<string, string>();
const redis = {
  multi: () => {
    const ops: Array<() => void> = [];
    const chain = {
      set: (k: string, v: string) => {
        ops.push(() => store.set(k, v));
        return chain;
      },
      exec: async () => ops.forEach((op) => op()),
    };
    return chain;
  },
  get: async (k: string) => store.get(k) ?? null,
  // Stands in for CLAIM_LUA: read the first key, and if it exists delete every
  // key passed. Redis runs this serially, which is the property under test.
  eval: async (_script: string, count: number, ...keys: string[]) => {
    const raw = store.get(keys[0]!) ?? null;
    if (!raw) return null;
    for (let i = 0; i < count; i++) store.delete(keys[i]!);
    return raw;
  },
  // Called as `del(...).catch()` for best-effort cleanup, so it must be a
  // real promise rather than an async iterator of ops.
  del: (...keys: string[]) => {
    keys.forEach((k) => store.delete(k));
    return Promise.resolve(keys.length);
  },
};

vi.mock("../../redis.js", () => ({ redisService: { getConnection: () => redis } }));

const { parkOptions, consumeOption, peekOption } = await import("./cards.js");

const option = (over: Record<string, unknown> = {}) => ({
  action: { kind: "approve-write", label: "spaces-create-ticket" },
  chatId: "group@g.us",
  senderId: "919",
  userId: "u1",
  ...over,
});

describe("card options", () => {
  beforeEach(() => store.clear());

  it("retires the whole card when one option is taken", async () => {
    await parkOptions("acc", [
      { token: "approve", option: option() as never },
      { token: "decline", option: option({ action: { kind: "decline-write", label: "x" } }) as never },
    ]);
    expect(await consumeOption("acc", "decline")).not.toBeNull();
    // The write must not still be runnable after the person declined it.
    expect(await consumeOption("acc", "approve")).toBeNull();
  });

  it("is single-use even without siblings", async () => {
    await parkOptions("acc", [{ token: "solo", option: option() as never }]);
    expect(await consumeOption("acc", "solo")).not.toBeNull();
    expect(await consumeOption("acc", "solo")).toBeNull();
  });

  it("lets only one of two simultaneous taps win", async () => {
    await parkOptions("acc", [
      { token: "approve", option: option() as never },
      { token: "decline", option: option({ action: { kind: "decline-write", label: "x" } }) as never },
    ]);
    // Both peek before either claims — the shape of two taps landing on two pods.
    const [a, b] = await Promise.all([consumeOption("acc", "approve"), consumeOption("acc", "decline")]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it("peeks without spending, so the sender can be checked first", async () => {
    await parkOptions("acc", [{ token: "t", option: option() as never }]);
    expect((await peekOption("acc", "t"))?.senderId).toBe("919");
    expect(await peekOption("acc", "t")).not.toBeNull();
    expect(await consumeOption("acc", "t")).not.toBeNull();
  });
});
