import { describe, it, expect } from "vitest";
import { parseGateDecision } from "../src/twin-respond-gate.js";

describe("parseGateDecision", () => {
  it("parses GLM native tool-call markup leaked into content (the real failing case)", () => {
    // Verbatim shape from a glm-flash-experimental response that was wrongly
    // collapsing to fail-closed.
    const raw =
      "<tool_call>emit_decision<arg_key>respond</arg_key><arg_value>true</arg_value>" +
      "<arg_key>confidence</arg_key><arg_value>0.9</arg_value>" +
      "<arg_key>reason</arg_key><arg_value>Direct mention in #sebi-demo asking about SEBI demo status.</arg_value></tool_call>";
    const d = parseGateDecision(raw);
    expect(d).not.toBeNull();
    expect(d!.respond).toBe(true);
    expect(d!.confidence).toBe(0.9);
    expect(d!.reason).toContain("sebi-demo");
  });

  it("parses GLM markup for a false decision too", () => {
    const raw =
      "<tool_call>emit_decision<arg_key>respond</arg_key><arg_value>false</arg_value>" +
      "<arg_key>confidence</arg_key><arg_value>0.7</arg_value>" +
      "<arg_key>reason</arg_key><arg_value>Automated bot ping.</arg_value></tool_call>";
    const d = parseGateDecision(raw);
    expect(d!.respond).toBe(false);
    expect(d!.confidence).toBe(0.7);
  });

  it("parses proper JSON tool-call arguments", () => {
    const d = parseGateDecision('{"respond": true, "confidence": 0.8, "reason": "direct question"}');
    expect(d).toEqual({ respond: true, confidence: 0.8, reason: "direct question" });
  });

  it("parses JSON wrapped in a ```json fence / prose", () => {
    const d = parseGateDecision('Here is my decision:\n```json\n{"respond": false, "confidence": 0.6, "reason": "noise"}\n```');
    expect(d!.respond).toBe(false);
    expect(d!.confidence).toBe(0.6);
  });

  it("coerces numeric-string / yes-no forms", () => {
    expect(parseGateDecision('{"respond":"yes","confidence":"0.55"}')).toEqual({ respond: true, confidence: 0.55, reason: "" });
    expect(parseGateDecision('{"respond":"0"}')!.respond).toBe(false);
  });

  it("clamps confidence to 0-1 and defaults to 0.5 when absent/unparseable", () => {
    expect(parseGateDecision('{"respond":true,"confidence":5}')!.confidence).toBe(1);
    expect(parseGateDecision('{"respond":true,"confidence":-2}')!.confidence).toBe(0);
    expect(parseGateDecision('{"respond":true}')!.confidence).toBe(0.5);
    expect(parseGateDecision('{"respond":true,"confidence":"abc"}')!.confidence).toBe(0.5);
  });

  it("returns null on truly unusable output (no respond field anywhere)", () => {
    expect(parseGateDecision("")).toBeNull();
    expect(parseGateDecision("I think the user might want to reply here.")).toBeNull();
    expect(parseGateDecision('{"confidence":0.9,"reason":"no respond key"}')).toBeNull();
    expect(parseGateDecision(null)).toBeNull();
  });
});
