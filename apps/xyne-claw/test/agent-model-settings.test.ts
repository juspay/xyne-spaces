import { describe, it, expect } from "vitest";
import {
  parseModelSettings,
  parseOutputFormat,
  buildSubmitResultTool,
  renderTemplate,
  type StructuredOutputRef,
} from "../src/agent-model-settings.js";

describe("parseModelSettings", () => {
  it("returns undefined when absent or empty", () => {
    expect(parseModelSettings(undefined)).toBeUndefined();
    expect(parseModelSettings({})).toBeUndefined();
    expect(parseModelSettings({ modelSettings: {} })).toBeUndefined();
    expect(parseModelSettings({ modelSettings: "nope" })).toBeUndefined();
  });

  it("accepts temperature 0 (falsy but valid)", () => {
    expect(parseModelSettings({ modelSettings: { temperature: 0 } })).toEqual({ temperature: 0 });
  });

  it("clamps temperature and maxTokens to safe ranges", () => {
    expect(parseModelSettings({ modelSettings: { temperature: 3 } })).toEqual({ temperature: 1 });
    expect(parseModelSettings({ modelSettings: { temperature: -1 } })).toEqual({ temperature: 0 });
    expect(parseModelSettings({ modelSettings: { maxTokens: 10 } })).toEqual({ maxTokens: 1024 });
    expect(parseModelSettings({ modelSettings: { maxTokens: 1_000_000 } })).toEqual({ maxTokens: 64000 });
  });

  it("drops invalid thinkingLevel values and keeps valid ones", () => {
    expect(parseModelSettings({ modelSettings: { thinkingLevel: "ultra" } })).toBeUndefined();
    expect(parseModelSettings({ modelSettings: { thinkingLevel: "off" } })).toEqual({ thinkingLevel: "off" });
  });

  it("trims model and ignores blank", () => {
    expect(parseModelSettings({ modelSettings: { model: "  claude-x  " } })).toEqual({ model: "claude-x" });
    expect(parseModelSettings({ modelSettings: { model: "   " } })).toBeUndefined();
  });
});

describe("parseOutputFormat", () => {
  it("requires a recognized type and an object schema for json", () => {
    expect(parseOutputFormat({ outputFormat: { type: "yaml", schema: {} } })).toBeUndefined();
    expect(parseOutputFormat({ outputFormat: { type: "json", schema: [] } })).toBeUndefined();
    expect(parseOutputFormat({ outputFormat: { type: "json", schema: { type: "object" } } }))
      .toEqual({ type: "json", schema: { type: "object" } });
  });

  it("carries an optional template on json", () => {
    expect(parseOutputFormat({ outputFormat: { type: "json", schema: { type: "object" }, template: "# {{x}}" } }))
      .toEqual({ type: "json", schema: { type: "object" }, template: "# {{x}}" });
  });

  it("accepts markdown type with no schema and optional template", () => {
    expect(parseOutputFormat({ outputFormat: { type: "markdown" } })).toEqual({ type: "markdown" });
    expect(parseOutputFormat({ outputFormat: { type: "markdown", template: "## Summary" } }))
      .toEqual({ type: "markdown", template: "## Summary" });
  });
});

describe("renderTemplate", () => {
  it("substitutes scalar and dot-path placeholders", () => {
    expect(renderTemplate("# {{title}} ({{meta.severity}})", { title: "Bug", meta: { severity: "high" } }))
      .toBe("# Bug (high)");
  });

  it("renders missing values as empty and joins scalar arrays", () => {
    expect(renderTemplate("[{{missing}}] {{tags}}", { tags: ["a", "b", "c"] })).toBe("[] a, b, c");
  });

  it("iterates arrays of objects with #each", () => {
    const out = renderTemplate(
      "{{#each items}}- {{name}}: {{score}}\n{{/each}}",
      { items: [{ name: "x", score: 1 }, { name: "y", score: 2 }] },
    );
    expect(out).toBe("- x: 1\n- y: 2\n");
  });

  it("supports {{.}} for scalar items inside #each", () => {
    expect(renderTemplate("{{#each xs}}{{.}} {{/each}}", { xs: ["a", "b"] })).toBe("a b ");
  });
});

describe("buildSubmitResultTool", () => {
  const schema = {
    type: "object",
    properties: { summary: { type: "string" }, severity: { type: "string" } },
    required: ["summary", "severity"],
  };

  it("accepts a payload matching required fields and stores it on the ref", async () => {
    const ref: StructuredOutputRef = {};
    const tool = buildSubmitResultTool({ type: "json", schema }, ref);
    const res = await tool.execute("tc1", { summary: "ok", severity: "low" }, undefined as never, undefined as never);
    expect(ref.value).toEqual({ summary: "ok", severity: "low" });
    expect(JSON.stringify(res)).toContain("accepted");
  });

  it("rejects a payload missing required fields without setting the ref", async () => {
    const ref: StructuredOutputRef = {};
    const tool = buildSubmitResultTool({ type: "json", schema }, ref);
    const res = await tool.execute("tc2", { summary: "ok" }, undefined as never, undefined as never);
    expect(ref.value).toBeUndefined();
    expect(JSON.stringify(res)).toContain("missing required field");
  });

  it("wraps non-object root schemas in a {result} envelope", async () => {
    const ref: StructuredOutputRef = {};
    const tool = buildSubmitResultTool({ type: "json", schema: { type: "array", items: { type: "string" } } }, ref);
    await tool.execute("tc3", { result: ["a", "b"] }, undefined as never, undefined as never);
    expect(ref.value).toEqual(["a", "b"]);
  });

  it("markdown type accepts a markdown string and stores it on the ref", async () => {
    const ref: StructuredOutputRef = {};
    const tool = buildSubmitResultTool({ type: "markdown" }, ref);
    await tool.execute("tc4", { markdown: "# Hello" }, undefined as never, undefined as never);
    expect(ref.value).toBe("# Hello");
  });

  it("markdown type rejects empty/non-string and leaves the ref unset", async () => {
    const ref: StructuredOutputRef = {};
    const tool = buildSubmitResultTool({ type: "markdown" }, ref);
    const res = await tool.execute("tc5", { markdown: "   " }, undefined as never, undefined as never);
    expect(ref.value).toBeUndefined();
    expect(JSON.stringify(res)).toContain("non-empty string");
  });
});
