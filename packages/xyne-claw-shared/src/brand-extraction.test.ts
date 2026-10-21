import { describe, expect, it } from "vitest";
import { isBrandSummary, parseBrandSummary, type BrandSummary } from "./brand-extraction.js";

/**
 * brand.json is written by a model inside a sandbox, so the card treats it as
 * untrusted input. These cover the fields the card would otherwise push
 * straight into the DOM as style values.
 */

const valid: BrandSummary = {
  version: 1,
  name: "Stripe",
  source: "url",
  sourceUrl: "https://stripe.com",
  extractedAt: "2026-10-21T10:00:00.000Z",
  colors: [
    { hex: "#635BFF", token: "brand-primary", role: "primary", occurrences: 42 },
    { hex: "#0A2540", token: "brand-text", role: "text", occurrences: 310 },
  ],
  fonts: [
    { family: "Inter", role: "body", fallbacks: ["system-ui", "sans-serif"], weights: [400, 600] },
  ],
  typeScale: [
    { name: "h1", sizePx: 48, lineHeightPx: 56, weight: 700 },
    { name: "body", sizePx: 16, lineHeightPx: 24 },
  ],
  gaps: ["no webfont file found"],
};

const withColors = (colors: unknown): unknown => ({ ...valid, colors });

describe("isBrandSummary", () => {
  it("accepts a complete payload", () => {
    expect(isBrandSummary(valid)).toBe(true);
  });

  it("accepts a screenshot payload with no occurrence counts", () => {
    const screenshot = {
      ...valid,
      source: "screenshot",
      sourceUrl: undefined,
      colors: [{ hex: "#635BFF", token: "brand-primary", role: "primary" }],
    };
    expect(isBrandSummary(screenshot)).toBe(true);
  });

  it("accepts a repo payload, so XYNE-66819 reuses the card unchanged", () => {
    expect(
      isBrandSummary({ ...valid, source: "repo", sourceRepo: "juspay/xyne-spaces" }),
    ).toBe(true);
  });

  it("refuses an unknown version rather than half-rendering it", () => {
    expect(isBrandSummary({ ...valid, version: 2 })).toBe(false);
  });

  it("refuses an unknown source", () => {
    expect(isBrandSummary({ ...valid, source: "figma" })).toBe(false);
  });

  describe("colour validation — these values reach the DOM as styles", () => {
    it("refuses a non-hex colour", () => {
      expect(isBrandSummary(withColors([{ hex: "rgb(99,91,255)", token: "t", role: "primary" }]))).toBe(false);
    });

    it("refuses a 3-digit hex, which would render but not round-trip to a token", () => {
      expect(isBrandSummary(withColors([{ hex: "#FFF", token: "t", role: "primary" }]))).toBe(false);
    });

    it("refuses 8-digit hex: alpha cannot survive as a flat token", () => {
      expect(isBrandSummary(withColors([{ hex: "#635BFF80", token: "t", role: "primary" }]))).toBe(false);
    });

    it("refuses a CSS injection attempt in the hex field", () => {
      expect(
        isBrandSummary(withColors([{ hex: "red;background:url(x)", token: "t", role: "primary" }])),
      ).toBe(false);
    });

    it("refuses a role outside the known set", () => {
      expect(isBrandSummary(withColors([{ hex: "#635BFF", token: "t", role: "brand" }]))).toBe(false);
    });

    it("accepts lowercase hex", () => {
      expect(isBrandSummary(withColors([{ hex: "#635bff", token: "t", role: "primary" }]))).toBe(true);
    });
  });

  it("refuses a font role outside heading/body/mono", () => {
    expect(isBrandSummary({ ...valid, fonts: [{ family: "Inter", role: "display" }] })).toBe(false);
  });

  it("refuses a type step whose size is a string", () => {
    expect(isBrandSummary({ ...valid, typeScale: [{ name: "h1", sizePx: "48" }] })).toBe(false);
  });

  it("refuses a blank name — the save dialog needs something to show", () => {
    expect(isBrandSummary({ ...valid, name: "   " })).toBe(false);
  });

  it("refuses arrays, null and primitives", () => {
    for (const bad of [null, undefined, 42, "brand", [valid]]) {
      expect(isBrandSummary(bad)).toBe(false);
    }
  });
});

describe("parseBrandSummary", () => {
  it("parses a valid document", () => {
    expect(parseBrandSummary(JSON.stringify(valid))?.name).toBe("Stripe");
  });

  it("returns null for malformed JSON instead of throwing", () => {
    expect(parseBrandSummary("{ not json")).toBeNull();
  });

  it("returns null for JSON that is not a brand summary", () => {
    expect(parseBrandSummary(JSON.stringify({ hello: "world" }))).toBeNull();
  });

  it("returns null for an empty file", () => {
    expect(parseBrandSummary("")).toBeNull();
  });
});
