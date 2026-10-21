import { describe, expect, it, vi } from "vitest";

vi.mock("../redis.js", () => ({ redisService: { publish: vi.fn() } }));
const partialParts = vi.fn();
vi.mock("../repositories/index.js", () => ({
  agentRunRepository: {},
  chatMessageRepository: { partialParts: (id: string) => partialParts(id) },
}));

const {
  alignPartsWithAnswer,
  applyPartDelta,
  applyToolPart,
  finalTurnFields,
  normalizeAssistantParts,
  reasoningText,
} = await import("./chat-run-record.js");
type AssistantPart = import("./chat-run-record.js").AssistantPart;

describe("turn parts", () => {
  it("folds the stream in order, one part per claw block", () => {
    let parts: AssistantPart[] = [];
    parts = applyPartDelta(parts, { type: "reasoning", partId: "1:0", delta: "Let me ", at: "t0" });
    parts = applyPartDelta(parts, { type: "reasoning", partId: "1:0", delta: "look.", at: "t1" });
    parts = applyPartDelta(parts, { type: "text", partId: "1:1", delta: "Searching.", at: "t2" });
    parts = applyToolPart(parts, { toolCallId: "call_a" }, "t3");
    parts = applyToolPart(parts, { toolCallId: "call_child", parentToolCallId: "call_a" }, "t4");
    parts = applyToolPart(parts, { toolCallId: "call_a" }, "t5");
    parts = applyPartDelta(parts, { type: "reasoning", partId: "2:0", delta: "Found it.", at: "t6" });
    expect(parts).toEqual([
      { type: "reasoning", id: "1:0", text: "Let me look.", startedAt: "t0", endedAt: "t2" },
      { type: "text", id: "1:1", text: "Searching." },
      { type: "tool", id: "call_a" },
      { type: "reasoning", id: "2:0", text: "Found it.", startedAt: "t6" },
    ]);
  });

  it("without partIds (an older claw), starts a new part when the type changes", () => {
    let parts: AssistantPart[] = [];
    for (const [type, delta] of [["reasoning", "a"], ["reasoning", "b"], ["text", "c"], ["reasoning", "d"]] as const) {
      parts = applyPartDelta(parts, { type, delta });
    }
    expect(parts.map((p) => (p.type === "tool" ? p.type : `${p.type}:${p.text}`))).toEqual(["reasoning:ab", "text:c", "reasoning:d"]);
  });

  it("reasoningText joins every thinking block", () => {
    expect(
      reasoningText([
        { type: "reasoning", id: "1", text: "one " },
        { type: "text", id: "2", text: "x" },
        { type: "reasoning", id: "3", text: "two" },
      ]),
    ).toBe("one\n\ntwo");
  });

  it("alignPartsWithAnswer ends the timeline in exactly the stored answer", () => {
    const parts: AssistantPart[] = [
      { type: "text", id: "a", text: "Looking." },
      { type: "tool", id: "t" },
      { type: "text", id: "b", text: "Answer." },
      { type: "text", id: "c", text: "draft", superseded: true },
    ];
    expect(alignPartsWithAnswer(parts, "Answer.", "Answer.")).toBe(parts);
    const withSources = alignPartsWithAnswer(parts, "Answer.", "Answer.\n\nSources: [1]")!;
    expect(withSources[2]).toEqual({ type: "text", id: "b", text: "Answer.\n\nSources: [1]" });
    expect(withSources[3]).toEqual(parts[3]);
    expect(alignPartsWithAnswer(parts, "Answer.", "Something went wrong")).toBeNull();
    expect(alignPartsWithAnswer([{ type: "tool", id: "t" }], "", "Rescued")).toEqual([
      { type: "tool", id: "t" },
      { type: "text", id: "final", text: "Rescued" },
    ]);
  });

  it("normalizeAssistantParts keeps only well-formed parts", () => {
    expect(normalizeAssistantParts(null)).toBeNull();
    expect(normalizeAssistantParts([{ type: "bogus", id: "x" }])).toBeNull();
    expect(
      normalizeAssistantParts([
        { type: "text", id: "t", text: "hi", extra: 1 },
        { type: "tool" },
        { type: "tool", id: "a" },
        { type: "reasoning", id: "r", text: "x", startedAt: "s", endedAt: 5 },
      ]),
    ).toEqual([
      { type: "text", id: "t", text: "hi" },
      { type: "tool", id: "a" },
      { type: "reasoning", id: "r", text: "x", startedAt: "s" },
    ]);
  });
});

describe("finalTurnFields", () => {
  const parts = [
    { type: "reasoning", id: "1:0", text: "Think." },
    { type: "text", id: "1:1", text: "Answer." },
  ];

  it("a completed run stores its parts, lined up with the stored answer", async () => {
    const turn = await finalTurnFields({ status: "completed", modelAnswer: "Answer.", storedAnswer: "Answer. [1]", callbackParts: parts, callbackReasoning: "Think." });
    expect(turn).toEqual({ parts: [parts[0], { type: "text", id: "1:1", text: "Answer. [1]" }] });
  });

  it("anything else stores no parts and the whole thinking — from the callback, else the partial parts", async () => {
    expect(await finalTurnFields({ status: "failed", modelAnswer: "", storedAnswer: "Error", callbackParts: parts, callbackReasoning: " Think. " })).toEqual({ parts: null, reasoning: "Think." });
    partialParts.mockResolvedValueOnce(parts);
    expect(await finalTurnFields({ status: "cancelled", modelAnswer: "", storedAnswer: "", callbackParts: null, callbackReasoning: null, assistantMessageId: "m1" })).toEqual({ parts: null, reasoning: "Think." });
    expect(partialParts).toHaveBeenCalledWith("m1");
  });
});
