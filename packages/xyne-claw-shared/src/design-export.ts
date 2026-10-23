/**
 * Export a design system to code (XYNE-66832).
 *
 * A saved system is two artifacts: the structured `brand.json` a fresh
 * extraction delivers, and the `tokens.css` that is all a SAVED DesignSystem
 * record keeps (see the DesignSystem model — it stores `designMd` and
 * `tokensCss`, not the summary). Both have to export, so both are normalised
 * into one `DesignTokenSet` first and every formatter reads only that. The
 * alternative — a formatter per format per source — is eight code paths that
 * drift.
 *
 * What the token-CSS path deliberately does NOT export, because no format here
 * has a safe representation for it: `hsl()`/`rgb()` functions, `var()`
 * references, 8-digit hex with alpha, bare HSL triples (`--primary: 221 83%
 * 53%`), and any length that is not plain px/rem/em (`clamp()`, `calc()`). They
 * are skipped silently — a consumer that needs to tell the user "3 tokens were
 * not exported" should collect that at the call site; adding a `skipped` array
 * to the public shape here was judged not worth it without one.
 *
 * Roles are mapped to the names a consumer actually writes in code. There is no
 * `secondary` or `neutral` in `BRAND_COLOR_ROLES`, so `accent` becomes
 * `secondary` and `muted` becomes `neutral`: a Tailwind config with
 * `colors.accent` and `colors.muted` is not what anyone types, and the mapping
 * is stated here rather than guessed per formatter.
 */

import type { BrandColorRole, BrandSummary } from "./brand-extraction.js";

export const DESIGN_EXPORT_FORMATS = [
  "tailwind",
  "css-vars",
  "style-dictionary",
  "figma-tokens",
] as const;
export type DesignExportFormat = (typeof DESIGN_EXPORT_FORMATS)[number];

export const isDesignExportFormat = (value: unknown): value is DesignExportFormat =>
  typeof value === "string" && (DESIGN_EXPORT_FORMATS as readonly string[]).includes(value);

export interface DesignColorToken {
  /** Slug, e.g. `primary`, `surface-raised`. Unique within the set. */
  key: string;
  /** `#RRGGBB`, uppercase. */
  hex: string;
  /** Absent when the source was token CSS, which carries no roles. */
  role?: BrandColorRole;
}

export interface DesignFontToken {
  key: "heading" | "body" | "mono";
  /** Family first, then its fallbacks. Joined for CSS, kept as an array for
   *  Tailwind — the one place the two formats genuinely differ. */
  stack: string[];
}

export interface DesignTypeToken {
  key: string;
  sizePx: number;
  lineHeightPx?: number;
  weight?: number;
  letterSpacingPx?: number;
}

export interface DesignScaleToken {
  key: string;
  /** Raw CSS value, e.g. `8px`, `0 1px 2px rgba(0,0,0,.05)`. */
  value: string;
}

export interface DesignTokenSet {
  name?: string;
  colors: DesignColorToken[];
  fonts: DesignFontToken[];
  typeScale: DesignTypeToken[];
  radii: DesignScaleToken[];
  spacing: DesignScaleToken[];
  shadows: DesignScaleToken[];
}

/** Frozen all the way down: a shallow freeze left `.colors` mutable, so a
 *  caller pushing into it changed the shared constant for everyone. */
export const EMPTY_DESIGN_TOKEN_SET: DesignTokenSet = Object.freeze({
  colors: Object.freeze<DesignColorToken[]>([]),
  fonts: Object.freeze<DesignFontToken[]>([]),
  typeScale: Object.freeze<DesignTypeToken[]>([]),
  radii: Object.freeze<DesignScaleToken[]>([]),
  spacing: Object.freeze<DesignScaleToken[]>([]),
  shadows: Object.freeze<DesignScaleToken[]>([]),
}) as DesignTokenSet;

/**
 * Role to the name a consumer writes in code.
 *
 * `accent` → `secondary` and `muted` → `neutral` are the two that are not
 * identities. Everything else keeps its role name because it already reads
 * correctly as a token.
 */
const ROLE_KEYS: Readonly<Record<BrandColorRole, string>> = {
  primary: "primary",
  accent: "secondary",
  muted: "neutral",
  background: "background",
  surface: "surface",
  text: "text",
  border: "border",
  success: "success",
  warning: "warning",
  danger: "danger",
};

/** Export order, so a diff of two exports is readable and a snapshot is
 *  stable. Roles first in this order, then anything unroled, alphabetically. */
const ROLE_ORDER: readonly BrandColorRole[] = [
  "primary",
  "accent",
  "background",
  "surface",
  "text",
  "muted",
  "border",
  "success",
  "warning",
  "danger",
];

/** Namespaces that say where a token lives rather than what it is, so
 *  `--brand-primary` and `--color-primary` both export as `primary`. This is
 *  also what lets a css-vars export re-import as the same COLOURS, FONTS,
 *  FONT SIZES and scales — not as the same set. The `--leading-*`,
 *  `--weight-*` and `--tracking-*` lines it writes have no classifier, so they
 *  are export-only and a round trip loses them. */
const TOKEN_NAMESPACES = /^(brand|color|colour|colors|clr|theme|palette|ds|token|tokens)-/;

/** `Primary Light` → `primary-light`, `primaryLight` → `primary-light`,
 *  `--brand-primary` → `primary`. Empty when nothing survives. */
export function slugifyTokenName(raw: string): string {
  return raw
    .trim()
    .replace(/^--/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(TOKEN_NAMESPACES, "")
    .replace(/^-+|-+$/g, "");
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Normalised to uppercase `#RRGGBB`, or null when it is not a flat hex. A
 *  colour that cannot be written into a config is left out rather than
 *  exported as something a build will choke on. */
function normalizeHex(value: string): string | null {
  const raw = value.trim();
  if (!HEX.test(raw)) return null;
  const body = raw.slice(1);
  const full =
    body.length === 3
      ? body
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : body;
  return `#${full.toUpperCase()}`;
}

/** First writer wins; a later collision is suffixed rather than dropped, so no
 *  token silently disappears from an export. */
function uniqueKey(key: string, taken: Set<string>): string {
  if (!taken.has(key)) {
    taken.add(key);
    return key;
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${key}-${suffix}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

/**
 * The category a scale token already names, stripped from its key.
 *
 * `--radius-md` exports as `borderRadius: { md }`, not `{ "radius-md" }`, and
 * as `--radius-md`, not `--radius-radius-md`. Applied on BOTH entry points: the
 * summary path skipped it at first, so the same system exported different keys
 * depending on which artifact it came from.
 */
const CATEGORY_PREFIXES = {
  radii: /^(border-)?radi(us|i)-?/,
  spacing: /^spac(e|ing)-?/,
  shadows: /^(shadow|elevation)-?/,
  typeScale: /^(font-size|text|size-font)-?/,
} as const;

const stripCategory = (key: string, prefix: RegExp): string => key.replace(prefix, "") || key;

const scaleTokens = (
  entries: ReadonlyArray<{ token: string; value: string }> | undefined,
  prefix: RegExp,
): DesignScaleToken[] => {
  const taken = new Set<string>();
  const out: DesignScaleToken[] = [];
  for (const entry of entries ?? []) {
    const slug = slugifyTokenName(entry.token);
    const value = entry.value.trim();
    if (!slug || !value || !isSafeCssValue(value)) continue;
    out.push({ key: uniqueKey(stripCategory(slug, prefix), taken), value });
  }
  return out;
};

/** The structured payload a fresh `/brand` extraction delivers. */
export function designTokensFromBrandSummary(summary: BrandSummary): DesignTokenSet {
  const taken = new Set<string>();
  const ordered = [...summary.colors].sort((a, b) => {
    const byRole = ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
    if (byRole !== 0) return byRole;
    return (b.occurrences ?? 0) - (a.occurrences ?? 0);
  });

  const colors: DesignColorToken[] = [];
  for (const color of ordered) {
    const hex = normalizeHex(color.hex);
    if (!hex) continue;
    // The role's code name first, the author's token name as the fallback —
    // `colors.primary` is what a consumer writes, `colors.brandPrimary500` is
    // not.
    const preferred = ROLE_KEYS[color.role] ?? slugifyTokenName(color.token);
    const key = taken.has(preferred) ? slugifyTokenName(color.token) || preferred : preferred;
    colors.push({ key: uniqueKey(key, taken), hex, role: color.role });
  }

  const fonts: DesignFontToken[] = [];
  for (const role of ["heading", "body", "mono"] as const) {
    const font = summary.fonts.find((candidate) => candidate.role === role);
    if (!font?.family.trim()) continue;
    const stack = [font.family.trim(), ...(font.fallbacks ?? [])]
      .map((family) => family.trim())
      .filter((family) => family.length > 0 && isSafeCssValue(family));
    if (stack.length === 0) continue;
    fonts.push({ key: role, stack });
  }

  const typeTaken = new Set<string>();
  const typeScale: DesignTypeToken[] = [];
  for (const step of summary.typeScale) {
    const slug = slugifyTokenName(step.name);
    if (!slug || !Number.isFinite(step.sizePx)) continue;
    // Stripped here too. CATEGORY_PREFIXES claimed both entry points did this,
    // but the summary path did not, so a step named `font-size-h1` exported as
    // `fontSize: { "font-size-h1" }` from brand.json and as `{ h1 }` from the
    // same system's token CSS.
    const key = stripCategory(slug, CATEGORY_PREFIXES.typeScale);
    typeScale.push({
      key: uniqueKey(key, typeTaken),
      sizePx: step.sizePx,
      ...(step.lineHeightPx === undefined ? {} : { lineHeightPx: step.lineHeightPx }),
      ...(step.weight === undefined ? {} : { weight: step.weight }),
      ...(step.letterSpacingPx === undefined ? {} : { letterSpacingPx: step.letterSpacingPx }),
    });
  }

  return {
    ...(summary.name.trim() ? { name: summary.name.trim() } : {}),
    colors,
    fonts,
    typeScale,
    radii: scaleTokens(summary.radii, CATEGORY_PREFIXES.radii),
    spacing: scaleTokens(summary.spacing, CATEGORY_PREFIXES.spacing),
    shadows: scaleTokens(summary.shadows, CATEGORY_PREFIXES.shadows),
  };
}

/**
 * Strip `/* … *\/` comments in one pass, skipping quoted strings.
 *
 * Deliberately not a regex. `/\/\*[\s\S]*?\*\//g` restarts its lazy scan at every
 * `/*` and runs it to the end of the input, so a file holding many unclosed
 * ones costs quadratic time — CodeQL's js/polynomial-redos. A saved system's
 * token CSS is model-written, so that is reachable input.
 *
 * Quote-aware because it has to be: `content: "/*"` opened a comment that then
 * ran to end of file and silently ate every token after it. An unterminated
 * comment outside a string still runs to the end, which is what the CSS spec
 * says and what a browser does — the regex left that text in place, where the
 * parse read commented-out declarations as live.
 *
 * The same scanner exists in brand-repo.ts (XYNE-66819), which needs the same
 * quote fix. Both are deliberate copies while these PRs are independent; they
 * fold into one module once the design-systems series has landed.
 */
function stripCssComments(css: string): string {
  let out = "";
  let index = 0;
  let quote: string | null = null;
  while (index < css.length) {
    const char = css[index] as string;
    if (quote) {
      out += char;
      if (char === "\\" && index + 1 < css.length) {
        out += css[index + 1];
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      out += char;
      index += 1;
      continue;
    }
    if (char === "/" && css[index + 1] === "*") {
      const end = css.indexOf("*/", index + 2);
      out += " ";
      if (end === -1) return out;
      index = end + 2;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

/** Index just past the closing quote of the string starting at `at`. Shared by
 *  every step that walks this CSS, so the comment strip, the block walk and the
 *  declaration pass cannot disagree about where a string ends. */
function skipQuoted(css: string, at: number): number {
  const quote = css[at];
  let index = at + 1;
  while (index < css.length) {
    if (css[index] === "\\") {
      index += 2;
      continue;
    }
    if (css[index] === quote) return index + 1;
    index += 1;
  }
  return css.length;
}

/** The `}` matching the `{` at `open`. Quote-aware: `content: "{"` counted as a
 *  real brace and threw the whole walk off, emptying the export. */
function matchingBrace(css: string, open: number, limit: number): number {
  let depth = 0;
  let index = open;
  while (index < limit) {
    const char = css[index];
    if (char === '"' || char === "'") {
      index = skipQuoted(css, index);
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
    index += 1;
  }
  return limit;
}

/**
 * Selector lists whose declarations are the light theme.
 *
 * Matched exactly, per part. A substring test let `:root[data-theme="dark"]`
 * and `:root.dark` through as extra colours — they are dark variants, which are
 * XYNE-66829's, not tokens of the set being exported.
 */
const THEME_SELECTORS = new Set([":root", ":host", "html"]);

function isThemeSelector(selector: string): boolean {
  const text = selector.trim().toLowerCase();
  if (!text) return false;
  // Tailwind v4, including `@theme inline`.
  if (/^@theme\b/.test(text)) return true;
  const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((part) => THEME_SELECTORS.has(part));
}

/**
 * At-rules that only group, so their contents sit at the same level.
 *
 * `@layer base { :root { … } }` is the default globals.css layout for shadcn
 * and Tailwind v3, and scoping to the top level alone exported NOTHING for it —
 * a silently empty download. `@media`, `@supports` and `@container` are not
 * transparent: a block inside one is conditional, which is what made the dark
 * override a phantom token in the first place.
 */
const isTransparentAtRule = (selector: string): boolean =>
  /^@layer\b/.test(selector.trim().toLowerCase());

/** A block's own declarations, with nested rules removed. Quote-aware for the
 *  same reason matchingBrace is. */
function topLevelOf(css: string, from: number, to: number): string {
  let out = "";
  let index = from;
  let depth = 0;
  while (index < to) {
    const char = css[index] as string;
    if (char === '"' || char === "'") {
      const close = skipQuoted(css, index);
      if (depth === 0) out += css.slice(index, Math.min(close, to));
      index = close;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (depth === 0) out += char;
    index += 1;
  }
  return out;
}

/** The final selector in a run of statements, e.g. `@layer base` out of
 *  `@tailwind base;\n@layer base`. */
function lastSelector(text: string): string {
  let out = text;
  for (const terminator of [";", "}"]) {
    const at = out.lastIndexOf(terminator);
    if (at !== -1) out = out.slice(at + 1);
  }
  return out;
}

/** Guard against pathological `@layer` nesting; real files are one deep. */
const MAX_AT_RULE_DEPTH = 8;

function collectThemeBlocks(
  css: string,
  from: number,
  to: number,
  depth: number,
  out: string[],
): void {
  if (depth > MAX_AT_RULE_DEPTH) return;
  let index = from;
  while (index < to) {
    let open = -1;
    let cursor = index;
    while (cursor < to) {
      const char = css[cursor];
      if (char === '"' || char === "'") {
        cursor = skipQuoted(css, cursor);
        continue;
      }
      if (char === "{") {
        open = cursor;
        break;
      }
      cursor += 1;
    }
    if (open === -1) return;
    // Only the text after the last statement terminator is this block's
    // selector. A statement at-rule before it — `@tailwind base;`, which every
    // shadcn globals.css opens with — would otherwise be read as part of the
    // selector and hide the `@layer` that follows.
    const selector = lastSelector(css.slice(index, open));
    const close = matchingBrace(css, open, to);
    if (isThemeSelector(selector)) out.push(topLevelOf(css, open + 1, close));
    else if (isTransparentAtRule(selector)) {
      collectThemeBlocks(css, open + 1, close, depth + 1, out);
    }
    index = close + 1;
  }
}

/**
 * The declarations of every theme block, concatenated.
 *
 * Scoped on purpose: reading declarations from anywhere in the file exported a
 * `prefers-color-scheme: dark` override as a SECOND colour — `primary` and
 * `primary-2` — so a download carried phantom tokens nobody authored. Dark
 * variants are XYNE-66829's; until then only the light set is exported.
 */
function themeDeclarations(css: string): string {
  const out: string[] = [];
  collectThemeBlocks(css, 0, css.length, 0, out);
  return out.join(";\n");
}

/** The value runs to the `;` or `}` that ends it, and is trimmed in code. A
 *  trailing `\s*(?:;|$)` would have competed with `([^;{}]+)` for the same
 *  spaces — the second half of the same ReDoS. */
const CSS_DECLARATION = /--([a-z0-9][a-z0-9_-]*)\s*:\s*([^;{}]*)/gi;

/** Root font size, for converting `rem` and `em`. The browser default, and
 *  what every design system this exports from assumes. */
const ROOT_FONT_PX = 16;

/**
 * A CSS length in px, or null when it is not a plain length.
 *
 * `Number.parseFloat` read `0.875rem` as `0.875` and the export wrote
 * `0.875px` — a Tailwind config with microscopic type, and most real token
 * files are in `rem`. Anything that is not a bare px/rem/em length —
 * `clamp()`, `calc()`, a percentage — is refused rather than having its
 * leading number read off.
 */
function parseLengthPx(value: string): number | null {
  const match = /^(-?(?:\d+\.?\d*|\.\d+))(px|rem|em)?$/i.exec(value.trim());
  if (!match) return null;
  const size = Number.parseFloat(match[1] as string);
  if (!Number.isFinite(size)) return null;
  const unit = match[2]?.toLowerCase();
  if (unit === "rem" || unit === "em") return size * ROOT_FONT_PX;
  return size;
}

/** Which group a custom property belongs in, from the name alone. Order
 *  matters: `--font-size-lg` is a type step, not a font family. */
function classifyCssToken(key: string, value: string): keyof DesignTokenSet | "unknown" {
  if (normalizeHex(value)) return "colors";
  if (/^(font-size|text|size-font)/.test(key) || /^(h[1-6]|display|body|caption|label)$/.test(key)) {
    return "typeScale";
  }
  if (/^(font|family|typeface)/.test(key)) return "fonts";
  if (/^(radius|radii|rounded|border-radius)/.test(key)) return "radii";
  if (/^(space|spacing|gap|inset)/.test(key)) return "spacing";
  if (/^(shadow|elevation)/.test(key)) return "shadows";
  return "unknown";
}

const FONT_KEYS: Readonly<Record<string, DesignFontToken["key"]>> = {
  heading: "heading",
  headings: "heading",
  display: "heading",
  title: "heading",
  body: "body",
  base: "body",
  text: "body",
  sans: "body",
  mono: "mono",
  code: "mono",
};

/**
 * A saved system's `tokens.css` — the only palette a stored DesignSystem has.
 *
 * Classified by name, because CSS carries no roles. A `#hex` value is a colour
 * whatever it is called; everything else is grouped by a name prefix, and a
 * declaration that matches nothing is skipped rather than guessed into the
 * wrong section of a Tailwind config.
 */
export function designTokensFromTokensCss(css: string, name?: string): DesignTokenSet {
  const colorKeys = new Set<string>();
  const typeKeys = new Set<string>();
  const colors: DesignColorToken[] = [];
  const fonts: DesignFontToken[] = [];
  const typeScale: DesignTypeToken[] = [];
  const radii: DesignScaleToken[] = [];
  const spacing: DesignScaleToken[] = [];
  const shadows: DesignScaleToken[] = [];
  const radiiKeys = new Set<string>();
  const spacingKeys = new Set<string>();
  const shadowKeys = new Set<string>();
  const seenFonts = new Set<DesignFontToken["key"]>();

  for (const match of themeDeclarations(stripCssComments(css)).matchAll(CSS_DECLARATION)) {
    const rawName = match[1];
    const rawValue = match[2];
    if (!rawName || !rawValue) continue;
    const key = slugifyTokenName(rawName);
    const value = rawValue.trim();
    if (!key || !value) continue;

    switch (classifyCssToken(key, value)) {
      case "colors": {
        const hex = normalizeHex(value);
        if (hex) colors.push({ key: uniqueKey(key, colorKeys), hex });
        break;
      }
      case "fonts": {
        // `--font-heading: Inter, system-ui` — split the stack back apart so
        // Tailwind gets an array and CSS gets the same string it came from.
        //
        // Only a real font slot counts. Defaulting to `body` meant
        // `--font-weight-bold: 700` landed there as the stack `["700"]`, and
        // first-wins then dropped the actual `--font-body` that followed it.
        // `--font-line-height-*` and `--font-letter-spacing-*` did the same.
        const slot = FONT_KEYS[key.replace(/^font-?/, "").replace(/^family-?/, "")];
        if (!slot || seenFonts.has(slot)) break;
        const stack = value
          .split(",")
          .map((part) => part.trim().replace(/^["']|["']$/g, ""))
          .filter((family) => family.length > 0 && isSafeCssValue(family));
        if (stack.length === 0) break;
        seenFonts.add(slot);
        fonts.push({ key: slot, stack });
        break;
      }
      case "typeScale": {
        const sizePx = parseLengthPx(value);
        if (sizePx === null) break;
        const stepKey = stripCategory(key, CATEGORY_PREFIXES.typeScale);
        typeScale.push({ key: uniqueKey(stepKey, typeKeys), sizePx });
        break;
      }
      case "radii":
        if (!isSafeCssValue(value)) break;
        radii.push({ key: uniqueKey(stripCategory(key, CATEGORY_PREFIXES.radii), radiiKeys), value });
        break;
      case "spacing":
        if (!isSafeCssValue(value)) break;
        spacing.push({
          key: uniqueKey(stripCategory(key, CATEGORY_PREFIXES.spacing), spacingKeys),
          value,
        });
        break;
      case "shadows":
        if (!isSafeCssValue(value)) break;
        shadows.push({
          key: uniqueKey(stripCategory(key, CATEGORY_PREFIXES.shadows), shadowKeys),
          value,
        });
        break;
      default:
        break;
    }
  }

  // Font slots are declared in whatever order the file happens to use; export
  // them in a fixed one so two exports of the same system match.
  const fontOrder: ReadonlyArray<DesignFontToken["key"]> = ["heading", "body", "mono"];
  fonts.sort((a, b) => fontOrder.indexOf(a.key) - fontOrder.indexOf(b.key));

  return {
    ...(name?.trim() ? { name: name.trim() } : {}),
    colors,
    fonts,
    typeScale,
    radii,
    spacing,
    shadows,
  };
}

const px = (value: number): string => `${value}px`;
const stringify = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const entries = <T>(list: readonly T[], key: (item: T) => string, value: (item: T) => unknown) =>
  Object.fromEntries(list.map((item) => [key(item), value(item)]));

/** Only sections that have something in them, so an export is not mostly
 *  empty objects a consumer has to read past. */
function withoutEmpty(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(
      ([, value]) => value !== undefined && Object.keys(value as object).length > 0,
    ),
  );
}

/** A `theme.extend` block for `tailwind.config.js`. The only format that keeps
 *  a font stack as an array, because that is what Tailwind expects. */
function toTailwind(tokens: DesignTokenSet): string {
  return stringify(
    withoutEmpty({
      colors: entries(tokens.colors, (color) => color.key, (color) => color.hex),
      fontFamily: entries(tokens.fonts, (font) => font.key, (font) => font.stack),
      fontSize: entries(
        tokens.typeScale,
        (step) => step.key,
        (step) => {
          const extras = withoutEmpty({
            lineHeight: step.lineHeightPx === undefined ? undefined : px(step.lineHeightPx),
            letterSpacing:
              step.letterSpacingPx === undefined ? undefined : px(step.letterSpacingPx),
            fontWeight: step.weight === undefined ? undefined : String(step.weight),
          });
          // Tailwind's tuple form, and a bare string when there is nothing to
          // put in the second slot.
          return Object.keys(extras).length > 0 ? [px(step.sizePx), extras] : px(step.sizePx);
        },
      ),
      borderRadius: entries(tokens.radii, (item) => item.key, (item) => item.value),
      spacing: entries(tokens.spacing, (item) => item.key, (item) => item.value),
      boxShadow: entries(tokens.shadows, (item) => item.key, (item) => item.value),
    }),
  );
}

/** A `:root` block. Font stacks are joined here — the CSS half of the one real
 *  difference between these formats. */
/**
 * A value that cannot end its own declaration.
 *
 * Applied when tokens are NORMALISED, not when they are formatted. Guarding
 * only the CSS writer left Tailwind emitting `"md": "4px;} body{display:none"`
 * — valid JSON, but Tailwind writes that value into generated CSS and the extra
 * rule reappears. One check at the boundary covers every format.
 *
 * `<>"'` and a backslash are refused alongside `;{}`, and that is not
 * belt-and-braces. CSS_DECLARATION stops at `;{}` but allows the rest, so a
 * model-written `--font-body: Inter</style><script>…` closed the brand style
 * block in a delivered HTML report, and `--radius-md: 8px" onload="…` closed
 * the style attribute in an email draft. Applied on BOTH entry points: the
 * token CSS path is exactly where those arrived.
 *
 * Refused rather than escaped, because no legitimate token value contains
 * these — a quoted font family has already had its quotes stripped by the time
 * it gets here.
 */
const isSafeCssValue = (value: string): boolean => !/[;{}<>"'\\]/.test(value);

/** A star followed by a slash would close the header comment early, so it is
 *  removed from a system name before the name goes in one. */
const commentSafe = (value: string): string => value.replace(/\*+\//g, "").trim();

function toCssVars(tokens: DesignTokenSet): string {
  const lines: string[] = [];
  // No guard here: normalisation already refused anything that could end its
  // own declaration, so every format gets the same safe values.
  const push = (name: string, value: string) => lines.push(`  --${name}: ${value};`);

  for (const color of tokens.colors) push(`color-${color.key}`, color.hex);
  for (const font of tokens.fonts) push(`font-${font.key}`, font.stack.join(", "));
  for (const step of tokens.typeScale) {
    push(`text-${step.key}`, px(step.sizePx));
    if (step.lineHeightPx !== undefined) push(`leading-${step.key}`, px(step.lineHeightPx));
    if (step.weight !== undefined) push(`weight-${step.key}`, String(step.weight));
    if (step.letterSpacingPx !== undefined) {
      push(`tracking-${step.key}`, px(step.letterSpacingPx));
    }
  }
  for (const item of tokens.radii) push(`radius-${item.key}`, item.value);
  for (const item of tokens.spacing) push(`space-${item.key}`, item.value);
  for (const item of tokens.shadows) push(`shadow-${item.key}`, item.value);

  const safeName = tokens.name ? commentSafe(tokens.name) : "";
  const header = safeName ? `/* ${safeName} */\n` : "";
  return `${header}:root {\n${lines.join("\n")}${lines.length > 0 ? "\n" : ""}}\n`;
}

/** Style Dictionary's classic nested shape: every leaf is `{ value }`, and the
 *  path above it is the category. */
function toStyleDictionary(tokens: DesignTokenSet): string {
  const value = (raw: string | number) => ({ value: String(raw) });
  return stringify(
    withoutEmpty({
      color: entries(tokens.colors, (color) => color.key, (color) => value(color.hex)),
      font: withoutEmpty({
        family: entries(tokens.fonts, (font) => font.key, (font) => value(font.stack.join(", "))),
        size: entries(tokens.typeScale, (step) => step.key, (step) => value(px(step.sizePx))),
        weight: entries(
          tokens.typeScale.filter((step) => step.weight !== undefined),
          (step) => step.key,
          (step) => value(step.weight as number),
        ),
        lineHeight: entries(
          tokens.typeScale.filter((step) => step.lineHeightPx !== undefined),
          (step) => step.key,
          (step) => value(px(step.lineHeightPx as number)),
        ),
      }),
      radius: entries(tokens.radii, (item) => item.key, (item) => value(item.value)),
      spacing: entries(tokens.spacing, (item) => item.key, (item) => value(item.value)),
      shadow: entries(tokens.shadows, (item) => item.key, (item) => value(item.value)),
    }),
  );
}

/** Tokens Studio (Figma) format: one `global` set, every leaf carrying its own
 *  `type`, which is how the plugin decides what a value can be applied to. */
function toFigmaTokens(tokens: DesignTokenSet): string {
  const typed = (raw: string | number, type: string) => ({ value: String(raw), type });
  return stringify({
    global: withoutEmpty({
      colors: entries(tokens.colors, (color) => color.key, (color) => typed(color.hex, "color")),
      fontFamilies: entries(
        tokens.fonts,
        (font) => font.key,
        (font) => typed(font.stack.join(", "), "fontFamilies"),
      ),
      fontSizes: entries(
        tokens.typeScale,
        (step) => step.key,
        (step) => typed(px(step.sizePx), "fontSizes"),
      ),
      lineHeights: entries(
        tokens.typeScale.filter((step) => step.lineHeightPx !== undefined),
        (step) => step.key,
        (step) => typed(px(step.lineHeightPx as number), "lineHeights"),
      ),
      fontWeights: entries(
        tokens.typeScale.filter((step) => step.weight !== undefined),
        (step) => step.key,
        (step) => typed(step.weight as number, "fontWeights"),
      ),
      letterSpacing: entries(
        tokens.typeScale.filter((step) => step.letterSpacingPx !== undefined),
        (step) => step.key,
        (step) => typed(px(step.letterSpacingPx as number), "letterSpacing"),
      ),
      borderRadius: entries(
        tokens.radii,
        (item) => item.key,
        (item) => typed(item.value, "borderRadius"),
      ),
      spacing: entries(tokens.spacing, (item) => item.key, (item) => typed(item.value, "spacing")),
      boxShadow: entries(
        tokens.shadows,
        (item) => item.key,
        (item) => typed(item.value, "boxShadow"),
      ),
    }),
  });
}

/** Format a normalised set. Both entry points funnel through here, so the two
 *  sources cannot drift into different output for the same tokens. */
export function exportDesignTokens(tokens: DesignTokenSet, format: DesignExportFormat): string {
  switch (format) {
    case "tailwind":
      return toTailwind(tokens);
    case "css-vars":
      return toCssVars(tokens);
    case "style-dictionary":
      return toStyleDictionary(tokens);
    case "figma-tokens":
      return toFigmaTokens(tokens);
  }
}

/** Export a fresh extraction's `brand.json`. */
export const exportDesignSystem = (
  system: BrandSummary,
  format: DesignExportFormat,
): string => exportDesignTokens(designTokensFromBrandSummary(system), format);

/** Export a saved system's `tokens.css`, which is all a stored DesignSystem
 *  record has. */
export const exportTokensCss = (
  tokensCss: string,
  format: DesignExportFormat,
  name?: string,
): string => exportDesignTokens(designTokensFromTokensCss(tokensCss, name), format);

/** Filename an export is conventionally written to, so callers do not each
 *  invent one. */
export function designExportFilename(format: DesignExportFormat): string {
  switch (format) {
    case "tailwind":
      return "tailwind.theme.json";
    case "css-vars":
      return "tokens.css";
    case "style-dictionary":
      return "tokens.style-dictionary.json";
    case "figma-tokens":
      return "tokens.figma.json";
  }
}
