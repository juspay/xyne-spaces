import { describe, expect, it } from "vitest";
import { checkDesignSystemCompliance } from "./design-system-qa.js";

const TOKENS = `
:root {
  --brand-primary: #1A73E8;
  --brand-surface: #FFFFFF;
  --brand-ink: #111;
}
`;

describe("checkDesignSystemCompliance", () => {
  it("accepts an artifact that only uses palette colours", () => {
    const got = checkDesignSystemCompliance(
      "<div style=\"color:#1a73e8;background:#ffffff\"></div>",
      TOKENS,
    );

    expect(got.offPaletteColors).toEqual([]);
  });

  it("reports a colour the system does not contain", () => {
    const got = checkDesignSystemCompliance('<div style="color:#ff0000"></div>', TOKENS);

    expect(got.offPaletteColors).toEqual(["#ff0000"]);
  });

  it("treats shorthand and longhand as the same colour", () => {
    // #111 in the tokens must match #111111 in the artifact.
    const got = checkDesignSystemCompliance('<p style="color:#111111">hi</p>', TOKENS);

    expect(got.offPaletteColors).toEqual([]);
  });

  it("ignores a fully opaque alpha channel", () => {
    const got = checkDesignSystemCompliance('<p style="color:#1a73e8ff">hi</p>', TOKENS);

    expect(got.offPaletteColors).toEqual([]);
  });

  it("reports each off-palette colour once", () => {
    const got = checkDesignSystemCompliance(
      '<a style="color:#ff0000"></a><b style="color:#FF0000"></b>',
      TOKENS,
    );

    expect(got.offPaletteColors).toEqual(["#ff0000"]);
  });

  it("reports nothing when the system has no palette, rather than everything", () => {
    const got = checkDesignSystemCompliance('<div style="color:#ff0000"></div>', "");

    expect(got.offPaletteColors).toEqual([]);
  });

  it("reports a font the system does not list", () => {
    const got = checkDesignSystemCompliance(
      "body { font-family: 'Comic Sans MS', sans-serif; }",
      TOKENS,
      ["Inter"],
    );

    expect(got.unauthorizedFonts).toEqual(["comic sans ms"]);
  });

  it("accepts a listed font regardless of quoting or case", () => {
    const got = checkDesignSystemCompliance(
      'body { font-family: "inter", system-ui; }',
      TOKENS,
      ["Inter"],
    );

    expect(got.unauthorizedFonts).toEqual([]);
  });

  it("never flags generic families, which are fallbacks not brand choices", () => {
    const got = checkDesignSystemCompliance(
      "body { font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif, monospace; }",
      TOKENS,
      ["Inter"],
    );

    expect(got.unauthorizedFonts).toEqual([]);
  });

  it("skips a var() family, which resolves to a token already checked", () => {
    const got = checkDesignSystemCompliance(
      "body { font-family: var(--brand-font); }",
      TOKENS,
      ["Inter"],
    );

    expect(got.unauthorizedFonts).toEqual([]);
  });

  it("reports no fonts when the system lists none", () => {
    const got = checkDesignSystemCompliance(
      "body { font-family: 'Comic Sans MS'; }",
      TOKENS,
      [],
    );

    expect(got.unauthorizedFonts).toEqual([]);
  });

  it("returns nothing for an empty artifact", () => {
    expect(checkDesignSystemCompliance("   ", TOKENS, ["Inter"])).toEqual({
      offPaletteColors: [],
      unauthorizedFonts: [],
    });
  });
});
