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

export const EMPTY_DESIGN_TOKEN_SET: DesignTokenSet = Object.freeze({
  colors: [],
  fonts: [],
  typeScale: [],
  radii: [],
  spacing: [],
  shadows: [],
});

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
 *  also what makes a css-vars export re-import as the same set. */
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
    if (!slug || !value) continue;
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
    fonts.push({ key: role, stack: [font.family.trim(), ...(font.fallbacks ?? [])] });
  }

  const typeTaken = new Set<string>();
  const typeScale: DesignTypeToken[] = [];
  for (const step of summary.typeScale) {
    const key = slugifyTokenName(step.name);
    if (!key || !Number.isFinite(step.sizePx)) continue;
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

const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;
const CSS_DECLARATION = /--([a-z0-9][a-z0-9_-]*)\s*:\s*([^;{}]+)\s*(?:;|$)/gi;

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

  for (const match of css.replace(CSS_COMMENT, " ").matchAll(CSS_DECLARATION)) {
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
        const slot = FONT_KEYS[key.replace(/^font-?/, "")] ?? "body";
        if (seenFonts.has(slot)) break;
        const stack = value
          .split(",")
          .map((part) => part.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
        if (stack.length === 0) break;
        seenFonts.add(slot);
        fonts.push({ key: slot, stack });
        break;
      }
      case "typeScale": {
        const sizePx = Number.parseFloat(value);
        if (!Number.isFinite(sizePx)) break;
        const stepKey = stripCategory(key, CATEGORY_PREFIXES.typeScale);
        typeScale.push({ key: uniqueKey(stepKey, typeKeys), sizePx });
        break;
      }
      case "radii":
        radii.push({ key: uniqueKey(stripCategory(key, CATEGORY_PREFIXES.radii), radiiKeys), value });
        break;
      case "spacing":
        spacing.push({
          key: uniqueKey(stripCategory(key, CATEGORY_PREFIXES.spacing), spacingKeys),
          value,
        });
        break;
      case "shadows":
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
function toCssVars(tokens: DesignTokenSet): string {
  const lines: string[] = [];
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

  const header = tokens.name ? `/* ${tokens.name} */\n` : "";
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
