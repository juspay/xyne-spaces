import { describe, it, expect } from "vitest";
import { parseFlowJsonComponents, extractTextFromFlowJson } from "./flow-text.js";

/**
 * Regression coverage for the `data-flow-json` attribute round-trip.
 *
 * A Flow card is stored as `<div data-flow-json="...escaped JSON...">fallback</div>`.
 * The escaping used by the backend emitters (chatController / incomingWebhookController
 * / the Slack adapter) MUST escape `&` FIRST, otherwise any literal `&`, `<`, `>` or
 * entity-like sequence already present in the payload (very common in an embedded
 * agent system prompt, e.g. the string `&quot;`, `A && B`, `<file:line>`) is corrupted
 * when the browser HTML-decodes the attribute — JSON.parse then throws and the card
 * collapses to its bare fallback text.
 *
 * The canonical encoder is apps/backend `encodeHtmlAttr`. This package must not depend
 * on apps/backend, so we replicate it here and keep it in lock-step with that helper.
 */
function encodeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** What `element.getAttribute('data-flow-json')` returns — full HTML entity decode. */
function browserAttrDecode(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

// A payload seeded with every character class that used to break the attribute:
// literal ampersands, an entity-looking sequence, shell `&&`, and angle brackets.
const NASTY = 'Envelope: <div data-flow-json="{&quot;-escaped JSON}">Flow JSON</div>; run A && B; R&D <x>';

const flow = {
  version: "2.0",
  screenId: "agent-card",
  title: "Capability",
  components: [{ id: "p", type: "text", props: { content: NASTY } }],
};

function wrap(escapedJSON: string): string {
  return `<div data-flow-json="${escapedJSON}">Flow JSON</div>`;
}

describe("data-flow-json escaping round-trip", () => {
  it("survives the browser attribute decode and JSON.parse (the frontend render path)", () => {
    const content = wrap(encodeHtmlAttr(JSON.stringify(flow)));
    const attr = content.match(/data-flow-json="([^"]*)"/)![1]!;
    const decoded = browserAttrDecode(attr);
    expect(() => JSON.parse(decoded)).not.toThrow();
    expect(JSON.parse(decoded)).toEqual(flow);
  });

  it("the OLD quotes-only escaping corrupted such a payload (documents the bug)", () => {
    const buggy = JSON.stringify(flow).replace(/"/g, "&quot;");
    const decoded = browserAttrDecode(buggy.match(/[\s\S]*/)![0]);
    // The literal `&quot;` inside the prompt is decoded back to a bare `"`,
    // breaking the JSON structure.
    expect(() => JSON.parse(decoded)).toThrow();
  });

  it("the shared decoder recovers the components with content intact", () => {
    const content = wrap(encodeHtmlAttr(JSON.stringify(flow)));
    const components = parseFlowJsonComponents(content);
    expect(components).not.toBeNull();
    expect(components).toHaveLength(1);
    expect((components![0] as any).props.content).toBe(NASTY);
  });

  it("extractTextFromFlowJson returns the original text, not entity-escaped noise", () => {
    const content = wrap(encodeHtmlAttr(JSON.stringify(flow)));
    expect(extractTextFromFlowJson(content)).toContain("A && B");
    expect(extractTextFromFlowJson(content)).toContain("<x>");
    expect(extractTextFromFlowJson(content)).not.toContain("&amp;");
  });
});
