import { describe, expect, it } from "vitest";
import { designVoiceCheck, runVoiceCheck } from "./tools.js";
import { getCustomTool } from "../registry.js";

/**
 * The tool shell. The check itself is covered in voice-tone-qa.test.ts — what
 * matters here is that a run can reach it: rules resolved from the right place,
 * a report the model can act on, and nothing that blocks a delivery.
 */

const DESIGN_MD = `# Acme

## Voice

- **Tone:** direct, concise
- **Prefer:** "use" over "utilize"
- **Avoid:** delve, seamlessly
- **Headings:** sentence case
- **Buttons:** sentence case
`;

const FAILING = `<h1>The Future of Work</h1>
<p>We seamlessly utilize your data.</p>
<button>Start Free Trial</button>`;

const CLEAN = `<h1>Ship faster with Xyne</h1>
<p>Use your data from day one.</p>
<button>Start my trial</button>`;

describe("runVoiceCheck", () => {
  it("fails content that breaks the rules, and says which rules", () => {
    const result = runVoiceCheck({ content: FAILING, designMd: DESIGN_MD });
    expect(result.passed).toBe(false);
    expect(result.findings.map((finding) => finding.type)).toEqual([
      "heading-casing",
      "banned-phrase",
      "preferred-wording",
      "button-casing",
    ]);
    // The rules come back too, so a caller can show what was checked rather
    // than only what failed.
    expect(result.rules.bannedPhrases).toEqual(["delve", "seamlessly"]);
  });

  it("passes content that follows them", () => {
    const result = runVoiceCheck({ content: CLEAN, designMd: DESIGN_MD });
    expect(result.passed).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it("passes when the system states no voice rules, and says so through rules", () => {
    const result = runVoiceCheck({ content: FAILING, designMd: "# Acme\n\n## Palette\n- Primary: #000\n" });
    expect(result.passed).toBe(true);
    // Passing because there was nothing to comply with is NOT the same as
    // passing a check, and `rules` is how a caller tells them apart.
    expect(result.rules.bannedPhrases).toEqual([]);
    expect(result.rules.casing).toEqual({});
  });

  it("passes with no design system at all", () => {
    expect(runVoiceCheck({ content: FAILING }).passed).toBe(true);
  });

  it("handles empty content without throwing", () => {
    expect(runVoiceCheck({ content: "", designMd: DESIGN_MD }).passed).toBe(true);
  });
});

describe("design-voice-check tool", () => {
  it("is registered under its slug", () => {
    const tool = getCustomTool("design-voice-check");
    expect(tool?.slug).toBe("design-voice-check");
    expect(tool?.inputSchema.required).toEqual(["content"]);
    // Advisory, never an approval gate: it reads an artifact and reports.
    expect(tool?.isWriteTool).toBeUndefined();
  });

  it("reports each issue on its own line, with the line number", async () => {
    const report = await designVoiceCheck.execute({ content: FAILING, designMd: DESIGN_MD });
    expect(report).toContain("Voice QA found 4 issues");
    expect(report).toContain("line 1 [heading-casing]");
    expect(report).toContain("line 2 [banned-phrase]");
    expect(report).toContain("line 3 [button-casing]");
    expect(report).toContain('use "use"');
    // Said out loud, because the model is about to act on the suggestions.
    expect(report).toContain("keep genuine proper nouns capitalised");
  });

  it("says plainly when it passed, and how much was checked", async () => {
    const report = await designVoiceCheck.execute({ content: CLEAN, designMd: DESIGN_MD });
    expect(report).toContain("Voice QA passed");
    expect(report).toContain("5 voice rules");
  });

  it("takes the run's own voice rules from meta when none are passed", async () => {
    const report = await designVoiceCheck.execute(
      { content: FAILING },
      { config: {}, meta: { designVoice: DESIGN_MD } },
    );
    expect(report).toContain("Voice QA found 4 issues");
  });

  it("prefers an explicit designMd over the run's own, so another system can be checked", async () => {
    const other = "## Voice\n\n- **Avoid:** data\n";
    const report = await designVoiceCheck.execute(
      { content: FAILING, designMd: other },
      { config: {}, meta: { designVoice: DESIGN_MD } },
    );
    expect(report).toContain("Voice QA found 1 issue");
    expect(report).toContain('Banned phrase "data"');
  });

  it("does not stand in the way of a delivery when no rules reached the run", async () => {
    // "No rules", not "no design system": a system can be configured and still
    // not be in effect, because the runtime pins only what the prompt injection
    // gave the model. Claiming there is no system would be the wrong reason.
    const report = await designVoiceCheck.execute({ content: FAILING }, { config: {} });
    expect(report).toContain("no voice rules are in effect");
    expect(report).toContain("Deliver as normal");
  });

  it("distinguishes a system with no checkable rules from a clean pass", async () => {
    const report = await designVoiceCheck.execute({
      content: FAILING,
      designMd: "## Voice\n\n- **Tone:** warm\n",
    });
    expect(report).toContain("no checkable voice rules");
    expect(report).toContain("Deliver as normal");
  });

  it("asks for content rather than reporting a pass on nothing", async () => {
    const report = await designVoiceCheck.execute({ content: "   " });
    expect(report).toContain("Error: content is required");
  });
});
