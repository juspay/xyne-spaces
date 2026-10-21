import { describe, expect, it, vi } from "vitest";

vi.mock("../db.js", () => ({ prisma: {} }));
vi.mock("../redis.js", () => ({ redisService: { getConnection: () => ({}) } }));

const { refreshInFlightAwakeningLocks, awakeningMaxRunMs } = await import("./lock-keepalive.js");

describe("refreshInFlightAwakeningLocks", () => {
  it("refreshes every in-flight run that still holds its lock", async () => {
    const refresh = vi.fn(async (_a: string, s: string) => s !== "sess_lost");
    const n = await refreshInFlightAwakeningLocks({
      findInFlight: async () => [
        { agentId: "a1", sessionId: "sess_1" },
        { agentId: "a2", sessionId: "sess_lost" },
        { agentId: "a3", sessionId: null },
      ],
      refresh,
      now: () => 1_000_000_000,
    });
    expect(n).toBe(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledWith("a1", "sess_1");
  });

  it("only looks back AWAKENING_MAX_RUN_MS, so a dead run's lock is allowed to expire", async () => {
    const findInFlight = vi.fn(async () => []);
    const now = 50_000_000_000;
    await refreshInFlightAwakeningLocks({ findInFlight, refresh: vi.fn(), now: () => now });
    expect(findInFlight).toHaveBeenCalledWith(new Date(now - awakeningMaxRunMs()), expect.any(Number));
  });

  it("never throws when the scan or a refresh fails", async () => {
    await expect(
      refreshInFlightAwakeningLocks({
        findInFlight: async () => {
          throw new Error("db down");
        },
        refresh: vi.fn(),
        now: () => 0,
      }),
    ).resolves.toBe(0);
    await expect(
      refreshInFlightAwakeningLocks({
        findInFlight: async () => [{ agentId: "a1", sessionId: "s" }],
        refresh: async () => {
          throw new Error("redis down");
        },
        now: () => 0,
      }),
    ).resolves.toBe(0);
  });
});

describe("awakeningMaxRunMs", () => {
  it("defaults to 3h and ignores junk", () => {
    expect(awakeningMaxRunMs(undefined)).toBe(3 * 60 * 60_000);
    expect(awakeningMaxRunMs("abc")).toBe(3 * 60 * 60_000);
    expect(awakeningMaxRunMs("-5")).toBe(3 * 60 * 60_000);
    expect(awakeningMaxRunMs("600000")).toBe(600_000);
  });
});
