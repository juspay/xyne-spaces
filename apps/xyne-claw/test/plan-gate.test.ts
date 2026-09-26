import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildGateState, decidePlanTracking, isShortFollowUp, planGateForced, readPreviousAgentReply } from "../src/plan-gate.js";

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

describe("previous agent reply for short follow-ups", () => {
  const dirs: string[] = [];
  const makeDir = () => {
    const d = mkdtempSync(path.join(tmpdir(), "plan-gate-"));
    dirs.push(d);
    return d;
  };
  const line = (role: string, content: unknown) => JSON.stringify({ type: "message", message: { role, content } });

  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    delete process.env["JEV_PLAN_GATE_CONTEXT_MAX_TASK_CHARS"];
  });

  it("returns the last assistant text from the newest session file", () => {
    const d = makeDir();
    const older = path.join(d, "2026-09-25T10-00-00-000Z_a.jsonl");
    const newer = path.join(d, "2026-09-26T10-00-00-000Z_b.jsonl");
    writeFileSync(older, [line("assistant", [{ type: "text", text: "old reply" }])].join("\n"));
    writeFileSync(newer, [
      JSON.stringify({ type: "session", version: 3 }),
      line("user", [{ type: "text", text: "find drivers" }]),
      line("assistant", [{ type: "text", text: "Which city should I look in?" }]),
      line("assistant", [{ type: "toolCall", name: "search", arguments: {} }]),
    ].join("\n"));
    utimesSync(older, new Date("2026-09-25T10:00:00Z"), new Date("2026-09-25T10:00:00Z"));
    expect(readPreviousAgentReply(d)).toBe("Which city should I look in?");
  });

  it("returns undefined for a missing or empty session directory", () => {
    expect(readPreviousAgentReply(path.join(tmpdir(), "does-not-exist-plan-gate"))).toBeUndefined();
    expect(readPreviousAgentReply(makeDir())).toBeUndefined();
  });

  it("skips malformed lines", () => {
    const d = makeDir();
    writeFileSync(path.join(d, "s.jsonl"), [line("assistant", "plain string reply"), "{not json \"assistant\""].join("\n"));
    expect(readPreviousAgentReply(d)).toBe("plain string reply");
  });

  it("treats only short messages as follow-ups, configurable by env", () => {
    expect(isShortFollowUp("BANGALORE")).toBe(true);
    expect(isShortFollowUp("x".repeat(201))).toBe(false);
    process.env["JEV_PLAN_GATE_CONTEXT_MAX_TASK_CHARS"] = "5";
    expect(isShortFollowUp("BANGALORE")).toBe(false);
  });

  it("puts the previous reply ahead of the user's message in the jev state", () => {
    expect(buildGateState("BANGALORE", "Which city?")).toContain("previously told the user:\nWhich city?");
    expect(buildGateState("BANGALORE", "Which city?")).toContain("latest message is:\nBANGALORE");
    expect(buildGateState("hi")).toBe("A user sent this request to an engineering assistant agent:\nhi");
  });

  it("sends the previous reply to jev and reports it", async () => {
    const ask = vi.fn(async () => ({ multiStep: { type: "noul", noul: 0.9 } }));
    const d = await decidePlanTracking("BANGALORE", {}, { enabled: () => true, ask }, "Which city should I pull inactive drivers for?");
    expect(d).toMatchObject({ plan: true, withPreviousReply: true });
    expect(ask.mock.calls[0]?.[0]).toContain("Which city should I pull inactive drivers for?");
  });
});
