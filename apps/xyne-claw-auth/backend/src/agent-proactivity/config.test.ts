import { describe, expect, it } from "vitest";
import { ROUTING_CARD_MAX, resolveProactivityConfig, validateProactivityConfig } from "./config.js";

const generated = { text: "Product/area: Deploys", sourceHash: "h", generatedAt: "2026-10-19T00:00:00.000Z" };

describe("resolveProactivityConfig", () => {
  it("has nothing to route by without a block or a card", () => {
    expect(resolveProactivityConfig({})).toEqual({ description: "" });
    expect(resolveProactivityConfig({ proactivity: { description: "  " } })).toEqual({ description: "" });
  });

  it("routes by the owner's text when there is one, else the generated card", () => {
    expect(resolveProactivityConfig({ proactivity: { description: " Deploys, from the runbooks ", generated } })).toEqual({
      description: "Deploys, from the runbooks",
    });
    expect(resolveProactivityConfig({ proactivity: { generated } })).toEqual({ description: "Product/area: Deploys" });
  });
});

describe("validateProactivityConfig", () => {
  it("accepts no block, or the owner's text", () => {
    expect(validateProactivityConfig({}).ok).toBe(true);
    expect(validateProactivityConfig({ proactivity: { description: "Deploys" } }).ok).toBe(true);
  });

  it("rejects wrong types and overlong text", () => {
    expect(validateProactivityConfig({ proactivity: { description: 3 } }).ok).toBe(false);
    expect(validateProactivityConfig({ proactivity: { description: "x".repeat(501) } }).ok).toBe(false);
    expect(validateProactivityConfig({ proactivity: { generated: { text: "x".repeat(ROUTING_CARD_MAX + 1) } } }).ok).toBe(false);
    expect(validateProactivityConfig({ proactivity: { generated: "card" } }).ok).toBe(false);
  });
});
