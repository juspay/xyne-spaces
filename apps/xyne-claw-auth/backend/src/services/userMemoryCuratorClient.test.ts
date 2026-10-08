import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserMemoryCandidatePayload, UserMemoryCuratorTrace, UserMemoryRecord } from "xyne-claw-shared";

// Characterization tests for curateAndPersistBatch and the claw distill S2S call
// behind it: the pipeline-event payloads (what the activity feed and the
// retry-state UI read), the candidate rows, the retain calls, the fetch attempts
// + 2000*attempt backoff, and every log line. Everything runs through
// curateAndPersistBatch (the only entry point).

const h = vi.hoisted(() => ({
  config: { xyneClawS2sKey: "s2s-key", xyneClawUrl: "http://claw.test:3002/" },
  provider: { ensureBank: vi.fn(), listMemories: vi.fn(), retain: vi.fn() },
  prisma: {
    user: { findUnique: vi.fn() },
    userMemoryCandidate: { createMany: vi.fn() },
    digitalTwinPipelineEvent: { update: vi.fn() },
  },
  events: { start: vi.fn(), attempt: vi.fn(), finish: vi.fn() },
  loggers: [] as Array<[string, string]>,
  logs: [] as Array<[string, string, unknown]>,
  order: [] as string[],
}));

vi.mock("../config.js", () => ({ CONFIG: h.config }));
vi.mock("../db.js", () => ({ prisma: h.prisma }));
vi.mock("../logger.js", () => {
  const at = (level: string) => (message: string, meta?: unknown) => {
    h.logs.push([level, message, meta]);
  };
  return {
    createTraceId: () => "trace",
    createLogger: (name: string, traceId: string) => {
      h.loggers.push([name, traceId]);
      return { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") };
    },
  };
});
vi.mock("./digitalTwinPipelineEvents.js", () => ({
  startCuratorBatchEvent: h.events.start,
  updateCuratorBatchAttempt: h.events.attempt,
  finishCuratorBatchEvent: h.events.finish,
}));
vi.mock("xyne-claw-shared", async (orig) => ({
  ...(await orig<typeof import("xyne-claw-shared")>()),
  getMemoryProvider: () => h.provider,
}));

import { DIGITAL_TWIN_BANK_ID } from "xyne-claw-shared";
const { curateAndPersistBatch } = await import("./userMemoryCuratorClient.js");

const NOW = new Date("2026-03-03T03:03:03.000Z");
const WINDOW = { from: new Date("2026-01-01T00:00:00.000Z"), to: new Date("2026-02-01T00:00:00.000Z") };
const SOURCE = "daily:2026-01-31:messages";
const DISTILL_URL = "http://claw.test:3002/internal/user-memory/distill";
// Each fetch takes 1500ms and the user lookup 300ms of the (fake) clock, so
// durationMs proves it is read at the time each terminal event is written.
const FETCH_MS = 1500;
const LOOKUP_MS = 300;
const DISTILL_TIMEOUT_MS = 2_484_000;

const RECORDS: UserMemoryRecord[] = [
  {
    id: "m1",
    type: "message",
    ts: "2026-01-05T10:00:00.000Z",
    channelId: "ch1",
    channelName: "general",
    text: "x".repeat(400),
  },
  { id: "call1#p1", type: "call", ts: "2026-01-06T10:00:00.000Z", title: "Standup", text: "standup notes" },
  { id: "call1#p2", type: "call", ts: "2026-01-06T10:05:00.000Z", title: "Standup", text: "more notes" },
];
const PREVIEWS = [
  {
    id: "m1",
    type: "message",
    ts: "2026-01-05T10:00:00.000Z",
    channelId: "ch1",
    channelName: "general",
    textPreview: "x".repeat(300),
  },
  { id: "call1#p1", type: "call", ts: "2026-01-06T10:00:00.000Z", title: "Standup", textPreview: "standup notes" },
  { id: "call1#p2", type: "call", ts: "2026-01-06T10:05:00.000Z", title: "Standup", textPreview: "more notes" },
];
const REF_M1 = { type: "message", id: "m1", channelId: "ch1", ts: "2026-01-05T10:00:00.000Z" };
const REF_CALL1 = { type: "call", id: "call1", ts: "2026-01-06T10:00:00.000Z" };

const cand = (
  text: string,
  groundedOnIds: string[],
  signalScore = 0.8,
  extra: { jevScore?: number } = {},
): UserMemoryCandidatePayload => ({ text, subsystem: "style", signalScore, groundedOnIds, ...extra });

const trace = (over: Partial<UserMemoryCuratorTrace> = {}): UserMemoryCuratorTrace => ({
  model: "glm",
  durationMs: 42,
  prompt: "p",
  promptChars: 1,
  emitted: [],
  ...over,
});

// --- fetch stub -------------------------------------------------------------

type Step = Record<string, unknown> | Error | string;
const okBody = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const distillOk = (candidates: UserMemoryCandidatePayload[], t?: UserMemoryCuratorTrace) =>
  okBody({ success: true, candidates, ...(t ? { trace: t } : {}) });
const httpError = (status: number, body = "") => ({
  ok: false,
  status,
  text: async () => body,
  json: async () => {
    throw new SyntaxError("not json");
  },
});
const garbled = () => ({
  ok: true,
  status: 200,
  json: async () => {
    throw new SyntaxError("Unexpected token < in JSON at position 0");
  },
  text: async () => "<html>",
});

let fetchMock: ReturnType<typeof vi.fn>;
let delays: number[];

/** Queue the responses the fetch stub returns in order (an Error is thrown). */
function script(...steps: Step[]) {
  const queue = [...steps];
  fetchMock.mockImplementation(async () => {
    h.order.push("fetch");
    vi.advanceTimersByTime(FETCH_MS);
    const step = queue.shift();
    if (step === undefined) throw new Error("unexpected extra fetch");
    if (step instanceof Error) throw step;
    if (typeof step === "string") throw step;
    return step;
  });
}

function setUser(user: Record<string, unknown> | null) {
  h.prisma.user.findUnique.mockImplementation(async () => {
    h.order.push("findUnique");
    vi.advanceTimersByTime(LOOKUP_MS);
    return user;
  });
}

const run = () => curateAndPersistBatch({ userId: "u1", window: WINDOW, records: RECORDS, source: SOURCE });

const finishInput = (over: Record<string, unknown>) => ({
  userId: "u1",
  source: SOURCE,
  window: WINDOW,
  status: "empty",
  recordCount: 3,
  records: PREVIEWS,
  existingMemoryCount: 0,
  emittedCount: 0,
  keptCount: 0,
  candidatesCreated: 0,
  autoApproved: 0,
  durationMs: FETCH_MS,
  error: null,
  trace: null,
  ...over,
});
/** The single terminal event a batch writes, as (eventId, input). */
const finishCalls = () => h.events.finish.mock.calls;
const attemptCalls = () => h.events.attempt.mock.calls;
const createdRows = () => h.prisma.userMemoryCandidate.createMany.mock.calls[0]![0].data as Array<Record<string, unknown>>;

beforeEach(() => {
  for (const m of [
    ...Object.values(h.provider),
    ...Object.values(h.events),
    h.prisma.user.findUnique,
    h.prisma.userMemoryCandidate.createMany,
    h.prisma.digitalTwinPipelineEvent.update,
  ]) {
    m.mockReset();
  }
  h.logs.length = 0;
  h.order.length = 0;
  h.config.xyneClawS2sKey = "s2s-key";
  h.config.xyneClawUrl = "http://claw.test:3002/";

  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  delays = [];
  // Backoff sleeps return at once but still advance the fake clock.
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
    delays.push(ms ?? 0);
    vi.advanceTimersByTime(ms ?? 0);
    fn();
    return 0;
  }) as unknown as typeof setTimeout);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  h.events.start.mockImplementation(async () => {
    h.order.push("start");
    return "evt1";
  });
  h.events.attempt.mockImplementation(() => {
    h.order.push("attempt");
  });
  h.events.finish.mockImplementation(async (_id: unknown, input: { status: string }) => {
    h.order.push(`finish:${input.status}`);
    return "pev1";
  });
  h.provider.listMemories.mockImplementation(async () => {
    h.order.push("listMemories");
    return { memories: [] };
  });
  h.provider.ensureBank.mockImplementation(async () => {
    h.order.push("ensureBank");
  });
  h.provider.retain.mockImplementation(async () => {
    h.order.push("retain");
    return [{ id: "hm1" }];
  });
  h.prisma.userMemoryCandidate.createMany.mockImplementation(async ({ data }: { data: unknown[] }) => {
    h.order.push("createMany");
    return { count: data.length };
  });
  h.prisma.digitalTwinPipelineEvent.update.mockImplementation(async () => {
    h.order.push("updateEvent");
    return {};
  });
  setUser({ digitalTwinMemoryApprovalMode: "manual", digitalTwinMemoryAutoApproveMinScore: 0.9 });
});

afterEach(() => {
  // Whatever the scenario, the stub only ever talks to claw's distill endpoint.
  for (const call of fetchMock.mock.calls) expect(call[0]).toBe(DISTILL_URL);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("logger", () => {
  it("is created once for this module", () => {
    expect(h.loggers).toEqual([["user-memory-curator-client", "trace"]]);
  });
});

describe("curateAndPersistBatch: empty outcomes", () => {
  it("does nothing for an empty batch", async () => {
    expect(await curateAndPersistBatch({ userId: "u1", window: WINDOW, records: [], source: SOURCE })).toBe(0);
    expect(h.order).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("records an error event when the curator trace carries an error", async () => {
    const t = trace({
      error: "no-tool-call",
      emitted: [
        { text: "a", verdict: "kept" },
        { text: "b", verdict: "dropped", dropReason: "low-signal" },
        { text: "c", verdict: "kept" },
      ],
    });
    script(distillOk([], t));
    expect(await run()).toBe(0);
    expect(finishCalls()).toHaveLength(1);
    expect(finishCalls()[0]).toStrictEqual([
      "evt1",
      finishInput({ status: "error", emittedCount: 3, keptCount: 2, error: "no-tool-call", trace: t }),
    ]);
    expect(h.order).toEqual(["start", "listMemories", "attempt", "fetch", "finish:error"]);
    expect(h.prisma.user.findUnique).not.toHaveBeenCalled();
    expect(h.prisma.userMemoryCandidate.createMany).not.toHaveBeenCalled();
  });

  it("treats an empty-string trace error as 'empty' but still records the string", async () => {
    const t = trace({ error: "" });
    script(distillOk([], t));
    expect(await run()).toBe(0);
    expect(finishCalls()[0]).toStrictEqual(["evt1", finishInput({ status: "empty", error: "", trace: t })]);
  });

  it("records 'empty' (error null) when claw returns no candidates and no trace", async () => {
    script(distillOk([]));
    expect(await run()).toBe(0);
    expect(finishCalls()[0]).toStrictEqual(["evt1", finishInput({ status: "empty" })]);
  });

  it("records 'empty' with the trace when claw returns no candidates and no error", async () => {
    const t = trace({ emitted: [{ text: "a", verdict: "dropped", dropReason: "low-signal" }] });
    script(distillOk([], t));
    expect(await run()).toBe(0);
    expect(finishCalls()[0]).toStrictEqual(["evt1", finishInput({ status: "empty", emittedCount: 1, trace: t })]);
  });

  it("records 'empty' when every candidate lost its grounding", async () => {
    const t = trace({ emitted: [{ text: "a", verdict: "kept" }, { text: "b", verdict: "kept" }] });
    script(distillOk([cand("ungrounded", []), cand("unknown ids", ["nope", "also-nope"])], t));
    expect(await run()).toBe(0);
    expect(finishCalls()).toHaveLength(1);
    expect(finishCalls()[0]).toStrictEqual([
      "evt1",
      finishInput({ status: "empty", emittedCount: 2, keptCount: 2, trace: t }),
    ]);
    expect(h.order).toEqual(["start", "listMemories", "attempt", "fetch", "finish:empty"]);
    expect(h.prisma.user.findUnique).not.toHaveBeenCalled();
    expect(h.prisma.userMemoryCandidate.createMany).not.toHaveBeenCalled();
  });

  it("refuses the call without an S2S key: 'empty', zero fetches, no attempt event", async () => {
    h.config.xyneClawS2sKey = "";
    expect(await run()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(attemptCalls()).toEqual([]);
    expect(finishCalls()[0]).toStrictEqual(["evt1", finishInput({ status: "empty", durationMs: 0 })]);
    expect(h.logs).toEqual([
      ["warn", "[user-memory-curator-client] XYNE_CLAW_S2S_KEY not set — refusing call", undefined],
    ]);
  });
});

describe("curateAndPersistBatch: manual approval", () => {
  it("persists pending rows with resolved, deduped sourceRefs and writes the ok event", async () => {
    const t = trace({ emitted: [{ text: "a", verdict: "kept" }, { text: "b", verdict: "kept" }, { text: "c", verdict: "dropped" }] });
    script(
      distillOk(
        [
          // `#pN` sub-chunks collapse to the base id; unknown ids are skipped.
          cand("Keeps replies short", ["call1#p1", "call1#p2", "m1", "nope"], 0.95),
          cand("Ungrounded", ["nope"], 0.99),
          cand("Prefers threads", ["m1"], 0.4),
        ],
        t,
      ),
    );
    expect(await run()).toBe(2);

    expect(h.prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "u1" },
      select: { digitalTwinMemoryApprovalMode: true, digitalTwinMemoryAutoApproveMinScore: true },
    });
    expect(finishCalls()).toHaveLength(1);
    expect(finishCalls()[0]).toStrictEqual([
      "evt1",
      finishInput({
        status: "ok",
        emittedCount: 3,
        keptCount: 2,
        candidatesCreated: 2,
        durationMs: FETCH_MS + LOOKUP_MS,
        trace: t,
      }),
    ]);
    const rows = createdRows();
    expect(rows).toStrictEqual([
      {
        userId: "u1",
        subsystem: "style",
        text: "Keeps replies short",
        sourceRefs: [REF_CALL1, REF_M1],
        signalScore: 0.95,
        source: SOURCE,
        status: "pending",
        pipelineEventId: "pev1",
      },
      {
        userId: "u1",
        subsystem: "style",
        text: "Prefers threads",
        sourceRefs: [REF_M1],
        signalScore: 0.4,
        source: SOURCE,
        status: "pending",
        pipelineEventId: "pev1",
      },
    ]);
    expect(Object.keys(rows[0]!)).toEqual([
      "userId",
      "subsystem",
      "text",
      "sourceRefs",
      "signalScore",
      "source",
      "status",
      "pipelineEventId",
    ]);
    expect(Object.keys((rows[0]!["sourceRefs"] as Array<Record<string, unknown>>)[1]!)).toEqual(["type", "id", "channelId", "ts"]);
    expect(h.order).toEqual([
      "start",
      "listMemories",
      "attempt",
      "fetch",
      "findUnique",
      "finish:ok",
      "createMany",
    ]);
    expect(h.provider.ensureBank).not.toHaveBeenCalled();
    expect(h.provider.retain).not.toHaveBeenCalled();
    expect(h.prisma.digitalTwinPipelineEvent.update).not.toHaveBeenCalled();
    expect(h.logs).toEqual([
      [
        "info",
        "[user-memory-curator-client] candidates persisted",
        {
          userId: "u1",
          source: SOURCE,
          received: 3,
          inserted: 2,
          autoApproved: 0,
          approvalMode: "manual",
          minScore: 0.9,
          pipelineEventId: "pev1",
        },
      ],
    ]);
  });

  it("falls back to manual mode and the default min score when the user row is missing", async () => {
    setUser(null);
    script(distillOk([cand("Fact", ["m1"], 0.99)]));
    expect(await run()).toBe(1);
    expect(createdRows()).toStrictEqual([
      {
        userId: "u1",
        subsystem: "style",
        text: "Fact",
        sourceRefs: [REF_M1],
        signalScore: 0.99,
        source: SOURCE,
        status: "pending",
        pipelineEventId: "pev1",
      },
    ]);
    expect(h.provider.retain).not.toHaveBeenCalled();
    expect(h.logs.at(-1)).toEqual([
      "info",
      "[user-memory-curator-client] candidates persisted",
      expect.objectContaining({ approvalMode: "manual", minScore: 0.9 }),
    ]);
  });

  it("never auto-approves in manual mode, whatever the score threshold", async () => {
    setUser({ digitalTwinMemoryApprovalMode: "manual", digitalTwinMemoryAutoApproveMinScore: 0.1 });
    script(distillOk([cand("Fact", ["m1"], 0.99)]));
    expect(await run()).toBe(1);
    expect(createdRows().map((r) => r["status"])).toEqual(["pending"]);
    expect(h.provider.ensureBank).not.toHaveBeenCalled();
    expect(h.provider.retain).not.toHaveBeenCalled();
    expect(h.prisma.digitalTwinPipelineEvent.update).not.toHaveBeenCalled();
  });

  it("stamps a null pipelineEventId on the rows when the events could not be recorded", async () => {
    h.events.start.mockImplementation(async () => null);
    h.events.finish.mockImplementation(async () => null);
    script(distillOk([cand("Fact", ["m1"])]));
    expect(await run()).toBe(1);
    expect(attemptCalls()).toStrictEqual([[null, 1, 3, undefined]]);
    expect(finishCalls()[0]![0]).toBeNull();
    expect(createdRows()).toStrictEqual([
      {
        userId: "u1",
        subsystem: "style",
        text: "Fact",
        sourceRefs: [REF_M1],
        signalScore: 0.8,
        source: SOURCE,
        status: "pending",
        pipelineEventId: null,
      },
    ]);
  });
});

describe("curateAndPersistBatch: auto approval", () => {
  const AUTO = { digitalTwinMemoryApprovalMode: "auto" as const };
  const RETAIN_TS = "2026-01-06T10:00:00.000Z"; // call1#p2 dedupes into call1#p1's ref (REF_CALL1)

  it("approves on the default 0.9 minimum AND the classifier's 0.5, keeps the rest pending", async () => {
    setUser({ ...AUTO, digitalTwinMemoryAutoApproveMinScore: null });
    script(
      distillOk([
        cand("high", ["m1"], 0.95),
        cand("below min", ["m1"], 0.89),
        cand("jev too low", ["m1"], 0.95, { jevScore: 0.49 }),
        cand("at both thresholds", ["call1#p1", "call1#p2"], 0.9, { jevScore: 0.5 }),
      ]),
    );
    expect(await run()).toBe(4);

    expect(createdRows().map((r) => [r["text"], r["status"]])).toEqual([
      ["high", "approved"],
      ["below min", "pending"],
      ["jev too low", "pending"],
      ["at both thresholds", "approved"],
    ]);
    expect(createdRows()[0]).toStrictEqual({
      userId: "u1",
      subsystem: "style",
      text: "high",
      sourceRefs: [REF_M1],
      signalScore: 0.95,
      source: SOURCE,
      status: "approved",
      approvedAt: new Date(NOW.getTime() + FETCH_MS + LOOKUP_MS),
      hindsightMemoryId: "hm1",
      pipelineEventId: "pev1",
    });
    expect(Object.keys(createdRows()[0]!)).toEqual([
      "userId",
      "subsystem",
      "text",
      "sourceRefs",
      "signalScore",
      "source",
      "status",
      "approvedAt",
      "hindsightMemoryId",
      "pipelineEventId",
    ]);
    expect(createdRows()[1]).toStrictEqual({
      userId: "u1",
      subsystem: "style",
      text: "below min",
      sourceRefs: [REF_M1],
      signalScore: 0.89,
      source: SOURCE,
      status: "pending",
      pipelineEventId: "pev1",
    });

    expect(h.provider.ensureBank).toHaveBeenCalledTimes(1);
    expect(h.provider.retain.mock.calls).toEqual([
      [
        DIGITAL_TWIN_BANK_ID,
        [
          {
            content: "high",
            tags: ["user:u1", "subsystem:style", "scope:user", "pipeline:pev1"],
            timestamp: "2026-01-05T10:00:00.000Z",
            observationScopes: [["user:u1"]],
          },
        ],
      ],
      [
        DIGITAL_TWIN_BANK_ID,
        [
          {
            content: "at both thresholds",
            tags: ["user:u1", "subsystem:style", "scope:user", "pipeline:pev1"],
            timestamp: RETAIN_TS,
            observationScopes: [["user:u1"]],
          },
        ],
      ],
    ]);
    // The event is written (with autoApproved: 0) BEFORE the retains so its id can
    // tag the memories; the real count is patched back afterwards.
    expect(finishCalls()[0]![1]).toMatchObject({ status: "ok", candidatesCreated: 4, autoApproved: 0 });
    expect(h.prisma.digitalTwinPipelineEvent.update).toHaveBeenCalledWith({
      where: { id: "pev1" },
      data: { autoApproved: 2 },
    });
    expect(h.order).toEqual([
      "start",
      "listMemories",
      "attempt",
      "fetch",
      "findUnique",
      "finish:ok",
      "ensureBank",
      "retain",
      "retain",
      "createMany",
      "updateEvent",
    ]);
    expect(h.logs.at(-1)).toEqual([
      "info",
      "[user-memory-curator-client] candidates persisted",
      {
        userId: "u1",
        source: SOURCE,
        received: 4,
        inserted: 4,
        autoApproved: 2,
        approvalMode: "auto",
        minScore: 0.9,
        pipelineEventId: "pev1",
      },
    ]);
  });

  it("honours a per-user minimum score", async () => {
    setUser({ ...AUTO, digitalTwinMemoryAutoApproveMinScore: 0.4 });
    script(distillOk([cand("a", ["m1"], 0.4), cand("b", ["m1"], 0.39)]));
    expect(await run()).toBe(2);
    expect(createdRows().map((r) => r["status"])).toEqual(["approved", "pending"]);
    expect(h.logs.at(-1)![2]).toMatchObject({ autoApproved: 1, minScore: 0.4 });
  });

  it("keeps a candidate pending (warn, fail closed) when the retain throws", async () => {
    setUser({ ...AUTO, digitalTwinMemoryAutoApproveMinScore: 0.9 });
    h.provider.retain.mockImplementationOnce(async () => {
      h.order.push("retain");
      throw new Error("hindsight down");
    });
    script(distillOk([cand("first", ["m1"], 0.95), cand("second", ["m1"], 0.97)]));
    expect(await run()).toBe(2);
    expect(createdRows().map((r) => [r["text"], r["status"]])).toEqual([
      ["first", "pending"],
      ["second", "approved"],
    ]);
    expect(createdRows()[0]).toStrictEqual({
      userId: "u1",
      subsystem: "style",
      text: "first",
      sourceRefs: [REF_M1],
      signalScore: 0.95,
      source: SOURCE,
      status: "pending",
      pipelineEventId: "pev1",
    });
    expect(h.logs[0]).toEqual([
      "warn",
      "[user-memory-curator-client] auto-approval retain failed; keeping pending",
      { userId: "u1", source: SOURCE, subsystem: "style", signalScore: 0.95, err: "hindsight down" },
    ]);
    expect(h.prisma.digitalTwinPipelineEvent.update).toHaveBeenCalledWith({
      where: { id: "pev1" },
      data: { autoApproved: 1 },
    });
    expect(h.logs.at(-1)![2]).toMatchObject({ received: 2, inserted: 2, autoApproved: 1 });
  });

  it("stores a null hindsightMemoryId when the provider returns no id", async () => {
    setUser({ ...AUTO, digitalTwinMemoryAutoApproveMinScore: 0.9 });
    h.provider.retain.mockImplementation(async () => []);
    script(distillOk([cand("a", ["m1"], 0.95)]));
    expect(await run()).toBe(1);
    expect(createdRows()[0]).toMatchObject({ status: "approved", hindsightMemoryId: null });
  });

  it("retains without a pipeline tag, and skips the count patch, when no event id exists", async () => {
    setUser({ ...AUTO, digitalTwinMemoryAutoApproveMinScore: 0.9 });
    h.events.finish.mockImplementation(async () => null);
    script(distillOk([cand("a", ["m1"], 0.95)]));
    expect(await run()).toBe(1);
    expect(h.provider.retain.mock.calls[0]![1][0].tags).toEqual(["user:u1", "subsystem:style", "scope:user"]);
    expect(createdRows()[0]).toMatchObject({ status: "approved", pipelineEventId: null });
    expect(h.prisma.digitalTwinPipelineEvent.update).not.toHaveBeenCalled();
    expect(h.logs.at(-1)![2]).toMatchObject({ autoApproved: 1, pipelineEventId: null });
  });

  it("swallows a failed count patch", async () => {
    setUser({ ...AUTO, digitalTwinMemoryAutoApproveMinScore: 0.9 });
    h.prisma.digitalTwinPipelineEvent.update.mockImplementation(() => Promise.reject(new Error("db down")));
    script(distillOk([cand("a", ["m1"], 0.95)]));
    expect(await run()).toBe(1);
    expect(h.prisma.digitalTwinPipelineEvent.update).toHaveBeenCalledTimes(1);
    expect(h.logs.at(-1)![1]).toBe("[user-memory-curator-client] candidates persisted");
  });
});

describe("curateAndPersistBatch: existing memories", () => {
  it("passes the user's already-retained memories (with a subsystem) to the distill call", async () => {
    h.provider.listMemories.mockResolvedValue({
      memories: [
        { id: "x1", tags: ["user:u1", "subsystem:style", "scope:user"], content: "Writes short replies" },
        { id: "x2", tags: ["user:u1", "subsystem:triage"] },
        { id: "", tags: ["subsystem:style"], content: "no id" },
        { id: "x3", tags: ["user:u1"], content: "no subsystem" },
      ],
    });
    script(distillOk([]));
    await run();
    expect(h.provider.listMemories).toHaveBeenCalledWith(DIGITAL_TWIN_BANK_ID, { tags: ["user:u1"], limit: 200 });
    const existing = [
      { id: "x1", subsystem: "style", text: "Writes short replies" },
      { id: "x2", subsystem: "triage", text: "" },
    ];
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).existingMemories).toEqual(existing);
    expect(finishCalls()[0]![1]).toMatchObject({ existingMemoryCount: 2 });
  });

  it("degrades to create-only (warn) when listing the memories fails", async () => {
    h.provider.listMemories.mockRejectedValue(new Error("list boom"));
    script(distillOk([]));
    await run();
    expect(h.logs[0]).toEqual([
      "warn",
      "[user-memory-curator-client] fetchExistingUserMemories failed — curator will create-only",
      { userId: "u1", err: "list boom" },
    ]);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).existingMemories).toEqual([]);
    expect(finishCalls()[0]![1]).toMatchObject({ existingMemoryCount: 0 });
  });
});

describe("distill S2S call", () => {
  it("POSTs the request with the S2S key, trace on, and no undici default timeouts", async () => {
    script(distillOk([]));
    await run();
    expect(h.events.start).toHaveBeenCalledWith({
      userId: "u1",
      source: SOURCE,
      window: WINDOW,
      recordCount: 3,
      records: PREVIEWS,
      maxAttempts: 3,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(DISTILL_URL);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json", "x-s2s-key": "s2s-key" });
    expect(Object.keys(JSON.parse(init.body))).toEqual(["userId", "window", "records", "existingMemories", "includeTrace"]);
    expect(JSON.parse(init.body)).toEqual({
      userId: "u1",
      window: { from: "2026-01-01T00:00:00.000Z", to: "2026-02-01T00:00:00.000Z" },
      records: RECORDS,
      existingMemories: [],
      includeTrace: true,
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.dispatcher).toBeDefined();
    expect(delays).toEqual([]);
    expect(attemptCalls()).toStrictEqual([["evt1", 1, 3, undefined]]);
  });

  it("retries a 5xx once, then succeeds (backoff 2000)", async () => {
    script(httpError(503, "upstream down"), distillOk([cand("Fact", ["m1"])]));
    expect(await run()).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([2000]);
    expect(attemptCalls()).toStrictEqual([
      ["evt1", 1, 3, undefined],
      ["evt1", 2, 3, "claw 503"],
    ]);
    expect(h.logs.slice(0, 2)).toEqual([
      [
        "warn",
        "[user-memory-curator-client] non-OK from claw",
        {
          status: 503,
          body: "upstream down",
          userId: "u1",
          recordsCount: 3,
          durationMs: FETCH_MS,
          attempt: 1,
          maxAttempts: 3,
        },
      ],
      ["info", "[user-memory-curator-client] distill succeeded on retry", { userId: "u1", attempt: 2 }],
    ]);
    expect(finishCalls()[0]![1]).toMatchObject({
      status: "ok",
      candidatesCreated: 1,
      durationMs: FETCH_MS + 2000 + FETCH_MS + LOOKUP_MS,
    });
  });

  it("gives up after three 5xx with 'empty' (backoff 2000 then 4000, third is not slept on)", async () => {
    script(httpError(500, "a"), httpError(502, "b"), httpError(504, "c".repeat(400)));
    expect(await run()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([2000, 4000]);
    expect(attemptCalls()).toStrictEqual([
      ["evt1", 1, 3, undefined],
      ["evt1", 2, 3, "claw 500"],
      ["evt1", 3, 3, "claw 502"],
    ]);
    expect(h.logs.map(([level, message, meta]) => [level, message, (meta as { attempt: number; body: string }).attempt, (meta as { body: string }).body.length])).toEqual([
      ["warn", "[user-memory-curator-client] non-OK from claw", 1, 1],
      ["warn", "[user-memory-curator-client] non-OK from claw", 2, 1],
      ["warn", "[user-memory-curator-client] non-OK from claw", 3, 300],
    ]);
    expect(finishCalls()[0]).toStrictEqual([
      "evt1",
      finishInput({ status: "empty", durationMs: 3 * FETCH_MS + 2000 + 4000 }),
    ]);
  });

  it("does not retry a 4xx, and tolerates an unreadable error body", async () => {
    script({
      ok: false,
      status: 400,
      text: async () => {
        throw new Error("stream closed");
      },
    });
    expect(await run()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
    expect(attemptCalls()).toStrictEqual([["evt1", 1, 3, undefined]]);
    expect(h.logs).toEqual([
      [
        "warn",
        "[user-memory-curator-client] non-OK from claw",
        {
          status: 400,
          body: "",
          userId: "u1",
          recordsCount: 3,
          durationMs: FETCH_MS,
          attempt: 1,
          maxAttempts: 3,
        },
      ],
    ]);
    expect(finishCalls()[0]).toStrictEqual(["evt1", finishInput({ status: "empty" })]);
  });

  it("retries a thrown transport error, logging its name and cause", async () => {
    script(new Error("fetch failed", { cause: new Error("ECONNRESET") }), distillOk([cand("Fact", ["m1"])]));
    expect(await run()).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([2000]);
    expect(attemptCalls()).toStrictEqual([
      ["evt1", 1, 3, undefined],
      ["evt1", 2, 3, "fetch failed"],
    ]);
    expect(h.logs.slice(0, 2)).toEqual([
      [
        "error",
        "[user-memory-curator-client] call failed",
        {
          err: "fetch failed",
          name: "Error",
          cause: "Error: ECONNRESET",
          url: DISTILL_URL,
          userId: "u1",
          recordsCount: 3,
          durationMs: FETCH_MS,
          timeoutMs: DISTILL_TIMEOUT_MS,
          attempt: 1,
          maxAttempts: 3,
          willRetry: true,
        },
      ],
      ["info", "[user-memory-curator-client] distill succeeded on retry", { userId: "u1", attempt: 2 }],
    ]);
  });

  it("gives up after three thrown errors with 'empty'", async () => {
    script(new Error("e1"), new Error("e2"), "plain string thrown");
    expect(await run()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([2000, 4000]);
    expect(attemptCalls()).toStrictEqual([
      ["evt1", 1, 3, undefined],
      ["evt1", 2, 3, "e1"],
      ["evt1", 3, 3, "e2"],
    ]);
    expect(h.logs.map(([level, , meta]) => [level, meta])).toEqual([
      ["error", expect.objectContaining({ err: "e1", name: "Error", cause: undefined, attempt: 1, willRetry: true })],
      ["error", expect.objectContaining({ err: "e2", name: "Error", cause: undefined, attempt: 2, willRetry: true })],
      ["error", expect.objectContaining({ err: "plain string thrown", name: "unknown", cause: undefined, attempt: 3, willRetry: false })],
    ]);
    expect(finishCalls()[0]).toStrictEqual([
      "evt1",
      finishInput({ status: "empty", durationMs: 3 * FETCH_MS + 2000 + 4000 }),
    ]);
  });

  it("mixes failure kinds across attempts: 5xx, then a throw, then success", async () => {
    script(httpError(502), new Error("socket hang up"), distillOk([cand("Fact", ["m1"])]));
    expect(await run()).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([2000, 4000]);
    expect(attemptCalls()).toStrictEqual([
      ["evt1", 1, 3, undefined],
      ["evt1", 2, 3, "claw 502"],
      ["evt1", 3, 3, "socket hang up"],
    ]);
    expect(h.logs.filter(([, message]) => message.includes("succeeded on retry"))).toEqual([
      ["info", "[user-memory-curator-client] distill succeeded on retry", { userId: "u1", attempt: 3 }],
    ]);
  });

  it("retries a 200 whose body is not JSON (the parse throws into the transport catch)", async () => {
    script(garbled(), garbled(), garbled());
    expect(await run()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([2000, 4000]);
    expect(attemptCalls()).toStrictEqual([
      ["evt1", 1, 3, undefined],
      ["evt1", 2, 3, "Unexpected token < in JSON at position 0"],
      ["evt1", 3, 3, "Unexpected token < in JSON at position 0"],
    ]);
    expect(h.logs.map(([level, message, meta]) => [level, message, (meta as { name: string }).name])).toEqual([
      ["error", "[user-memory-curator-client] call failed", "SyntaxError"],
      ["error", "[user-memory-curator-client] call failed", "SyntaxError"],
      ["error", "[user-memory-curator-client] call failed", "SyntaxError"],
    ]);
    expect(finishCalls()[0]).toStrictEqual([
      "evt1",
      finishInput({ status: "empty", durationMs: 3 * FETCH_MS + 2000 + 4000 }),
    ]);
  });

  it("does not retry success:false, and drops any trace that came with it", async () => {
    script(okBody({ success: false, error: "llm exploded", trace: trace({ error: "x" }) }));
    expect(await run()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
    expect(h.logs).toEqual([
      [
        "warn",
        "[user-memory-curator-client] malformed response",
        { error: "llm exploded", userId: "u1", recordsCount: 3 },
      ],
    ]);
    expect(finishCalls()[0]).toStrictEqual(["evt1", finishInput({ status: "empty" })]);
  });

  it("does not retry a non-array candidates field", async () => {
    script(okBody({ success: true, candidates: "nope" }));
    expect(await run()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
    expect(h.logs).toEqual([
      [
        "warn",
        "[user-memory-curator-client] malformed response",
        { error: undefined, userId: "u1", recordsCount: 3 },
      ],
    ]);
    expect(finishCalls()[0]).toStrictEqual(["evt1", finishInput({ status: "empty" })]);
  });

  it("returns a null trace when the response carries none", async () => {
    script(okBody({ success: true, candidates: [cand("Fact", ["m1"])] }));
    expect(await run()).toBe(1);
    expect(finishCalls()[0]![1]).toMatchObject({ status: "ok", trace: null, emittedCount: 0, keptCount: 0 });
  });
});
