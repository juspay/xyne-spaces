import { describe, it, expect } from "vitest";
import { resolvePromptChange, PROMPT_FULL_REPLACEMENT_MAX_CHARS } from "./prompt-edits.js";

const CURRENT = [
  "You are the release-notes writer.",
  "## Rules",
  "- Keep entries under one line.",
  "- Never invent ticket numbers.",
].join("\n");

describe("resolvePromptChange", () => {
  it("returns no change when neither mode is supplied", () => {
    expect(resolvePromptChange({}, CURRENT)).toEqual({});
  });

  it("applies anchored edits in order against the current prompt", () => {
    const r = resolvePromptChange(
      {
        promptEdits: [
          { oldText: "- Keep entries under one line.", newText: "- Keep entries under two lines." },
          { oldText: "## Rules", newText: "## Rules\n- Always cite the PR." },
        ],
      },
      CURRENT,
    );
    expect(r.error).toBeUndefined();
    expect(r.prompt).toContain("- Keep entries under two lines.");
    expect(r.prompt).toContain("- Always cite the PR.");
    expect(r.prompt).toContain("Never invent ticket numbers.");
  });

  it("rejects an anchor that is missing, with re-read guidance", () => {
    const r = resolvePromptChange({ promptEdits: [{ oldText: "not in the prompt", newText: "x" }] }, CURRENT);
    expect(r.error).toContain("not found in the current prompt");
    expect(r.error).toContain("read the current prompt first");
  });

  it("rejects an ambiguous anchor instead of guessing which occurrence", () => {
    const r = resolvePromptChange({ promptEdits: [{ oldText: "one line", newText: "x" }] }, CURRENT + "\none line");
    expect(r.error).toContain("matches more than once");
  });

  it("rejects supplying both modes at once", () => {
    const r = resolvePromptChange({ systemPrompt: "new", promptEdits: [{ oldText: "a", newText: "b" }] }, CURRENT);
    expect(r.error).toContain("not both");
  });

  it("rejects edits that would empty the prompt", () => {
    const r = resolvePromptChange({ promptEdits: [{ oldText: CURRENT, newText: "  " }] }, CURRENT);
    expect(r.error).toContain("empty");
  });

  it("allows full replacement only while the current prompt is small", () => {
    expect(resolvePromptChange({ systemPrompt: "short new prompt" }, CURRENT)).toEqual({ prompt: "short new prompt" });
    const big = "x".repeat(PROMPT_FULL_REPLACEMENT_MAX_CHARS + 1);
    const r = resolvePromptChange({ systemPrompt: "short new prompt" }, big);
    // The gate is on the CURRENT prompt's size: a truncated tool argument
    // overwriting a large prompt is the failure being prevented.
    expect(r.error).toContain("too large for full-replacement mode");
    expect(r.error).toContain("promptEdits");
  });

  it("still lets anchored edits change a large prompt", () => {
    const big = "x".repeat(PROMPT_FULL_REPLACEMENT_MAX_CHARS) + "\nUNIQUE ANCHOR LINE";
    const r = resolvePromptChange({ promptEdits: [{ oldText: "UNIQUE ANCHOR LINE", newText: "REPLACED" }] }, big);
    expect(r.error).toBeUndefined();
    expect(r.prompt?.endsWith("REPLACED")).toBe(true);
  });
});
