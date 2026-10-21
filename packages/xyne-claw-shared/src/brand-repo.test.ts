import { describe, expect, it } from "vitest";
import {
  colorVariables,
  extractBlock,
  flattenStringEntries,
  inferColorRole,
  normalizeColor,
  parseCssCustomProperties,
  parseTailwindConfig,
  scanComponentPrimitives,
  toBrandColors,
} from "./brand-repo.js";
import { isBrandSummary, type BrandSummary } from "./brand-extraction.js";

/**
 * Fixtures are shaped like real configs — v3 with `extend`, v4 with `@theme`,
 * shadcn's `:root` + `hsl(var(--x))` indirection — because those are the cases
 * that actually break a naive regex.
 */

const TAILWIND_V3 = `
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#635BFF",
        'brand-background': '#FFFFFF',
        text: { DEFAULT: "#0A2540", muted: "#425466" },
        border: "rgb(230, 235, 241)",
        legacy: "oklch(0.7 0.1 250)",
      },
      borderRadius: { lg: "0.75rem", md: "0.5rem" },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
    },
  },
  plugins: [require("@tailwindcss/forms")],
};
`;

const TAILWIND_V4 = `
@import "tailwindcss";

@theme {
  --color-primary: #635BFF;
  --color-background: #FFF;
  --color-text: rgb(10, 37, 64);
  --color-muted: oklch(0.55 0.02 250);
  --radius-lg: 0.75rem;
  --font-sans: Inter, system-ui, sans-serif;
}
`;

const SHADCN_ROOT = `
/* commented out, must not be read
:root { --color-ghost: #DEAD00; }
*/
:root {
  --background: #FFFFFF;
  --foreground: #0A2540;
  --primary: #635BFF;
  --border: #E6EBF1;
  --destructive: rgb(220, 38, 38);
  --ring: hsl(var(--primary));
  --radius: 0.5rem;
}
`;

describe("normalizeColor", () => {
  it("expands 3-digit hex", () => {
    expect(normalizeColor("#FFF")).toBe("#FFFFFF");
    expect(normalizeColor("#06c")).toBe("#0066CC");
  });

  it("uppercases 6-digit hex and strips quotes", () => {
    expect(normalizeColor(" '#635bff' ")).toBe("#635BFF");
  });

  it("drops alpha from 8-digit hex — a token is flat", () => {
    expect(normalizeColor("#635BFF80")).toBe("#635BFF");
  });

  it("converts rgb() and rgba()", () => {
    expect(normalizeColor("rgb(99, 91, 255)")).toBe("#635BFF");
    expect(normalizeColor("rgba(10 37 64 / 0.5)")).toBe("#0A2540");
  });

  it("refuses colour spaces it cannot convert, rather than approximating", () => {
    // Tailwind v4 and shadcn emit oklch routinely. A wrong conversion is worse
    // than an admitted gap, so these come back null and become gaps.
    for (const value of ["oklch(0.7 0.1 250)", "lab(50% 20 -30)", "color-mix(in srgb, red, blue)"]) {
      expect(normalizeColor(value)).toBeNull();
    }
  });

  it("refuses var() indirection and junk", () => {
    expect(normalizeColor("var(--primary)")).toBeNull();
    expect(normalizeColor("hsl(var(--primary))")).toBeNull();
    expect(normalizeColor("red;background:url(x)")).toBeNull();
    expect(normalizeColor("")).toBeNull();
  });

  it("refuses out-of-range rgb channels", () => {
    expect(normalizeColor("rgb(300, 0, 0)")).toBeNull();
  });
});

describe("extractBlock", () => {
  it("brace-matches past nested objects", () => {
    const block = extractBlock(`theme: { extend: { colors: { a: "1" } }, other: 2 }`, "theme");
    expect(block).toContain("extend");
    expect(block).toContain("other: 2");
  });

  it("is not fooled by braces inside strings", () => {
    const block = extractBlock(`theme: { content: "a}b", x: 1 }`, "theme");
    expect(block).toContain("x: 1");
  });

  it("returns null for a missing or unterminated key", () => {
    expect(extractBlock("module.exports = {}", "theme")).toBeNull();
    expect(extractBlock("theme: { colors: {", "theme")).toBeNull();
  });
});

describe("flattenStringEntries", () => {
  it("flattens nested keys to dotted paths", () => {
    const entries = flattenStringEntries(`text: { DEFAULT: "#0A2540", muted: "#425466" }`);
    expect(entries).toContainEqual(["text-DEFAULT", "#0A2540"]);
    expect(entries).toContainEqual(["text-muted", "#425466"]);
  });
});

describe("parseTailwindConfig — v3", () => {
  const tokens = parseTailwindConfig(TAILWIND_V3);

  it("reads colours out of theme.extend", () => {
    const byName = Object.fromEntries(tokens.colors.map((c) => [c.name, c.value]));
    expect(byName["primary"]).toBe("#635BFF");
    expect(byName["brand-background"]).toBe("#FFFFFF");
    expect(byName["text-DEFAULT"]).toBe("#0A2540");
    expect(byName["border"]).toBe("#E6EBF1");
  });

  it("reports an oklch value as unresolved instead of guessing", () => {
    expect(tokens.unresolved.join(" ")).toContain("legacy");
    expect(tokens.colors.some((c) => c.name === "legacy")).toBe(false);
  });

  it("reads font stacks, including quoted families", () => {
    const sans = tokens.fontFamilies.find((f) => f.name === "sans");
    expect(sans?.stack).toEqual(["Inter", "system-ui", "sans-serif"]);
    expect(tokens.fontFamilies.find((f) => f.name === "mono")?.stack[0]).toBe("JetBrains Mono");
  });

  it("reads radii", () => {
    expect(tokens.radii).toContainEqual({ token: "radius-lg", value: "0.75rem" });
  });

  it("returns empty for a config with no theme, without throwing", () => {
    const empty = parseTailwindConfig("module.exports = { content: [] }");
    expect(empty.colors).toEqual([]);
  });

  it("survives a truncated config", () => {
    expect(() => parseTailwindConfig("module.exports = { theme: { colors: { a:")).not.toThrow();
  });

  it("never executes the config", () => {
    // A config is arbitrary JS from an untrusted repo. If this were eval'd the
    // throw would surface here instead of being ignored as text.
    const hostile = `module.exports = { theme: { colors: { x: (() => { throw new Error("executed") })() } } }`;
    expect(() => parseTailwindConfig(hostile)).not.toThrow();
  });
});

describe("parseCssCustomProperties", () => {
  it("reads Tailwind v4 @theme tokens", () => {
    const tokens = parseCssCustomProperties(TAILWIND_V4);
    const byName = Object.fromEntries(tokens.variables.map((v) => [v.name, v.value]));
    expect(byName["color-primary"]).toBe("#635BFF");
    expect(byName["radius-lg"]).toBe("0.75rem");
  });

  it("reads :root tokens", () => {
    const tokens = parseCssCustomProperties(SHADCN_ROOT);
    expect(tokens.variables.find((v) => v.name === "primary")?.value).toBe("#635BFF");
  });

  it("ignores commented-out declarations", () => {
    const tokens = parseCssCustomProperties(SHADCN_ROOT);
    expect(tokens.variables.some((v) => v.name === "color-ghost")).toBe(false);
  });

  it("returns nothing for CSS with no custom properties", () => {
    expect(parseCssCustomProperties("body { color: red; }").variables).toEqual([]);
  });

  it("survives an unterminated block", () => {
    expect(() => parseCssCustomProperties(":root { --a: #FFF;")).not.toThrow();
  });
});

describe("colorVariables", () => {
  it("keeps convertible colours and gaps the rest", () => {
    const tokens = parseCssCustomProperties(SHADCN_ROOT);
    const colors = colorVariables(tokens);
    const names = colors.map((c) => c.name);

    expect(names).toContain("primary");
    expect(names).toContain("destructive");
    // hsl(var(--primary)) cannot be resolved statically; --radius is not a colour.
    expect(names).not.toContain("ring");
    expect(names).not.toContain("radius");
    expect(tokens.unresolved.join(" ")).toContain("ring");
  });
});

describe("inferColorRole", () => {
  it("maps conventional names", () => {
    expect(inferColorRole("primary")).toBe("primary");
    expect(inferColorRole("brand-background")).toBe("background");
    expect(inferColorRole("muted-foreground")).toBe("muted");
    expect(inferColorRole("destructive")).toBe("danger");
    expect(inferColorRole("card")).toBe("surface");
  });

  it("returns null for a name that implies nothing", () => {
    expect(inferColorRole("blue-500")).toBeNull();
    expect(inferColorRole("gizmo")).toBeNull();
  });
});

describe("scanComponentPrimitives", () => {
  const files = [
    { path: "src/components/ui/Button.tsx", content: `<button className="bg-primary text-background rounded-lg" />` },
    { path: "src/components/ui/Card.tsx", content: `<div className="bg-surface border-border" style={{ color: "var(--primary)" }} />` },
    { path: "src/components/Unrelated.tsx", content: `<div className="bg-chartreuse" />` },
  ];
  const evidence = scanComponentPrimitives(files);

  it("only reads the known primitives", () => {
    expect(evidence.primitives).toEqual(["Button", "Card"]);
    expect(evidence.tokens.some((t) => t.token === "chartreuse")).toBe(false);
  });

  it("counts a token used by two primitives above one used once", () => {
    const primary = evidence.tokens.find((t) => t.token === "primary");
    expect(primary?.occurrences).toBe(2);
    expect(evidence.tokens[0]?.token).toBe("primary");
  });

  it("returns empty evidence when no primitives exist", () => {
    expect(scanComponentPrimitives([{ path: "src/App.tsx", content: "bg-primary" }]).primitives).toEqual([]);
  });
});

describe("toBrandColors", () => {
  it("annotates roles and usage, and reports what it could not role", () => {
    const evidence = scanComponentPrimitives([
      { path: "Button.tsx", content: `class="bg-primary"` },
    ]);
    const { colors, unroled } = toBrandColors(
      [
        { name: "primary", value: "#635BFF" },
        { name: "background", value: "#FFFFFF" },
        { name: "blue-500", value: "#3B82F6" },
      ],
      evidence,
    );

    expect(colors.find((c) => c.token === "primary")).toMatchObject({ role: "primary", occurrences: 1 });
    expect(colors.find((c) => c.token === "background")?.occurrences).toBeUndefined();
    expect(unroled).toEqual(["blue-500"]);
  });
});

describe("a repo-derived summary satisfies the shared contract", () => {
  it("passes isBrandSummary, so the 66818 card renders it unchanged", () => {
    const tokens = parseTailwindConfig(TAILWIND_V3);
    const evidence = scanComponentPrimitives([
      { path: "src/ui/Button.tsx", content: `class="bg-primary rounded-lg"` },
    ]);
    const { colors, unroled } = toBrandColors(tokens.colors, evidence);

    const summary: BrandSummary = {
      version: 1,
      name: "acme/web",
      source: "repo",
      sourceRepo: "acme/web",
      sourceCommit: "a1b2c3d",
      extractedAt: "2026-10-21T12:00:00.000Z",
      colors,
      fonts: tokens.fontFamilies.map((font) => ({
        family: font.stack[0]!,
        fallbacks: font.stack.slice(1),
        role: font.name === "mono" ? "mono" : "body",
      })),
      typeScale: [{ name: "body", sizePx: 16 }],
      radii: tokens.radii,
      gaps: [
        ...tokens.unresolved.map((u) => `unresolved token: ${u}`),
        ...unroled.map((name) => `no role inferred for ${name}`),
      ],
    };

    expect(isBrandSummary(summary)).toBe(true);
    expect(summary.colors.length).toBeGreaterThan(0);
    // The oklch value must have survived as an admitted gap, not a colour.
    expect(summary.gaps?.join(" ")).toContain("legacy");
  });
});

describe("analyzeRepoTokens — the tool's entry point", () => {
  it("merges Tailwind and CSS sources, annotating usage from the primitives", async () => {
    const { analyzeRepoTokens } = await import("./tools/brand-repo/index.js");
    const analysis = analyzeRepoTokens({
      tailwindConfig: TAILWIND_V3,
      cssFiles: [{ path: "src/globals.css", content: SHADCN_ROOT }],
      componentFiles: [
        { path: "src/ui/Button.tsx", content: `class="bg-primary rounded-lg"` },
        { path: "src/ui/Card.tsx", content: `class="bg-primary border-border"` },
      ],
    });

    expect(analysis.primitives).toEqual(["Button", "Card"]);
    const primary = analysis.colors.find((c) => c.token === "primary");
    expect(primary).toMatchObject({ hex: "#635BFF", role: "primary", occurrences: 2 });
    expect(analysis.fonts.find((f) => f.token === "sans")?.family).toBe("Inter");
    expect(analysis.radii.some((r) => r.token === "radius-lg")).toBe(true);
  });

  it("reports unconvertible values as gaps rather than dropping them", async () => {
    const { analyzeRepoTokens } = await import("./tools/brand-repo/index.js");
    const analysis = analyzeRepoTokens({
      tailwindConfig: TAILWIND_V3,
      cssFiles: [{ path: "src/globals.css", content: SHADCN_ROOT }],
      componentFiles: [{ path: "src/ui/Button.tsx", content: `class="bg-primary"` }],
    });
    const gaps = analysis.gaps.join(" ");
    expect(gaps).toContain("legacy");   // oklch in the tailwind config
    expect(gaps).toContain("ring");     // hsl(var(--primary)) in :root
  });

  it("says the palette is unverified when no primitive exists", async () => {
    const { analyzeRepoTokens } = await import("./tools/brand-repo/index.js");
    const analysis = analyzeRepoTokens({ tailwindConfig: TAILWIND_V3 });
    expect(analysis.gaps.join(" ")).toContain("no Button/Card/Badge primitive");
  });

  it("does not claim a palette it could not find", async () => {
    const { analyzeRepoTokens } = await import("./tools/brand-repo/index.js");
    const analysis = analyzeRepoTokens({ tailwindConfig: "module.exports = {}" });
    expect(analysis.colors).toEqual([]);
    expect(analysis.gaps.join(" ")).toContain("no colour tokens could be resolved");
  });

  it("produces colours that satisfy the shared contract", async () => {
    const { analyzeRepoTokens } = await import("./tools/brand-repo/index.js");
    const analysis = analyzeRepoTokens({
      tailwindConfig: TAILWIND_V3,
      componentFiles: [{ path: "Button.tsx", content: `class="bg-primary"` }],
    });
    const summary: BrandSummary = {
      version: 1,
      name: "acme/web",
      source: "repo",
      sourceRepo: "acme/web",
      extractedAt: "2026-10-21T12:00:00.000Z",
      colors: analysis.colors,
      fonts: analysis.fonts.map((f) => ({ family: f.family, fallbacks: f.fallbacks, role: "body" as const })),
      typeScale: [{ name: "body", sizePx: 16 }],
      gaps: analysis.gaps,
    };
    expect(isBrandSummary(summary)).toBe(true);
  });
});
