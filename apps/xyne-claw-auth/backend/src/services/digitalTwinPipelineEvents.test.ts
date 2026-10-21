import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClassifierExchange, UserMemoryCuratorTrace } from "xyne-claw-shared";

// Characterization tests: every pipeline-event write is best-effort (a failure is
// logged + swallowed, never thrown), and the prisma args / warn meta (including
// key ORDER, which toEqual ignores) are what the pipeline viewer and log
// queries depend on.

type Mode = "ok" | "reject" | "throw" | "noid" | "noobject";

const h = vi.hoisted(() => {
  const state = {
    mode: "ok" as "ok" | "reject" | "throw" | "noid" | "noobject",
    calls: [] as Array<[string, any]>,
    warns: [] as Array<[string, unknown]>,
  };
  // Plain functions (not vi.fn) so a lost `this` binding on the delegate is caught.
  const delegate: Record<string, (this: unknown, args: unknown) => Promise<unknown>> = {};
  const op = (name: string, ok: unknown) =>
    function (this: unknown, args: unknown): Promise<unknown> {
      if (this !== delegate) throw new Error(`lost this for ${name}`);
      state.calls.push([name, args]);
      if (state.mode === "throw") throw new Error(`sync boom ${name}`);
      if (state.mode === "reject") return Promise.reject(new Error(`boom ${name}`));
      if (state.mode === "noid") return Promise.resolve(name === "create" ? {} : ok);
      if (state.mode === "noobject") return Promise.resolve(undefined);
      return Promise.resolve(ok);
    };
  delegate["create"] = op("create", { id: "evt1" });
  delegate["update"] = op("update", {});
  delegate["deleteMany"] = op("deleteMany", { count: 7 });
  return { state, delegate };
});

vi.mock("../db.js", () => ({ prisma: { digitalTwinPipelineEvent: h.delegate } }));
vi.mock("../logger.js", () => ({
  createTraceId: () => "trace",
  createLogger: () => ({
    warn: (message: string, meta?: unknown) => {
      h.state.warns.push([message, meta]);
    },
  }),
}));

const {
  recordPipelineEvent,
  startSynthesisEvent,
  finishSynthesisEvent,
  startCuratorBatchEvent,
  updateCuratorBatchAttempt,
  finishCuratorBatchEvent,
  recordGateEvent,
  prunePipelineEvents,
} = await import("./digitalTwinPipelineEvents.js");

const NOW = new Date("2026-03-03T03:03:03.000Z");
const WINDOW = { from: new Date("2026-01-01T00:00:00.000Z"), to: new Date("2026-01-02T00:00:00.000Z") };
const PREFIX = "[digital-twin-pipeline-events]";

const setMode = (mode: Mode) => {
  h.state.mode = mode;
};
const calls = (name?: string) => h.state.calls.filter(([n]) => !name || n === name).map(([, args]) => args);
const warns = () => h.state.warns;
const metaJson = (i = 0) => JSON.stringify(h.state.warns[i]?.[1]);

const BASE = {
  userId: "u1",
  source: "backfill:dt-backfill:u1:calls:2026-01",
  window: WINDOW,
  status: "ok" as const,
  recordCount: 3,
};
const FULL = {
  ...BASE,
  source: "daily:2026-01-01:messages",
  records: [{ id: "a", type: "m", ts: "x", textPreview: "t" }],
  existingMemoryCount: 2,
  emittedCount: 3,
  keptCount: 1,
  candidatesCreated: 1,
  autoApproved: 1,
  durationMs: 55,
  error: "e",
  trace: { emitted: [] } as unknown as UserMemoryCuratorTrace,
};
const SOURCE_KEYS = ["userId", "runType", "source", "sourceKind", "windowFrom", "windowTo"];
const OUTCOME_KEYS = [
  "status",
  "recordCount",
  "records",
  "existingMemoryCount",
  "emittedCount",
  "keptCount",
  "candidatesCreated",
  "autoApproved",
  "durationMs",
  "error",
  "trace",
];

beforeEach(() => {
  h.state.mode = "ok";
  h.state.calls.length = 0;
  h.state.warns.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("recordPipelineEvent", () => {
  it("inserts source + outcome columns with defaults and returns the id", async () => {
    await expect(recordPipelineEvent(BASE)).resolves.toBe("evt1");
    expect(calls()).toHaveLength(1);
    expect(h.state.calls[0]![0]).toBe("create");
    const args = calls("create")[0];
    expect(args).toStrictEqual({
      data: {
        userId: "u1",
        runType: "backfill",
        source: "backfill:dt-backfill:u1:calls:2026-01",
        sourceKind: "calls",
        windowFrom: WINDOW.from,
        windowTo: WINDOW.to,
        status: "ok",
        recordCount: 3,
        records: undefined,
        existingMemoryCount: 0,
        emittedCount: 0,
        keptCount: 0,
        candidatesCreated: 0,
        autoApproved: 0,
        durationMs: 0,
        error: null,
        trace: undefined,
      },
      select: { id: true },
    });
    expect(Object.keys(args)).toEqual(["data", "select"]);
    expect(Object.keys(args.data)).toEqual([...SOURCE_KEYS, ...OUTCOME_KEYS]);
  });

  it("passes every optional field through", async () => {
    await expect(recordPipelineEvent(FULL)).resolves.toBe("evt1");
    const args = calls("create")[0];
    expect(args).toStrictEqual({
      data: {
        userId: "u1",
        runType: "daily",
        source: "daily:2026-01-01:messages",
        sourceKind: "messages",
        windowFrom: WINDOW.from,
        windowTo: WINDOW.to,
        status: "ok",
        recordCount: 3,
        records: [{ id: "a", type: "m", ts: "x", textPreview: "t" }],
        existingMemoryCount: 2,
        emittedCount: 3,
        keptCount: 1,
        candidatesCreated: 1,
        autoApproved: 1,
        durationMs: 55,
        error: "e",
        trace: { emitted: [] },
      },
      select: { id: true },
    });
    expect(Object.keys(args.data)).toEqual([...SOURCE_KEYS, ...OUTCOME_KEYS]);
  });

  it("maps null records / trace / error to undefined / undefined / null", async () => {
    await recordPipelineEvent({ ...BASE, records: null, trace: null, error: null });
    const { data } = calls("create")[0];
    expect(data.records).toBeUndefined();
    expect(data.trace).toBeUndefined();
    expect(data.error).toBeNull();
  });

  it("returns null (no throw, no warn) when the created row has no id", async () => {
    setMode("noid");
    await expect(recordPipelineEvent(BASE)).resolves.toBeNull();
    expect(warns()).toEqual([]);
  });

  it.each<Mode>(["reject", "throw"])("swallows a %s failure, warns once, returns null", async (mode) => {
    setMode(mode);
    await expect(recordPipelineEvent(BASE)).resolves.toBeNull();
    const msg = mode === "reject" ? "boom create" : "sync boom create";
    expect(warns()).toEqual([[`${PREFIX} recordPipelineEvent failed`, { userId: "u1", source: BASE.source, err: msg }]]);
    expect(metaJson()).toBe(JSON.stringify({ userId: "u1", source: BASE.source, err: msg }));
  });

  // deriveRunType / deriveSourceKind are not exported: observe them through the
  // runType / sourceKind columns of the insert.
  const DERIVE: Array<[string, string, string | null]> = [
    ["backfill:dt-backfill:u1:calls:2026-01", "backfill", "calls"],
    ["backfill:x", "backfill", null],
    ["daily:2026-01-01:messages", "daily", "messages"],
    ["daily:2026:zzz", "daily", null],
    ["upload:abc", "upload", null],
    ["twin-approval:x", "twin-approval", null],
    ["synthesize:daily", "synthesize", null],
    ["gate:123", "gate", null],
    ["retry:2026-01-01:canvases", "retry", "canvases"],
    ["retry:", "retry", null],
    ["", "daily", null],
    ["unknown:thing", "daily", null],
    ["daily", "daily", null],
    ["backfill", "daily", null],
    ["gate", "daily", null],
    ["Backfill:x", "daily", null],
    ["xdaily:1:messages", "daily", null],
    [":", "daily", null],
    ["a:b:c:d:e:f", "daily", null],
  ];
  it.each(DERIVE)("derives runType/sourceKind from source %j", async (source, runType, sourceKind) => {
    await recordPipelineEvent({ ...BASE, source });
    const { data } = calls("create")[0];
    expect(data.runType).toBe(runType);
    expect(data.sourceKind).toBe(sourceKind);
    expect(data.source).toBe(source);
  });
});

describe("startSynthesisEvent", () => {
  it("inserts a running synthesize row stamped with the frozen clock", async () => {
    await expect(startSynthesisEvent("u1", "manual")).resolves.toBe("evt1");
    const args = calls("create")[0];
    expect(args).toStrictEqual({
      data: {
        userId: "u1",
        runType: "synthesize",
        source: "synthesize:manual",
        sourceKind: null,
        windowFrom: NOW,
        windowTo: NOW,
        status: "running",
        recordCount: 0,
        trace: { kind: "synthesize", trigger: "manual", running: true, files: [] },
      },
      select: { id: true },
    });
    expect(Object.keys(args.data)).toEqual([
      "userId",
      "runType",
      "source",
      "sourceKind",
      "windowFrom",
      "windowTo",
      "status",
      "recordCount",
      "trace",
    ]);
    expect(Object.keys(args.data.trace)).toEqual(["kind", "trigger", "running", "files"]);
  });

  it("swallows a failure and returns null", async () => {
    setMode("reject");
    await expect(startSynthesisEvent("u1", "daily")).resolves.toBeNull();
    expect(warns()).toEqual([[`${PREFIX} startSynthesisEvent failed`, { userId: "u1", err: "boom create" }]]);
    expect(metaJson()).toBe('{"userId":"u1","err":"boom create"}');
  });
});

describe("finishSynthesisEvent", () => {
  it("errored files -> status error, counts, singular failure message", async () => {
    const files = [
      { name: "soul.md", factsUsed: 3, action: "updated" as const },
      { name: "x.md", factsUsed: 2, action: "error" as const },
    ];
    await expect(finishSynthesisEvent("e1", "manual", { files, durationMs: 9 })).resolves.toBeUndefined();
    const args = calls("update")[0];
    expect(args).toStrictEqual({
      where: { id: "e1" },
      data: {
        status: "error",
        recordCount: 5,
        emittedCount: 2,
        keptCount: 1,
        candidatesCreated: 1,
        durationMs: 9,
        error: "1 persona file failed to compile",
        trace: { kind: "synthesize", trigger: "manual", files },
      },
    });
    expect(Object.keys(args)).toEqual(["where", "data"]);
    expect(Object.keys(args.data)).toEqual([
      "status",
      "recordCount",
      "emittedCount",
      "keptCount",
      "candidatesCreated",
      "durationMs",
      "error",
      "trace",
    ]);
    expect(Object.keys(args.data.trace)).toEqual(["kind", "trigger", "files"]);
  });

  it("plural failure message", async () => {
    const files = [
      { name: "a.md", factsUsed: 1, action: "error" as const },
      { name: "b.md", factsUsed: 1, action: "error" as const },
    ];
    await finishSynthesisEvent("e1", "daily", { files, durationMs: 1 });
    expect(calls("update")[0].data.error).toBe("2 persona files failed to compile");
  });

  it("empty files and no error -> status empty, error null", async () => {
    await finishSynthesisEvent("e1", "daily", { files: [], durationMs: 1, error: null });
    expect(calls("update")[0]).toStrictEqual({
      where: { id: "e1" },
      data: {
        status: "empty",
        recordCount: 0,
        emittedCount: 0,
        keptCount: 0,
        candidatesCreated: 0,
        durationMs: 1,
        error: null,
        trace: { kind: "synthesize", trigger: "daily", files: [] },
      },
    });
  });

  it("only updated files -> status ok", async () => {
    const files = [{ name: "soul.md", factsUsed: 4, action: "updated" as const }];
    await finishSynthesisEvent("e1", "daily", { files, durationMs: 2 });
    const { data } = calls("update")[0];
    expect(data.status).toBe("ok");
    expect(data.error).toBeNull();
    expect(data.recordCount).toBe(4);
  });

  it("an explicit result.error wins over file outcomes", async () => {
    const files = [{ name: "soul.md", factsUsed: 4, action: "updated" as const }];
    await finishSynthesisEvent("e1", "daily", { files, durationMs: 2, error: "llm down" });
    const { data } = calls("update")[0];
    expect(data.status).toBe("error");
    expect(data.error).toBe("llm down");
  });

  it("swallows a failure and resolves undefined", async () => {
    setMode("reject");
    await expect(finishSynthesisEvent("e1", "daily", { files: [], durationMs: 1 })).resolves.toBeUndefined();
    expect(warns()).toEqual([[`${PREFIX} finishSynthesisEvent failed`, { id: "e1", err: "boom update" }]]);
    expect(metaJson()).toBe('{"id":"e1","err":"boom update"}');
  });
});

describe("startCuratorBatchEvent", () => {
  const input = { userId: "u1", source: "retry:2026-01-01:canvases", window: WINDOW, recordCount: 4, maxAttempts: 3 };

  it("inserts a running curate row (no outcome defaults)", async () => {
    await expect(startCuratorBatchEvent(input)).resolves.toBe("evt1");
    const args = calls("create")[0];
    expect(args).toStrictEqual({
      data: {
        userId: "u1",
        runType: "retry",
        source: "retry:2026-01-01:canvases",
        sourceKind: "canvases",
        windowFrom: WINDOW.from,
        windowTo: WINDOW.to,
        status: "running",
        recordCount: 4,
        records: undefined,
        trace: { kind: "curate", running: true, attempt: 1, maxAttempts: 3 },
      },
      select: { id: true },
    });
    expect(Object.keys(args.data)).toEqual([...SOURCE_KEYS, "status", "recordCount", "records", "trace"]);
    expect(Object.keys(args.data.trace)).toEqual(["kind", "running", "attempt", "maxAttempts"]);
  });

  it("includes the record previews when given", async () => {
    const records = [{ id: "a", type: "m", ts: "x", textPreview: "t" }];
    await startCuratorBatchEvent({ ...input, records });
    expect(calls("create")[0].data.records).toEqual(records);
  });

  it("swallows a failure and returns null", async () => {
    setMode("reject");
    await expect(startCuratorBatchEvent(input)).resolves.toBeNull();
    expect(warns()).toEqual([
      [`${PREFIX} startCuratorBatchEvent failed`, { userId: "u1", source: input.source, err: "boom create" }],
    ]);
    expect(metaJson()).toBe(`{"userId":"u1","source":"${input.source}","err":"boom create"}`);
  });
});

describe("updateCuratorBatchAttempt", () => {
  it("is a no-op for a null id", async () => {
    await expect(updateCuratorBatchAttempt(null, 1, 3)).resolves.toBeUndefined();
    expect(calls()).toEqual([]);
    expect(warns()).toEqual([]);
  });

  it("attempt > 1 -> retry status carrying lastError", async () => {
    await expect(updateCuratorBatchAttempt("e2", 2, 3, "bad")).resolves.toBeUndefined();
    const args = calls("update")[0];
    expect(args).toStrictEqual({
      where: { id: "e2" },
      data: {
        status: "retry",
        trace: { kind: "curate", running: true, attempt: 2, maxAttempts: 3, lastError: "bad" },
      },
    });
    expect(Object.keys(args.data)).toEqual(["status", "trace"]);
    expect(Object.keys(args.data.trace)).toEqual(["kind", "running", "attempt", "maxAttempts", "lastError"]);
  });

  it("attempt 1 -> running status, lastError null", async () => {
    await updateCuratorBatchAttempt("e2", 1, 3);
    expect(calls("update")[0]).toStrictEqual({
      where: { id: "e2" },
      data: {
        status: "running",
        trace: { kind: "curate", running: true, attempt: 1, maxAttempts: 3, lastError: null },
      },
    });
  });

  it("swallows a failure", async () => {
    setMode("reject");
    await expect(updateCuratorBatchAttempt("e2", 2, 3, "bad")).resolves.toBeUndefined();
    expect(warns()).toEqual([[`${PREFIX} updateCuratorBatchAttempt failed`, { id: "e2", err: "boom update" }]]);
    expect(metaJson()).toBe('{"id":"e2","err":"boom update"}');
  });
});

describe("finishCuratorBatchEvent", () => {
  it("null id -> falls back to a fresh insert and returns its id", async () => {
    await expect(finishCuratorBatchEvent(null, BASE)).resolves.toBe("evt1");
    expect(h.state.calls.map(([n]) => n)).toEqual(["create"]);
    expect(warns()).toEqual([]);
  });

  it("updates the start row with the outcome columns and returns the same id", async () => {
    await expect(finishCuratorBatchEvent("e3", { ...BASE, durationMs: 4 })).resolves.toBe("e3");
    expect(h.state.calls.map(([n]) => n)).toEqual(["update"]);
    const args = calls("update")[0];
    expect(args).toStrictEqual({
      where: { id: "e3" },
      data: {
        status: "ok",
        recordCount: 3,
        records: undefined,
        existingMemoryCount: 0,
        emittedCount: 0,
        keptCount: 0,
        candidatesCreated: 0,
        autoApproved: 0,
        durationMs: 4,
        error: null,
        trace: undefined,
      },
    });
    expect(Object.keys(args)).toEqual(["where", "data"]);
    expect(Object.keys(args.data)).toEqual(OUTCOME_KEYS);
  });

  it("update failure -> warns, then inserts a fresh row and returns its id", async () => {
    // First call (update) rejects, the fallback insert succeeds.
    const origUpdate = h.delegate["update"]!;
    h.delegate["update"] = function (this: unknown, args: unknown) {
      h.state.calls.push(["update", args]);
      return Promise.reject(new Error("boom update"));
    };
    try {
      await expect(finishCuratorBatchEvent("e3", FULL)).resolves.toBe("evt1");
    } finally {
      h.delegate["update"] = origUpdate;
    }
    expect(h.state.calls.map(([n]) => n)).toEqual(["update", "create"]);
    expect(warns()).toEqual([[`${PREFIX} finishCuratorBatchEvent failed — creating fresh`, { id: "e3", err: "boom update" }]]);
    expect(metaJson()).toBe('{"id":"e3","err":"boom update"}');
    expect(Object.keys(calls("create")[0].data)).toEqual([...SOURCE_KEYS, ...OUTCOME_KEYS]);
  });

  it("update and fallback insert both fail -> two warns, returns null", async () => {
    setMode("reject");
    await expect(finishCuratorBatchEvent("e3", BASE)).resolves.toBeNull();
    expect(h.state.calls.map(([n]) => n)).toEqual(["update", "create"]);
    expect(warns()).toEqual([
      [`${PREFIX} finishCuratorBatchEvent failed — creating fresh`, { id: "e3", err: "boom update" }],
      [`${PREFIX} recordPipelineEvent failed`, { userId: "u1", source: BASE.source, err: "boom create" }],
    ]);
    expect(metaJson(0)).toBe('{"id":"e3","err":"boom update"}');
    expect(metaJson(1)).toBe(`{"userId":"u1","source":"${BASE.source}","err":"boom create"}`);
  });

  it("null id and failing insert -> single warn, returns null", async () => {
    setMode("reject");
    await expect(finishCuratorBatchEvent(null, BASE)).resolves.toBeNull();
    expect(warns().map(([m]) => m)).toEqual([`${PREFIX} recordPipelineEvent failed`]);
  });
});

describe("recordGateEvent", () => {
  const full = {
    userId: "u1",
    incoming: "x".repeat(2500),
    channelName: "eng",
    senderName: "bob",
    sourceMessageId: "m1",
    decision: { respond: true, confidence: 0.8, reason: "r", source: "llm" },
    llm: { systemPrompt: "s", userPrompt: "u", response: "r", thinking: "t", model: "m" },
    classifier: [{} as unknown as ClassifierExchange],
    durationMs: 12,
  };

  it("full LLM decision -> ok row with truncated incoming + full trace", async () => {
    await expect(recordGateEvent(full)).resolves.toBe("evt1");
    const args = calls("create")[0];
    expect(args).toStrictEqual({
      data: {
        userId: "u1",
        runType: "gate",
        source: "gate:m1",
        sourceKind: null,
        windowFrom: NOW,
        windowTo: NOW,
        status: "ok",
        recordCount: 1,
        records: [
          {
            id: "m1",
            type: "mention",
            ts: "2026-03-03T03:03:03.000Z",
            channelName: "eng",
            textPreview: "x".repeat(300),
          },
        ],
        durationMs: 12,
        trace: {
          kind: "gate",
          respond: true,
          confidence: 0.8,
          reason: "r",
          decisionSource: "llm",
          incoming: "x".repeat(2000),
          channelName: "eng",
          senderName: "bob",
          classifier: [{}],
          systemPrompt: "s",
          userPrompt: "u",
          response: "r",
          thinking: "t",
          model: "m",
        },
      },
      select: { id: true },
    });
    expect(Object.keys(args.data)).toEqual([
      "userId",
      "runType",
      "source",
      "sourceKind",
      "windowFrom",
      "windowTo",
      "status",
      "recordCount",
      "records",
      "durationMs",
      "trace",
    ]);
    expect(Object.keys(args.data.records[0])).toEqual(["id", "type", "ts", "channelName", "textPreview"]);
    expect(Object.keys(args.data.trace)).toEqual([
      "kind",
      "respond",
      "confidence",
      "reason",
      "decisionSource",
      "incoming",
      "channelName",
      "senderName",
      "classifier",
      "systemPrompt",
      "userPrompt",
      "response",
      "thinking",
      "model",
    ]);
  });

  it("failed gate without an llm exchange -> error row keyed by the frozen clock", async () => {
    await recordGateEvent({
      userId: "u1",
      incoming: "hi",
      decision: { respond: false, confidence: 0.1, reason: "r", source: "rule" },
      llm: null,
      classifier: [],
      error: "timeout",
      durationMs: 1,
    });
    const args = calls("create")[0];
    expect(args).toStrictEqual({
      data: {
        userId: "u1",
        runType: "gate",
        source: `gate:${NOW.getTime()}`,
        sourceKind: null,
        windowFrom: NOW,
        windowTo: NOW,
        status: "error",
        recordCount: 1,
        records: [{ id: "incoming", type: "mention", ts: "2026-03-03T03:03:03.000Z", textPreview: "hi" }],
        durationMs: 1,
        trace: {
          kind: "gate",
          respond: false,
          confidence: 0.1,
          reason: "r",
          decisionSource: "rule",
          incoming: "hi",
          error: "timeout",
        },
      },
      select: { id: true },
    });
    expect(Object.keys(args.data.trace)).toEqual(["kind", "respond", "confidence", "reason", "decisionSource", "incoming", "error"]);
  });

  it("silent decision -> empty status; llm without thinking omits the thinking key", async () => {
    await recordGateEvent({
      userId: "u1",
      incoming: "hi",
      decision: { respond: false, confidence: 0.5, reason: "r", source: "llm" },
      llm: { systemPrompt: "s", userPrompt: "u", response: "r", model: "m" },
      durationMs: 2,
    });
    const { data } = calls("create")[0];
    expect(data.status).toBe("empty");
    expect(Object.keys(data.trace)).toEqual([
      "kind",
      "respond",
      "confidence",
      "reason",
      "decisionSource",
      "incoming",
      "systemPrompt",
      "userPrompt",
      "response",
      "model",
    ]);
  });

  it("swallows a failure and returns null", async () => {
    setMode("reject");
    await expect(recordGateEvent(full)).resolves.toBeNull();
    expect(warns()).toEqual([[`${PREFIX} recordGateEvent failed`, { userId: "u1", err: "boom create" }]]);
    expect(metaJson()).toBe('{"userId":"u1","err":"boom create"}');
  });
});

describe("prunePipelineEvents", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("default window is 30 days and returns the deleted count", async () => {
    await expect(prunePipelineEvents()).resolves.toBe(7);
    expect(calls("deleteMany")).toStrictEqual([{ where: { createdAt: { lt: new Date(NOW.getTime() - 30 * DAY) } } }]);
  });

  it("honours an explicit window", async () => {
    await expect(prunePipelineEvents(5)).resolves.toBe(7);
    expect(calls("deleteMany")).toStrictEqual([{ where: { createdAt: { lt: new Date(NOW.getTime() - 5 * DAY) } } }]);
  });

  it("swallows a failure and returns 0", async () => {
    setMode("reject");
    await expect(prunePipelineEvents(5)).resolves.toBe(0);
    expect(warns()).toEqual([[`${PREFIX} prunePipelineEvents failed`, { days: 5, err: "boom deleteMany" }]]);
    expect(metaJson()).toBe('{"days":5,"err":"boom deleteMany"}');
  });

  it("a non-object result is swallowed as a property-access failure on `count`", async () => {
    setMode("noobject");
    await expect(prunePipelineEvents()).resolves.toBe(0);
    expect(warns()).toHaveLength(1);
    const [message, meta] = warns()[0]!;
    expect(message).toBe(`${PREFIX} prunePipelineEvents failed`);
    expect(Object.keys(meta as object)).toEqual(["days", "err"]);
    expect((meta as { err: string }).err).toMatch(/^Cannot read propert\w+ .*reading 'count'/);
  });
});

describe("all writes failing", () => {
  it("every export swallows, returns its fallback and warns in call order", async () => {
    setMode("reject");
    const out = [
      await recordPipelineEvent(BASE),
      await startSynthesisEvent("u1", "daily"),
      await finishSynthesisEvent("e1", "daily", { files: [], durationMs: 1 }),
      await startCuratorBatchEvent({ userId: "u1", source: "daily:2026-01-01:messages", window: WINDOW, recordCount: 1, maxAttempts: 2 }),
      await updateCuratorBatchAttempt("e2", 2, 3, "bad"),
      await finishCuratorBatchEvent("e3", BASE),
      await recordGateEvent({ userId: "u1", incoming: "hi", decision: { respond: true, confidence: 1, reason: "r", source: "rule" }, durationMs: 1 }),
      await prunePipelineEvents(),
    ];
    expect(out).toEqual([null, null, undefined, null, undefined, null, null, 0]);
    expect(warns().map(([m]) => m)).toEqual([
      `${PREFIX} recordPipelineEvent failed`,
      `${PREFIX} startSynthesisEvent failed`,
      `${PREFIX} finishSynthesisEvent failed`,
      `${PREFIX} startCuratorBatchEvent failed`,
      `${PREFIX} updateCuratorBatchAttempt failed`,
      `${PREFIX} finishCuratorBatchEvent failed — creating fresh`,
      `${PREFIX} recordPipelineEvent failed`,
      `${PREFIX} recordGateEvent failed`,
      `${PREFIX} prunePipelineEvents failed`,
    ]);
  });
});
