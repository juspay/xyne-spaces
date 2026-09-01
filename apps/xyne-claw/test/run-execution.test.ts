import { describe, it, expect } from "vitest";

process.env["XYNE_CLAW_S2S_KEY"] ||= "test-s2s-key";

describe("run-execution module surface", () => {
  it("exports executeRunFromPayload", async () => {
    const mod = await import("../src/run-execution.js");
    expect(typeof mod.executeRunFromPayload).toBe("function");
    expect(mod.executeRunFromPayload.length).toBeGreaterThanOrEqual(1);
  });

  it("run route module still imports and exposes its drain helpers", async () => {
    const mod = await import("../src/routes/run.js");
    expect(mod.runRouter).toBeDefined();
    expect(typeof mod.processTask).toBe("function");
    expect(typeof mod.ensureActiveRun).toBe("function");
    expect(typeof mod.finishActiveRun).toBe("function");
    expect(typeof mod.requestActiveRunHandoffs).toBe("function");
  });

  it("ensureActiveRun registers once and finishActiveRun clears it", async () => {
    const { ensureActiveRun, finishActiveRun, getActiveSessionIds } = await import("../src/routes/run.js");
    const sessionId = `run-execution-test-${Date.now()}`;
    const first = ensureActiveRun(sessionId, { userId: " u1 ", agentSlug: "tester" });
    const second = ensureActiveRun(sessionId, { userId: "other" });
    expect(second).toBe(first);
    expect(first.userId).toBe("u1");
    expect(first.agentSlug).toBe("tester");
    expect(getActiveSessionIds()).toContain(sessionId);
    finishActiveRun(sessionId, first);
    expect(getActiveSessionIds()).not.toContain(sessionId);
  });

  it("startRunQueueWorker is a no-op unless XYNE_RUN_QUEUE=1", async () => {
    const { startRunQueueWorker } = await import("../src/run-queue-worker.js");
    delete process.env["XYNE_RUN_QUEUE"];
    expect(startRunQueueWorker()).toBeNull();
  });
});
