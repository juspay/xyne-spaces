import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Characterization tests for the Digital Twin respond/ignore gate (claw-auth
// client side). They pin the exact body POSTed to claw's /should-respond, the
// gate-event inputs, the pattern/recall ordering + caps and the recordTwinSilence
// upsert args, so the gate can be restructured without changing behaviour.
//
// getMemoryProvider() and createLogger() run at import time, so every mock is
// defined via vi.hoisted before the module is imported.

const mocks = vi.hoisted(() => ({
  groupBy: vi.fn(),
  findMany: vi.fn(),
  upsert: vi.fn(),
  recall: vi.fn(),
  interact: vi.fn(),
  resolveAuthForUser: vi.fn(),
  recordGateEvent: vi.fn(),
  loggerWarn: vi.fn(),
  config: { xyneClawS2sKey: "s2s-secret", xyneClawUrl: "http://claw.test/" },
}));

vi.mock("../db.js", () => ({
  prisma: { twinBehaviorSignal: { groupBy: mocks.groupBy, findMany: mocks.findMany, upsert: mocks.upsert } },
}));
vi.mock("xyne-claw-shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("xyne-claw-shared")>()),
  getMemoryProvider: () => ({ recall: mocks.recall }),
}));
vi.mock("../mcp/servers/xyne-spaces-client.js", () => ({ interact: mocks.interact }));
vi.mock("./userMemoryFetcher.js", () => ({ resolveAuthForUser: mocks.resolveAuthForUser }));
vi.mock("./digitalTwinPipelineEvents.js", () => ({ recordGateEvent: mocks.recordGateEvent }));
vi.mock("../config.js", () => ({ CONFIG: mocks.config }));
vi.mock("../logger.js", () => ({
  createLogger: () => ({ warn: mocks.loggerWarn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  createTraceId: () => "trace",
}));

import { FAIL_CLOSED, recordTwinSilence, shouldTwinRespond } from "./twinRespondGate.js";

const BANK_ID = "xyne-digital-twin";
const TRIAGE_QUERY =
  "when the user responds versus ignores messages and @mentions — who and what they engage with vs stay silent on";
const BROAD_QUERY =
  "how the user decides when to respond to or ignore messages and @mentions; their response patterns and what they ignore";
const USER_TAG = "user:u1";
const TRIAGE_TAG = "subsystem:triage";

type Hit = { text: string; tags?: string[] };
const triageHit = (text: string): Hit => ({ text, tags: [USER_TAG, TRIAGE_TAG] });
const userHit = (text: string): Hit => ({ text, tags: [USER_TAG] });

const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();

/** recall is called concurrently (patterns + relevant), so dispatch on the query, never on call index. */
function setRecall(hits: { triage?: Hit[]; broad?: Hit[]; relevant?: Hit[] }): void {
  mocks.recall.mockImplementation(async (_bank: string, query: string) => {
    if (query === TRIAGE_QUERY) return hits.triage ?? [];
    if (query === BROAD_QUERY) return hits.broad ?? [];
    return hits.relevant ?? [];
  });
}

type Where = Record<string, unknown>;
/** findMany is called concurrently (corrections + ignored examples), so dispatch on `where`. */
function setFindMany(rows: {
  corrections?: Array<{ channelType: string | null; triggerPreview: string | null }>;
  ignored?: Array<{ channelType: string | null; triggerPreview: string | null }>;
}): void {
  mocks.findMany.mockImplementation(async ({ where }: { where: Where }) => {
    if (where["shouldHaveResponded"] === true) return rows.corrections ?? [];
    if (where["outcome"] === "ignored") return rows.ignored ?? [];
    throw new Error(`unexpected findMany where ${JSON.stringify(where)}`);
  });
}

/** groupBy dispatches on the scoping key in `where`. Missing scope → no rows (ratio() → null). */
function setGroupBy(groups: { overall?: [number, number]; channel?: [number, number]; sender?: [number, number] }): void {
  mocks.groupBy.mockImplementation(async ({ where }: { where: Where }) => {
    const pick = where["channelId"] !== undefined ? groups.channel : where["actorId"] !== undefined ? groups.sender : groups.overall;
    if (!pick) return [];
    return [
      { outcome: "responded", _count: { _all: pick[0] } },
      { outcome: "ignored", _count: { _all: pick[1] } },
    ];
  });
}

function clawReplies(body: unknown, status = 200): void {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

function postedInit(): RequestInit {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  return fetchMock.mock.calls[0]![1];
}
function postedBody(): string {
  return String(postedInit().body);
}
function postedJson(): Record<string, unknown> {
  return JSON.parse(postedBody()) as Record<string, unknown>;
}
function gateEventInput(): Record<string, unknown> {
  expect(mocks.recordGateEvent).toHaveBeenCalledTimes(1);
  return mocks.recordGateEvent.mock.calls[0]![0] as Record<string, unknown>;
}

beforeEach(() => {
  for (const m of [
    mocks.groupBy,
    mocks.findMany,
    mocks.upsert,
    mocks.recall,
    mocks.interact,
    mocks.resolveAuthForUser,
    mocks.recordGateEvent,
    mocks.loggerWarn,
    fetchMock,
  ]) {
    m.mockReset();
  }
  mocks.config.xyneClawS2sKey = "s2s-secret";
  mocks.config.xyneClawUrl = "http://claw.test/";
  mocks.recordGateEvent.mockResolvedValue("evt");
  mocks.upsert.mockResolvedValue({});
  mocks.resolveAuthForUser.mockResolvedValue({ token: "auth" });
  mocks.interact.mockResolvedValue([]);
  setRecall({});
  setFindMany({});
  setGroupBy({});
  clawReplies({ respond: true, confidence: 0.9, reason: "because", source: "llm" });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("shouldTwinRespond: request to claw", () => {
  it("stays silent (fail-closed) with no S2S key: no fetch, no recall, no gate event", async () => {
    mocks.config.xyneClawS2sKey = "";
    const d = await shouldTwinRespond("u1", { incoming: "hi", conversationId: "c1" });
    expect(d).toBe(FAIL_CLOSED);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.recall).not.toHaveBeenCalled();
    expect(mocks.groupBy).not.toHaveBeenCalled();
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.recordGateEvent).not.toHaveBeenCalled();
  });

  it("POSTs the exact body (key order pinned) with every optional arg present", async () => {
    setGroupBy({ overall: [3, 1], channel: [2, 2], sender: [1, 0] });
    setRecall({ triage: [triageHit("t1")], broad: [userHit("b1")], relevant: [userHit("r1")] });
    setFindMany({
      corrections: [{ channelType: "dm", triggerPreview: "missed me" }],
      ignored: [{ channelType: "channel", triggerPreview: "spam" }],
    });
    mocks.interact.mockResolvedValue([{ id: "m1" }]);

    await shouldTwinRespond("u1", {
      incoming: "hello there",
      channelName: "general",
      channelId: "ch1",
      conversationId: "conv1",
      senderName: "alice",
      senderId: "s1",
      sourceMessageId: "msg1",
    });

    const init = postedInit();
    expect(fetchMock.mock.calls[0]![0]).toBe("http://claw.test/internal/user-memory/should-respond");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json", "x-s2s-key": "s2s-secret" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(postedBody()).toBe(
      JSON.stringify({
        incoming: "hello there",
        channelName: "general",
        senderName: "alice",
        patterns: [
          'CORRECTION — the twin previously stayed SILENT but the user DID respond themselves (dm): "missed me". Lean toward REPLYING to similar messages.',
          "t1",
          "b1",
          'Previously IGNORED (channel): "spam"',
        ],
        relevantContext: ["r1"],
        stats: "overall responded 3/4; in #general responded 2/4; to @alice responded 1/1",
        isDirectMessage: false,
        isThreadParticipant: true,
        includeTrace: true,
      }),
    );
    expect(mocks.resolveAuthForUser).toHaveBeenCalledWith("u1");
    expect(mocks.interact).toHaveBeenCalledWith(
      {
        model: "message",
        operation: "findMany",
        where: { senderId: { equals: "u1" }, conversationId: { equals: "conv1" } },
        take: 1,
      },
      { token: "auth" },
    );
    expect(mocks.groupBy).toHaveBeenCalledWith({ by: ["outcome"], where: { userId: "u1" }, _count: { _all: true } });
    expect(mocks.groupBy).toHaveBeenCalledWith({ by: ["outcome"], where: { userId: "u1", channelId: "ch1" }, _count: { _all: true } });
    expect(mocks.groupBy).toHaveBeenCalledWith({ by: ["outcome"], where: { userId: "u1", actorId: "s1" }, _count: { _all: true } });
  });

  it("without conversationId: isThreadParticipant is false and interact is never called", async () => {
    await shouldTwinRespond("u1", { incoming: "hello there", channelName: "general", senderName: "alice" });
    const body = postedJson();
    expect(body["isThreadParticipant"]).toBe(false);
    expect(mocks.interact).not.toHaveBeenCalled();
    expect(mocks.resolveAuthForUser).not.toHaveBeenCalled();
  });

  it("POSTs the minimal body when every optional arg is absent", async () => {
    await shouldTwinRespond("u1", { incoming: "hi" });
    expect(postedBody()).toBe(
      JSON.stringify({ incoming: "hi", patterns: [], relevantContext: [], isDirectMessage: false, isThreadParticipant: false, includeTrace: true }),
    );
    // Only the overall ratio is read when there is no channel/sender to scope by.
    expect(mocks.groupBy).toHaveBeenCalledTimes(1);
    expect(mocks.groupBy).toHaveBeenCalledWith({ by: ["outcome"], where: { userId: "u1" }, _count: { _all: true } });
  });

  it("omits empty-string optional args from the body, stats scoping and the gate event", async () => {
    setGroupBy({ overall: [1, 1] });
    await shouldTwinRespond("u1", {
      incoming: "hi",
      channelName: "",
      channelId: "",
      senderName: "",
      senderId: "",
      sourceMessageId: "",
    });
    expect(postedBody()).toBe(
      JSON.stringify({
        incoming: "hi",
        patterns: [],
        relevantContext: [],
        stats: "overall responded 1/2",
        isDirectMessage: false,
        isThreadParticipant: false,
        includeTrace: true,
      }),
    );
    expect(mocks.groupBy).toHaveBeenCalledTimes(1);
    expect(Object.keys(gateEventInput()).sort()).toEqual(["classifier", "decision", "durationMs", "incoming", "llm", "userId"]);
  });

  it("names the scope generically when channel/sender names are missing", async () => {
    setGroupBy({ overall: [4, 0], channel: [1, 1], sender: [0, 2] });
    await shouldTwinRespond("u1", { incoming: "hi", channelId: "ch1", senderId: "s1" });
    expect(postedJson()["stats"]).toBe("overall responded 4/4; in this channel responded 1/2; to this person responded 0/2");
  });

  it("drops scoped stats that have no history and omits stats entirely when there is none", async () => {
    setGroupBy({ overall: [2, 2] });
    await shouldTwinRespond("u1", { incoming: "hi", channelId: "ch1", senderId: "s1" });
    expect(postedJson()["stats"]).toBe("overall responded 2/4");
  });

  it("strips exactly one trailing slash from the claw URL", async () => {
    mocks.config.xyneClawUrl = "http://claw.test";
    await shouldTwinRespond("u1", { incoming: "hi" });
    expect(fetchMock.mock.calls[0]![0]).toBe("http://claw.test/internal/user-memory/should-respond");
  });
});

describe("shouldTwinRespond: best-effort reads", () => {
  it("still asks claw when every read fails, sending empty patterns/context and no stats", async () => {
    mocks.recall.mockRejectedValue(new Error("hindsight down"));
    mocks.findMany.mockRejectedValue(new Error("db down"));
    mocks.groupBy.mockRejectedValue(new Error("db down"));
    mocks.interact.mockRejectedValue(new Error("spaces down"));
    const d = await shouldTwinRespond("u1", { incoming: "hi", conversationId: "conv1" });
    expect(d).toEqual({ respond: true, confidence: 0.9, reason: "because", source: "llm" });
    expect(postedBody()).toBe(
      JSON.stringify({ incoming: "hi", patterns: [], relevantContext: [], isDirectMessage: false, isThreadParticipant: false, includeTrace: true }),
    );
  });

  it("isThreadParticipant is false when the user has no spaces auth, and when they authored nothing there", async () => {
    mocks.resolveAuthForUser.mockResolvedValue(null);
    await shouldTwinRespond("u1", { incoming: "hi", conversationId: "conv1" });
    expect(postedJson()["isThreadParticipant"]).toBe(false);
    expect(mocks.interact).not.toHaveBeenCalled();

    fetchMock.mockClear();
    mocks.resolveAuthForUser.mockResolvedValue({ token: "auth" });
    mocks.interact.mockResolvedValue([]);
    await shouldTwinRespond("u1", { incoming: "hi", conversationId: "conv1" });
    expect(postedJson()["isThreadParticipant"]).toBe(false);

    fetchMock.mockClear();
    mocks.interact.mockResolvedValue({ not: "an array" });
    await shouldTwinRespond("u1", { incoming: "hi", conversationId: "conv1" });
    expect(postedJson()["isThreadParticipant"]).toBe(false);
  });

  it("keeps the recalled patterns when only the ignored-examples read fails", async () => {
    setRecall({ triage: [triageHit("t1")] });
    mocks.findMany.mockImplementation(async ({ where }: { where: Where }) => {
      if (where["shouldHaveResponded"] === true) return [{ channelType: null, triggerPreview: "c" }];
      throw new Error("db down");
    });
    await shouldTwinRespond("u1", { incoming: "hi" });
    expect(postedJson()["patterns"]).toEqual([
      'CORRECTION — the twin previously stayed SILENT but the user DID respond themselves (?): "c". Lean toward REPLYING to similar messages.',
      "t1",
    ]);
  });

  it("keeps the triage patterns when the broad recall fails", async () => {
    mocks.recall.mockImplementation(async (_bank: string, query: string) => {
      if (query === TRIAGE_QUERY) return [triageHit("t1")];
      if (query === BROAD_QUERY) throw new Error("hindsight down");
      return [];
    });
    await shouldTwinRespond("u1", { incoming: "hi" });
    expect(postedJson()["patterns"]).toEqual(["t1"]);
  });
});

describe("shouldTwinRespond: patterns", () => {
  it("recalls triage then broad with the exact bank, queries, tags, budget and token caps", async () => {
    await shouldTwinRespond("u1", { incoming: "hi" });
    expect(mocks.recall).toHaveBeenCalledWith(BANK_ID, TRIAGE_QUERY, { budget: "low", tags: [USER_TAG, TRIAGE_TAG], maxTokens: 1500 });
    expect(mocks.recall).toHaveBeenCalledWith(BANK_ID, BROAD_QUERY, { budget: "low", tags: [USER_TAG], maxTokens: 1500 });
    const queries = mocks.recall.mock.calls.map((c) => c[1]);
    expect(queries.indexOf(TRIAGE_QUERY)).toBeLessThan(queries.indexOf(BROAD_QUERY));
  });

  it("with 6+ triage hits skips the broad recall, caps the recalled ones at 6, and still appends the ignored examples", async () => {
    setRecall({
      triage: ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"].map(triageHit),
      broad: [userHit("b1")],
    });
    setFindMany({
      corrections: [
        { channelType: "dm", triggerPreview: "c1" },
        { channelType: null, triggerPreview: "c2" },
      ],
      ignored: [1, 2, 3, 4].map((n) => ({ channelType: "channel", triggerPreview: `i${n}` })),
    });
    await shouldTwinRespond("u1", { incoming: "hi" });
    expect(mocks.recall.mock.calls.map((c) => c[1])).not.toContain(BROAD_QUERY);
    const patterns = postedJson()["patterns"] as string[];
    expect(patterns).toEqual([
      'CORRECTION — the twin previously stayed SILENT but the user DID respond themselves (dm): "c1". Lean toward REPLYING to similar messages.',
      'CORRECTION — the twin previously stayed SILENT but the user DID respond themselves (?): "c2". Lean toward REPLYING to similar messages.',
      "t1",
      "t2",
      "t3",
      "t4",
      "t5",
      "t6",
      'Previously IGNORED (channel): "i1"',
      'Previously IGNORED (channel): "i2"',
      'Previously IGNORED (channel): "i3"',
      'Previously IGNORED (channel): "i4"',
    ]);
  });

  it("with fewer than 6 triage hits runs the broad recall and the cap of 6 holds across both sources", async () => {
    setRecall({
      triage: [
        triageHit("t1"),
        { text: "no-triage-tag", tags: [USER_TAG] }, // missing subsystem:triage -> filtered out
        triageHit("t2"),
        triageHit("t1"), // duplicate
        { text: "", tags: [USER_TAG, TRIAGE_TAG] }, // falsy text -> skipped
        { text: "no-tags" }, // tags undefined -> filtered out
      ],
      broad: [
        { text: "other-user", tags: ["user:u2"] }, // missing the user tag -> filtered out
        userHit("t2"), // duplicate of a triage pattern
        userHit("b1"),
        userHit("b2"),
        userHit("b3"),
        userHit("b4"), // the 6th pattern -> cap reached
        userHit("b5"), // past the cap
        userHit("b6"),
      ],
    });
    await shouldTwinRespond("u1", { incoming: "hi" });
    expect(postedJson()["patterns"]).toEqual(["t1", "t2", "b1", "b2", "b3", "b4"]);
  });

  it("orders triage hits, then broad hits, then ignored examples, deduping across all three", async () => {
    setRecall({ triage: [triageHit("shared"), triageHit("t1")], broad: [userHit("shared"), userHit("b1")] });
    setFindMany({
      ignored: [
        { channelType: "channel", triggerPreview: "x".repeat(200) },
        { channelType: null, triggerPreview: null }, // skipped
        { channelType: null, triggerPreview: "" }, // skipped
        { channelType: "dm", triggerPreview: "last" },
      ],
    });
    await shouldTwinRespond("u1", { incoming: "hi" });
    expect(postedJson()["patterns"]).toEqual([
      "shared",
      "t1",
      "b1",
      `Previously IGNORED (channel): "${"x".repeat(120)}"`,
      'Previously IGNORED (dm): "last"',
    ]);
  });

  it("reads the ignored examples and corrections with the exact queries", async () => {
    await shouldTwinRespond("u1", { incoming: "hi" });
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { userId: "u1", outcome: "ignored", triggerPreview: { not: null } },
      orderBy: { occurredAt: "desc" },
      take: 4,
      select: { channelType: true, triggerPreview: true },
    });
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { userId: "u1", shouldHaveResponded: true },
      orderBy: { occurredAt: "desc" },
      take: 4,
      select: { channelType: true, triggerPreview: true },
    });
  });

  it("formats corrections: skips empty previews, truncates to 120 chars, '?' for an unknown channel type", async () => {
    setFindMany({
      corrections: [
        { channelType: "dm", triggerPreview: "y".repeat(150) },
        { channelType: "dm", triggerPreview: null },
        { channelType: "dm", triggerPreview: "" },
        { channelType: null, triggerPreview: "ok" },
      ],
    });
    await shouldTwinRespond("u1", { incoming: "hi" });
    expect(postedJson()["patterns"]).toEqual([
      `CORRECTION — the twin previously stayed SILENT but the user DID respond themselves (dm): "${"y".repeat(120)}". Lean toward REPLYING to similar messages.`,
      'CORRECTION — the twin previously stayed SILENT but the user DID respond themselves (?): "ok". Lean toward REPLYING to similar messages.',
    ]);
  });
});

describe("shouldTwinRespond: relevant memories", () => {
  it("recalls with the message (first 800 chars) as the query and keeps at most 5 user-tagged hits, duplicates included", async () => {
    const incoming = "q".repeat(1000);
    setRecall({
      relevant: [
        { text: "other-user", tags: ["user:u2"] },
        userHit("r1"),
        userHit("r1"),
        { text: "no-tags" },
        userHit("r2"),
        userHit("r3"),
        userHit("r4"),
        userHit("r5"),
        userHit("r6"),
      ],
    });
    await shouldTwinRespond("u1", { incoming });
    expect(mocks.recall).toHaveBeenCalledWith(BANK_ID, "q".repeat(800), { budget: "low", tags: [USER_TAG], maxTokens: 1200 });
    expect(postedJson()["relevantContext"]).toEqual(["r1", "r1", "r2", "r3", "r4"]);
    // The body still carries the full, unsliced message.
    expect(postedJson()["incoming"]).toBe(incoming);
  });

  it("keeps the hits collected so far when a later hit breaks the loop", async () => {
    setRecall({ relevant: [userHit("r1"), null as unknown as Hit, userHit("r3")] });
    await shouldTwinRespond("u1", { incoming: "hi" });
    expect(postedJson()["relevantContext"]).toEqual(["r1"]);
  });
});

describe("shouldTwinRespond: gate events", () => {
  it("records the decision, LLM trace and classifier exchanges on success", async () => {
    const trace = { systemPrompt: "sys", userPrompt: "usr", response: "resp", thinking: "hmm", model: "m1" };
    const classifier = [{ purpose: "gate", backend: "jev", ms: 5, ok: true, state: "s", questionSpec: {}, answers: null, at: "now" }];
    clawReplies({ respond: false, confidence: 0.2, reason: "busy", source: "llm", trace, classifier });
    const d = await shouldTwinRespond("u1", {
      incoming: "hello there",
      channelName: "general",
      senderName: "alice",
      sourceMessageId: "msg1",
    });
    expect(d).toEqual({ respond: false, confidence: 0.2, reason: "busy", source: "llm" });
    expect(gateEventInput()).toStrictEqual({
      userId: "u1",
      incoming: "hello there",
      channelName: "general",
      senderName: "alice",
      sourceMessageId: "msg1",
      decision: { respond: false, confidence: 0.2, reason: "busy", source: "llm" },
      llm: trace,
      classifier,
      durationMs: expect.any(Number),
    });
  });

  it("normalises a sparse decision (defaults) and records null llm/classifier", async () => {
    clawReplies({ respond: true, classifier: "not-an-array" });
    const d = await shouldTwinRespond("u1", { incoming: "hi" });
    expect(d).toEqual({ respond: true, confidence: 0.5, reason: "", source: "llm" });
    expect(gateEventInput()).toStrictEqual({
      userId: "u1",
      incoming: "hi",
      decision: d,
      llm: null,
      classifier: null,
      durationMs: expect.any(Number),
    });
  });

  it("records an HTTP failure as a fail-closed error event", async () => {
    clawReplies({ error: "nope" }, 500);
    const d = await shouldTwinRespond("u1", { incoming: "hi", channelName: "general", sourceMessageId: "msg1" });
    expect(d).toBe(FAIL_CLOSED);
    expect(gateEventInput()).toStrictEqual({
      userId: "u1",
      incoming: "hi",
      channelName: "general",
      sourceMessageId: "msg1",
      decision: FAIL_CLOSED,
      llm: null,
      error: "gate LLM HTTP 500",
      durationMs: expect.any(Number),
    });
  });

  it("records an unusable response with the trace claw sent (or null)", async () => {
    const trace = { systemPrompt: "sys", userPrompt: "usr", response: "garbage", model: "m1" };
    clawReplies({ respond: "yes", trace });
    expect(await shouldTwinRespond("u1", { incoming: "hi", senderName: "alice" })).toBe(FAIL_CLOSED);
    expect(gateEventInput()).toStrictEqual({
      userId: "u1",
      incoming: "hi",
      senderName: "alice",
      decision: FAIL_CLOSED,
      llm: trace,
      error: "gate returned no usable decision",
      durationMs: expect.any(Number),
    });

    mocks.recordGateEvent.mockClear();
    clawReplies({});
    expect(await shouldTwinRespond("u1", { incoming: "hi" })).toBe(FAIL_CLOSED);
    expect(gateEventInput()).toMatchObject({ llm: null, error: "gate returned no usable decision" });
  });

  it("records a thrown fetch error, logs it, and fails closed", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    const d = await shouldTwinRespond("u1", { incoming: "hi", channelName: "general" });
    expect(d).toBe(FAIL_CLOSED);
    expect(mocks.loggerWarn).toHaveBeenCalledWith("[twin-respond-gate] client failed — fail-closed (stay silent)", {
      userId: "u1",
      err: "boom",
    });
    expect(gateEventInput()).toStrictEqual({
      userId: "u1",
      incoming: "hi",
      channelName: "general",
      decision: FAIL_CLOSED,
      llm: null,
      error: "gate client error: boom",
      durationMs: expect.any(Number),
    });
  });

  it("fails closed on an unparseable claw response body", async () => {
    fetchMock.mockResolvedValue(new Response("not json", { status: 200 }));
    expect(await shouldTwinRespond("u1", { incoming: "hi" })).toBe(FAIL_CLOSED);
    expect(gateEventInput()["error"]).toMatch(/^gate client error: /);
  });
});

describe("recordTwinSilence", () => {
  const decision = { respond: false, confidence: 0.3, reason: "r".repeat(400), source: "llm" };

  it("does nothing without a sourceMessageId", async () => {
    await recordTwinSilence("u1", { channelId: "ch1" }, decision);
    await recordTwinSilence("u1", { sourceMessageId: "", channelId: "ch1" }, decision);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("upserts a pending 'mention' signal keyed on the trigger message", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-03-04T05:06:07.000Z");
    vi.setSystemTime(now);
    await recordTwinSilence(
      "u1",
      {
        sourceMessageId: "msg1",
        channelId: "ch1",
        channelName: "general",
        senderId: "s1",
        occurredAt: "2026-03-01T00:00:00.000Z",
        triggerPreview: "p".repeat(300),
      },
      decision,
    );
    const gate = { gateDecision: "ignore", gateConfidence: 0.3, gateReason: "r".repeat(300), gateAt: now };
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { userId_sourceMessageId: { userId: "u1", sourceMessageId: "msg1" } },
      create: {
        userId: "u1",
        eventType: "mention",
        outcome: "pending",
        channelId: "ch1",
        channelName: "general",
        channelType: null,
        actorId: "s1",
        sourceMessageId: "msg1",
        triggerPreview: "p".repeat(240),
        occurredAt: new Date("2026-03-01T00:00:00.000Z"),
        ...gate,
      },
      update: gate,
    });
  });

  it("nulls every absent field and stamps occurredAt with now", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-03-04T05:06:07.000Z");
    vi.setSystemTime(now);
    await recordTwinSilence("u1", { sourceMessageId: "msg1" }, { respond: false, confidence: 0, reason: "short", source: "fail-closed" });
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { userId_sourceMessageId: { userId: "u1", sourceMessageId: "msg1" } },
      create: {
        userId: "u1",
        eventType: "mention",
        outcome: "pending",
        channelId: null,
        channelName: null,
        channelType: null,
        actorId: null,
        sourceMessageId: "msg1",
        triggerPreview: null,
        occurredAt: now,
        gateDecision: "ignore",
        gateConfidence: 0,
        gateReason: "short",
        gateAt: now,
      },
      update: { gateDecision: "ignore", gateConfidence: 0, gateReason: "short", gateAt: now },
    });
  });

  it("accepts a numeric occurredAt", async () => {
    await recordTwinSilence("u1", { sourceMessageId: "msg1", occurredAt: 1_700_000_000_000 }, decision);
    const create = (mocks.upsert.mock.calls[0]![0] as { create: { occurredAt: Date } }).create;
    expect(create.occurredAt).toEqual(new Date(1_700_000_000_000));
  });

  it("swallows an upsert failure and logs it", async () => {
    mocks.upsert.mockRejectedValue(new Error("db down"));
    await expect(recordTwinSilence("u1", { sourceMessageId: "msg1" }, decision)).resolves.toBeUndefined();
    expect(mocks.loggerWarn).toHaveBeenCalledWith("[twin-respond-gate] recordTwinSilence failed", { userId: "u1", err: "db down" });
  });
});
