import { describe, expect, it } from "vitest";
import {
  DESIGN_EXPORT_FORMATS,
  designExportFilename,
  designTokensFromBrandSummary,
  designTokensFromTokensCss,
  exportDesignSystem,
  exportTokensCss,
  isDesignExportFormat,
  slugifyTokenName,
  EMPTY_DESIGN_TOKEN_SET,
  type DesignColorToken,
  type DesignExportFormat,
} from "./design-export.js";
import type { BrandSummary } from "./brand-extraction.js";

/**
 * Every format is asserted through JSON.parse or a parsed `:root` block rather
 * than against a pasted string: a snapshot of generated config tells you it
 * changed, not whether it is still valid to the tool that consumes it.
 */

const SUMMARY: BrandSummary = {
  version: 1,
  name: "Northwind",
  source: "url",
  sourceUrl: "https://northwind.example",
  extractedAt: "2026-10-23T00:00:00.000Z",
  colors: [
    { hex: "#0B5FFF", token: "brand-primary", role: "primary", occurrences: 120 },
    { hex: "#FF6B6B", token: "brand-accent", role: "accent", occurrences: 40 },
    { hex: "#6B7280", token: "text-muted", role: "muted", occurrences: 90 },
    { hex: "#FFFFFF", token: "brand-background", role: "background", occurrences: 400 },
    { hex: "#0A2540", token: "brand-text", role: "text", occurrences: 310 },
  ],
  fonts: [
    { family: "Inter", role: "heading", fallbacks: ["system-ui", "sans-serif"], weights: [600, 700] },
    { family: "Inter", role: "body", fallbacks: ["system-ui", "sans-serif"] },
    { family: "JetBrains Mono", role: "mono", fallbacks: ["monospace"] },
  ],
  typeScale: [
    { name: "h1", sizePx: 48, lineHeightPx: 56, weight: 700, letterSpacingPx: -0.5 },
    { name: "body", sizePx: 16, lineHeightPx: 24 },
  ],
  radii: [{ token: "radius-md", value: "8px" }],
  spacing: [{ token: "space-3", value: "12px" }],
  shadows: [{ token: "shadow-sm", value: "0 1px 2px rgba(0,0,0,.05)" }],
};

const parsed = (format: DesignExportFormat, summary: BrandSummary = SUMMARY): any =>
  JSON.parse(exportDesignSystem(summary, format));

/** `--name: value` pairs out of a `:root` block. */
const cssVars = (css: string): Record<string, string> =>
  Object.fromEntries(
    [...css.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)].map((match) => [match[1]!, match[2]!.trim()]),
  );

describe("slugifyTokenName", () => {
  it("slugifies the shapes a token name arrives in", () => {
    expect(slugifyTokenName("Primary Light")).toBe("primary-light");
    expect(slugifyTokenName("primaryLight")).toBe("primary-light");
    expect(slugifyTokenName("--brand-primary")).toBe("primary");
    expect(slugifyTokenName("Surface / Raised")).toBe("surface-raised");
    expect(slugifyTokenName("  text_muted  ")).toBe("text-muted");
    expect(slugifyTokenName("Brand Primary 500")).toBe("primary-500");
  });

  it("returns empty for a name with nothing usable in it", () => {
    expect(slugifyTokenName("")).toBe("");
    expect(slugifyTokenName("---")).toBe("");
    expect(slugifyTokenName("  ")).toBe("");
  });
});

describe("format catalogue", () => {
  it("names all four formats and recognises them", () => {
    expect(DESIGN_EXPORT_FORMATS).toEqual([
      "tailwind",
      "css-vars",
      "style-dictionary",
      "figma-tokens",
    ]);
    for (const format of DESIGN_EXPORT_FORMATS) expect(isDesignExportFormat(format)).toBe(true);
    expect(isDesignExportFormat("scss")).toBe(false);
    expect(isDesignExportFormat(undefined)).toBe(false);
  });

  it("gives each format its own filename", () => {
    const names = DESIGN_EXPORT_FORMATS.map(designExportFilename);
    expect(new Set(names).size).toBe(names.length);
    expect(designExportFilename("css-vars")).toBe("tokens.css");
  });

  it("emits parseable output for every format", () => {
    for (const format of DESIGN_EXPORT_FORMATS) {
      const out = exportDesignSystem(SUMMARY, format);
      expect(out.length, format).toBeGreaterThan(0);
      if (format === "css-vars") expect(out, format).toContain(":root {");
      else expect(() => JSON.parse(out), format).not.toThrow();
    }
  });
});

describe("primary, secondary and neutral", () => {
  // BRAND_COLOR_ROLES has no secondary or neutral, so `accent` and `muted` are
  // mapped to the names a consumer actually writes in code. Every format has to
  // agree on that, which is the point of normalising first.
  it("maps the three in Tailwind", () => {
    expect(parsed("tailwind").colors).toMatchObject({
      primary: "#0B5FFF",
      secondary: "#FF6B6B",
      neutral: "#6B7280",
    });
  });

  it("maps the three in CSS variables", () => {
    const vars = cssVars(exportDesignSystem(SUMMARY, "css-vars"));
    expect(vars["color-primary"]).toBe("#0B5FFF");
    expect(vars["color-secondary"]).toBe("#FF6B6B");
    expect(vars["color-neutral"]).toBe("#6B7280");
  });

  it("maps the three in Style Dictionary", () => {
    expect(parsed("style-dictionary").color).toMatchObject({
      primary: { value: "#0B5FFF" },
      secondary: { value: "#FF6B6B" },
      neutral: { value: "#6B7280" },
    });
  });

  it("maps the three in Figma tokens, each carrying its type", () => {
    expect(parsed("figma-tokens").global.colors).toMatchObject({
      primary: { value: "#0B5FFF", type: "color" },
      secondary: { value: "#FF6B6B", type: "color" },
      neutral: { value: "#6B7280", type: "color" },
    });
  });

  it("keeps the roles that already read correctly under their own name", () => {
    const colors = parsed("tailwind").colors;
    expect(colors).toMatchObject({ background: "#FFFFFF", text: "#0A2540" });
    expect(colors).not.toHaveProperty("accent");
    expect(colors).not.toHaveProperty("muted");
  });

  it("falls back to the token name when two colours claim one role", () => {
    const twoPrimaries = {
      ...SUMMARY,
      colors: [
        { hex: "#0B5FFF", token: "brand-primary", role: "primary" as const },
        { hex: "#003399", token: "primary-dark", role: "primary" as const },
      ],
    };
    const colors = JSON.parse(exportDesignSystem(twoPrimaries, "tailwind")).colors;
    expect(colors["primary"]).toBe("#0B5FFF");
    expect(colors["primary-dark"]).toBe("#003399");
  });
});

describe("font stacks", () => {
  it("keeps an array for Tailwind and joins for the rest", () => {
    // The one real difference between the formats, and the thing most likely
    // to be got wrong: Tailwind wants an array, CSS and the token formats want
    // one string.
    expect(parsed("tailwind").fontFamily).toEqual({
      heading: ["Inter", "system-ui", "sans-serif"],
      body: ["Inter", "system-ui", "sans-serif"],
      mono: ["JetBrains Mono", "monospace"],
    });

    const vars = cssVars(exportDesignSystem(SUMMARY, "css-vars"));
    expect(vars["font-heading"]).toBe("Inter, system-ui, sans-serif");
    expect(vars["font-mono"]).toBe("JetBrains Mono, monospace");

    expect(parsed("style-dictionary").font.family.body).toEqual({
      value: "Inter, system-ui, sans-serif",
    });
    expect(parsed("figma-tokens").global.fontFamilies.body).toEqual({
      value: "Inter, system-ui, sans-serif",
      type: "fontFamilies",
    });
  });

  it("carries a family with no fallbacks as a one-entry stack", () => {
    const bare = {
      ...SUMMARY,
      fonts: [{ family: "Inter", role: "body" as const }],
    };
    expect(JSON.parse(exportDesignSystem(bare, "tailwind")).fontFamily).toEqual({
      body: ["Inter"],
    });
    expect(cssVars(exportDesignSystem(bare, "css-vars"))["font-body"]).toBe("Inter");
  });
});

describe("the type scale", () => {
  it("uses Tailwind's tuple form only when there is more than a size", () => {
    const fontSize = parsed("tailwind").fontSize;
    expect(fontSize.h1).toEqual([
      "48px",
      { lineHeight: "56px", letterSpacing: "-0.5px", fontWeight: "700" },
    ]);
    expect(fontSize.body).toEqual(["16px", { lineHeight: "24px" }]);

    const sizeOnly = { ...SUMMARY, typeScale: [{ name: "lg", sizePx: 20 }] };
    expect(JSON.parse(exportDesignSystem(sizeOnly, "tailwind")).fontSize).toEqual({ lg: "20px" });
  });

  it("splits size, line height, weight and tracking into their own CSS vars", () => {
    const vars = cssVars(exportDesignSystem(SUMMARY, "css-vars"));
    expect(vars["text-h1"]).toBe("48px");
    expect(vars["leading-h1"]).toBe("56px");
    expect(vars["weight-h1"]).toBe("700");
    expect(vars["tracking-h1"]).toBe("-0.5px");
    // Only what the step actually stated.
    expect(vars["weight-body"]).toBeUndefined();
  });

  it("omits the optional groups entirely when no step states them", () => {
    const sizeOnly = { ...SUMMARY, typeScale: [{ name: "lg", sizePx: 20 }] };
    expect(JSON.parse(exportDesignSystem(sizeOnly, "style-dictionary")).font).not.toHaveProperty(
      "weight",
    );
    expect(JSON.parse(exportDesignSystem(sizeOnly, "figma-tokens")).global).not.toHaveProperty(
      "fontWeights",
    );
  });
});

describe("scales", () => {
  it("strips the category from the key, so it is not repeated in the output", () => {
    expect(parsed("tailwind")).toMatchObject({
      borderRadius: { md: "8px" },
      spacing: { 3: "12px" },
      boxShadow: { sm: "0 1px 2px rgba(0,0,0,.05)" },
    });
    const vars = cssVars(exportDesignSystem(SUMMARY, "css-vars"));
    expect(vars["radius-md"]).toBe("8px");
    expect(vars["space-3"]).toBe("12px");
  });

  it("does not double the category it already carries", () => {
    // The summary path skipped the strip at first, so `--radius-md` came out as
    // `--radius-radius-md` and `borderRadius: { "radius-md" }` — and the same
    // system exported different keys depending on whether it arrived as
    // brand.json or as tokens.css.
    const css = exportDesignSystem(SUMMARY, "css-vars");
    expect(css).toContain("--radius-md:");
    expect(css).not.toContain("--radius-radius-md:");
    expect(css).not.toContain("--space-space-3:");
    expect(css).not.toContain("--shadow-shadow-sm:");

    const fromCss = designTokensFromTokensCss(
      ":root { --radius-md: 8px; --space-3: 12px; --shadow-sm: 0 1px 2px #0001; }",
    );
    const fromSummary = designTokensFromBrandSummary(SUMMARY);
    expect(fromCss.radii.map((item) => item.key)).toEqual(
      fromSummary.radii.map((item) => item.key),
    );
    expect(fromCss.spacing.map((item) => item.key)).toEqual(
      fromSummary.spacing.map((item) => item.key),
    );
    expect(fromCss.shadows.map((item) => item.key)).toEqual(
      fromSummary.shadows.map((item) => item.key),
    );
  });
});

describe("the token CSS entry point", () => {
  const TOKENS_CSS = `
    /* Northwind */
    :root {
      --brand-primary: #0b5fff;
      --brand-accent: #FF6B6B;
      --text-muted: #6b7280;
      --brand-background: #fff;
      --font-heading: Inter, system-ui, sans-serif;
      --font-mono: "JetBrains Mono", monospace;
      --font-size-h1: 48px;
      --radius-md: 8px;
      --space-3: 12px;
      --shadow-sm: 0 1px 2px rgba(0,0,0,.05);
      --transition-fast: 120ms ease;
    }
  `;

  it("reads a saved system's token CSS, which is all the record keeps", () => {
    const tokens = designTokensFromTokensCss(TOKENS_CSS, "Northwind");
    expect(tokens.name).toBe("Northwind");
    expect(tokens.colors.map((color) => color.key)).toEqual([
      "primary",
      "accent",
      "text-muted",
      "background",
    ]);
    // Expanded and uppercased, so #fff and #FFFFFF are one value everywhere.
    expect(tokens.colors.find((color) => color.key === "background")?.hex).toBe("#FFFFFF");
    expect(tokens.radii).toEqual([{ key: "md", value: "8px" }]);
    expect(tokens.spacing).toEqual([{ key: "3", value: "12px" }]);
    expect(tokens.shadows).toEqual([{ key: "sm", value: "0 1px 2px rgba(0,0,0,.05)" }]);
  });

  it("splits a font stack back apart, so Tailwind still gets an array", () => {
    const tokens = designTokensFromTokensCss(TOKENS_CSS);
    expect(tokens.fonts).toEqual([
      { key: "heading", stack: ["Inter", "system-ui", "sans-serif"] },
      { key: "mono", stack: ["JetBrains Mono", "monospace"] },
    ]);
    expect(JSON.parse(exportTokensCss(TOKENS_CSS, "tailwind")).fontFamily.mono).toEqual([
      "JetBrains Mono",
      "monospace",
    ]);
  });

  it("skips a declaration it cannot classify rather than guessing", () => {
    // `--transition-fast` is not a colour, a type step or any scale this
    // exports. Putting it in `spacing` would produce a config that builds and
    // is wrong.
    const tokens = designTokensFromTokensCss(TOKENS_CSS);
    const everyKey = [
      ...tokens.colors.map((item) => item.key),
      ...tokens.radii.map((item) => item.key),
      ...tokens.spacing.map((item) => item.key),
      ...tokens.shadows.map((item) => item.key),
    ];
    expect(everyKey).not.toContain("transition-fast");
    expect(everyKey).not.toContain("fast");
  });

  it("stays linear on token CSS full of unclosed comments", () => {
    // `/\/\*[\s\S]*?\*\//g` restarted its lazy scan at every `/*` and ran it to
    // end of input — CodeQL's js/polynomial-redos. A saved system's token CSS
    // is model-written, so this is reachable input.
    const pathological = `${"a/*".repeat(40_000)}:root{--brand-primary:#0B5FFF}`;
    const started = Date.now();
    // An unterminated comment runs to end of file per the CSS spec, so the
    // declaration after it is commented out.
    expect(designTokensFromTokensCss(pathological).colors).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("ignores a commented-out declaration", () => {
    const tokens = designTokensFromTokensCss("/* --brand-primary: #FF0000; */ :root { --brand-primary: #0B5FFF; }");
    expect(tokens.colors).toEqual([{ key: "primary", hex: "#0B5FFF" }]);
  });

  it("exports every format from token CSS too", () => {
    for (const format of DESIGN_EXPORT_FORMATS) {
      const out = exportTokensCss(TOKENS_CSS, format);
      if (format === "css-vars") expect(out, format).toContain("--color-primary: #0B5FFF;");
      else expect(() => JSON.parse(out), format).not.toThrow();
    }
  });

  it("round-trips its own CSS export back to the same colours", () => {
    // The namespace strip is what makes this hold: `--color-primary` on the way
    // out reads back as `primary`, not `color-primary`.
    const first = designTokensFromTokensCss(TOKENS_CSS);
    const second = designTokensFromTokensCss(exportTokensCss(TOKENS_CSS, "css-vars"));
    expect(second.colors).toEqual(first.colors);
    expect(second.fonts).toEqual(first.fonts);
  });
});

describe("real-world token CSS", () => {
  it("converts rem and em type sizes instead of reading off the number", () => {
    // `Number.parseFloat("0.875rem")` was 0.875, exported as `0.875px` — a
    // Tailwind config with microscopic type, and most token files use rem.
    const tokens = designTokensFromTokensCss(":root{--text-sm:0.875rem;--text-lg:1.5rem;--text-xs:12px}");
    expect(tokens.typeScale).toEqual([
      { key: "sm", sizePx: 14 },
      { key: "lg", sizePx: 24 },
      { key: "xs", sizePx: 12 },
    ]);
    expect(JSON.parse(exportTokensCss(":root{--text-sm:0.875rem}", "tailwind")).fontSize).toEqual({
      sm: "14px",
    });
  });

  it("refuses a length it cannot read rather than taking its leading number", () => {
    const tokens = designTokensFromTokensCss(
      ":root{--text-fluid:clamp(1rem, 2vw, 2rem);--text-pct:120%;--text-ok:18px}",
    );
    expect(tokens.typeScale).toEqual([{ key: "ok", sizePx: 18 }]);
  });

  it("does not let --font-weight-* claim the body font slot", () => {
    // It matched the `^font` prefix and defaulted to `body` as the stack
    // ["700"], and first-wins then dropped the real --font-body after it.
    const tokens = designTokensFromTokensCss(
      ":root{--font-weight-bold:700;--font-line-height-tight:1.1;--font-body:Inter, sans-serif}",
    );
    expect(tokens.fonts).toEqual([{ key: "body", stack: ["Inter", "sans-serif"] }]);
  });

  it("still reads a family-prefixed font token", () => {
    expect(designTokensFromTokensCss(":root{--font-family-base:Inter, sans-serif}").fonts).toEqual([
      { key: "body", stack: ["Inter", "sans-serif"] },
    ]);
  });

  it("exports only the top-level :root, not a dark-scheme override", () => {
    // Reading declarations from anywhere in the file exported the override as
    // a second colour, `primary-2`, so the download carried a phantom token.
    // Dark variants are XYNE-66829's.
    const tokens = designTokensFromTokensCss(
      ":root{--brand-primary:#2563EB}" +
        "@media (prefers-color-scheme: dark){:root{--brand-primary:#60A5FA}}" +
        ".dark{--brand-primary:#1D4ED8}",
    );
    expect(tokens.colors).toEqual([{ key: "primary", hex: "#2563EB" }]);
  });

  it("reads a shadcn globals.css, where :root sits inside @layer base", () => {
    // Scoping to the top level alone exported NOTHING for this layout — the
    // default for shadcn and Tailwind v3, and what repo extraction and
    // hand-edited systems most often look like. A silently empty download.
    const shadcn = `@tailwind base;
@layer base {
  :root {
    --brand-primary: #2563EB;
    --radius-md: 0.5rem;
    --font-body: Inter, sans-serif;
  }
  .dark {
    --brand-primary: #60A5FA;
  }
}`;
    const tokens = designTokensFromTokensCss(shadcn);
    expect(tokens.colors).toEqual([{ key: "primary", hex: "#2563EB" }]);
    expect(tokens.radii).toEqual([{ key: "md", value: "0.5rem" }]);
    expect(tokens.fonts).toEqual([{ key: "body", stack: ["Inter", "sans-serif"] }]);
  });

  it("does not walk into a conditional at-rule, only a grouping one", () => {
    // @layer only groups; @media and @supports are conditions, and a block
    // inside one is a variant rather than a token of this set.
    const conditional = `@media (min-width: 40rem){:root{--brand-primary:#111111}}
@supports (display:grid){:root{--brand-primary:#222222}}
@layer tokens{:root{--brand-primary:#2563EB}}`;
    expect(designTokensFromTokensCss(conditional).colors).toEqual([
      { key: "primary", hex: "#2563EB" },
    ]);
  });

  it("treats an attribute or class dark variant as a variant, not a token", () => {
    // A substring test on the selector let these through as primary-2 and
    // primary-3.
    const variants = `:root{--brand-primary:#2563EB}
:root[data-theme="dark"]{--brand-primary:#60A5FA}
:root.dark{--brand-primary:#1D4ED8}
html.theme-dark{--brand-primary:#1E40AF}`;
    expect(designTokensFromTokensCss(variants).colors).toEqual([
      { key: "primary", hex: "#2563EB" },
    ]);
  });

  it("still accepts a selector list of plain root selectors", () => {
    expect(designTokensFromTokensCss(":root, html{--brand-primary:#2563EB}").colors).toEqual([
      { key: "primary", hex: "#2563EB" },
    ]);
  });

  it("does not let a brace inside a string throw off the block walk", () => {
    // The comment strip became quote-aware; the brace counting had not, so
    // `content: "{"` emptied the whole export.
    const tokens = designTokensFromTokensCss(
      '.a { content: "{" } :root { --brand-primary: #2563EB; --label: "}" ; --space-2: 8px }',
    );
    expect(tokens.colors).toEqual([{ key: "primary", hex: "#2563EB" }]);
    expect(tokens.spacing).toEqual([{ key: "2", value: "8px" }]);
  });

  it("matches units whatever their case", () => {
    expect(designTokensFromTokensCss(":root{--text-lg:2.5REM;--text-sm:12PX}").typeScale).toEqual([
      { key: "lg", sizePx: 40 },
      { key: "sm", sizePx: 12 },
    ]);
  });

  it("reads a Tailwind v4 @theme block, which is top level too", () => {
    expect(designTokensFromTokensCss("@theme{--color-primary:#2563EB}").colors).toEqual([
      { key: "primary", hex: "#2563EB" },
    ]);
  });

  it("ignores a nested block inside a theme block", () => {
    const tokens = designTokensFromTokensCss(
      "@theme{--color-primary:#2563EB;@keyframes spin{from{--color-primary:#FF0000}}}",
    );
    expect(tokens.colors).toEqual([{ key: "primary", hex: "#2563EB" }]);
  });

  it("does not let a /* inside a string swallow the rest of the file", () => {
    // The strip ran the unterminated comment to end of file and every token
    // after it disappeared. Model-written CSS can contain this without anyone
    // trying.
    const tokens = designTokensFromTokensCss(
      ':root{--brand-primary:#2563EB;--label:"/*";--space-4:16px}',
    );
    expect(tokens.colors).toEqual([{ key: "primary", hex: "#2563EB" }]);
    expect(tokens.spacing).toEqual([{ key: "4", value: "16px" }]);
  });

  it("keeps the same type-step key whichever artifact the system arrived as", () => {
    const fromSummary = JSON.parse(
      exportDesignSystem({ ...SUMMARY, typeScale: [{ name: "font-size-h1", sizePx: 48 }] }, "tailwind"),
    ).fontSize;
    const fromCss = JSON.parse(exportTokensCss(":root{--font-size-h1:48px}", "tailwind")).fontSize;
    expect(Object.keys(fromSummary)).toEqual(["h1"]);
    expect(Object.keys(fromCss)).toEqual(["h1"]);
  });
});

describe("the CSS export cannot be broken out of", () => {
  it("drops a value that would end its own declaration", () => {
    // The CSS entry point cannot produce this, but brand.json can: a
    // model-written radius wrote a whole extra rule into the downloaded file.
    const hostile = {
      ...SUMMARY,
      radii: [{ token: "radius-md", value: "4px;} body{display:none" }],
    };
    const css = exportDesignSystem(hostile, "css-vars");
    expect(css).not.toContain("display:none");
    expect(css).not.toContain("--radius-md");
    // The rest of the system still exports.
    expect(css).toContain("--color-primary: #0B5FFF;");
  });

  it("drops the value for EVERY format, not just the CSS writer", () => {
    // Guarding only toCssVars left Tailwind emitting
    // `"md": "4px;} body{display:none"` — valid JSON, but Tailwind writes it
    // into generated CSS and the extra rule comes back.
    const hostile = {
      ...SUMMARY,
      radii: [{ token: "radius-md", value: "4px;} body{display:none" }],
      fonts: [{ family: "Inter;} body{display:none", role: "body" as const }],
    };
    for (const format of DESIGN_EXPORT_FORMATS) {
      const out = exportDesignSystem(hostile, format);
      expect(out, format).not.toContain("display:none");
    }
    expect(JSON.parse(exportDesignSystem(hostile, "tailwind"))).not.toHaveProperty("borderRadius");
    expect(JSON.parse(exportDesignSystem(hostile, "tailwind"))).not.toHaveProperty("fontFamily");
  });

  it("refuses a value that would break out of a style block or attribute", () => {
    // CSS_DECLARATION stops at `;{}` but allowed `<>"'`, so these reached the
    // branding injectors in XYNE-66827 and escaped: the font closed the brand
    // `<style>` and put a `<script>` in a delivered report, the radius closed
    // a `style="…"` attribute and added `onload` to an email draft's link.
    const tokens = designTokensFromTokensCss(
      ':root{--brand-primary:#2563EB;' +
        '--radius-md:8px" onload="alert(1);' +
        '--font-body:Inter</style><script>alert(2)</script>;' +
        "--space-2:8px}",
    );
    expect(tokens.radii).toEqual([]);
    expect(tokens.fonts).toEqual([]);
    // The safe tokens around them still export.
    expect(tokens.colors).toEqual([{ key: "primary", hex: "#2563EB" }]);
    expect(tokens.spacing).toEqual([{ key: "2", value: "8px" }]);

    for (const format of DESIGN_EXPORT_FORMATS) {
      const out = exportTokensCss(
        ':root{--font-body:Inter</style><script>alert(1)</script>}',
        format,
      );
      expect(out, format).not.toContain("<script>");
    }
  });

  it("strips a comment terminator out of the system name", () => {
    const css = exportDesignSystem({ ...SUMMARY, name: "Acme */ evil" }, "css-vars");
    expect(css.split("\n")[0]).toBe("/* Acme  evil */");
  });
});

describe("EMPTY_DESIGN_TOKEN_SET", () => {
  it("is frozen all the way down, so a caller cannot mutate the shared constant", () => {
    expect(() => (EMPTY_DESIGN_TOKEN_SET.colors as DesignColorToken[]).push({ key: "x", hex: "#000000" })).toThrow();
    expect(EMPTY_DESIGN_TOKEN_SET.colors).toEqual([]);
  });
});

describe("bad and empty input", () => {
  it("drops a colour that is not a flat hex instead of writing it into a config", () => {
    const messy = {
      ...SUMMARY,
      colors: [
        { hex: "#0B5FFF", token: "brand-primary", role: "primary" as const },
        { hex: "rgba(0,0,0,.5)", token: "overlay", role: "surface" as const },
        { hex: "not-a-colour", token: "broken", role: "border" as const },
      ],
    };
    expect(JSON.parse(exportDesignSystem(messy, "tailwind")).colors).toEqual({
      primary: "#0B5FFF",
    });
  });

  it("normalises three-digit and lower-case hex", () => {
    const short = {
      ...SUMMARY,
      colors: [{ hex: "#abc", token: "brand-primary", role: "primary" as const }],
    };
    expect(JSON.parse(exportDesignSystem(short, "tailwind")).colors).toEqual({
      primary: "#AABBCC",
    });
  });

  it("emits valid, empty output for a system with nothing in it", () => {
    const bare: BrandSummary = {
      version: 1,
      name: "",
      source: "screenshot",
      extractedAt: "2026-10-23T00:00:00.000Z",
      colors: [],
      fonts: [],
      typeScale: [],
    };
    expect(JSON.parse(exportDesignSystem(bare, "tailwind"))).toEqual({});
    expect(JSON.parse(exportDesignSystem(bare, "style-dictionary"))).toEqual({});
    expect(JSON.parse(exportDesignSystem(bare, "figma-tokens"))).toEqual({ global: {} });
    expect(exportDesignSystem(bare, "css-vars")).toBe(":root {\n}\n");
  });

  it("survives token CSS that is not CSS", () => {
    for (const format of DESIGN_EXPORT_FORMATS) {
      expect(() => exportTokensCss("", format), format).not.toThrow();
      expect(() => exportTokensCss("not css at all", format), format).not.toThrow();
    }
    expect(JSON.parse(exportTokensCss("", "tailwind"))).toEqual({});
  });

  it("names the system in the CSS header when it has one", () => {
    expect(exportDesignSystem(SUMMARY, "css-vars")).toMatch(/^\/\* Northwind \*\//);
    expect(exportTokensCss(":root { --brand-primary: #0B5FFF; }", "css-vars")).toMatch(/^:root \{/);
  });
});

describe("the two entry points agree", () => {
  it("produces the same Tailwind colours from a summary and from its own CSS", () => {
    // Normalising both sources into one DesignTokenSet is what guarantees this;
    // without it there are eight code paths to keep in step instead of four.
    const fromSummary = JSON.parse(exportDesignSystem(SUMMARY, "tailwind"));
    const viaCss = JSON.parse(
      exportTokensCss(exportDesignSystem(SUMMARY, "css-vars"), "tailwind"),
    );
    expect(viaCss.colors).toEqual(fromSummary.colors);
    expect(viaCss.fontFamily).toEqual(fromSummary.fontFamily);
    expect(viaCss.borderRadius).toEqual(fromSummary.borderRadius);
    expect(viaCss.spacing).toEqual(fromSummary.spacing);
    expect(viaCss.boxShadow).toEqual(fromSummary.boxShadow);
  });
});
