import { beforeEach, describe, expect, it } from "vitest";
import type { Redis } from "ioredis";
import {
  OWNERSHIP_TTL_SECONDS,
  __setOwnershipClientForTests,
  claimOwnership,
  createOwnerToken,
  fenceSession,
  isFencedSession,
  isOwnedByOther,
  refreshOwnership,
  releaseOwnership,
  unfenceSession,
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
  return { set: boom, get: boom, eval: boom, on() { return this; } } as unknown as Redis;
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
