import { test, expect, vi, beforeEach } from "vitest";
import type { UserMemoryRecord } from "xyne-claw-shared";

// Mock the LiteLLM transport so we script the tool-call `arguments` per test.
const fetchMock = vi.fn();
vi.mock("../src/litellm-retry.js", () => ({
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

test("empty-or-too-long and malformed drop reasons", async () => {
  const longText = "x".repeat(1_600);
  fetchMock.mockResolvedValue(
    okResponse(
      JSON.stringify({
        candidates: [
          { text: "   ", subsystem: "style", signalScore: 0.9, groundedOnIds: ["r1"] }, // empty
          { text: longText, subsystem: "style", signalScore: 0.9, groundedOnIds: ["r1"] }, // too long
          "not-an-object", // malformed
        ],
      }),
    ),
  );

  const { candidates, trace } = await run([rec("r1")]);
  expect(candidates).toHaveLength(0);
  expect(trace.emitted).toHaveLength(3);
  expect(trace.emitted[0]).toMatchObject({ verdict: "dropped", dropReason: "empty-or-too-long" });
  expect(trace.emitted[1]).toMatchObject({ verdict: "dropped", dropReason: "empty-or-too-long" });
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
