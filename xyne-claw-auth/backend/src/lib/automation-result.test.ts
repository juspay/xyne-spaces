import { describe, expect, it } from "vitest";
import { coerceAutomationForwardResult } from "./automation-result.js";

describe("coerceAutomationForwardResult", () => {
  it("forwards a JSON object string unchanged", () => {
    const text = JSON.stringify({ title: "Support string type", description: "Add string support" });
    expect(coerceAutomationForwardResult(text)).toBe(text);
  });

  it("forwards a nested JSON object string unchanged", () => {
    const text = JSON.stringify({ result: { title: "Nested", description: "Nested desc" } });
    expect(coerceAutomationForwardResult(text)).toBe(text);
  });

  it("wraps plain text in a result envelope", () => {
    const text = "This is a plain answer.";
    expect(coerceAutomationForwardResult(text)).toBe(JSON.stringify({ result: text }));
  });

  it("wraps markdown text in a result envelope", () => {
    const text = "# Heading\n\nSome **bold** text.";
    expect(coerceAutomationForwardResult(text)).toBe(JSON.stringify({ result: text }));
  });

  it("wraps text that looks like JSON but is invalid", () => {
    const text = '{ "title": "missing closing brace';
    expect(coerceAutomationForwardResult(text)).toBe(JSON.stringify({ result: text }));
  });

  it("wraps JSON primitives", () => {
    expect(coerceAutomationForwardResult('"just a string"')).toBe(
      JSON.stringify({ result: '"just a string"' }),
    );
  });

  it("wraps empty text", () => {
    expect(coerceAutomationForwardResult("")).toBe(JSON.stringify({ result: "" }));
  });

  it("preserves whitespace around valid JSON objects", () => {
    const text = "\n  {\n    \"ok\": true\n  }\n  ";
    expect(coerceAutomationForwardResult(text)).toBe(text.trim());
  });
});
