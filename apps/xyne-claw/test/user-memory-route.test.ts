import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClassifierExchange, UserMemoryCandidatePayload, UserMemoryCuratorTrace } from "xyne-claw-shared";
import { userMemoryRouter } from "../src/routes/user-memory.js";
import { distillUserMemory } from "../src/user-memory-curator.js";
import { checkMemoryCandidates, type CandidateCheckSummary } from "../src/user-memory-candidate-check.js";
import { synthesizeMemoryFile } from "../src/twin-soul-synthesizer.js";
import { checkMemoryUpdate } from "../src/twin-soul-update-check.js";
import { decideRespond } from "../src/twin-respond-gate.js";

vi.mock("../src/user-memory-curator.js", () => ({ distillUserMemory: vi.fn() }));
// Partial mock: applyClassifierToTrace stays real so the trace annotation is what the route ships.
vi.mock("../src/user-memory-candidate-check.js", async (orig) => ({
  ...(await orig<object>()),
  checkMemoryCandidates: vi.fn(),
}));
vi.mock("../src/twin-soul-synthesizer.js", () => ({ synthesizeMemoryFile: vi.fn() }));
vi.mock("../src/twin-soul-update-check.js", () => ({ checkMemoryUpdate: vi.fn() }));
vi.mock("../src/twin-respond-gate.js", () => ({ decideRespond: vi.fn() }));

type Handler = (req: unknown, res: unknown) => Promise<void>;

/** The route's own handler, skipping validateS2SKey (the last layer in the route stack). */
function handlerFor(path: string): Handler {
  const layer = (userMemoryRouter as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: unknown }> } }> }).stack
    .find((l) => l.route?.path === path);
  const handlers = layer!.route!.stack;
  return handlers[handlers.length - 1]!.handle as Handler;
}

/** Drives a handler and returns the status code (200 unless status() was called) plus the exact JSON bytes sent. */
async function call(path: string, body: unknown): Promise<{ status: number; json: string }> {
  let status = 200;
  let sent: unknown;
  const res = {
    status(code: number) {
      status = code;
      return res;
    },
    json(b: unknown) {
      sent = b;
      return res;
    },
  };
  await handlerFor(path)({ body }, res);
  return { status, json: JSON.stringify(sent) };
}

const DISTILL = "/internal/user-memory/distill";
const SYNTH = "/internal/user-memory/synthesize-file";
const GATE = "/internal/user-memory/should-respond";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("POST /internal/user-memory/distill", () => {
  const WINDOW = { from: "2026-01-01T00:00:00Z", to: "2026-01-02T00:00:00Z" };
  const REC = { id: "r1", type: "message", ts: "2026-01-01T10:00:00Z", text: "hello" };

  it.each([
    ["no body", undefined],
    ["no userId", { window: WINDOW, records: [REC] }],
    ["no window.from", { userId: "u1", window: { to: WINDOW.to }, records: [REC] }],
    ["no window.to", { userId: "u1", window: { from: WINDOW.from }, records: [REC] }],
    ["records not an array", { userId: "u1", window: WINDOW, records: "nope" }],
  ])("400s when %s", async (_name, body) => {
    const r = await call(DISTILL, body);
    expect(r.status).toBe(400);
    expect(r.json).toBe(JSON.stringify({ success: false, error: "Missing userId, window.from/to, or records[]" }));
    expect(distillUserMemory).not.toHaveBeenCalled();
  });

  describe("when every record fails the shape filter", () => {
    const bad = [null, "str", { id: 1, type: "message", ts: "t", text: "x" }, { id: "a", type: "other", ts: "t", text: "x" }, { id: "a", type: "call", ts: 5, text: "x" }, { id: "a", type: "call", ts: "t" }];

    it("returns no candidates and no trace unless asked", async () => {
      const r = await call(DISTILL, { userId: "u1", window: WINDOW, records: bad });
      expect(r.status).toBe(200);
      expect(r.json).toBe(JSON.stringify({ success: true, candidates: [] }));
      expect(distillUserMemory).not.toHaveBeenCalled();
    });

    it("includes the minimal trace, reporting the route's own model, only when includeTrace is true", async () => {
      // The route resolves its model at import time (not the curator's LITELLM_AUTOMATION_MODEL), so never hard-code it.
      const model = process.env["LITELLM_MODEL"] ?? "claude-haiku-4-5-20251001";
      const r = await call(DISTILL, { userId: "u1", window: WINDOW, records: bad, includeTrace: true });
      expect(r.status).toBe(200);
      expect(r.json).toBe(JSON.stringify({
        success: true,
        candidates: [],
        trace: { model, durationMs: 0, prompt: "", promptChars: 0, emitted: [] },
      }));
      const notTrue = await call(DISTILL, { userId: "u1", window: WINDOW, records: [], includeTrace: "true" });
      expect(notTrue.json).toBe(JSON.stringify({ success: true, candidates: [] }));
    });
  });

  const PAYLOAD = (text: string): UserMemoryCandidatePayload => ({ text, subsystem: "preferences", signalScore: 0.8, groundedOnIds: ["r1"] });
  const cand = (text: string) => ({ text, subsystem: "preferences", signalScore: 0.9, groundedOnIds: ["r1"], verdict: "kept" as const });
  const ex = (purpose: string): ClassifierExchange => ({
    purpose, backend: "jev", ms: 7, ok: true, state: `state ${purpose}`, questionSpec: { q: purpose }, answers: { a: purpose }, at: "2026-01-01T00:00:00Z",
  });
  const LONG = "L".repeat(250);

  it("passes shape-filtered records and existingMemories to the curator and the classifier, then returns candidates", async () => {
    const candidates = [PAYLOAD("fact a")];
    vi.mocked(distillUserMemory).mockResolvedValue({ candidates, trace: { model: "m", durationMs: 1, prompt: "p", promptChars: 1, emitted: [] } });
    vi.mocked(checkMemoryCandidates).mockResolvedValue({ candidates, summary: null });
    const existing = [{ id: "m1", subsystem: "preferences", text: "likes tea" }];
    const r = await call(DISTILL, {
      userId: "u1",
      window: WINDOW,
      records: [REC, { id: "x", type: "bogus", ts: "t", text: "t" }, null],
      existingMemories: [existing[0], { id: "m2", subsystem: "preferences" }, null, { id: 3, subsystem: "s", text: "t" }],
    });
    expect(r.status).toBe(200);
    expect(r.json).toBe(JSON.stringify({ success: true, candidates }));
    expect(distillUserMemory).toHaveBeenCalledWith("u1", WINDOW, [REC], existing);
    expect(checkMemoryCandidates).toHaveBeenCalledWith(candidates, existing);
  });

  it("passes an empty existingMemories list when the field is missing or not an array", async () => {
    vi.mocked(distillUserMemory).mockResolvedValue({ candidates: [], trace: { model: "m", durationMs: 1, prompt: "p", promptChars: 1, emitted: [] } });
    vi.mocked(checkMemoryCandidates).mockResolvedValue({ candidates: [], summary: null });
    await call(DISTILL, { userId: "u1", window: WINDOW, records: [REC] });
    await call(DISTILL, { userId: "u1", window: WINDOW, records: [REC], existingMemories: "nope" });
    expect(distillUserMemory).toHaveBeenNthCalledWith(1, "u1", WINDOW, [REC], []);
    expect(distillUserMemory).toHaveBeenNthCalledWith(2, "u1", WINDOW, [REC], []);
  });

  it("annotates the trace with the classifier pass (drops, verdicts, 200-char keys) and returns the kept candidates", async () => {
    const trace: UserMemoryCuratorTrace = {
      model: "curator-model",
      durationMs: 12,
      prompt: "p",
      promptChars: 1,
      emitted: [
        cand("dup fact"),
        cand("noise fact"),
        cand("good fact"),
        cand("unchecked fact"),
        cand(LONG),
        { text: "already dropped", verdict: "dropped", dropReason: "low-signal" },
      ],
    };
    const summary: CandidateCheckSummary = {
      checked: 5,
      dropped: [
        { text: "dup fact", verdict: "duplicate", p: 0.9 },
        { text: "noise fact", verdict: "noise", p: 0.8 },
      ],
      verdicts: [
        { text: "dup fact", verdict: "duplicate", p: 0.9 },
        { text: "noise fact", verdict: "noise", p: 0.8 },
        { text: "good fact", verdict: "new", p: 0.75, worth: 0.6 },
        { text: LONG.slice(0, 200), verdict: "update", p: 0.55, worth: 0 },
      ],
      exchanges: [
        { text: "dup fact", exchange: ex("dup") },
        { text: "good fact", exchange: ex("good") },
        { text: "unchecked fact", exchange: ex("unchecked") },
        { text: LONG.slice(0, 200), exchange: ex("long") },
      ],
      unavailable: 1,
      ms: 42,
    };
    const kept = [PAYLOAD("good fact"), PAYLOAD("unchecked fact"), PAYLOAD(LONG)];
    vi.mocked(distillUserMemory).mockResolvedValue({ candidates: [PAYLOAD("all")], trace });
    vi.mocked(checkMemoryCandidates).mockResolvedValue({ candidates: kept, summary });

    const r = await call(DISTILL, { userId: "u1", window: WINDOW, records: [REC], includeTrace: true });

    expect(r.status).toBe(200);
    // Hand-derived from the original route-local markClassifierDrops: emitted stays in place, classifier is appended.
    const expectedTrace = {
      model: "curator-model",
      durationMs: 12,
      prompt: "p",
      promptChars: 1,
      emitted: [
        { ...cand("dup fact"), verdict: "dropped", jevVerdict: "duplicate", jevConfidence: 0.9, dropReason: "classifier-duplicate" },
        { ...cand("noise fact"), verdict: "dropped", jevVerdict: "noise", jevConfidence: 0.8, dropReason: "classifier-noise" },
        { ...cand("good fact"), jevVerdict: "new", jevConfidence: 0.75, jevScore: 0.6 },
        cand("unchecked fact"),
        { ...cand(LONG), jevVerdict: "update", jevConfidence: 0.55, jevScore: 0 },
        { text: "already dropped", verdict: "dropped", dropReason: "low-signal" },
      ],
      classifier: {
        checked: 5,
        kept: 3,
        dropped: 2,
        unavailable: 1,
        ms: 42,
        calls: [
          { text: "dup fact", verdict: "duplicate", confidence: 0.9, exchange: ex("dup") },
          { text: "good fact", verdict: "new", confidence: 0.75, worth: 0.6, exchange: ex("good") },
          { text: "unchecked fact", exchange: ex("unchecked") },
          { text: LONG.slice(0, 200), verdict: "update", confidence: 0.55, worth: 0, exchange: ex("long") },
        ],
      },
    };
    expect(r.json).toBe(JSON.stringify({ success: true, candidates: kept, trace: expectedTrace }));
    // The annotated emitted entries keep their full text; only the lookup key is sliced.
    expect(JSON.parse(r.json).trace.emitted[4].text).toHaveLength(250);
  });

  it("omits the annotated trace unless includeTrace is true", async () => {
    const kept = [PAYLOAD("good fact")];
    const summary: CandidateCheckSummary = { checked: 1, dropped: [], verdicts: [], exchanges: [], unavailable: 1, ms: 1 };
    vi.mocked(distillUserMemory).mockResolvedValue({ candidates: kept, trace: { model: "m", durationMs: 1, prompt: "p", promptChars: 1, emitted: [cand("good fact")] } });
    vi.mocked(checkMemoryCandidates).mockResolvedValue({ candidates: kept, summary });
    const r = await call(DISTILL, { userId: "u1", window: WINDOW, records: [REC] });
    expect(r.json).toBe(JSON.stringify({ success: true, candidates: kept }));
  });

  it("falls back to the curator's candidates and trace when the classifier check rejects", async () => {
    const candidates = [PAYLOAD("fact a"), PAYLOAD("fact b")];
    const trace: UserMemoryCuratorTrace = { model: "m", durationMs: 3, prompt: "p", promptChars: 1, emitted: [cand("fact a"), cand("fact b")] };
    vi.mocked(distillUserMemory).mockResolvedValue({ candidates, trace });
    vi.mocked(checkMemoryCandidates).mockRejectedValue(new Error("jev down"));
    const r = await call(DISTILL, { userId: "u1", window: WINDOW, records: [REC], includeTrace: true });
    expect(r.status).toBe(200);
    expect(r.json).toBe(JSON.stringify({ success: true, candidates, trace }));
  });

  it("returns the un-annotated trace when the classifier did not run (summary null)", async () => {
    const candidates = [PAYLOAD("fact a")];
    const trace: UserMemoryCuratorTrace = { model: "m", durationMs: 3, prompt: "p", promptChars: 1, emitted: [cand("fact a")] };
    vi.mocked(distillUserMemory).mockResolvedValue({ candidates, trace });
    vi.mocked(checkMemoryCandidates).mockResolvedValue({ candidates, summary: null });
    const r = await call(DISTILL, { userId: "u1", window: WINDOW, records: [REC], includeTrace: true });
    expect(r.json).toBe(JSON.stringify({ success: true, candidates, trace }));
  });

  it("500s with the error message when the curator throws, and a generic message for a non-Error", async () => {
    vi.mocked(distillUserMemory).mockRejectedValueOnce(new Error("curator exploded"));
    const r = await call(DISTILL, { userId: "u1", window: WINDOW, records: [REC] });
    expect(r.status).toBe(500);
    expect(r.json).toBe(JSON.stringify({ success: false, error: "curator exploded" }));

    vi.mocked(distillUserMemory).mockRejectedValueOnce("nope");
    const r2 = await call(DISTILL, { userId: "u1", window: WINDOW, records: [REC] });
    expect(r2.status).toBe(500);
    expect(r2.json).toBe(JSON.stringify({ success: false, error: "Internal error" }));
  });
});

describe("POST /internal/user-memory/synthesize-file", () => {
  const SYNTH_TRACE = { model: "m", durationMs: 5 };
  const okResult = { content: "# Soul", trace: SYNTH_TRACE } as unknown as Awaited<ReturnType<typeof synthesizeMemoryFile>>;
  const CHECK = { verdict: "accept", source: "jev", ms: 9 } as const;

  it.each([
    ["no body", undefined],
    ["no fileName", { facts: ["a"] }],
    ["empty fileName", { fileName: "", facts: ["a"] }],
    ["no facts", { fileName: "soul.md" }],
    ["facts not an array", { fileName: "soul.md", facts: "a" }],
  ])("400s when %s", async (_name, body) => {
    const r = await call(SYNTH, body);
    expect(r.status).toBe(400);
    expect(r.json).toBe(JSON.stringify({ success: false, error: "Missing fileName or facts[]" }));
    expect(synthesizeMemoryFile).not.toHaveBeenCalled();
  });

  it("synthesizes with defaults and returns success, content and trace (no check key)", async () => {
    vi.mocked(synthesizeMemoryFile).mockResolvedValue(okResult);
    const r = await call(SYNTH, { fileName: "soul.md", facts: ["a", "b"] });
    expect(r.status).toBe(200);
    expect(r.json).toBe(JSON.stringify({ success: true, content: "# Soul", trace: SYNTH_TRACE }));
    expect(vi.mocked(synthesizeMemoryFile).mock.calls[0]![0]).toStrictEqual({
      fileName: "soul.md",
      description: "",
      facts: ["a", "b"],
      maxChars: 20_000,
    });
    expect(checkMemoryUpdate).not.toHaveBeenCalled();
  });

  it("forwards typed optional fields and drops mistyped ones", async () => {
    vi.mocked(synthesizeMemoryFile).mockResolvedValue(okResult);
    await call(SYNTH, { fileName: "soul.md", facts: [], description: "d", maxChars: 500, currentContent: "old", preserveEdits: true });
    await call(SYNTH, { fileName: "soul.md", facts: [], description: 7, maxChars: "500", currentContent: 7, preserveEdits: "true" });
    expect(vi.mocked(synthesizeMemoryFile).mock.calls[0]![0]).toStrictEqual({
      fileName: "soul.md", description: "d", facts: [], maxChars: 500, currentContent: "old", preserveEdits: true,
    });
    expect(vi.mocked(synthesizeMemoryFile).mock.calls[1]![0]).toStrictEqual({
      fileName: "soul.md", description: "", facts: [], maxChars: 20_000,
    });
  });

  it("reports failure with content null and the synthesizer's error", async () => {
    vi.mocked(synthesizeMemoryFile).mockResolvedValue({ content: null, error: "llm-http-500" });
    const r = await call(SYNTH, { fileName: "soul.md", facts: ["a"] });
    expect(r.status).toBe(200);
    expect(r.json).toBe(JSON.stringify({ success: false, content: null, error: "llm-http-500" }));
  });

  it("scores the rewrite when check is true and there is content, appending the check last", async () => {
    vi.mocked(synthesizeMemoryFile).mockResolvedValue(okResult);
    vi.mocked(checkMemoryUpdate).mockResolvedValue(CHECK);
    const r = await call(SYNTH, { fileName: "soul.md", description: "d", facts: ["a", "b"], currentContent: "old", check: true });
    expect(r.status).toBe(200);
    expect(r.json).toBe(JSON.stringify({ success: true, content: "# Soul", trace: SYNTH_TRACE, check: CHECK }));
    expect(vi.mocked(checkMemoryUpdate).mock.calls[0]![0]).toStrictEqual({
      fileName: "soul.md", description: "d", oldContent: "old", newContent: "# Soul", facts: ["a", "b"],
    });
  });

  it("omits oldContent for a new file but still scores it", async () => {
    vi.mocked(synthesizeMemoryFile).mockResolvedValue(okResult);
    vi.mocked(checkMemoryUpdate).mockResolvedValue(CHECK);
    await call(SYNTH, { fileName: "soul.md", facts: ["a"], check: true });
    expect(vi.mocked(checkMemoryUpdate).mock.calls[0]![0]).toStrictEqual({
      fileName: "soul.md", description: "", newContent: "# Soul", facts: ["a"],
    });
  });

  it("does not score when the synthesizer produced no content", async () => {
    vi.mocked(synthesizeMemoryFile).mockResolvedValueOnce({ content: null, error: "no-tool-call" });
    const r = await call(SYNTH, { fileName: "soul.md", facts: ["a"], check: true });
    expect(r.json).toBe(JSON.stringify({ success: false, content: null, error: "no-tool-call" }));
    vi.mocked(synthesizeMemoryFile).mockResolvedValueOnce({ content: "" });
    const r2 = await call(SYNTH, { fileName: "soul.md", facts: ["a"], check: true });
    expect(r2.json).toBe(JSON.stringify({ success: false, content: "" }));
    expect(checkMemoryUpdate).not.toHaveBeenCalled();
  });

  it("only treats the boolean true as check", async () => {
    vi.mocked(synthesizeMemoryFile).mockResolvedValue(okResult);
    vi.mocked(checkMemoryUpdate).mockResolvedValue(CHECK);
    const r = await call(SYNTH, { fileName: "soul.md", facts: ["a"], check: "true" });
    expect(r.json).toBe(JSON.stringify({ success: true, content: "# Soul", trace: SYNTH_TRACE }));
    await call(SYNTH, { fileName: "soul.md", facts: ["a"], check: 1 });
    expect(checkMemoryUpdate).not.toHaveBeenCalled();
  });

  it("drops the check but keeps success when the update check rejects or resolves null", async () => {
    vi.mocked(synthesizeMemoryFile).mockResolvedValue(okResult);
    vi.mocked(checkMemoryUpdate).mockRejectedValueOnce(new Error("jev down"));
    const r = await call(SYNTH, { fileName: "soul.md", facts: ["a"], check: true });
    expect(r.status).toBe(200);
    expect(r.json).toBe(JSON.stringify({ success: true, content: "# Soul", trace: SYNTH_TRACE }));
    vi.mocked(checkMemoryUpdate).mockResolvedValueOnce(null);
    const r2 = await call(SYNTH, { fileName: "soul.md", facts: ["a"], check: true });
    expect(r2.json).toBe(JSON.stringify({ success: true, content: "# Soul", trace: SYNTH_TRACE }));
  });

  it("hands the same string-only facts list to the synthesizer and the update check", async () => {
    vi.mocked(synthesizeMemoryFile).mockResolvedValue(okResult);
    vi.mocked(checkMemoryUpdate).mockResolvedValue(CHECK);
    await call(SYNTH, { fileName: "soul.md", facts: ["a", 2, null, "b", { x: 1 }], check: true });
    expect(vi.mocked(synthesizeMemoryFile).mock.calls[0]![0].facts).toStrictEqual(["a", "b"]);
    expect(vi.mocked(checkMemoryUpdate).mock.calls[0]![0].facts).toStrictEqual(["a", "b"]);
  });

  it("forwards an empty currentContent as-is to both callees", async () => {
    vi.mocked(synthesizeMemoryFile).mockResolvedValue(okResult);
    vi.mocked(checkMemoryUpdate).mockResolvedValue(CHECK);
    await call(SYNTH, { fileName: "soul.md", facts: ["a"], currentContent: "", check: true });
    expect(vi.mocked(synthesizeMemoryFile).mock.calls[0]![0].currentContent).toBe("");
    expect(vi.mocked(checkMemoryUpdate).mock.calls[0]![0].oldContent).toBe("");
  });

  it("500s with the message when the synthesizer throws", async () => {
    vi.mocked(synthesizeMemoryFile).mockRejectedValue(new Error("synth exploded"));
    const r = await call(SYNTH, { fileName: "soul.md", facts: ["a"] });
    expect(r.status).toBe(500);
    expect(r.json).toBe(JSON.stringify({ success: false, error: "synth exploded" }));
  });
});

describe("POST /internal/user-memory/should-respond", () => {
  const FAIL_CLOSED_EMPTY = JSON.stringify({ respond: false, confidence: 0, reason: "no incoming text", source: "fail-closed" });
  const FAIL_CLOSED_ERROR = JSON.stringify({ respond: false, confidence: 0, reason: "gate error — stay silent", source: "fail-closed" });
  const DECISION = { respond: true, confidence: 0.8, reason: "matches a learned pattern", source: "llm" } as const;

  it.each([
    ["no body", undefined],
    ["no incoming", {}],
    ["incoming not a string", { incoming: 5 }],
    ["blank incoming", { incoming: "  \n " }],
  ])("stays silent without calling the gate when %s", async (_name, body) => {
    const r = await call(GATE, body);
    expect(r.status).toBe(200);
    expect(r.json).toBe(FAIL_CLOSED_EMPTY);
    expect(decideRespond).not.toHaveBeenCalled();
  });

  it("forwards exactly the typed fields and returns the decision untouched", async () => {
    vi.mocked(decideRespond).mockResolvedValue(DECISION);
    const r = await call(GATE, {
      incoming: " can you review? ",
      channelName: "eng",
      channelType: "public",
      senderName: "Sam",
      patterns: ["p1"],
      relevantContext: ["c1"],
      stats: "replied 4/5",
      isDirectMessage: true,
      isThreadParticipant: true,
      includeTrace: true,
      unknownField: "ignored",
    });
    expect(r.status).toBe(200);
    expect(r.json).toBe(JSON.stringify(DECISION));
    expect(vi.mocked(decideRespond).mock.calls[0]![0]).toStrictEqual({
      incoming: " can you review? ",
      channelName: "eng",
      channelType: "public",
      senderName: "Sam",
      patterns: ["p1"],
      relevantContext: ["c1"],
      stats: "replied 4/5",
      isDirectMessage: true,
      isThreadParticipant: true,
      includeTrace: true,
    });
  });

  it("always sends patterns and relevantContext, defaulting to [] when absent or not an array", async () => {
    vi.mocked(decideRespond).mockResolvedValue(DECISION);
    await call(GATE, { incoming: "hi" });
    await call(GATE, { incoming: "hi", patterns: "nope", relevantContext: {} });
    for (const i of [0, 1]) {
      const arg = vi.mocked(decideRespond).mock.calls[i]![0];
      expect(Object.keys(arg)).toStrictEqual(["incoming", "patterns", "relevantContext"]);
      expect(arg.patterns).toStrictEqual([]);
      expect(arg.relevantContext).toStrictEqual([]);
    }
  });

  it("keeps only string entries of patterns and relevantContext", async () => {
    vi.mocked(decideRespond).mockResolvedValue(DECISION);
    await call(GATE, { incoming: "hi", patterns: ["a", 1, null, "b"], relevantContext: [false, "c", { x: 1 }] });
    const arg = vi.mocked(decideRespond).mock.calls[0]![0];
    expect(arg.patterns).toStrictEqual(["a", "b"]);
    expect(arg.relevantContext).toStrictEqual(["c"]);
  });

  it("omits mistyped optional fields instead of forwarding them", async () => {
    vi.mocked(decideRespond).mockResolvedValue(DECISION);
    await call(GATE, {
      incoming: "hi",
      channelName: 1,
      channelType: {},
      senderName: ["Sam"],
      stats: 3,
      isDirectMessage: "true",
      isThreadParticipant: 1,
      includeTrace: "true",
    });
    expect(vi.mocked(decideRespond).mock.calls[0]![0]).toStrictEqual({ incoming: "hi", patterns: [], relevantContext: [] });
  });

  it("does not forward false flags", async () => {
    vi.mocked(decideRespond).mockResolvedValue(DECISION);
    await call(GATE, { incoming: "hi", isDirectMessage: false, isThreadParticipant: false, includeTrace: false });
    expect(vi.mocked(decideRespond).mock.calls[0]![0]).toStrictEqual({ incoming: "hi", patterns: [], relevantContext: [] });
  });

  it("fails closed with a 200 when the gate throws", async () => {
    vi.mocked(decideRespond).mockRejectedValue(new Error("gate exploded"));
    const r = await call(GATE, { incoming: "hi" });
    expect(r.status).toBe(200);
    expect(r.json).toBe(FAIL_CLOSED_ERROR);
  });
});
