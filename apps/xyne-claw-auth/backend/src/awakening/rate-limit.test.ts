import { describe, expect, it, vi, beforeEach } from "vitest";

const store = new Map<string, string>();
const redisMock = vi.hoisted(() => ({
  get: vi.fn(),
  incr: vi.fn(),
  expire: vi.fn(),
}));
vi.mock("../redis.js", () => ({ redisService: { getConnection: () => redisMock } }));

const { peekRunRate, consumeRunRate } = await import("./rate-limit.js");

beforeEach(() => {
  store.clear();
  redisMock.get.mockReset().mockImplementation(async (k: string) => store.get(k) ?? null);
  redisMock.incr.mockReset().mockImplementation(async (k: string) => {
    const next = Number(store.get(k) ?? 0) + 1;
    store.set(k, String(next));
    return next;
  });
  redisMock.expire.mockReset().mockResolvedValue(1);
});

describe("peekRunRate", () => {
  it("allows when under the cap and does NOT consume budget", async () => {
    expect(await peekRunRate("a1", 4)).toEqual({ allowed: true, used: 0 });
    expect(await peekRunRate("a1", 4)).toEqual({ allowed: true, used: 0 });
    expect(redisMock.incr).not.toHaveBeenCalled();
  });

  it("blocks once the cap is reached", async () => {
    for (let i = 0; i < 4; i++) await consumeRunRate("a2");
    expect(await peekRunRate("a2", 4)).toEqual({ allowed: false, used: 4 });
  });

  it("fails open when Redis is down — an outage must not silence every agent", async () => {
    redisMock.get.mockRejectedValue(new Error("connection refused"));
    expect(await peekRunRate("a3", 1)).toEqual({ allowed: true, used: 0 });
  });

  it("treats a corrupt counter as zero rather than blocking forever", async () => {
    redisMock.get.mockResolvedValue("not-a-number");
    expect(await peekRunRate("a4", 4)).toEqual({ allowed: true, used: 0 });
  });
});

describe("consumeRunRate", () => {
  it("increments and sets a TTL on the first use of an hour bucket", async () => {
    await consumeRunRate("b1");
    expect(redisMock.incr).toHaveBeenCalledTimes(1);
    expect(redisMock.expire).toHaveBeenCalledTimes(1);
  });

  it("does not re-set the TTL on later increments", async () => {
    await consumeRunRate("b2");
    await consumeRunRate("b2");
    await consumeRunRate("b2");
    expect(redisMock.incr).toHaveBeenCalledTimes(3);
    expect(redisMock.expire).toHaveBeenCalledTimes(1);
  });

  it("never throws when Redis is down", async () => {
    redisMock.incr.mockRejectedValue(new Error("down"));
    await expect(consumeRunRate("b3")).resolves.toBeUndefined();
  });

  it("only the agent that ran spends its own budget", async () => {
    await consumeRunRate("b4");
    await consumeRunRate("b4");
    expect(await peekRunRate("b4", 3)).toEqual({ allowed: true, used: 2 });
    expect(await peekRunRate("b5", 3)).toEqual({ allowed: true, used: 0 });
  });
});

/**
 * The behaviour this split exists to guarantee: skipped and failed windows are
 * free. An agent that skips its quiet hours must still be able to run when
 * something finally happens.
 */
describe("skips and failures are free", () => {
  it("lets an agent run after many skipped windows", async () => {
    for (let i = 0; i < 50; i++) expect((await peekRunRate("c1", 4)).allowed).toBe(true);
    expect((await peekRunRate("c1", 4)).allowed).toBe(true);
  });

  it("lets a failing agent keep retrying", async () => {
    for (let i = 0; i < 10; i++) expect((await peekRunRate("c2", 2)).allowed).toBe(true);
    await consumeRunRate("c2");
    await consumeRunRate("c2");
    expect((await peekRunRate("c2", 2)).allowed).toBe(false);
  });
});
