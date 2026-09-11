import { test, expect, vi, beforeEach } from "vitest";
import type { UserMemoryRecord } from "xyne-claw-shared";

// Mock the LiteLLM transport so we script the tool-call `arguments` per test.
const fetchMock = vi.fn();
vi.mock("@xyne/litellm-client", () => ({
  fetchLiteLLMWithRetry: fetchMock,
}));

/** Build a fake OK Response carrying a forced tool_call with the given
 *  arguments string, plus optional usage. */
function okResponse(argumentsJson: string, usage?: { prompt_tokens?: number; completion_tokens?: number }) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { tool_calls: [{ function: { arguments: argumentsJson } }] } }],
      ...(usage ? { usage } : {}),
    }),
    text: async () => "",
  };
}

/** A response with no tool_call in it (the "no-tool-call" failure stage). */
function noToolCallResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: {} }] }),
    text: async () => "",
  };
}

const rec = (id: string, text = "some text"): UserMemoryRecord => ({
  id,
  type: "message",
  ts: "2026-07-01T00:00:00.000Z",
  text,
});

const WINDOW = { from: "2026-06-01T00:00:00.000Z", to: "2026-07-01T00:00:00.000Z" };

async function run(records: UserMemoryRecord[]) {
  const { distillUserMemory } = await import("../src/user-memory-curator.js");
  return distillUserMemory("u1", WINDOW, records);
}

beforeEach(() => {
  process.env["LITELLM_API_KEY"] = "test-key";
  fetchMock.mockReset();
});

test("kept + dropped verdicts with correct dropReasons and 1:1 kept↔candidates", async () => {
  fetchMock.mockResolvedValue(
    okResponse(
      JSON.stringify({
        candidates: [
          // kept
          { text: "The user owns the curator pipeline", subsystem: "projects", signalScore: 0.9, groundedOnIds: ["r1"] },
          // low-signal
          { text: "The user writes docs", subsystem: "docs", signalScore: 0.4, groundedOnIds: ["r1"] },
          // ungrounded (id not in batch)
          { text: "The user uses BullMQ", subsystem: "expertise", signalScore: 0.95, groundedOnIds: ["nope"] },
          // bad-subsystem
          { text: "The user is nice", subsystem: "vibes", signalScore: 0.9, groundedOnIds: ["r1"] },
        ],
      }),
      { prompt_tokens: 123, completion_tokens: 45 },
    ),
  );

  const { candidates, trace } = await run([rec("r1"), rec("r2")]);

  // Return value: only the kept candidate.
  expect(candidates).toHaveLength(1);
  expect(candidates[0]).toEqual({
    text: "The user owns the curator pipeline",
    subsystem: "projects",
    signalScore: 0.9,
    groundedOnIds: ["r1"],
  });

  // Trace: one emitted entry per input candidate, in order.
  expect(trace.emitted).toHaveLength(4);
  expect(trace.emitted[0]).toMatchObject({ verdict: "kept" });
  expect(trace.emitted[0]!.dropReason).toBeUndefined();
  expect(trace.emitted[1]).toMatchObject({ verdict: "dropped", dropReason: "low-signal" });
  expect(trace.emitted[2]).toMatchObject({ verdict: "dropped", dropReason: "ungrounded" });
  expect(trace.emitted[3]).toMatchObject({ verdict: "dropped", dropReason: "bad-subsystem" });

  // kept emitted entries correspond 1:1 with the returned candidates.
  const keptTexts = trace.emitted.filter((e) => e.verdict === "kept").map((e) => e.text);
  expect(keptTexts).toEqual(candidates.map((c) => c.text));

  // Metadata is captured.
  expect(trace.model).toBeTruthy();
  expect(trace.promptChars).toBeGreaterThan(0);
  expect(trace.prompt.length).toBeGreaterThan(0);
  expect(trace.usage).toEqual({ promptTokens: 123, completionTokens: 45 });
  expect(trace.error).toBeUndefined();
  expect(trace.rawResponse).toContain("owns the curator pipeline");
});

test("empty and malformed candidates are dropped while long candidates are kept", async () => {
  const longText = "x".repeat(1_600);
  fetchMock.mockResolvedValue(
    okResponse(
      JSON.stringify({
        candidates: [
          { text: "   ", subsystem: "style", signalScore: 0.9, groundedOnIds: ["r1"] }, // empty
          { text: longText, subsystem: "style", signalScore: 0.9, groundedOnIds: ["r1"] }, // long but valid
          "not-an-object", // malformed
        ],
      }),
    ),
  );

  const { candidates, trace } = await run([rec("r1")]);
  expect(candidates).toHaveLength(1);
  expect(candidates[0]?.text).toBe(longText);
  expect(trace.emitted).toHaveLength(3);
  expect(trace.emitted[0]).toMatchObject({ verdict: "dropped", dropReason: "empty" });
  expect(trace.emitted[1]).toMatchObject({ verdict: "kept", text: longText });
  expect(trace.emitted[2]).toMatchObject({ verdict: "dropped", dropReason: "malformed" });
});

test("no tool_call → error trace, empty candidates and emitted", async () => {
  fetchMock.mockResolvedValue(noToolCallResponse());

  const { candidates, trace } = await run([rec("r1")]);
  expect(candidates).toEqual([]);
  expect(trace.error).toBe("no-tool-call");
  expect(trace.emitted).toEqual([]);
  expect(trace.rawResponse).toBeUndefined();
  expect(trace.prompt.length).toBeGreaterThan(0);
});

test("candidates return value is unchanged vs the kept emitted entries", async () => {
  fetchMock.mockResolvedValue(
    okResponse(
      JSON.stringify({
        candidates: [
          { text: "fact A", subsystem: "context", signalScore: 0.8, groundedOnIds: ["r1", "bad"] },
          { text: "fact B", subsystem: "expertise", signalScore: 0.7, groundedOnIds: ["r2"] },
        ],
      }),
    ),
  );

  const { candidates, trace } = await run([rec("r1"), rec("r2")]);
  const kept = trace.emitted.filter((e) => e.verdict === "kept");
  expect(kept.map((e) => e.text)).toEqual(candidates.map((c) => c.text));
  // groundedOnIds on the kept trace entry is filtered to the valid input ids,
  // matching what the returned candidate carries.
  expect(kept[0]!.groundedOnIds).toEqual(candidates[0]!.groundedOnIds);
  expect(candidates[0]!.groundedOnIds).toEqual(["r1"]);
});

test("accepts a 200-record batch without truncating the grounding set", async () => {
  fetchMock.mockResolvedValue(
    okResponse(
      JSON.stringify({
        candidates: [
          {
            text: "The user follows a recurring acknowledgement pattern",
            subsystem: "style",
            signalScore: 0.9,
            groundedOnIds: ["r199"],
          },
        ],
      }),
    ),
  );

  const records = Array.from({ length: 200 }, (_, i) => rec(`r${i}`, `message ${i}`));
  const { candidates } = await run(records);

  expect(candidates).toHaveLength(1);
  expect(candidates[0]!.groundedOnIds).toEqual(["r199"]);
});

test("accepts up to 100 candidates and hard-caps excess model output", async () => {
  const emitted = Array.from({ length: 101 }, (_, i) => ({
    text: `Concrete grounded fact ${i}`,
    subsystem: "projects",
    signalScore: 0.9,
    groundedOnIds: ["r1"],
  }));
  fetchMock.mockResolvedValue(okResponse(JSON.stringify({ candidates: emitted })));

  const { candidates, trace } = await run([rec("r1")]);

  expect(candidates).toHaveLength(100);
  expect(trace.emitted).toHaveLength(100);
  expect(candidates.at(-1)?.text).toBe("Concrete grounded fact 99");
});

// ── all-ungrounded: retry, then salvage ──────────────────────────────────────
// Reproduces the production case where the curator returned a full set of good
// candidates but every groundedOnIds entry cited an id absent from the batch.
// Previously each such candidate was dropped as "ungrounded", the attempt still
// reported ok:true with zero candidates, no retry fired, and the whole batch was
// silently lost.

/** The shape seen in prod: valid text/subsystem/signalScore, foreign ids. */
const PROD_SHAPED_UNGROUNDED = JSON.stringify({
  candidates: [
    {
      text: "When someone thanks the user in #xyne-spaces, they acknowledge it with only a thumbs-up reaction and no text.",
      subsystem: "style",
      signalScore: 1,
      groundedOnIds: ["cmstbntfh0xqn5501pwkwu3p9"],
    },
    {
      text: "The user declines twin-drafted replies that explain bugs with long technical monologues and a casual register.",
      subsystem: "style",
      signalScore: 0.9,
      groundedOnIds: ["cmstb6dod0xhl5501ni115ni5", "cmstbnema0xqk5501os09umho"],
    },
    {
      text: "The user is listed as owner of the Sev2 slash command custom message workstream, marked In Progress.",
      subsystem: "projects",
      signalScore: 1,
      groundedOnIds: ["cmsyes5vp038z5s012id8hphy"],
    },
  ],
});

test("all-ungrounded is retried instead of silently returning zero candidates", async () => {
  // Attempt 1 cites unknown ids; attempt 2 cites a real record id.
  fetchMock
    .mockResolvedValueOnce(okResponse(PROD_SHAPED_UNGROUNDED))
    .mockResolvedValueOnce(
      okResponse(
        JSON.stringify({
          candidates: [
            { text: "The user owns the Sev2 slash command workstream", subsystem: "projects", signalScore: 0.95, groundedOnIds: ["r1"] },
          ],
        }),
      ),
    );

  const out = await run([rec("r1"), rec("r2")]);

  // The retry actually happened, and its result is what we returned.
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(out.trace.attempts).toBe(2);
  expect(out.candidates).toHaveLength(1);
  expect(out.candidates[0]?.groundedOnIds).toEqual(["r1"]);
  expect(out.trace.error).toBeUndefined();
});

test("all-ungrounded after every retry is salvaged with batch-level grounding", async () => {
  // The model never cites a known id, on any attempt.
  fetchMock.mockResolvedValue(okResponse(PROD_SHAPED_UNGROUNDED));

  const out = await run([rec("r1"), rec("r2")]);

  // Retries were exhausted rather than giving up after one call.
  expect(fetchMock).toHaveBeenCalledTimes(3);

  // The batch is NOT lost: all three candidates survive, re-grounded on the
  // whole batch so sourceRefs still resolve downstream.
  expect(out.candidates).toHaveLength(3);
  for (const c of out.candidates) {
    expect(c.groundedOnIds).toEqual(["r1", "r2"]);
  }
  expect(out.candidates.map((c) => c.subsystem).sort()).toEqual(["projects", "style", "style"]);

  // The salvage is visible in the trace rather than silent.
  expect(out.trace.error).toBe("all-ungrounded-salvaged");
  expect(out.trace.emitted?.every((e) => e.verdict === "kept")).toBe(true);
});

test("a genuinely empty batch still returns zero candidates and is not salvaged", async () => {
  // No candidates at all is a real "nothing worth remembering" result — it must
  // not be confused with the citation failure above.
  fetchMock.mockResolvedValue(okResponse(JSON.stringify({ candidates: [] })));

  const out = await run([rec("r1")]);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(out.candidates).toHaveLength(0);
  expect(out.trace.error).toBeUndefined();
});
