import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const enqueueRun = vi.fn(async () => undefined);

vi.mock("../queue/run-execution-queue.js", () => ({
  enqueueRun,
  getRunExecutionQueue: () => ({ getWaitingCount: async () => 0 }),
}));

const { dispatchRun } = await import("./dispatch-run.js");

const payload = { sessionId: "sess-1", userId: "u1", task: "hello" };

beforeEach(() => {
  enqueueRun.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("dispatchRun", () => {
  it("enqueues the payload and reports the queue position", async () => {
    const result = await dispatchRun(payload);

    expect(enqueueRun).toHaveBeenCalledWith(payload);
    expect(result).toEqual({ success: true, sessionId: "sess-1", status: 202, queued: true, queuePosition: 0 });
  });

  it("refuses to dispatch when the payload has no sessionId", async () => {
    const result = await dispatchRun({ userId: "u1" });

    expect(enqueueRun).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.status).toBe(500);
  });

  it("runs the onEnqueued hook with the minted sessionId", async () => {
    const onEnqueued = vi.fn(async () => undefined);

    const result = await dispatchRun(
      { sessionId: "minted-by-start-run", userId: "u1", task: "hello" },
      { onEnqueued },
    );

    expect(enqueueRun).toHaveBeenCalledTimes(1);
    expect(enqueueRun).toHaveBeenCalledWith({
      sessionId: "minted-by-start-run",
      userId: "u1",
      task: "hello",
    });
    expect(onEnqueued).toHaveBeenCalledWith("minted-by-start-run");
    expect(result).toEqual({
      success: true,
      sessionId: "minted-by-start-run",
      status: 202,
      queued: true,
      queuePosition: 0,
    });
  });
});
