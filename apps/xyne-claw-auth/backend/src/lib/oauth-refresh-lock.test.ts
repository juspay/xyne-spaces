import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => new Map<string, string>());
const redisDown = vi.hoisted(() => ({ value: false }));

vi.mock("../redis.js", () => ({
  redisService: {
    getConnection: () => ({
      set: vi.fn(async (key: string, value: string, _px: string, _ttl: number, nx: string) => {
        if (redisDown.value) throw new Error("connection refused");
        if (nx === "NX" && store.has(key)) return null;
        store.set(key, value);
        return "OK";
      }),
      eval: vi.fn(async (_script: string, _n: number, key: string, holder: string) => {
        if (store.get(key) !== holder) return 0;
        store.delete(key);
        return 1;
      }),
    }),
  },
}));

import { OAuthRefreshBusyError, refreshUnderLock } from "./oauth-refresh-lock.js";

describe("refreshUnderLock", () => {
  beforeEach(() => {
    store.clear();
    redisDown.value = false;
  });

  it("refreshes once when two pods race for the same credential", async () => {
    let persisted: string | null = null;
    const refresh = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 50));
      persisted = "new-token";
      return "new-token";
    });
    const alreadyRefreshed = async () => persisted;
    const [a, b] = await Promise.all([
      refreshUnderLock("shared:c1:claude", alreadyRefreshed, refresh),
      refreshUnderLock("shared:c1:claude", alreadyRefreshed, refresh),
    ]);
    expect(a).toBe("new-token");
    expect(b).toBe("new-token");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(store.size).toBe(0);
  });

  it("skips the refresh when the row was already rotated by another pod", async () => {
    const refresh = vi.fn(async () => "mine");
    await expect(refreshUnderLock("shared:c2:claude", async () => "theirs", refresh)).resolves.toBe("theirs");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("releases the lock when the refresh fails", async () => {
    await expect(
      refreshUnderLock("shared:c3:claude", async () => null, async () => {
        throw new Error("400 invalid_grant");
      }),
    ).rejects.toThrow("invalid_grant");
    expect(store.size).toBe(0);
  });

  it("refreshes without a lock when Redis is down", async () => {
    redisDown.value = true;
    await expect(refreshUnderLock("shared:c4:claude", async () => null, async () => "t")).resolves.toBe("t");
  });

  it("gives up instead of refreshing while another pod holds the lock", async () => {
    vi.useFakeTimers();
    store.set("claw:oauth-refresh:shared:c5:claude", "other-pod");
    const refresh = vi.fn(async () => "t");
    const run = refreshUnderLock("shared:c5:claude", async () => null, refresh);
    const settled = expect(run).rejects.toBeInstanceOf(OAuthRefreshBusyError);
    await vi.advanceTimersByTimeAsync(21_000);
    await settled;
    expect(refresh).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
