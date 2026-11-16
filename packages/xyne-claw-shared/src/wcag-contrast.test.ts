import { describe, expect, it } from "vitest";
import {
  CONTRAST_PAIRS,
  auditBrandColors,
  auditContrast,
  auditTokensCss,
  contrastPaletteFromBrandColors,
  contrastPaletteFromTokensCss,
  contrastRatio,
  contrastRatioBetween,
  matchContrastSlot,
  parseHexColor,
  rateContrast,
  relativeLuminance,
  suggestNearestPassing,
  suggestNearestPassingAgainst,
  toHexColor,
  type ContrastAudit,
  type ContrastPairResult,
} from "./wcag-contrast.js";
import type { BrandColor } from "./brand-extraction.js";

/**
 * A design system is injected into every later /design run, so a palette that
 * fails here fails in every artifact built against it. These cover the maths
 * the audit reports and the suggestions a reviewer applies with one click —
 * every suggestion is asserted against the ratio it claims to achieve rather
 * than against a hardcoded hex, so a change to the step size cannot quietly
 * start suggesting colours that still fail.
 */

const rgb = (hex: string) => {
  const parsed = parseHexColor(hex);
  if (!parsed) throw new Error(`not a hex colour: ${hex}`);
  return parsed;
};

const pairOf = (audit: ContrastAudit, id: string): ContrastPairResult => {
  const pair = audit.pairs.find((candidate) => candidate.id === id);
  if (!pair) throw new Error(`no pair ${id}`);
  return pair;
};

const BLACK = "#000000";
const WHITE = "#FFFFFF";

describe("parseHexColor", () => {
  it("accepts #RRGGBB, #RGB and a missing hash, in any case", () => {
    expect(parseHexColor("#0b5fff")).toEqual({ r: 11, g: 95, b: 255 });
    expect(parseHexColor("0B5FFF")).toEqual({ r: 11, g: 95, b: 255 });
    expect(parseHexColor("#FFF")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHexColor("  #ABC  ")).toEqual({ r: 170, g: 187, b: 204 });
  });

  it("refuses anything that is not a flat hex colour", () => {
    for (const value of ["", "#", "#12", "#12345", "#1234567", "#GGGGGG", "rgb(0,0,0)", "var(--x)", "#8884d8ff"]) {
      expect(parseHexColor(value)).toBeNull();
    }
  });

  it("round-trips through toHexColor as uppercase #RRGGBB", () => {
    expect(toHexColor(rgb("#0b5fff"))).toBe("#0B5FFF");
    expect(toHexColor(rgb("#abc"))).toBe("#AABBCC");
  });
});

describe("relativeLuminance", () => {
  it("anchors at 0 for black and 1 for white", () => {
    expect(relativeLuminance(rgb(BLACK))).toBe(0);
    expect(relativeLuminance(rgb(WHITE))).toBeCloseTo(1, 10);
  });

  it("is monotonic along a grey ramp", () => {
    const greys = ["#000000", "#333333", "#777777", "#BBBBBB", "#FFFFFF"].map((hex) =>
      relativeLuminance(rgb(hex)),
    );
    for (let i = 1; i < greys.length; i += 1) {
      expect(greys[i]!).toBeGreaterThan(greys[i - 1]!);
    }
  });
});

describe("contrastRatio", () => {
  it("is 21:1 for black on white", () => {
    expect(contrastRatio(rgb(BLACK), rgb(WHITE))).toBeCloseTo(21, 10);
    expect(contrastRatioBetween(BLACK, WHITE)).toBe(21);
  });

  it("is 1:1 for white on white and for any colour against itself", () => {
    expect(contrastRatioBetween(WHITE, WHITE)).toBe(1);
    expect(contrastRatioBetween(BLACK, BLACK)).toBe(1);
    expect(contrastRatioBetween("#635BFF", "#635BFF")).toBe(1);
  });

  it("does not depend on which colour is called the foreground", () => {
    expect(contrastRatioBetween("#0A2540", "#F6F9FC")).toBe(
      contrastRatioBetween("#F6F9FC", "#0A2540"),
    );
  });

  it("treats #RGB and #RRGGBB as the same colour", () => {
    expect(contrastRatioBetween("#FFF", "#000")).toBe(contrastRatioBetween(WHITE, BLACK));
  });

  it("is null when either side is not measurable", () => {
    expect(contrastRatioBetween("var(--text)", WHITE)).toBeNull();
    expect(contrastRatioBetween(WHITE, "rgba(0,0,0,.5)")).toBeNull();
  });

  it("truncates rather than rounds, so a ratio never over-claims", () => {
    // 4.47:1 — the real value is 4.4769…, which would round up to 4.48 and
    // read as closer to AA than it is.
    expect(contrastRatioBetween("#767676", WHITE)).toBe(4.54);
    expect(contrastRatioBetween("#777777", WHITE)).toBe(4.47);
  });
});

describe("rateContrast", () => {
  it("applies the WCAG 2.2 floors for normal and large text", () => {
    expect(rateContrast(4.49)).toEqual({
      aaNormal: false,
      aaLarge: true,
      aaaNormal: false,
      aaaLarge: false,
    });
    expect(rateContrast(4.5)).toEqual({
      aaNormal: true,
      aaLarge: true,
      aaaNormal: false,
      aaaLarge: true,
    });
    expect(rateContrast(7)).toEqual({
      aaNormal: true,
      aaLarge: true,
      aaaNormal: true,
      aaaLarge: true,
    });
    expect(rateContrast(2.99).aaLarge).toBe(false);
    expect(rateContrast(3).aaLarge).toBe(true);
  });
});

describe("matchContrastSlot", () => {
  it("maps purpose-named tokens to slots, with or without a namespace", () => {
    expect(matchContrastSlot("primary")).toBe("primary");
    expect(matchContrastSlot("brand-primary")).toBe("primary");
    expect(matchContrastSlot("--color-background")).toBe("background");
    expect(matchContrastSlot("text_muted")).toBe("muted");
    expect(matchContrastSlot("Surface-Raised")).toBe("surface");
    expect(matchContrastSlot("link")).toBe("link");
  });

  it("does not let an on-* token fall into the slot it sits on", () => {
    expect(matchContrastSlot("text-on-primary")).toBe("onPrimary");
    expect(matchContrastSlot("primary-foreground")).toBe("onPrimary");
    expect(matchContrastSlot("on-surface")).toBe("onSurface");
  });

  it("returns null for tokens this audit does not pair", () => {
    for (const name of ["border", "success", "danger", "radius-md", "space-3", "", "--"]) {
      expect(matchContrastSlot(name)).toBeNull();
    }
  });
});

describe("auditContrast", () => {
  const passing = {
    background: WHITE,
    surface: WHITE,
    body: "#1A1A1A",
    muted: "#595959",
    primary: "#0B5FFF",
    onPrimary: WHITE,
    link: "#0B5FFF",
  };

  it("evaluates exactly the five standard pairs", () => {
    const audit = auditContrast(passing);
    expect(audit.pairs.map((pair) => pair.id)).toEqual([
      "body-on-background",
      "muted-on-background",
      "on-primary-on-primary",
      "on-surface-on-surface",
      "link-on-background",
    ]);
    expect(audit.pairs).toHaveLength(CONTRAST_PAIRS.length);
  });

  it("passes a readable palette and suggests nothing", () => {
    const audit = auditContrast(passing);
    expect(audit.failing).toBe(0);
    expect(audit.audited).toBe(5);
    expect(audit.hasIssues).toBe(false);
    for (const pair of audit.pairs) {
      expect(pair.status).toBe("pass");
      expect(pair.ratings?.aaNormal).toBe(true);
      expect(pair.suggestion).toBeNull();
    }
  });

  it("defaults on-surface to the body colour, so body-on-surface is still checked", () => {
    const audit = auditContrast({ background: WHITE, surface: "#EDEDED", body: "#949494" });
    const onSurface = pairOf(audit, "on-surface-on-surface");
    expect(onSurface.foregroundHex).toBe("#949494");
    expect(onSurface.backgroundHex).toBe("#EDEDED");
    expect(onSurface.status).toBe("fail");
  });

  it("reports a missing token instead of failing or inventing a pair", () => {
    const audit = auditContrast({ background: WHITE, body: "#1A1A1A" });
    const onPrimary = pairOf(audit, "on-primary-on-primary");
    expect(onPrimary.status).toBe("missing");
    expect(onPrimary.unresolved).toEqual(["onPrimary", "primary"]);
    expect(onPrimary.ratio).toBeNull();
    expect(onPrimary.ratings).toBeNull();
    expect(onPrimary.suggestion).toBeNull();

    expect(pairOf(audit, "link-on-background").unresolved).toEqual(["link"]);
    // Only body-on-background is measurable — on-surface inherits the body
    // colour but has no surface to sit on. Nothing failing: a system that never
    // names a link colour has no link pair to get wrong.
    expect(audit.audited).toBe(1);
    expect(pairOf(audit, "on-surface-on-surface").unresolved).toEqual(["surface"]);
    expect(audit.failing).toBe(0);
    expect(audit.hasIssues).toBe(false);
  });

  it("survives an empty token set", () => {
    const audit = auditContrast({});
    expect(audit.audited).toBe(0);
    expect(audit.failing).toBe(0);
    expect(audit.hasIssues).toBe(false);
    expect(audit.pairs.every((pair) => pair.status === "missing")).toBe(true);
  });

  it("separates a token that is present but not measurable from one that is absent", () => {
    const audit = auditContrast({ background: WHITE, body: "var(--ink)" });
    const body = pairOf(audit, "body-on-background");
    expect(body.status).toBe("invalid");
    expect(body.unresolved).toEqual(["body"]);
    expect(body.foregroundHex).toBe("var(--ink)");
    expect(body.ratio).toBeNull();
  });

  it("raises the bar when a caller asks for AAA", () => {
    const tokens = { background: WHITE, body: "#767676" };
    expect(pairOf(auditContrast(tokens), "body-on-background").status).toBe("pass");

    const aaa = auditContrast(tokens, { target: 7 });
    const body = pairOf(aaa, "body-on-background");
    // Still rated against AA, but the suggestion now has to reach AAA.
    expect(body.status).toBe("pass");
    expect(body.ratings?.aaaNormal).toBe(false);
    const suggestion = suggestNearestPassing("#767676", WHITE, 7);
    expect(suggestion?.ratio).toBeGreaterThanOrEqual(7);
  });
});

describe("suggestNearestPassing", () => {
  it("returns null when the pair already passes", () => {
    expect(suggestNearestPassing("#1A1A1A", WHITE)).toBeNull();
  });

  it("darkens the foreground on a light background", () => {
    const suggestion = suggestNearestPassing("#AAAAAA", WHITE);
    expect(suggestion).not.toBeNull();
    expect(relativeLuminance(rgb(suggestion!.hex))).toBeLessThan(
      relativeLuminance(rgb("#AAAAAA")),
    );
    expect(contrastRatioBetween(suggestion!.hex, WHITE)).toBeGreaterThanOrEqual(4.5);
  });

  it("lightens the foreground on a dark background", () => {
    const suggestion = suggestNearestPassing("#3A3A3A", "#111111");
    expect(suggestion).not.toBeNull();
    expect(relativeLuminance(rgb(suggestion!.hex))).toBeGreaterThan(
      relativeLuminance(rgb("#3A3A3A")),
    );
    expect(contrastRatioBetween(suggestion!.hex, "#111111")).toBeGreaterThanOrEqual(4.5);
  });

  it("reports the ratio it actually achieves", () => {
    const suggestion = suggestNearestPassing("#7FB2FF", WHITE);
    expect(suggestion).not.toBeNull();
    expect(contrastRatioBetween(suggestion!.hex, WHITE)).toBe(suggestion!.ratio);
    expect(suggestion!.ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("stops at the first passing step, so it does not overshoot to black", () => {
    const suggestion = suggestNearestPassing("#AAAAAA", WHITE);
    expect(suggestion!.hex).not.toBe(BLACK);
    expect(suggestion!.ratio).toBeLessThan(6);
  });

  it("keeps hue and saturation, so the suggestion still reads as the brand colour", () => {
    const suggestion = suggestNearestPassing("#FF6B6B", WHITE);
    const fixed = rgb(suggestion!.hex);
    expect(fixed.r).toBeGreaterThan(fixed.g);
    expect(fixed.r).toBeGreaterThan(fixed.b);
    expect(fixed.g).toBe(fixed.b);
  });

  it("turns back the other way when the stated direction cannot reach the target", () => {
    // #808080 is light enough to darken from, but a mid-grey foreground on it
    // has to go the other way to clear 4.5:1.
    const suggestion = suggestNearestPassing("#8A8A8A", "#595959");
    expect(suggestion).not.toBeNull();
    expect(contrastRatioBetween(suggestion!.hex, "#595959")).toBeGreaterThanOrEqual(4.5);
  });

  it("always finds a colour at AA, because every background clears 4.5:1 against black or white", () => {
    // The two floors overlap: a background fails against black only below
    // 0.175 luminance and against white only above 0.183, so no background
    // fails both. The ramp reaches both ends, so an AA suggestion always
    // exists for a measurable pair.
    const backgrounds = ["#FFFFFF", "#F7F7F7", "#777777", "#595959", "#111111", BLACK];
    for (const background of backgrounds) {
      const suggestion = suggestNearestPassing("#8A8A8A", background);
      const already = contrastRatioBetween("#8A8A8A", background)!;
      if (already >= 4.5) {
        expect(suggestion, background).toBeNull();
        continue;
      }
      expect(suggestion, background).not.toBeNull();
      expect(contrastRatioBetween(suggestion!.hex, background), background).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it("returns null when no colour on the ramp can reach a stricter target", () => {
    // Nothing clears AAA's 7:1 against a mid-tone background — there the
    // background is what has to change, and saying so beats suggesting a
    // colour that still fails.
    expect(contrastRatioBetween(BLACK, "#777777")).toBeLessThan(7);
    expect(contrastRatioBetween(WHITE, "#777777")).toBeLessThan(7);
    expect(suggestNearestPassing("#6A6A6A", "#777777", 7)).toBeNull();
  });

  it("returns null when either colour is not measurable", () => {
    expect(suggestNearestPassing("var(--x)", WHITE)).toBeNull();
    expect(suggestNearestPassing("#AAAAAA", "currentColor")).toBeNull();
  });
});

describe("suggestNearestPassingAgainst", () => {
  it("clears every background it is given, not just the easiest", () => {
    const backgrounds = [WHITE, "#F7F7F7", "#EDEDED"];
    const suggestion = suggestNearestPassingAgainst("#AAAAAA", backgrounds);
    expect(suggestion).not.toBeNull();
    for (const background of backgrounds) {
      expect(contrastRatioBetween(suggestion!.hex, background), background).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it("is stricter than the single-background walk when the backgrounds differ", () => {
    const lenient = suggestNearestPassing("#AAAAAA", WHITE)!;
    const strict = suggestNearestPassingAgainst("#AAAAAA", [WHITE, "#E0E0E0"])!;
    expect(relativeLuminance(rgb(strict.hex))).toBeLessThan(relativeLuminance(rgb(lenient.hex)));
    expect(contrastRatioBetween(lenient.hex, "#E0E0E0")).toBeLessThan(4.5);
    expect(contrastRatioBetween(strict.hex, "#E0E0E0")).toBeGreaterThanOrEqual(4.5);
  });

  it("reports the ratio against the hardest background, so it never over-claims", () => {
    const suggestion = suggestNearestPassingAgainst("#AAAAAA", [WHITE, "#E0E0E0"])!;
    expect(suggestion.ratio).toBe(contrastRatioBetween(suggestion.hex, "#E0E0E0"));
    expect(suggestion.ratio).toBeLessThan(contrastRatioBetween(suggestion.hex, WHITE)!);
  });

  it("returns null when it already clears every background, or when none resolve", () => {
    expect(suggestNearestPassingAgainst("#1A1A1A", [WHITE, "#F7F7F7"])).toBeNull();
    expect(suggestNearestPassingAgainst("#AAAAAA", [])).toBeNull();
    expect(suggestNearestPassingAgainst("#AAAAAA", ["var(--bg)"])).toBeNull();
  });

  it("skips the backgrounds it cannot measure rather than giving up", () => {
    const suggestion = suggestNearestPassingAgainst("#AAAAAA", [WHITE, "var(--surface)"]);
    expect(suggestion?.hex).toBe(suggestNearestPassing("#AAAAAA", WHITE)?.hex);
  });
});

describe("contrastPaletteFromTokensCss", () => {
  const css = `
    /* --text: #FF0000 — commented out, must be ignored */
    :root {
      --brand-background: #ffffff;
      --brand-surface: #F7F7F7;
      --brand-text: #abc;
      --text-muted: #CCCCCC;
      --brand-primary: #FFD400;
      --on-primary: #FFFFFF;
      --link: #7fb2ff;
      --brand-border: #E5E5E5;
      --radius-md: 8px;
      --shadow-sm: 0 1px 2px rgba(0,0,0,.05);
      --text-inverse: var(--brand-background);
    }
    @media (prefers-color-scheme: dark) {
      :root { --brand-background: #0B0B0B; }
    }
  `;

  it("reads the purpose-named colour tokens and nothing else", () => {
    expect(contrastPaletteFromTokensCss(css).tokens).toEqual({
      background: "#FFFFFF",
      surface: "#F7F7F7",
      // Expanded from #abc, so it matches the form a suggestion is compared in.
      body: "#AABBCC",
      muted: "#CCCCCC",
      primary: "#FFD400",
      onPrimary: "#FFFFFF",
      link: "#7FB2FF",
    });
  });

  it("remembers the custom property behind each slot, which is what a fix rewrites", () => {
    expect(contrastPaletteFromTokensCss(css).names).toEqual({
      background: "brand-background",
      surface: "brand-surface",
      body: "brand-text",
      muted: "text-muted",
      primary: "brand-primary",
      onPrimary: "on-primary",
      link: "link",
    });
  });

  it("keeps the first declaration, so a dark-scheme override is not audited as the light set", () => {
    expect(contrastPaletteFromTokensCss(css).tokens.background).toBe("#FFFFFF");
  });

  it("stays linear on CSS full of unclosed comments", () => {
    // `/\/\*[\s\S]*?\*\//g` restarted its lazy scan at every `/*` and ran it to
    // end of input — CodeQL's js/polynomial-redos. The token CSS is
    // model-written inside a sandbox, so this is reachable input.
    const pathological = `${"a/*".repeat(40_000)}:root{--brand-primary:#0B5FFF}`;
    const started = Date.now();
    // An unterminated comment runs to end of file, per the CSS spec, so the
    // declaration after it is commented out — which is the point of stripping.
    expect(contrastPaletteFromTokensCss(pathological).tokens).toEqual({});
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("returns nothing for CSS with no usable colour tokens", () => {
    expect(contrastPaletteFromTokensCss(":root { --radius: 8px; }").tokens).toEqual({});
    expect(contrastPaletteFromTokensCss("").tokens).toEqual({});
  });

  it("audits a saved system straight from its token CSS", () => {
    const audit = auditTokensCss(css);
    expect(audit.hasIssues).toBe(true);
    expect(pairOf(audit, "muted-on-background").status).toBe("fail");
  });
});

describe("contrastPaletteFromBrandColors", () => {
  const color = (hex: string, token: string, role: BrandColor["role"]): BrandColor => ({
    hex,
    token,
    role,
  });

  it("prefers a purpose-named token over the role it was tagged with", () => {
    const { tokens, names } = contrastPaletteFromBrandColors([
      color("#111111", "on-primary", "text"),
      color("#999999", "brand-text", "text"),
      color("#0B5FFF", "brand-primary", "primary"),
    ]);
    expect(tokens.onPrimary).toBe("#111111");
    expect(tokens.body).toBe("#999999");
    expect(names.onPrimary).toBe("on-primary");
    expect(names.body).toBe("brand-text");
  });

  it("falls back to roles for the slots no token name claims", () => {
    const { tokens, names } = contrastPaletteFromBrandColors([
      color("#FFFFFF", "surface-base", "background"),
      color("#1A1A1A", "ink-900", "text"),
      color("#0B5FFF", "blue-600", "primary"),
      color("#E5E5E5", "line", "border"),
    ]);
    expect(tokens).toEqual({ background: "#FFFFFF", body: "#1A1A1A", primary: "#0B5FFF" });
    // Still named, so a fix rewrites the right declaration even when the slot
    // was inferred from the role rather than the token name.
    expect(names).toEqual({ background: "surface-base", body: "ink-900", primary: "blue-600" });
  });

  it("leaves on-primary and link unresolved when the palette never names them", () => {
    // BrandColorRole has no on-primary or link, and the extractor's own rule is
    // that an admitted gap beats an invented colour.
    const audit = auditBrandColors([
      color("#FFFFFF", "bg", "background"),
      color("#1A1A1A", "fg", "text"),
      color("#0B5FFF", "accent-600", "primary"),
    ]);
    expect(pairOf(audit, "on-primary-on-primary").status).toBe("missing");
    expect(pairOf(audit, "link-on-background").status).toBe("missing");
    expect(audit.hasIssues).toBe(false);
  });

  it("strips a leading -- from a token name", () => {
    // The contract says `token` carries none, but it is model-written and only
    // checked for being a string. A `--brand-text` became the name
    // `--brand-text`, and a one-click fix then looked for `----brand-text`,
    // matched nothing, and left the card showing a colour never written.
    const { names } = contrastPaletteFromBrandColors([
      color("#999999", "--brand-text", "text"),
      color("#FFFFFF", "--brand-background", "background"),
    ]);
    expect(names.body).toBe("brand-text");
    expect(names.background).toBe("brand-background");
  });

  it("has no role fallback on the token CSS path, and that is deliberate", () => {
    // tokens.css carries no roles, so this path matches names only. The two
    // paths therefore disagree for a token named outside the slot list — which
    // is exactly why the review card audits the token CSS it is about to
    // store, rather than brand.json. Do not "fix" this by inventing roles
    // here; fix it by auditing one artifact.
    const named = [
      color("#FFFFFF", "brand-paper", "background"),
      color("#999999", "brand-copy", "text"),
    ];
    expect(auditBrandColors(named).audited).toBe(1);
    expect(
      auditTokensCss(":root{--brand-paper:#FFFFFF;--brand-copy:#999999}").audited,
    ).toBe(0);
  });

  it("ignores a colour whose hex did not survive validation", () => {
    const { tokens } = contrastPaletteFromBrandColors([
      { hex: "not-a-colour", token: "brand-text", role: "text" } as BrandColor,
      color("#1A1A1A", "ink", "text"),
    ]);
    expect(tokens.body).toBe("#1A1A1A");
  });
});

describe("a failing palette, end to end", () => {
  /** Light background, every foreground too pale: the shape of palette this
   *  audit exists to stop spreading into every later /design run. */
  const palette: BrandColor[] = [
    { hex: "#FFFFFF", token: "brand-background", role: "background" },
    { hex: "#F7F7F7", token: "brand-surface", role: "surface" },
    { hex: "#AAAAAA", token: "brand-text", role: "text" },
    { hex: "#CCCCCC", token: "text-muted", role: "muted" },
    { hex: "#FFD400", token: "brand-primary", role: "primary" },
    { hex: "#FFFFFF", token: "on-primary", role: "text" },
    { hex: "#7FB2FF", token: "link", role: "accent" },
  ];

  it("fails all five pairs and offers a suggestion for each", () => {
    const audit = auditBrandColors(palette);
    expect(audit.audited).toBe(5);
    expect(audit.failing).toBe(5);
    expect(audit.hasIssues).toBe(true);
    for (const pair of audit.pairs) {
      expect(pair.status).toBe("fail");
      expect(pair.ratings?.aaNormal).toBe(false);
      expect(pair.suggestion).not.toBeNull();
    }
  });

  it("suggests colours that actually clear AA against the same background", () => {
    for (const pair of auditBrandColors(palette).pairs) {
      const suggestion = pair.suggestion;
      expect(suggestion, pair.id).not.toBeNull();
      expect(contrastRatioBetween(suggestion!.hex, pair.backgroundHex!), pair.id).toBe(
        suggestion!.ratio,
      );
      expect(suggestion!.ratio, pair.id).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("passes every pair once the suggestions are applied by token name", () => {
    const first = auditBrandColors(palette);
    const applied = palette.map((entry) => {
      const fix = first.pairs.find(
        (pair) => pair.foregroundToken === entry.token && pair.suggestion !== null,
      );
      return fix?.suggestion ? { ...entry, hex: fix.suggestion.hex } : entry;
    });

    const second = auditBrandColors(applied);
    expect(second.failing).toBe(0);
    expect(second.hasIssues).toBe(false);
  });

  it("sizes one token's fix for every background it sits on", () => {
    // --brand-text is the foreground of body-on-background (#FFFFFF) AND of
    // body-on-surface (#F7F7F7), because on-surface defaults to the body
    // colour. Fixing it for white alone leaves the surface pair failing.
    const audit = auditBrandColors(palette);
    const onBackground = pairOf(audit, "body-on-background");
    const onSurface = pairOf(audit, "on-surface-on-surface");
    expect(onBackground.foregroundToken).toBe("brand-text");
    expect(onSurface.foregroundToken).toBe("brand-text");
    expect(onSurface.suggestion!.hex).toBe(onBackground.suggestion!.hex);
    expect(contrastRatioBetween(onBackground.suggestion!.hex, "#F7F7F7")).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it("names a distinct token per side, so a fix cannot be keyed by colour value", () => {
    // --brand-background and --on-primary are both #FFFFFF here, which is the
    // common case, not a contrived one: a white page and white text on a
    // primary fill. Applying the on-primary fix by hex would darken the page
    // background along with it and fail four pairs that had passed.
    const audit = auditBrandColors(palette);
    const onPrimary = pairOf(audit, "on-primary-on-primary");
    const body = pairOf(audit, "body-on-background");
    expect(onPrimary.foregroundHex).toBe(body.backgroundHex);
    expect(onPrimary.foregroundToken).toBe("on-primary");
    expect(body.backgroundToken).toBe("brand-background");
  });
});
