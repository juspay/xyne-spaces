import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = { toolInvocations: unknown };

const db = vi.hoisted(() => ({
  rows: new Map<string, Row>(),
  reads: 0,
  writes: 0,
  locks: 0,
  failNextUpdate: false,
}));

vi.mock("../db.js", () => {
  const agentRun = {
    findUnique: vi.fn(async ({ where }: { where: { sessionId: string } }) => {
      db.reads += 1;
      const row = db.rows.get(where.sessionId);
      return row ? { toolInvocations: structuredClone(row.toolInvocations) } : null;
    }),
    update: vi.fn(async ({ where, data }: { where: { sessionId: string }; data: Row }) => {
      if (db.failNextUpdate) {
        db.failNextUpdate = false;
        throw new Error("write failed");
      }
      db.writes += 1;
      db.rows.set(where.sessionId, { toolInvocations: structuredClone(data.toolInvocations) });
      return {};
    }),
  };
  const lockStub = vi.fn(async () => {
    db.locks += 1;
    return 1;
  });
  const tx = new Proxy({ agentRun } as Record<string, unknown>, {
    get: (target, key) => (typeof key === "string" && key in target ? target[key] : lockStub),
  });
  return {
    prisma: {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      agentRun,
    },
  };
});

vi.mock("@prisma/client", () => ({
  Prisma: { sql: () => ({}), empty: {}, PrismaClientKnownRequestError: class extends Error {} },
}));

vi.mock("../logger.js", () => ({ createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));

const { agentRunRepository, mergeToolInvocations } = await import("./agentRunRepository.js");

function invocations(sessionId: string): Array<Record<string, unknown>> {
  return (db.rows.get(sessionId)?.toolInvocations as Array<Record<string, unknown>>) ?? [];
}

describe("appendToolInvocation batching", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    db.rows.clear();
    db.reads = 0;
    db.writes = 0;
    db.locks = 0;
    db.failNextUpdate = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes a burst of appends with one read and one write", async () => {
    db.rows.set("s1", { toolInvocations: [] });
    const done = Array.from({ length: 50 }, (_, i) =>
      agentRunRepository.appendToolInvocation("s1", { toolCallId: `c${i}`, toolName: "grep", status: "completed" }),
    );
    expect(db.writes).toBe(0);
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.all(done);
    expect(db.reads).toBe(1);
    expect(db.writes).toBe(1);
    expect(db.locks).toBe(1);
    expect(invocations("s1").map((i) => i["toolCallId"])).toEqual(Array.from({ length: 50 }, (_, i) => `c${i}`));
  });

  it("collapses a tool's start and end in one window into a single row in place", async () => {
    db.rows.set("s2", { toolInvocations: [] });
    const a = agentRunRepository.appendToolInvocation("s2", { toolCallId: "x", status: "running" });
    const b = agentRunRepository.appendToolInvocation("s2", { toolCallId: "y", status: "running" });
    const c = agentRunRepository.appendToolInvocation("s2", { toolCallId: "x", status: "completed", result: "ok" });
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.all([a, b, c]);
    expect(invocations("s2")).toEqual([
      { toolCallId: "x", status: "completed", result: "ok" },
      { toolCallId: "y", status: "running" },
    ]);
  });

  it("replaces a running placeholder already stored by an earlier flush", async () => {
    db.rows.set("s3", { toolInvocations: [{ toolCallId: "z", status: "running" }, { toolCallId: "w", status: "completed" }] });
    const p = agentRunRepository.appendToolInvocation("s3", { toolCallId: "z", status: "completed" });
    await vi.advanceTimersByTimeAsync(2000);
    await p;
    expect(invocations("s3")).toEqual([
      { toolCallId: "z", status: "completed" },
      { toolCallId: "w", status: "completed" },
    ]);
  });

  it("appends invocations without a toolCallId instead of merging them", async () => {
    db.rows.set("s4", { toolInvocations: [] });
    const p1 = agentRunRepository.appendToolInvocation("s4", { toolName: "a" });
    const p2 = agentRunRepository.appendToolInvocation("s4", { toolName: "a" });
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.all([p1, p2]);
    expect(invocations("s4")).toHaveLength(2);
  });

  it("flushToolInvocations writes immediately, without waiting for the window", async () => {
    db.rows.set("s5", { toolInvocations: [] });
    const p = agentRunRepository.appendToolInvocation("s5", { toolCallId: "k" });
    await agentRunRepository.flushToolInvocations("s5");
    await p;
    expect(db.writes).toBe(1);
    expect(invocations("s5")).toHaveLength(1);
  });

  it("keeps sessions in separate batches", async () => {
    db.rows.set("a", { toolInvocations: [] });
    db.rows.set("b", { toolInvocations: [] });
    const ps = [
      agentRunRepository.appendToolInvocation("a", { toolCallId: "1" }),
      agentRunRepository.appendToolInvocation("b", { toolCallId: "1" }),
      agentRunRepository.appendToolInvocation("a", { toolCallId: "2" }),
    ];
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.all(ps);
    expect(invocations("a")).toHaveLength(2);
    expect(invocations("b")).toHaveLength(1);
    expect(db.writes).toBe(2);
  });

  it("rejects every waiter in a batch when the write fails, and later appends still flush", async () => {
    db.rows.set("s6", { toolInvocations: [] });
    db.failNextUpdate = true;
    const p1 = agentRunRepository.appendToolInvocation("s6", { toolCallId: "1" });
    const p2 = agentRunRepository.appendToolInvocation("s6", { toolCallId: "2" });
    const settled = Promise.allSettled([p1, p2]);
    await vi.advanceTimersByTimeAsync(2000);
    const results = await settled;
    expect(results.every((r) => r.status === "rejected")).toBe(true);

    const p3 = agentRunRepository.appendToolInvocation("s6", { toolCallId: "3" });
    await vi.advanceTimersByTimeAsync(2000);
    await p3;
    expect(invocations("s6").map((i) => i["toolCallId"])).toEqual(["3"]);
  });

  it("never lets a late running event overwrite a stored completed row (start and end on different pods)", async () => {
    db.rows.set("s8", { toolInvocations: [{ toolCallId: "t", status: "completed", result: "real result" }] });
    const p = agentRunRepository.appendToolInvocation("s8", { toolCallId: "t", status: "running" });
    await vi.advanceTimersByTimeAsync(2000);
    await p;
    expect(invocations("s8")).toEqual([{ toolCallId: "t", status: "completed", result: "real result" }]);
  });

  it("keeps the completed event when end arrives before start in the same window", async () => {
    db.rows.set("s9", { toolInvocations: [] });
    const end = agentRunRepository.appendToolInvocation("s9", { toolCallId: "t", status: "completed", result: "ok" });
    const start = agentRunRepository.appendToolInvocation("s9", { toolCallId: "t", status: "running" });
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.all([end, start]);
    expect(invocations("s9")).toEqual([{ toolCallId: "t", status: "completed", result: "ok" }]);
  });

  it("strips NUL characters before storing", async () => {
    db.rows.set("s7", { toolInvocations: [] });
    const p = agentRunRepository.appendToolInvocation("s7", { toolCallId: "n", result: "a\u0000b" });
    await vi.advanceTimersByTimeAsync(2000);
    await p;
    expect(invocations("s7")[0]?.["result"]).toBe("ab");
  });
});

describe("mergeToolInvocations", () => {
  it("caps the column to the most recent rows", () => {
    const existing = Array.from({ length: 5 }, (_, i) => ({ toolCallId: `e${i}` }));
    const batch = Array.from({ length: 3 }, (_, i) => ({ toolCallId: `b${i}` }));
    expect(mergeToolInvocations(existing, batch, 4).map((i) => i["toolCallId"])).toEqual(["e4", "b0", "b1", "b2"]);
  });
});
