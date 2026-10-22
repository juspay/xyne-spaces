import { describe, expect, it } from "vitest";
import { SUBAGENT_TEMPLATES, getSubagentDefinition, loadTemplateSamples, validateDecideQuestions } from "xyne-claw-shared";
import { STANDARD_QUESTIONS, buildQuestions, judgeVariation, standardQuestionsFrom } from "../src/ui-tester/checks.js";
import { buildSubagentTools, type CustomSubagentSpec } from "../src/subagent-tools.js";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

describe("ui-tester standard questions", () => {
  it("come from the shared checks with the same ids, types and options", () => {
    expect(Object.keys(STANDARD_QUESTIONS)).toEqual(["cut_off", "overlap", "errors", "placeholders", "toasts", "content", "background"]);
    expect(STANDARD_QUESTIONS.cut_off).toEqual({ type: "noul", instructions: "Is any text, button or control cut off at the right edge of the screen?" });
    expect(STANDARD_QUESTIONS.toasts).toMatchObject({ type: "choice", criteria: { none: "No toast notifications", one: "Exactly one toast notification" } });
  });

  it("take a cloned subagent's wording when id, type and option keys match, and ignore anything else", () => {
    const q = standardQuestionsFrom([
      { id: "cut_off", question: "Is anything clipped at the right edge?", type: "yesno" },
      { id: "toasts", question: "How many toasts?", type: "choice", options: { none: "None", one: "One", several: "Several of the same" } },
      { id: "background", question: "Theme?", type: "choice", options: { light: "Light", dark: "Dark", sepia: "Sepia" } },
      { id: "content", question: "What is shown?", type: "yesno" },
      { id: "extra", question: "Unrelated", type: "yesno" },
    ]);
    expect(q.cut_off.instructions).toBe("Is anything clipped at the right edge?");
    expect(q.toasts).toEqual({ type: "choice", instructions: "How many toasts?", criteria: { none: "None", one: "One", several: "Several of the same" } });
    expect(q.background).toBe(STANDARD_QUESTIONS.background);
    expect(q.content).toBe(STANDARD_QUESTIONS.content);
    expect(Object.keys(q)).not.toContain("extra");
    expect(buildQuestions({ id: "v" }, q)["cut_off"]).toEqual({ type: "noul", instructions: "Is anything clipped at the right edge?" });
    const verdict = judgeVariation({ id: "v" }, { toasts: { type: "choice", choice: "several", confidence: 0.95 } }, q);
    expect(verdict.findings.map((f) => f.message).join(" ")).toContain("How many toasts? → Several of the same");
  });
});

describe("subagent templates", () => {
  it.each(SUBAGENT_TEMPLATES.map((t) => [t.id, t] as const))("%s has valid checks, a unique default name and labelled samples", async (_id, t) => {
    const v = validateDecideQuestions(t.defaults.checks);
    expect("questions" in v).toBe(true);
    expect(getSubagentDefinition(t.defaults.name)).toBeUndefined();
    expect(t.defaults.fast).toBe(true);
    const samples = await loadTemplateSamples(t);
    expect(samples.length).toBeGreaterThanOrEqual(9);
    const ids = new Set(t.defaults.checks.map((c) => c.id));
    for (const s of samples) {
      expect(s.input || s.image).toBeTruthy();
      expect(Object.keys(s.expected).length).toBeGreaterThan(0);
      for (const k of Object.keys(s.expected)) expect(ids.has(k)).toBe(true);
    }
  });

  it("ui-tester ships the built-in prompt, harness and sandbox tools, and screenshot samples", async () => {
    const t = SUBAGENT_TEMPLATES.find((x) => x.id === "ui-tester")!;
    expect(t.defaults.systemPrompt).toBe(getSubagentDefinition("ui-tester")!.systemPrompt);
    expect(t.defaults.tools.custom).toEqual(expect.arrayContaining(["ui-test-variations", "visual-check", "sandbox-run", "sandbox-deliver-files"]));
    const samples = await loadTemplateSamples(t);
    expect(samples.every((s) => s.image?.startsWith("data:image/jpeg;base64,"))).toBe(true);
  });

  it("a cloned ui-tester gets its harness tools and no xor-decide question bank in its prompt", () => {
    const t = SUBAGENT_TEMPLATES.find((x) => x.id === "ui-tester")!;
    const tool = (name: string) => ({ name, description: name, parameters: { type: "object", properties: {} }, execute: async () => ({ content: [], details: {} }) }) as unknown as ToolDefinition;
    const spec: CustomSubagentSpec = { ...t.defaults, name: "my-ui-tester", skills: [], checks: t.defaults.checks, checksVersion: 1 };
    const sandbox = ["sandbox-run", "sandbox-read-file"].map((n) => Object.assign(tool(n), { slug: n, source: "custom:sandbox" }));
    const built = buildSubagentTools([], sandbox, undefined, undefined, undefined, undefined, { "my-ui-tester": [tool("ui-test-variations"), tool("visual-check")] }, [spec], undefined, [tool("xor-decide")]);
    const sub = built.subagentTools.find((x) => x.name === "my-ui-tester");
    expect(sub).toBeDefined();
    expect(String(sub!.description)).toMatch(/^\[Subagent — runs on a cheap model/);
  });
});
