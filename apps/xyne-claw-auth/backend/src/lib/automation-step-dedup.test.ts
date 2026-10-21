import { describe, expect, it } from "vitest";
import { claimAutomationStep, type StepDedupRedis } from "./automation-step-dedup.js";

function fakeRedis(): StepDedupRedis & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async set(key: string, value: string, _ex: "EX", _seconds: number, nx?: "NX") {
      if (nx === "NX" && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    },
    async get(key: string) {
      return store.get(key) ?? null;
    },
  };
}

const KEY = "automation-step-dedup:pi-alerts-bot:run1:step_2";

describe("claimAutomationStep", () => {
  it("runs the first dispatch of a step", async () => {
    const redis = fakeRedis();
    await expect(claimAutomationStep(redis, "pi-alerts-bot", "run1:step_2")).resolves.toEqual({ kind: "run" });
    expect(redis.store.get(KEY)).toBe("run1:step_2");
  });

  it("runs each validation retry after the attempt before it, and hands it the key", async () => {
    const redis = fakeRedis();
    await claimAutomationStep(redis, "pi-alerts-bot", "run1:step_2");
    await expect(claimAutomationStep(redis, "pi-alerts-bot", "run1:step_2:retry-1")).resolves.toEqual({
      kind: "run-new-attempt",
      stepBaseId: "run1:step_2",
      previous: "run1:step_2",
    });
    await expect(claimAutomationStep(redis, "pi-alerts-bot", "run1:step_2:retry-2")).resolves.toEqual({
      kind: "run-new-attempt",
      stepBaseId: "run1:step_2",
      previous: "run1:step_2:retry-1",
    });
    expect(redis.store.get(KEY)).toBe("run1:step_2:retry-2");
  });

  it("absorbs a late or repeated delivery of an older attempt", async () => {
    const redis = fakeRedis();
    await claimAutomationStep(redis, "pi-alerts-bot", "run1:step_2:retry-2");
    await expect(claimAutomationStep(redis, "pi-alerts-bot", "run1:step_2:retry-1")).resolves.toEqual({
      kind: "absorb",
      stepBaseId: "run1:step_2",
      holder: "run1:step_2:retry-2",
    });
    await expect(claimAutomationStep(redis, "pi-alerts-bot", "run1:step_2")).resolves.toMatchObject({ kind: "absorb" });
  });

  it("lets the same dispatch id through, as before", async () => {
    const redis = fakeRedis();
    await claimAutomationStep(redis, "pi-alerts-bot", "run1:step_2:retry-1");
    await expect(claimAutomationStep(redis, "pi-alerts-bot", "run1:step_2:retry-1")).resolves.toEqual({ kind: "run" });
  });

  it("scopes steps by agent", async () => {
    const redis = fakeRedis();
    await claimAutomationStep(redis, "pi-alerts-bot", "run1:step_2:retry-3");
    await expect(claimAutomationStep(redis, "other-agent", "run1:step_2:retry-1")).resolves.toEqual({ kind: "run" });
  });
});
