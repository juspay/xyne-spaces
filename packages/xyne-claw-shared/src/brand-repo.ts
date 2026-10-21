/**
 * Static analysis of a repository's design tokens (XYNE-66819).
 *
 * These parsers run in the claw runtime over file CONTENTS the model reads out
 * of a read-only clone — they are not a sandbox script. That matters: the code
 * covered by unit tests is the code that actually runs, so a fixture suite is
 * real evidence rather than a parallel implementation that can drift.
 *
 * Everything here is deliberately conservative. A token that cannot be
 * resolved is reported as a gap, never guessed — the same rule the URL
 * extractor follows, and for the same reason: a wrong token is silently wrong
 * in every artifact later built from it.
 *
 * No `eval`. A Tailwind config is arbitrary JavaScript from an untrusted
 * repository; it is scanned textually, never executed.
 */

import type { BrandColor, BrandColorRole, BrandScaleValue } from "./brand-extraction.js";

// --- colour normalisation ---------------------------------------------------

/** Colour spaces we can turn into the `#RRGGBB` a token needs. Anything else
 *  (oklch, lab, color-mix, a bare var()) is reported as a gap — Tailwind v4 and
 *  shadcn emit oklch routinely, and a bad conversion is worse than an omission. */
const UNSUPPORTED_COLOR_FN = /^(oklch|oklab|lab|lch|color|color-mix|hwb)\(/i;

export function normalizeColor(raw: string): string | null {
  const value = raw.trim().replace(/^['"]|['"]$/g, "");
  if (!value || UNSUPPORTED_COLOR_FN.test(value) || value.startsWith("var(")) return null;

  const hex = /^#([0-9a-f]{3,8})$/i.exec(value);
  if (hex?.[1]) {
    const digits = hex[1];
    if (digits.length === 3) {
      const [r, g, b] = [digits[0], digits[1], digits[2]];
      return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
    }
    // 6 and 8 digit both resolve to RGB; alpha is dropped because a token is flat.
    if (digits.length === 6 || digits.length === 8) return `#${digits.slice(0, 6)}`.toUpperCase();
    return null;
  }

  const rgb = /^rgba?\(\s*([0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)/i.exec(value);
  if (rgb) {
    const channel = (n: string): string => {
      const parsed = Math.round(Number(n));
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 255) return "";
      return parsed.toString(16).padStart(2, "0");
    };
    const [r, g, b] = [channel(rgb[1]!), channel(rgb[2]!), channel(rgb[3]!)];
    if (!r || !g || !b) return null;
    return `#${r}${g}${b}`.toUpperCase();
  }

  return null;
}

// --- shared scanning helpers ------------------------------------------------

/**
 * The text of a `key: { ... }` block, brace-matched.
 *
 * A Tailwind config is JS, so a regex cannot be trusted to find the end of a
 * nested object; counting braces while skipping string literals can.
 */
export function extractBlock(source: string, key: string): string | null {
  const start = new RegExp(`(?:^|[\\s,{])${key}\\s*:\\s*\\{`, "m").exec(source);
  if (!start) return null;

  const open = source.indexOf("{", start.index + start[0].length - 1);
  if (open < 0) return null;

  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i]!;
    const prev = source[i - 1];
    if (quote) {
      if (char === quote && prev !== "\\") quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

/**
 * `key: "value"` pairs at any nesting depth, as dotted paths.
 *
 * After recursing into a nested object the scanner MUST skip past it. Letting
 * the outer regex continue inside re-emits every nested key under a shorter
 * path, so `brand: { dark: { bg } }` also yielded `brand-bg`, `dark-bg` and
 * `bg` — token names the repository never had. Worse, `parseTailwindConfig`
 * keeps the first name it sees, so an invented `primary` could take
 * `brand.primary`'s value and become the brand colour of every later artifact.
 */
export function flattenStringEntries(block: string, prefix = ""): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  const keyRe = /(?:^|[,{\s])['"]?([A-Za-z0-9_-]+)['"]?\s*:\s*/g;

  let match: RegExpExecArray | null;
  while ((match = keyRe.exec(block))) {
    const key = match[1]!;
    const valueStart = match.index + match[0].length;
    const rest = block.slice(valueStart);
    const path = prefix ? `${prefix}-${key}` : key;

    if (rest.startsWith("{")) {
      const nested = extractBlock(`x:${rest}`, "x");
      if (nested) {
        entries.push(...flattenStringEntries(nested, path));
        // +2 for the `x:` prefix extractBlock was given, +2 for the braces.
        keyRe.lastIndex = valueStart + nested.length + 2;
      }
      continue;
    }
    const literal = /^(['"])((?:\\.|(?!\1).)*)\1/.exec(rest);
    if (literal?.[2] !== undefined) entries.push([path, literal[2]]);
  }
  return entries;
}

// --- Tailwind -------------------------------------------------------------

export interface TailwindTokens {
  colors: Array<{ name: string; value: string }>;
  fontFamilies: Array<{ name: string; stack: string[] }>;
  radii: BrandScaleValue[];
  /** Values found but not convertible, e.g. `oklch(...)` or `var(--x)`. */
  unresolved: string[];
}

/**
 * Tokens from a Tailwind v3 config (`theme` / `theme.extend`).
 *
 * `extend` is merged over the base so a project that only extends is read
 * correctly — that is the common shape, and reading only `theme` would return
 * nothing for most repositories.
 */
export function parseTailwindConfig(source: string): TailwindTokens {
  const out: TailwindTokens = { colors: [], fontFamilies: [], radii: [], unresolved: [] };
  const theme = extractBlock(source, "theme");
  if (!theme) return out;

  const scopes = [theme, extractBlock(theme, "extend")].filter((s): s is string => Boolean(s));
  const seenColor = new Set<string>();
  const seenRadius = new Set<string>();
  const seenFont = new Set<string>();

  for (const scope of scopes) {
    const colors = extractBlock(scope, "colors");
    if (colors) {
      for (const [name, value] of flattenStringEntries(colors)) {
        const hex = normalizeColor(value);
        if (!hex) {
          out.unresolved.push(`colors.${name} = ${value}`);
          continue;
        }
        if (seenColor.has(name)) continue;
        seenColor.add(name);
        out.colors.push({ name, value: hex });
      }
    }

    const radius = extractBlock(scope, "borderRadius");
    if (radius) {
      for (const [name, value] of flattenStringEntries(radius)) {
        if (seenRadius.has(name)) continue;
        seenRadius.add(name);
        out.radii.push({ token: `radius-${name}`, value });
      }
    }

    const fonts = extractBlock(scope, "fontFamily");
    if (fonts) {
      // fontFamily values are arrays of strings, which flattenStringEntries
      // cannot see; pull each array literal instead.
      const arrayRe = /['"]?([A-Za-z0-9_-]+)['"]?\s*:\s*\[([^\]]*)\]/g;
      let match: RegExpExecArray | null;
      while ((match = arrayRe.exec(fonts))) {
        const name = match[1]!;
        if (seenFont.has(name)) continue;
        seenFont.add(name);
        const stack = [...match[2]!.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]!);
        if (stack.length > 0) out.fontFamilies.push({ name, stack });
      }
    }
  }
  return out;
}

// --- CSS ------------------------------------------------------------------

export interface CssTokens {
  /** Custom properties, without the leading `--`. */
  variables: Array<{ name: string; value: string }>;
  unresolved: string[];
}

/**
 * Custom properties from `:root` (and, for Tailwind v4, `@theme`).
 *
 * Blocks are brace-matched, not matched with a non-greedy regex: a nested rule
 * such as `@keyframes` inside `@theme` ended the block at the first `}`, so
 * every declaration after it was lost — silently, without even a gap.
 *
 * A declaration may also end at `}` rather than `;`. The last one in a block
 * legally omits its semicolon and minifiers always do, so requiring `;` threw
 * away `:root{--primary:#111}` entirely.
 */
export function parseCssCustomProperties(css: string): CssTokens {
  const out: CssTokens = { variables: [], unresolved: [] };
  // Comments first: a commented-out token must not look live.
  const cleaned = css.replace(/\/\*[\s\S]*?\*\//g, "");

  const seen = new Set<string>();
  const selectorRe = /(?::root|@theme)[^{]*\{/g;
  let selector: RegExpExecArray | null;
  while ((selector = selectorRe.exec(cleaned))) {
    const openIndex = selector.index + selector[0].length - 1;
    const body = matchBraces(cleaned, openIndex);
    if (body === null) continue;

    // Only top-level declarations: a value inside a nested rule (keyframe
    // stops, media queries) is not a theme token.
    const topLevel = stripNestedBlocks(body);
    const declRe = /--([A-Za-z0-9_-]+)\s*:\s*([^;}]+)/g;
    let decl: RegExpExecArray | null;
    while ((decl = declRe.exec(topLevel))) {
      const name = decl[1]!;
      const value = decl[2]!.trim();
      if (!value || seen.has(name)) continue;
      seen.add(name);
      out.variables.push({ name, value });
    }
    selectorRe.lastIndex = openIndex + body.length + 2;
  }
  return out;
}

/** Contents between `source[openIndex]` and its matching brace, or null when
 *  the block never closes. */
function matchBraces(source: string, openIndex: number): string | null {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, i);
    }
  }
  return null;
}

/** Drop nested `{ ... }` rules so only a block's own declarations remain. */
function stripNestedBlocks(body: string): string {
  let out = "";
  let depth = 0;
  for (const char of body) {
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (depth === 0) out += char;
  }
  return out;
}

/** A value that is TRYING to be a colour: a hex, any colour function, or a
 *  var() indirection. Judged on the value, not the name — `--ring` and
 *  `--destructive` carry no colour word, and a name-based guess silently
 *  dropped them instead of recording a gap. */
const LOOKS_LIKE_COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color|color-mix)\s*\(|\bvar\s*\(/i;

/** The subset of custom properties that resolve to a usable colour. Anything
 *  that looks like a colour but will not normalise is pushed to `unresolved`
 *  so it surfaces as a gap rather than vanishing. */
export function colorVariables(tokens: CssTokens): Array<{ name: string; value: string }> {
  const colors: Array<{ name: string; value: string }> = [];
  for (const variable of tokens.variables) {
    const hex = normalizeColor(variable.value);
    if (hex) colors.push({ name: variable.name, value: hex });
    else if (LOOKS_LIKE_COLOR.test(variable.value)) {
      tokens.unresolved.push(`--${variable.name} = ${variable.value}`);
    }
  }
  return colors;
}

// --- role inference --------------------------------------------------------

const ROLE_PATTERNS: Array<[BrandColorRole, RegExp]> = [
  ["primary", /(^|-)(primary|accent-primary)(-|$)/i],
  ["accent", /(^|-)(accent|secondary)(-|$)/i],
  ["background", /(^|-)(background|bg|canvas|page)(-|$)/i],
  ["surface", /(^|-)(surface|card|panel|popover|elevated)(-|$)/i],
  // `muted` before `text`: shadcn's `muted-foreground` is muted TEXT, and the
  // text pattern matches `foreground`, so the more specific role must win.
  ["muted", /(^|-)(muted|subtle|secondary-text|placeholder)(-|$)/i],
  ["text", /(^|-)(text|foreground|fg|ink|copy)(-|$)/i],
  ["border", /(^|-)(border|divider|outline|ring|stroke)(-|$)/i],
  ["success", /(^|-)(success|positive|ok|green)(-|$)/i],
  ["warning", /(^|-)(warning|caution|attention|amber|yellow)(-|$)/i],
  ["danger", /(^|-)(danger|destructive|error|negative|critical|red)(-|$)/i],
];

/**
 * A role from the token's NAME. Null when the name says nothing — the caller
 * records a gap rather than assigning a role the repository never implied.
 *
 * `brand` is checked LAST and only as a fallback: it is a prefix as often as
 * it is a role, so matching it eagerly made `brand-background` read as the
 * primary colour.
 */
export function inferColorRole(tokenName: string): BrandColorRole | null {
  for (const [role, pattern] of ROLE_PATTERNS) {
    if (pattern.test(tokenName)) return role;
  }
  return /(^|-)brand(-|$)/i.test(tokenName) ? "primary" : null;
}

// --- component corroboration ----------------------------------------------

export interface ComponentEvidence {
  /** Token names referenced by the primitives, most-referenced first. */
  tokens: Array<{ token: string; occurrences: number }>;
  /** Primitives actually found, e.g. ["Button", "Card"]. */
  primitives: string[];
}

const PRIMITIVES = ["Button", "Card", "Badge"] as const;

/**
 * Which tokens the primitives actually use.
 *
 * A config can declare fifty colours while the Button uses one. Counting
 * references is what separates the brand's primary from an unused palette
 * entry, and it is the only signal here that reflects real usage.
 */
export function scanComponentPrimitives(
  files: Array<{ path: string; content: string }>,
): ComponentEvidence {
  const counts = new Map<string, number>();
  const primitives = new Set<string>();

  for (const file of files) {
    const base = file.path.split("/").pop() ?? "";
    const matched = PRIMITIVES.find((name) => new RegExp(`\\b${name}\\b`).test(base));
    if (!matched) continue;
    primitives.add(matched);

    // Tailwind utilities (bg-primary, text-muted-foreground, rounded-lg) and
    // direct custom-property references both count as usage.
    const utility = /\b(?:bg|text|border|ring|fill|stroke|from|to|rounded)-([a-z0-9]+(?:-[a-z0-9]+)*)/gi;
    const cssVar = /var\(\s*--([A-Za-z0-9_-]+)/g;
    for (const re of [utility, cssVar]) {
      let match: RegExpExecArray | null;
      while ((match = re.exec(file.content))) {
        const token = match[1]!.toLowerCase();
        counts.set(token, (counts.get(token) ?? 0) + 1);
      }
    }
  }

  return {
    tokens: [...counts.entries()]
      .map(([token, occurrences]) => ({ token, occurrences }))
      .sort((a, b) => b.occurrences - a.occurrences),
    primitives: [...primitives].sort(),
  };
}

/** Colours in declaration order, annotated with role and usage count. Entries
 *  whose role cannot be inferred are dropped and reported by the caller. */
export function toBrandColors(
  declared: Array<{ name: string; value: string }>,
  evidence: ComponentEvidence,
): { colors: BrandColor[]; unroled: string[] } {
  const usage = new Map(evidence.tokens.map((t) => [t.token, t.occurrences]));
  const colors: BrandColor[] = [];
  const unroled: string[] = [];

  for (const entry of declared) {
    const role = inferColorRole(entry.name);
    if (!role) {
      unroled.push(entry.name);
      continue;
    }
    const occurrences = usage.get(entry.name.toLowerCase());
    colors.push({
      hex: entry.value,
      token: entry.name,
      role,
      ...(occurrences === undefined ? {} : { occurrences }),
    });
  }
  return { colors, unroled };
}
