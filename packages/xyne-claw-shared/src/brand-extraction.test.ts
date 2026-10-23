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

describe("optional fields the card renders — a shape slip here crashes the thread", () => {
  /**
   * The card maps `gaps`, joins `fallbacks` and renders the source fields. A
   * validator that only checked the REQUIRED fields let these through, and the
   * resulting throw took down MessageThread — permanently, because the message
   * is persisted and the throw repeated on every reload.
   */
  it('refuses gaps as a string — "none".map is not a function', () => {
    expect(isBrandSummary({ ...valid, gaps: "none" })).toBe(false);
  });

  it("refuses gaps as objects — React cannot render an object child", () => {
    expect(isBrandSummary({ ...valid, gaps: [{ field: "shadows" }] })).toBe(false);
  });

  it('refuses fallbacks as a string — "Arial".join is not a function', () => {
    expect(
      isBrandSummary({ ...valid, fonts: [{ family: "Inter", role: "body", fallbacks: "Arial" }] }),
    ).toBe(false);
  });

  it("refuses non-numeric font weights", () => {
    expect(
      isBrandSummary({ ...valid, fonts: [{ family: "Inter", role: "body", weights: ["400"] }] }),
    ).toBe(false);
  });

  it("refuses a non-string sourceUrl, sourceRepo or sourceCommit", () => {
    expect(isBrandSummary({ ...valid, sourceUrl: { evil: 1 } })).toBe(false);
    expect(isBrandSummary({ ...valid, sourceRepo: 42 })).toBe(false);
    expect(isBrandSummary({ ...valid, sourceCommit: ["a"] })).toBe(false);
  });

  it("refuses a non-numeric type-step weight — it becomes a fontWeight style", () => {
    expect(
      isBrandSummary({ ...valid, typeScale: [{ name: "h1", sizePx: 48, weight: "bold" }] }),
    ).toBe(false);
  });

  it("refuses non-numeric colour occurrences", () => {
    expect(
      isBrandSummary({
        ...valid,
        colors: [{ hex: "#635BFF", token: "p", role: "primary", occurrences: "many" }],
      }),
    ).toBe(false);
  });

  it("refuses malformed assets and scale entries", () => {
    expect(isBrandSummary({ ...valid, assets: [{ kind: "logo" }] })).toBe(false);
    expect(isBrandSummary({ ...valid, assets: "logo.svg" })).toBe(false);
    expect(isBrandSummary({ ...valid, radii: [{ token: "r" }] })).toBe(false);
    expect(isBrandSummary({ ...valid, shadows: [{ token: "s", value: 1 }] })).toBe(false);
  });

  it("still accepts every optional field correctly formed", () => {
    expect(
      isBrandSummary({
        ...valid,
        sourceCommit: "a1b2c3d",
        fonts: [{ family: "Inter", role: "body", fallbacks: ["system-ui"], weights: [400, 700] }],
        typeScale: [{ name: "h1", sizePx: 48, lineHeightPx: 56, weight: 700, letterSpacingPx: -0.5 }],
        assets: [{ kind: "logo", file: "logo.svg", mimeType: "image/svg+xml", width: 100, height: 20 }],
        radii: [{ token: "radius-lg", value: "0.75rem" }],
        gaps: ["no webfont file found"],
      }),
    ).toBe(true);
  });

  it("accepts a payload that omits every optional field", () => {
    expect(isBrandSummary(valid)).toBe(true);
  });
});

describe("isBrandSummary — light and dark token sets", () => {
  const darkColors = [
    { hex: "#0B1120", token: "brand-background", role: "background" as const },
    { hex: "#F8FAFC", token: "brand-text", role: "text" as const },
  ];

  it("accepts a payload carrying both sets and a provenance", () => {
    expect(
      isBrandSummary({ ...valid, colorsDark: darkColors, darkThemeSource: "prefers-color-scheme" }),
    ).toBe(true);
  });

  it("accepts every dark theme source the contract names", () => {
    for (const source of ["prefers-color-scheme", "class", "theme-file"]) {
      expect(isBrandSummary({ ...valid, colorsDark: darkColors, darkThemeSource: source })).toBe(
        true,
      );
    }
  });

  it("refuses an unknown dark theme source", () => {
    expect(
      isBrandSummary({ ...valid, colorsDark: darkColors, darkThemeSource: "media-query" }),
    ).toBe(false);
    expect(isBrandSummary({ ...valid, darkThemeSource: true })).toBe(false);
  });

  it("holds colorsDark to the same rules as colors", () => {
    expect(isBrandSummary({ ...valid, colorsDark: [{ ...darkColors[0], hex: "#FFF" }] })).toBe(
      false,
    );
    expect(isBrandSummary({ ...valid, colorsDark: [{ ...darkColors[0], role: "midground" }] })).toBe(
      false,
    );
    expect(isBrandSummary({ ...valid, colorsDark: [{ hex: "#0B1120", role: "background" }] })).toBe(
      false,
    );
    expect(isBrandSummary({ ...valid, colorsDark: ":root{}" })).toBe(false);
    expect(
      isBrandSummary({ ...valid, colorsDark: [{ ...darkColors[0], occurrences: "many" }] }),
    ).toBe(false);
  });

  it("accepts a single-theme payload, which is the common case", () => {
    expect(isBrandSummary(valid)).toBe(true);
    expect(isBrandSummary({ ...valid, colorsDark: [] })).toBe(true);
  });

  it("accepts a dark set with no provenance rather than refusing the whole payload", () => {
    expect(isBrandSummary({ ...valid, colorsDark: darkColors })).toBe(true);
    expect(isBrandSummary({ ...valid, darkThemeSource: "class" })).toBe(true);
  });

  it("round-trips both sets through parseBrandSummary", () => {
    const parsed = parseBrandSummary(
      JSON.stringify({ ...valid, colorsDark: darkColors, darkThemeSource: "class" }),
    );
    expect(parsed?.colorsDark).toHaveLength(2);
    expect(parsed?.darkThemeSource).toBe("class");
    expect(parsed?.colors).toHaveLength(2);
  });
});
