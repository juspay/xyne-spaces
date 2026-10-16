import { describe, expect, it } from "vitest";
import { TurnParts } from "../src/turn-parts.js";

/** Replays what the session subscriber sees for one run: two LLM calls with
 *  thinking, narration and two parallel tool calls, then a citation rewrite. */
function sampleRun(): TurnParts {
  const parts = new TurnParts();
  const id = TurnParts.partId;
  parts.delta("reasoning", id(1, 0), "Plan the ", "t0");
  parts.delta("reasoning", id(1, 0), "search.", "t1");
  parts.endReasoning(id(1, 0), "t2");
  parts.delta("text", id(1, 1), "Let me look that up.", "t3");
  parts.tool("call-a", "t4");
  parts.tool("call-b", "t4");
  parts.tool("call-a", "t5"); // a repeated start is ignored
  parts.delta("reasoning", id(2, 0), "Compare.", "t6");
  parts.delta("text", id(2, 1), "Answer without citations.", "t7");
  parts.supersedeTrailingText(); // citation reflection nudge
  parts.delta("text", id(3, 0), "Answer [clf-x#1].", "t8");
  return parts;
}

describe("TurnParts", () => {
  it("records the run's thinking, text and tools in the order they happened", () => {
    const parts = sampleRun().finish("t9");
    expect(parts.map((p) => [p.type, p.id])).toEqual([
      ["reasoning", "1:0"],
      ["text", "1:1"],
      ["tool", "call-a"],
      ["tool", "call-b"],
      ["reasoning", "2:0"],
      ["text", "2:1"],
      ["text", "3:0"],
    ]);
    expect(parts[0]).toMatchObject({ text: "Plan the search.", startedAt: "t0", endedAt: "t2" });
    expect(parts[4]).toMatchObject({ startedAt: "t6", endedAt: "t7" }); // closed by the next part
  });

  it("marks the draft a rewrite nudge replaces, keeping earlier narration", () => {
    const parts = sampleRun().finish();
    expect(parts.find((p) => p.id === "2:1")).toMatchObject({ superseded: true });
    expect(parts.find((p) => p.id === "1:1")).not.toHaveProperty("superseded");
    expect(parts.find((p) => p.id === "3:0")).not.toHaveProperty("superseded");
  });

  it("keeps the streamed answer when it is what gets delivered, sanitized the same way", () => {
    const aligned = TurnParts.alignFinalAnswer(sampleRun().finish(), "Let me look that up.\n\nAnswer [1].", (t) =>
      t.replace("[clf-x#1]", "[1]"),
    );
    expect(aligned.at(-1)).toMatchObject({ id: "3:0", text: "Answer [1]." });
    expect(aligned.some((p) => p.id === "final")).toBe(false);
  });

  it("ends in the delivered answer when it did not come from the last streamed text", () => {
    // e.g. the answer arrived through a submit-response tool call
    const parts = new TurnParts();
    parts.delta("text", "1:0", "Working on it.");
    parts.tool("submit");
    const aligned = TurnParts.alignFinalAnswer(parts.finish(), "The delivered answer.");
    expect(aligned.map((p) => [p.id, p.type === "text" ? p.superseded ?? false : "-"])).toEqual([
      ["1:0", false],
      ["submit", "-"],
      ["final", false],
    ]);

    // …or the trailing text is not the end of what was delivered
    const other = new TurnParts();
    other.delta("text", "1:0", "draft");
    const replaced = TurnParts.alignFinalAnswer(other.finish(), "rescued answer");
    expect(replaced.map((p) => [p.id, (p as { superseded?: true }).superseded ?? false])).toEqual([
      ["1:0", true],
      ["final", false],
    ]);
  });
});
