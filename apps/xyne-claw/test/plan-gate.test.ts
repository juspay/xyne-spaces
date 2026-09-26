import { afterEach, describe, expect, it, vi } from "vitest";
import { decidePlanTracking, planGateForced } from "../src/plan-gate.js";

const answer = (p: number) => async () => ({ multiStep: { type: "noul", noul: p } });

describe("decidePlanTracking", () => {
  afterEach(() => {
    delete process.env["XYNE_PLAN_GATE"];
    delete process.env["JEV_PLAN_GATE_THRESHOLD"];
  });

  it("skips the plan when jev says the request is a direct reply", async () => {
    const d = await decidePlanTracking("what is your capability", {}, { enabled: () => true, ask: answer(0.08) });
    expect(d).toMatchObject({ plan: false, reason: "jev", probability: 0.08 });
  });

  it("keeps the plan for multi-step work", async () => {
    const d = await decidePlanTracking("investigate why pods restart and fix the manifest", {}, { enabled: () => true, ask: answer(0.91) });
    expect(d).toMatchObject({ plan: true, reason: "jev" });
  });

  it("keeps the plan at the threshold and honours an env override", async () => {
    expect((await decidePlanTracking("x", {}, { enabled: () => true, ask: answer(0.5) })).plan).toBe(true);
    expect((await decidePlanTracking("x", {}, { enabled: () => true, ask: answer(0.31) })).plan).toBe(false);
    process.env["JEV_PLAN_GATE_THRESHOLD"] = "0.7";
    expect((await decidePlanTracking("x", {}, { enabled: () => true, ask: answer(0.61) })).plan).toBe(false);
  });

  it("keeps the plan when jev is not configured", async () => {
    const ask = vi.fn(answer(0.01));
    const d = await decidePlanTracking("hi", {}, { enabled: () => false, ask });
    expect(d).toMatchObject({ plan: true, reason: "jev-unavailable" });
    expect(ask).not.toHaveBeenCalled();
  });

  it("keeps the plan when jev returns nothing or throws", async () => {
    expect((await decidePlanTracking("hi", {}, { enabled: () => true, ask: async () => null })).plan).toBe(true);
    const throwing = async () => {
      throw new Error("boom");
    };
    expect(await decidePlanTracking("hi", {}, { enabled: () => true, ask: throwing })).toMatchObject({ plan: true, reason: "jev-unavailable" });
    expect((await decidePlanTracking("hi", {}, { enabled: () => true, ask: async () => ({}) })).plan).toBe(true);
  });

  it("always plans when the agent forces it, without asking jev", async () => {
    const ask = vi.fn(answer(0.01));
    const d = await decidePlanTracking("hi", { planTracking: "always" }, { enabled: () => true, ask });
    expect(d).toEqual({ plan: true, reason: "forced" });
    expect(ask).not.toHaveBeenCalled();
    expect(planGateForced({ planTracking: "always" })).toBe(true);
    expect(planGateForced({ planTracking: true })).toBe(false);
  });

  it("always plans when the gate is switched off by env", async () => {
    process.env["XYNE_PLAN_GATE"] = "off";
    const ask = vi.fn(answer(0.01));
    expect(await decidePlanTracking("hi", {}, { enabled: () => true, ask })).toEqual({ plan: true, reason: "gate-off" });
    expect(ask).not.toHaveBeenCalled();
  });

  it("keeps the plan for an empty task", async () => {
    expect((await decidePlanTracking("   ", {}, { enabled: () => true, ask: answer(0.01) })).plan).toBe(true);
  });
});
