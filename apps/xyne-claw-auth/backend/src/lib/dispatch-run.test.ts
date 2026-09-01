import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const enqueueRun = vi.fn(async () => undefined);

vi.mock("../queue/run-execution-queue.js", () => ({
  enqueueRun,
  getRunExecutionQueue: () => ({ getWaitingCount: async () => 0 }),
}));

const mockConfig = { internalUrl: "http://claw-auth.test", xyneClawS2sKey: "s2s-test-key", runQueueEnabled: false };
vi.mock("../config.js", () => ({
  CONFIG: mockConfig,
}));

const { dispatchRun } = await import("./dispatch-run.js");

const payload = { sessionId: "sess-1", userId: "u1", task: "hello" };

beforeEach(() => {
  enqueueRun.mockClear();
  mockConfig.runQueueEnabled = false;
});

afterEach(() => {
  vi.unstubAllGlobals();
  mockConfig.runQueueEnabled = false;
});

describe("dispatchRun", () => {
  it("performs the legacy HTTP POST when the flag is off", async () => {
    const httpDispatch = vi.fn(async () => ({ success: true, sessionId: "sess-1", status: 200 }));

    const result = await dispatchRun(payload, { httpDispatch });

    expect(enqueueRun).not.toHaveBeenCalled();
    expect(httpDispatch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true, sessionId: "sess-1", status: 200 });
  });

  it("uses the caller-provided httpDispatch when the flag is off", async () => {
    const httpDispatch = vi.fn(async () => ({ success: false, error: "nope", status: 503 }));
    const result = await dispatchRun(payload, { httpDispatch });
    expect(httpDispatch).toHaveBeenCalledTimes(1);
    expect(enqueueRun).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false, error: "nope", status: 503 });
  });

  it("enqueues instead of dispatching when the flag is on", async () => {
    mockConfig.runQueueEnabled = true;
    const httpDispatch = vi.fn(async () => ({ success: true, status: 200 }));

    const result = await dispatchRun(payload, { httpDispatch });

    expect(httpDispatch).not.toHaveBeenCalled();
    expect(enqueueRun).toHaveBeenCalledWith(payload);
    expect(result).toEqual({ success: true, sessionId: "sess-1", status: 202, queued: true, queuePosition: 0 });
  });

  it("falls back to HTTP when the flag is on but the payload has no sessionId", async () => {
    mockConfig.runQueueEnabled = true;
    const httpDispatch = vi.fn(async () => ({ success: true, sessionId: "minted", status: 200 }));

    const result = await dispatchRun({ userId: "u1" }, { httpDispatch });

    expect(enqueueRun).not.toHaveBeenCalled();
    expect(httpDispatch).toHaveBeenCalledTimes(1);
    expect(result.sessionId).toBe("minted");
  });
  it("enqueues WITH the sessionId when startRun calls it post-mint (no HTTP fallback)", async () => {
    mockConfig.runQueueEnabled = true;
    const httpDispatch = vi.fn(async () => ({ success: true, sessionId: "http-path", status: 200 }));
    const onEnqueued = vi.fn(async () => undefined);

    // startRun always dispatches AFTER minting sessionId, so the queue branch is
    // reachable — this is the gap slice 1.5 closed.
    const result = await dispatchRun(
      { sessionId: "minted-by-start-run", userId: "u1", task: "hello" },
      { httpDispatch, onEnqueued },
    );

    expect(httpDispatch).not.toHaveBeenCalled();
    expect(enqueueRun).toHaveBeenCalledTimes(1);
    expect(enqueueRun).toHaveBeenCalledWith({
      sessionId: "minted-by-start-run",
      userId: "u1",
      task: "hello",
    });
    expect(onEnqueued).toHaveBeenCalledWith("minted-by-start-run");
    expect(result).toEqual({ success: true, sessionId: "minted-by-start-run", status: 202, queued: true, queuePosition: 0 });
  });
});
