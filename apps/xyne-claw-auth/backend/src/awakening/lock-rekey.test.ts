import { describe, expect, it, vi, beforeEach } from "vitest";

// Minimal in-memory Redis that interprets the one Lua script under test by
// behaviour (compare holder.sessionId, then SET with PX) rather than by text.
const store = new Map<string, { value: string; px: number }>();
const redisMock = vi.hoisted(() => ({ eval: vi.fn(), set: vi.fn(), get: vi.fn() }));
vi.mock("../redis.js", () => ({ redisService: { getConnection: () => redisMock } }));

const { rekeyAgentLock, acquireAgentLock, readAgentLock } = await import("./lock.js");

beforeEach(() => {
  store.clear();
  redisMock.set.mockReset().mockImplementation(async (k: string, v: string, _px: string, ttl: number, nx: string) => {
    if (nx === "NX" && store.has(k)) return null;
    store.set(k, { value: v, px: ttl });
    return "OK";
  });
  redisMock.get.mockReset().mockImplementation(async (k: string) => store.get(k)?.value ?? null);
  redisMock.eval.mockReset().mockImplementation(async (_s: string, _n: number, k: string, from: string, v: string, ttl: string) => {
    const cur = store.get(k);
    if (!cur) return 0;
    if ((JSON.parse(cur.value) as { sessionId: string }).sessionId !== from) return 0;
    store.set(k, { value: v, px: Number(ttl) });
    return 1;
  });
});

describe("rekeyAgentLock", () => {
  it("hands the lock to the real session without ever leaving it free", async () => {
    await acquireAgentLock("a1", { sessionId: "awk_key", kind: "heartbeat", acquiredAtMs: 1 });
    expect(await rekeyAgentLock("a1", "awk_key", { sessionId: "sess_1", kind: "heartbeat", acquiredAtMs: 2 })).toBe(true);
    expect((await readAgentLock("a1"))?.sessionId).toBe("sess_1");
    // No DEL/SET NX pair: a racing acquire still fails.
    expect(await acquireAgentLock("a1", { sessionId: "other", kind: "reflex", acquiredAtMs: 3 })).toBe(false);
    expect(redisMock.eval).toHaveBeenCalledTimes(1);
  });

  it("refuses when the placeholder no longer holds the lock", async () => {
    await acquireAgentLock("a1", { sessionId: "someone_else", kind: "reflex", acquiredAtMs: 1 });
    expect(await rekeyAgentLock("a1", "awk_key", { sessionId: "sess_1", kind: "heartbeat", acquiredAtMs: 2 })).toBe(false);
    expect((await readAgentLock("a1"))?.sessionId).toBe("someone_else");
  });

  it("returns false instead of throwing when Redis fails", async () => {
    redisMock.eval.mockRejectedValue(new Error("down"));
    expect(await rekeyAgentLock("a1", "x", { sessionId: "y", kind: "heartbeat", acquiredAtMs: 0 })).toBe(false);
  });
});
