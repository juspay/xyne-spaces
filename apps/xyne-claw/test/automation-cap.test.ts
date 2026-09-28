import { afterEach, describe, expect, it, vi } from "vitest";

async function loadCap(value?: string) {
  vi.resetModules();
  if (value === undefined) delete process.env["RUN_QUEUE_AUTOMATION_CONCURRENCY"];
  else process.env["RUN_QUEUE_AUTOMATION_CONCURRENCY"] = value;
  return await import("../src/automation-cap.js");
}

afterEach(() => {
  delete process.env["RUN_QUEUE_AUTOMATION_CONCURRENCY"];
});

describe("automation cap", () => {
  it("is unlimited when unset, zero or invalid", async () => {
    for (const v of [undefined, "0", "-3", "abc"]) {
      const cap = await loadCap(v);
      expect(cap.automationConcurrencyLimit()).toBe(0);
      for (let i = 0; i < 50; i++) expect(cap.tryAcquireAutomationSlot()).toBe(true);
    }
  });

  it("admits up to the limit and frees slots on release", async () => {
    const cap = await loadCap("2");
    expect(cap.tryAcquireAutomationSlot()).toBe(true);
    expect(cap.tryAcquireAutomationSlot()).toBe(true);
    expect(cap.tryAcquireAutomationSlot()).toBe(false);
    expect(cap.activeAutomationRuns()).toBe(2);
    cap.releaseAutomationSlot();
    expect(cap.tryAcquireAutomationSlot()).toBe(true);
    expect(cap.tryAcquireAutomationSlot()).toBe(false);
  });

  it("never drops the active count below zero", async () => {
    const cap = await loadCap("1");
    cap.releaseAutomationSlot();
    expect(cap.activeAutomationRuns()).toBe(0);
    expect(cap.tryAcquireAutomationSlot()).toBe(true);
    expect(cap.tryAcquireAutomationSlot()).toBe(false);
  });

  it("classifies automation and scheduled payloads only", async () => {
    const cap = await loadCap("1");
    expect(cap.isAutomationPayload({ eventType: "automation" })).toBe(true);
    expect(cap.isAutomationPayload({ eventType: "scheduled_job" })).toBe(true);
    expect(cap.isAutomationPayload({ conversationId: "scheduled_abc" })).toBe(true);
    expect(cap.isAutomationPayload({ eventType: "message", conversationId: "c1" })).toBe(false);
    expect(cap.isAutomationPayload({})).toBe(false);
  });

  it("defers between 5 and 10 seconds", async () => {
    const cap = await loadCap("1");
    for (let i = 0; i < 20; i++) {
      const ms = cap.automationDeferMs();
      expect(ms).toBeGreaterThanOrEqual(5_000);
      expect(ms).toBeLessThan(10_000);
    }
  });
});
