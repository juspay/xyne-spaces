import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Redis } from "ioredis";
import {
  OWNERSHIP_TTL_SECONDS,
  POD_ALIVE_TTL_SECONDS,
  __setOwnershipClientForTests,
  claimOwnership,
  createOwnerToken,
  currentOwnerPod,
  fenceSession,
  handleOwnershipLoss,
  isFencedSession,
  isOwnedByOther,
  ownerPodFromToken,
  ownerStatus,
  podAliveKey,
  podName,
  refreshOwnership,
  registerOwnedSession,
  releaseOwnership,
  setOwnershipRefreshPort,
  unfenceSession,
  unregisterOwnedSession,
} from "../src/run-ownership.js";

interface Entry {
  value: string;
  ttl: number;
}

function memoryRedis(): { stub: Redis; store: Map<string, Entry> } {
  const store = new Map<string, Entry>();
  const stub = {
    async set(key: string, value: string, _ex: string, ttl: number) {
      store.set(key, { value, ttl: Number(ttl) });
      return "OK";
    },
    async get(key: string) {
      return store.get(key)?.value ?? null;
    },
    async exists(key: string) {
      return store.has(key) ? 1 : 0;
    },
    async eval(script: string, _n: number, key: string, token: string, ttl?: string) {
      const current = store.get(key)?.value ?? null;
      if (current !== token) return 0;
      if (script.includes("DEL")) {
        store.delete(key);
        return 1;
      }
      store.set(key, { value: token, ttl: Number(ttl) });
      return 1;
    },
    on() {
      return this;
    },
  } as unknown as Redis;
  return { stub, store };
}

function throwingRedis(): Redis {
  const boom = async () => {
    throw new Error("redis down");
  };
  return { set: boom, get: boom, exists: boom, eval: boom, on() { return this; } } as unknown as Redis;
}

describe("run-ownership", () => {
  beforeEach(() => {
    process.env["REDIS_HOST"] = "127.0.0.1";
  });

  it("creates distinct owner tokens with a pod prefix", () => {
    process.env["POD_ID"] = "pod-a";
    const a = createOwnerToken();
    const b = createOwnerToken();
    expect(a.startsWith("pod-a:")).toBe(true);
    expect(a).not.toBe(b);
    delete process.env["POD_ID"];
  });

  it("claims with a TTL and reports ownership to the holder", async () => {
    const { stub, store } = memoryRedis();
    __setOwnershipClientForTests(stub);
    await claimOwnership("s1", "tok-1");
    expect(store.get("claw:run-owner:s1")).toEqual({ value: "tok-1", ttl: OWNERSHIP_TTL_SECONDS });
    expect(await isOwnedByOther("s1", "tok-1")).toBe(false);
  });

  it("reports a foreign holder and an unowned session", async () => {
    const { stub } = memoryRedis();
    __setOwnershipClientForTests(stub);
    await claimOwnership("s2", "tok-old");
    expect(await isOwnedByOther("s2", "tok-new")).toBe(true);
    expect(await isOwnedByOther("absent", "tok-new")).toBe(false);
  });

  it("refreshes only for the current owner", async () => {
    const { stub, store } = memoryRedis();
    __setOwnershipClientForTests(stub);
    await claimOwnership("s3", "tok-1");
    expect(await refreshOwnership("s3", "tok-1")).toBe(true);
    await claimOwnership("s3", "tok-2");
    expect(await refreshOwnership("s3", "tok-1")).toBe(false);
    expect(store.get("claw:run-owner:s3")?.value).toBe("tok-2");
  });

  it("releases only when still the owner", async () => {
    const { stub, store } = memoryRedis();
    __setOwnershipClientForTests(stub);
    await claimOwnership("s4", "tok-1");
    expect(await releaseOwnership("s4", "tok-other")).toBe(false);
    expect(store.has("claw:run-owner:s4")).toBe(true);
    expect(await releaseOwnership("s4", "tok-1")).toBe(true);
    expect(store.has("claw:run-owner:s4")).toBe(false);
  });

  it("fails open when redis throws", async () => {
    __setOwnershipClientForTests(throwingRedis());
    expect(await claimOwnership("s5", "tok")).toBe(true);
    expect(await refreshOwnership("s5", "tok")).toBe(true);
    expect(await isOwnedByOther("s5", "tok")).toBe(false);
    expect(await releaseOwnership("s5", "tok")).toBe(false);
  });

  it("fences and unfences sessions", () => {
    expect(isFencedSession("s6")).toBe(false);
    fenceSession("s6");
    expect(isFencedSession("s6")).toBe(true);
    expect(isFencedSession("s7")).toBe(false);
    expect(isFencedSession(undefined)).toBe(false);
    unfenceSession("s6");
    expect(isFencedSession("s6")).toBe(false);
  });
});

describe("ownerPodFromToken", () => {
  it("splits the single colon of a <pod>:<uuid> token", () => {
    const token = createOwnerToken();
    expect(token.split(":")).toHaveLength(2);
    expect(token.slice(token.indexOf(":") + 1)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(ownerPodFromToken(token)).toBe(podName());
  });

  it("keeps hyphens in the pod name intact", () => {
    expect(ownerPodFromToken("xyne-claw-7d9f-abc:0d1e2f34-5678-4abc-9def-0123456789ab")).toBe("xyne-claw-7d9f-abc");
  });

  it("returns null without a pod prefix", () => {
    expect(ownerPodFromToken("no-colon-here")).toBeNull();
    expect(ownerPodFromToken(":leading")).toBeNull();
    expect(ownerPodFromToken("")).toBeNull();
  });
});

describe("ownerStatus", () => {
  const mine = "pod-a:11111111-1111-4111-8111-111111111111";
  const theirs = "pod-b:22222222-2222-4222-8222-222222222222";

  beforeEach(() => {
    process.env["REDIS_HOST"] = "127.0.0.1";
  });

  it("is free when nobody holds the key", async () => {
    const { stub } = memoryRedis();
    __setOwnershipClientForTests(stub);
    expect(await ownerStatus("s1", mine)).toBe("free");
  });

  it("is mine when the key holds my own token", async () => {
    const { stub } = memoryRedis();
    __setOwnershipClientForTests(stub);
    await claimOwnership("s1", mine);
    expect(await ownerStatus("s1", mine)).toBe("mine");
  });

  it("is alive-other while the holding pod still publishes its pod-alive key", async () => {
    const { stub, store } = memoryRedis();
    __setOwnershipClientForTests(stub);
    await claimOwnership("s1", theirs);
    store.set(podAliveKey("pod-b"), { value: String(Date.now()), ttl: POD_ALIVE_TTL_SECONDS });
    expect(await ownerStatus("s1", mine)).toBe("alive-other");
  });

  it("is dead-other once the holding pod's alive key has lapsed", async () => {
    const { stub } = memoryRedis();
    __setOwnershipClientForTests(stub);
    await claimOwnership("s1", theirs);
    expect(await ownerStatus("s1", mine)).toBe("dead-other");
  });

  it("fails open to free when redis throws", async () => {
    __setOwnershipClientForTests(throwingRedis());
    expect(await ownerStatus("s1", mine)).toBe("free");
  });

  it("names the holding pod for the takeover log", async () => {
    const { stub } = memoryRedis();
    __setOwnershipClientForTests(stub);
    await claimOwnership("s1", theirs);
    expect(await currentOwnerPod("s1")).toBe("pod-b");
    expect(await currentOwnerPod("absent")).toBeNull();
  });
});

describe("refresh strategy switch", () => {
  const token = "pod-a:33333333-3333-4333-8333-333333333333";

  beforeEach(() => {
    process.env["REDIS_HOST"] = "127.0.0.1";
    __setOwnershipClientForTests(memoryRedis().stub);
    vi.useFakeTimers();
  });

  afterEach(() => {
    setOwnershipRefreshPort({ postMessage: () => {} });
    unregisterOwnedSession("s1");
    setOwnershipRefreshPort(null);
    vi.useRealTimers();
  });

  it("posts own/release to the worker port instead of ticking on the main thread", () => {
    const posted: unknown[] = [];
    setOwnershipRefreshPort({ postMessage: (m) => posted.push(m) });

    registerOwnedSession("s1", token, () => {});
    expect(posted).toEqual([{ type: "own", sessionId: "s1", ownerToken: token }]);
    expect(vi.getTimerCount()).toBe(0);

    unregisterOwnedSession("s1");
    expect(posted[1]).toEqual({ type: "release", sessionId: "s1" });
  });

  it("hands sessions registered before the worker was ready over to it", () => {
    registerOwnedSession("s1", token, () => {});
    expect(vi.getTimerCount()).toBe(1);

    const posted: unknown[] = [];
    setOwnershipRefreshPort({ postMessage: (m) => posted.push(m) });

    expect(posted).toEqual([{ type: "own", sessionId: "s1", ownerToken: token }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("falls back to the main-thread heartbeat when the worker goes away", () => {
    setOwnershipRefreshPort({ postMessage: () => {} });
    registerOwnedSession("s1", token, () => {});
    expect(vi.getTimerCount()).toBe(0);

    setOwnershipRefreshPort(null);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("runs onLost once, and only for the token still registered", () => {
    const lost = vi.fn();
    setOwnershipRefreshPort({ postMessage: () => {} });
    registerOwnedSession("s1", token, lost);

    handleOwnershipLoss("s1", "pod-b:44444444-4444-4444-8444-444444444444");
    expect(lost).not.toHaveBeenCalled();

    handleOwnershipLoss("s1", token);
    handleOwnershipLoss("s1", token);
    expect(lost).toHaveBeenCalledTimes(1);
  });
});

describe("timing constants", () => {
  it("keeps the owner TTL on the 180s lock and the pod-alive key short-lived", () => {
    expect(OWNERSHIP_TTL_SECONDS).toBe(180);
    expect(POD_ALIVE_TTL_SECONDS).toBe(120);
  });
});
