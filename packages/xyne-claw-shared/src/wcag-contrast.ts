/**
 * WCAG 2.2 contrast for a design system's token pairs (XYNE-66828).
 *
 * A design system is saved once and then injected into every later `/design`
 * run, so an unreadable pairing does not stay a one-off: it spreads into every
 * artifact built against that system. This module is the one place the maths
 * lives, so the review card, the specimen page and a saved system's warning
 * badge all agree on whether a palette passes.
 *
 * Deliberately pure and dependency-free: it is imported by the claw-auth
 * backend (which serves the audit to a frontend that has no workspace
 * dependencies by design) and is the only implementation under test.
 *
 * Prior art: `apps/mobile/src/theme/accent-contrast.ts` ramps a chat accent to
 * a contrast floor with the same formulas. It is not reused here because apps
 * do not export to packages, and that one answers a narrower question (one
 * colour against one surface, 3:1 for non-text graphics).
 */

import type { BrandColor, BrandColorRole } from "./brand-extraction.js";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface Hsl {
  /** Degrees, 0–360. */
  h: number;
  /** 0–1. */
  s: number;
  /** 0–1. */
  l: number;
}

const clampChannel = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

/** `#RGB` and `#RRGGBB`, with or without the hash, any case. Returns null for
 *  anything else — including `rgb()`, `var()` and the 4/8-digit alpha forms, as
 *  a token needs a flat value before it can be contrast-checked. */
export function parseHexColor(value: string): Rgb | null {
  const hex = value.trim().replace(/^#/, "");
  const normalized =
    hex.length === 3
      ? hex
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : hex;
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

/** Uppercase `#RRGGBB`, matching the form `BrandColor.hex` is validated in. */
export function toHexColor({ r, g, b }: Rgb): string {
  const channels = [r, g, b]
    .map((channel) => clampChannel(channel).toString(16).padStart(2, "0"))
    .join("");
  return `#${channels}`.toUpperCase();
}

/** WCAG 2.2 uses 0.04045 as the linearisation crossover. Older copies of the
 *  formula carry 0.03928 from a 2.0-era erratum; the two differ only for
 *  channel values 10 and 11, but this is the published one. */
const toLinear = (channel: number): number => {
  const normalized = channel / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
};

export const relativeLuminance = ({ r, g, b }: Rgb): number =>
  0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

/** `(L1 + 0.05) / (L2 + 0.05)`, lighter colour first. Order-independent. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/**
 * Truncated to 2dp rather than rounded, so a displayed ratio and its pass/fail
 * pills can never disagree and the audit never over-claims: a true 4.497 shows
 * as 4.49 and fails, where rounding would show 4.50 beside a failing badge.
 */
export const truncateRatio = (ratio: number): number => Math.floor(ratio * 100) / 100;

/** Null when either value is not a flat hex colour. */
export function contrastRatioBetween(foreground: string, background: string): number | null {
  const fg = parseHexColor(foreground);
  const bg = parseHexColor(background);
  if (!fg || !bg) return null;
  return truncateRatio(contrastRatio(fg, bg));
}

/** WCAG 2.2 SC 1.4.3 (AA) and 1.4.6 (AAA). Large text is >= 18.66px bold or
 *  >= 24px regular. */
export const CONTRAST_THRESHOLDS = {
  aaNormal: 4.5,
  aaaNormal: 7,
  aaLarge: 3,
  aaaLarge: 4.5,
} as const;

export interface ContrastRatings {
  aaNormal: boolean;
  aaLarge: boolean;
  aaaNormal: boolean;
  aaaLarge: boolean;
}

export const rateContrast = (ratio: number): ContrastRatings => ({
  aaNormal: ratio >= CONTRAST_THRESHOLDS.aaNormal,
  aaLarge: ratio >= CONTRAST_THRESHOLDS.aaLarge,
  aaaNormal: ratio >= CONTRAST_THRESHOLDS.aaaNormal,
  aaaLarge: ratio >= CONTRAST_THRESHOLDS.aaaLarge,
});

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const l = (max + min) / 2;
  if (delta === 0) return { h: 0, s: 0, l };

  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === red) h = ((green - blue) / delta) % 6;
  else if (max === green) h = (blue - red) / delta + 2;
  else h = (red - green) / delta + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const sector = ((h % 360) + 360) % 360 / 60;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  const [r1, g1, b1]: [number, number, number] =
    sector < 1
      ? [chroma, second, 0]
      : sector < 2
        ? [second, chroma, 0]
        : sector < 3
          ? [0, chroma, second]
          : sector < 4
            ? [0, second, chroma]
            : sector < 5
              ? [second, 0, chroma]
              : [chroma, 0, second];
  const match = l - chroma / 2;
  return {
    r: clampChannel((r1 + match) * 255),
    g: clampChannel((g1 + match) * 255),
    b: clampChannel((b1 + match) * 255),
  };
}

export interface ContrastSuggestion {
  /** Uppercase `#RRGGBB`. */
  hex: string;
  /** What the suggestion actually achieves against the same background. */
  ratio: number;
}

/** The luminance at which contrast against white equals contrast against
 *  black. Above it a background is "light" and the fix is to darken the
 *  foreground; below it, to lighten. */
const LIGHT_BACKGROUND_LUMINANCE = 0.179;

/** Half a percent of lightness. Fine enough that a suggestion does not
 *  overshoot a brand colour by a visible amount, coarse enough to settle in a
 *  couple of hundred iterations. */
const LIGHTNESS_STEP = 0.005;

function rampLightness(
  from: Hsl,
  backgrounds: readonly Rgb[],
  direction: 1 | -1,
  target: number,
): Rgb | null {
  const clears = (candidate: Rgb): boolean =>
    backgrounds.every((background) => contrastRatio(candidate, background) >= target);

  const steps = Math.ceil(1 / LIGHTNESS_STEP);
  for (let step = 1; step <= steps; step += 1) {
    const lightness = from.l + direction * step * LIGHTNESS_STEP;
    if (lightness < 0 || lightness > 1) break;
    const candidate = hslToRgb({ ...from, l: lightness });
    if (clears(candidate)) return candidate;
  }
  // The endpoint itself can be the only passing value, and the loop above
  // stops just short of it whenever the starting lightness is not a multiple
  // of the step.
  const endpoint = hslToRgb({ ...from, l: direction === -1 ? 0 : 1 });
  return clears(endpoint) ? endpoint : null;
}

/**
 * The nearest colour to `foregroundHex` that clears `target` against
 * `backgroundHex`, found by walking the foreground's own lightness ramp so hue
 * and saturation survive — a suggestion that reads as a different brand colour
 * does not get applied.
 *
 * Direction comes from the background, as the ticket specifies: darken on a
 * light background, lighten on a dark one. The opposite direction is tried only
 * when the first cannot reach the target, which is what rescues a mid-tone
 * foreground on a mid-tone background.
 *
 * Returns null when the pair already passes, when either value is not a hex
 * colour, or when NO colour on that ramp passes. At AA for normal text the last
 * case cannot happen: every background has either black or white above 4.5:1,
 * and the ramp reaches both. It does happen at stricter targets — against a
 * mid-tone background like `#777777`, nothing clears AAA's 7:1, so there the
 * background is what has to change.
 */
export function suggestNearestPassing(
  foregroundHex: string,
  backgroundHex: string,
  target: number = CONTRAST_THRESHOLDS.aaNormal,
): ContrastSuggestion | null {
  return suggestNearestPassingAgainst(foregroundHex, [backgroundHex], target);
}

/**
 * The same walk, but the result has to clear `target` against EVERY background
 * given — because one token is often the foreground of more than one pair.
 *
 * Body text sits on both the page background and a raised surface, and those
 * are different colours. A suggestion sized for the lighter of the two leaves
 * the other pair failing, which is worse than no suggestion: the reviewer
 * clicked something that said it was fixed. Direction is taken from the first
 * background, which callers pass as the pair being fixed.
 *
 * The reported ratio is against the hardest background, so it never
 * over-claims. Unresolvable backgrounds are skipped; null if none resolve.
 */
export function suggestNearestPassingAgainst(
  foregroundHex: string,
  backgroundHexes: readonly string[],
  target: number = CONTRAST_THRESHOLDS.aaNormal,
): ContrastSuggestion | null {
  const foreground = parseHexColor(foregroundHex);
  const backgrounds = backgroundHexes
    .map((hex) => parseHexColor(hex))
    .filter((value): value is Rgb => value !== null);
  const first = backgrounds[0];
  if (!foreground || !first) return null;
  if (backgrounds.every((background) => contrastRatio(foreground, background) >= target)) {
    return null;
  }

  const from = rgbToHsl(foreground);
  const directions: readonly (1 | -1)[] =
    relativeLuminance(first) >= LIGHT_BACKGROUND_LUMINANCE ? [-1, 1] : [1, -1];
  for (const direction of directions) {
    const found = rampLightness(from, backgrounds, direction, target);
    if (!found) continue;
    const worst = Math.min(
      ...backgrounds.map((background) => contrastRatio(found, background)),
    );
    return { hex: toHexColor(found), ratio: truncateRatio(worst) };
  }
  return null;
}

/**
 * The semantic slots a contrast audit is defined over.
 *
 * These are NOT `BrandColorRole`s. A role says what a colour was used for on
 * the source; a slot is one side of a text-on-background pair. `on-primary`
 * and `link` have no role at all, which is why a system that never names them
 * reports those pairs as unaudited rather than inventing a plausible pairing.
 */
export const CONTRAST_SLOTS = [
  "background",
  "surface",
  "body",
  "muted",
  "primary",
  "onPrimary",
  "onSurface",
  "link",
] as const;
export type ContrastSlot = (typeof CONTRAST_SLOTS)[number];

/** Hex per slot. Every absent slot costs a pair, not the audit. */
export type ContrastTokens = Partial<Record<ContrastSlot, string>>;

/**
 * The custom property each slot came from, without the `--`.
 *
 * Carried through the audit for two reasons: a reviewer can act on
 * "`--text-muted` on `--brand-background`" where "Muted text on background"
 * only tells them what broke, and applying a suggestion has to rewrite one
 * named declaration. Two slots routinely hold the SAME hex — a white page
 * background and white text on a primary fill — so a fix keyed by colour value
 * would darken the page background while fixing the button.
 */
export type ContrastTokenNames = Partial<Record<ContrastSlot, string>>;

/** A palette and the token names behind it, as read off a real system. */
export interface ContrastPalette {
  tokens: ContrastTokens;
  names: ContrastTokenNames;
}

export interface ContrastPairDefinition {
  id: string;
  /** Shown verbatim in the audit UI. */
  label: string;
  foreground: ContrastSlot;
  background: ContrastSlot;
}

/** The five pairs every system is held to. `body` on surface is covered by
 *  `onSurface`, which defaults to `body` — see `withSlotDefaults`. */
export const CONTRAST_PAIRS: readonly ContrastPairDefinition[] = [
  {
    id: "body-on-background",
    label: "Body text on background",
    foreground: "body",
    background: "background",
  },
  {
    id: "muted-on-background",
    label: "Muted text on background",
    foreground: "muted",
    background: "background",
  },
  {
    id: "on-primary-on-primary",
    label: "Text on primary",
    foreground: "onPrimary",
    background: "primary",
  },
  {
    id: "on-surface-on-surface",
    label: "Body text on surface",
    foreground: "onSurface",
    background: "surface",
  },
  {
    id: "link-on-background",
    label: "Links on background",
    foreground: "link",
    background: "background",
  },
];

/**
 * - `pass` / `fail` — audited, against AA for normal text.
 * - `missing` — one side has no token. Not a failure: a system that does not
 *   define a link colour has no link pair to get wrong.
 * - `invalid` — a token exists but its value is not a flat hex, so it cannot be
 *   measured. Worth saying out loud, since it looks identical to `missing` in
 *   the UI otherwise.
 */
export type ContrastPairStatus = "pass" | "fail" | "missing" | "invalid";

export interface ContrastPairResult {
  id: string;
  label: string;
  status: ContrastPairStatus;
  foreground: ContrastSlot;
  background: ContrastSlot;
  foregroundHex: string | null;
  backgroundHex: string | null;
  /** The custom property behind each side, without `--`. Null when the caller
   *  audited a bare token map. What "Apply" rewrites. */
  foregroundToken: string | null;
  backgroundToken: string | null;
  /** Truncated to 2dp. Null unless the status is pass or fail. */
  ratio: number | null;
  ratings: ContrastRatings | null;
  /** Present only on a failing pair, and null there too when no colour on the
   *  foreground's lightness ramp can pass. */
  suggestion: ContrastSuggestion | null;
  /** The slots that stopped this pair being audited, so the UI can name the
   *  token to add rather than saying "unavailable". */
  unresolved: ContrastSlot[];
}

export interface ContrastAudit {
  pairs: ContrastPairResult[];
  /** Pairs with a measurable ratio. */
  audited: number;
  failing: number;
  /** Drives the warning badge: at least one audited pair is below AA for
   *  normal text. A system with nothing measurable is not "failing". */
  hasIssues: boolean;
}

/** `onSurface` falls back to `body`, because body text on a surface IS the
 *  pair, and it is the same colour the system already owns — so applying a fix
 *  to it rewrites a real token. No other slot is derived from another: a
 *  suggestion must never rewrite a colour the user did not mean. */
function withSlotDefaults(palette: ContrastPalette): ContrastPalette {
  const onSurface = palette.tokens.onSurface ?? palette.tokens.body;
  if (onSurface === undefined) return palette;
  const name = palette.names.onSurface ?? palette.names.body;
  return {
    tokens: { ...palette.tokens, onSurface },
    names: { ...palette.names, ...(name === undefined ? {} : { onSurface: name }) },
  };
}

export interface AuditContrastOptions {
  /** The ratio a suggestion has to reach. Defaults to AA for normal text. */
  target?: number;
  /** The custom property behind each slot, so the audit can name what to fix. */
  names?: ContrastTokenNames;
}

export function auditContrast(
  tokens: ContrastTokens,
  options: AuditContrastOptions = {},
): ContrastAudit {
  const target = options.target ?? CONTRAST_THRESHOLDS.aaNormal;
  const resolved = withSlotDefaults({ tokens, names: options.names ?? {} });

  const measurable = (slot: ContrastSlot): string | null => {
    const hex = resolved.tokens[slot];
    return hex !== undefined && parseHexColor(hex) ? hex : null;
  };

  /**
   * Every background a given foreground has to work on, keyed by the token a
   * fix would rewrite. `body` and `onSurface` are different slots that
   * routinely share one token, so grouping by slot would size a fix for one of
   * them and leave the other failing. Without token names there is nothing
   * safer than the slot to group by — two slots holding the same hex are not
   * necessarily the same token.
   */
  const fixKey = (slot: ContrastSlot): string => resolved.names[slot] ?? `slot:${slot}`;
  const backgroundsByFix = new Map<string, string[]>();
  for (const pair of CONTRAST_PAIRS) {
    if (!measurable(pair.foreground)) continue;
    const background = measurable(pair.background);
    if (!background) continue;
    const key = fixKey(pair.foreground);
    const seen = backgroundsByFix.get(key) ?? [];
    if (!seen.includes(background)) seen.push(background);
    backgroundsByFix.set(key, seen);
  }

  const pairs = CONTRAST_PAIRS.map((pair): ContrastPairResult => {
    const foregroundHex = resolved.tokens[pair.foreground] ?? null;
    const backgroundHex = resolved.tokens[pair.background] ?? null;
    const base = {
      id: pair.id,
      label: pair.label,
      foreground: pair.foreground,
      background: pair.background,
      foregroundHex,
      backgroundHex,
      foregroundToken: resolved.names[pair.foreground] ?? null,
      backgroundToken: resolved.names[pair.background] ?? null,
      ratio: null,
      ratings: null,
      suggestion: null,
    };

    const unresolved: ContrastSlot[] = [];
    if (foregroundHex === null) unresolved.push(pair.foreground);
    if (backgroundHex === null) unresolved.push(pair.background);
    if (foregroundHex === null || backgroundHex === null) {
      return { ...base, status: "missing", unresolved };
    }

    const foreground = parseHexColor(foregroundHex);
    const background = parseHexColor(backgroundHex);
    if (!foreground) unresolved.push(pair.foreground);
    if (!background) unresolved.push(pair.background);
    if (!foreground || !background) {
      return { ...base, status: "invalid", unresolved };
    }

    const ratio = truncateRatio(contrastRatio(foreground, background));
    const ratings = rateContrast(ratio);
    if (ratings.aaNormal) {
      return { ...base, status: "pass", ratio, ratings, unresolved: [] };
    }

    // This pair's own background first: it sets the direction, and the
    // suggestion is reported against it so the row's number matches the row.
    const others = (backgroundsByFix.get(fixKey(pair.foreground)) ?? []).filter(
      (hex) => hex !== backgroundHex,
    );
    const found = suggestNearestPassingAgainst(
      foregroundHex,
      [backgroundHex, ...others],
      target,
    );
    const achieved = found ? contrastRatioBetween(found.hex, backgroundHex) : null;
    return {
      ...base,
      status: "fail",
      ratio,
      ratings,
      suggestion: found && achieved !== null ? { hex: found.hex, ratio: achieved } : null,
      unresolved: [],
    };
  });

  const audited = pairs.filter((pair) => pair.ratio !== null).length;
  const failing = pairs.filter((pair) => pair.status === "fail").length;
  return { pairs, audited, failing, hasIssues: failing > 0 };
}

/** Prefixes that namespace a token without changing its purpose, so
 *  `--brand-primary` and `--primary` land in the same slot. */
const TOKEN_NAMESPACES = /^(brand|color|colour|colors|clr|theme|palette|ds)-/;

const normalizeTokenName = (raw: string): string =>
  raw
    .trim()
    .toLowerCase()
    .replace(/^--/, "")
    .replace(/[\s_]+/g, "-")
    .replace(TOKEN_NAMESPACES, "");

/**
 * Purpose names seen in the wild, matched exactly after normalisation. Exact
 * rather than substring matching on purpose: `text-on-primary` must not land in
 * `body` because it contains "text".
 */
const SLOT_ALIASES: Readonly<Record<ContrastSlot, readonly string[]>> = {
  onPrimary: [
    "on-primary",
    "primary-foreground",
    "primary-fg",
    "primary-contrast",
    "primary-text",
    "text-on-primary",
    "on-accent",
    "accent-foreground",
    "on-brand",
  ],
  onSurface: [
    "on-surface",
    "surface-foreground",
    "surface-fg",
    "surface-text",
    "text-on-surface",
    "card-foreground",
  ],
  link: ["link", "text-link", "link-color", "link-colour", "link-default", "anchor"],
  muted: [
    "muted",
    "text-muted",
    "muted-foreground",
    "muted-fg",
    "fg-muted",
    "foreground-muted",
    "text-secondary",
    "secondary-text",
  ],
  body: [
    "text",
    "text-primary",
    "text-base",
    "text-default",
    "text-body",
    "body",
    "body-text",
    "foreground",
    "fg",
    "fg-primary",
    "on-background",
    "ink",
  ],
  surface: ["surface", "surface-default", "surface-raised", "surface-1", "card", "panel", "elevated"],
  background: ["background", "background-default", "bg", "bg-default", "page", "page-background", "canvas", "backdrop"],
  primary: ["primary", "accent", "brand", "cta"],
};

/** The slot a token name claims, or null when it names something this audit
 *  does not pair (a border, a success colour, a radius). */
export function matchContrastSlot(tokenName: string): ContrastSlot | null {
  const normalized = normalizeTokenName(tokenName);
  if (!normalized) return null;
  for (const slot of CONTRAST_SLOTS) {
    if (SLOT_ALIASES[slot].includes(normalized)) return slot;
  }
  return null;
}

/**
 * Strip `/* … *\/` comments in one pass.
 *
 * Deliberately not a regex. `/\/\*[\s\S]*?\*\//g` restarts its lazy scan at
 * every `/*` and runs it to the end of the input, so a file holding many
 * unclosed ones costs quadratic time — CodeQL's js/polynomial-redos. The token
 * CSS here is model-written inside a sandbox, so that is reachable input.
 *
 * An unterminated comment runs to end of file, which is what the CSS spec says
 * and what a browser does. The regex left that text in place, where the scan
 * below would have read commented-out declarations as live.
 *
 * The same scanner exists in brand-repo.ts (XYNE-66819). Both are deliberate
 * copies while these PRs are independent; they fold into one module once the
 * design-systems series has landed.
 */
function stripCssComments(css: string): string {
  let out = "";
  let from = 0;
  for (;;) {
    const start = css.indexOf("/*", from);
    if (start === -1) return out + css.slice(from);
    out += `${css.slice(from, start)} `;
    const end = css.indexOf("*/", start + 2);
    if (end === -1) return out;
    from = end + 2;
  }
}
/** `--name: #hex`. Six digits are tried before three so `#abcdef` is not read
 *  as `#abc`. */
const CSS_COLOR_DECLARATION = /--([a-z0-9][a-z0-9_-]*)\s*:\s*(#(?:[0-9a-f]{6}|[0-9a-f]{3}))\b/gi;

/**
 * Slot colours from a saved system's `tokens.css`.
 *
 * This is the only palette a saved DesignSystem has — the record keeps DESIGN.md
 * and token CSS, not the structured `brand.json` — so it is what the warning
 * badge on a saved system is derived from.
 *
 * First declaration per slot wins, which is the `:root` block in a file that
 * follows the brand-extraction skill. A `prefers-color-scheme` override later
 * in the file is therefore ignored rather than silently audited as if it were
 * the light set; auditing both sets is the "Light and dark variants" item, and
 * arrives as a second call with the dark tokens.
 */
export function contrastPaletteFromTokensCss(css: string): ContrastPalette {
  const tokens: ContrastTokens = {};
  const names: ContrastTokenNames = {};
  const declarations = stripCssComments(css);
  for (const match of declarations.matchAll(CSS_COLOR_DECLARATION)) {
    const name = match[1];
    const hex = match[2];
    if (!name || !hex) continue;
    const slot = matchContrastSlot(name);
    if (!slot || tokens[slot] !== undefined) continue;
    const rgb = parseHexColor(hex);
    if (!rgb) continue;
    // Expanded to #RRGGBB so `#abc` and `#aabbcc` are one value everywhere
    // downstream, including the hex a suggestion is compared against.
    tokens[slot] = toHexColor(rgb);
    names[slot] = name.toLowerCase();
  }
  return { tokens, names };
}

/** Roles that stand in for a slot when no token name claims it. `accent`,
 *  `border` and the status colours are left out: none of them is one side of a
 *  pair this audit defines. */
const ROLE_SLOTS: Readonly<Partial<Record<BrandColorRole, ContrastSlot>>> = {
  background: "background",
  surface: "surface",
  text: "body",
  muted: "muted",
  primary: "primary",
};

/**
 * Slot colours from a fresh extraction's `brand.json`.
 *
 * Token names are read first and roles only fill what is left, because the
 * extraction skill requires purpose-named tokens (`--on-primary`, not
 * `--blue-600`) while `BrandColorRole` has no on-primary or link at all. A
 * palette that names neither leaves those two pairs unaudited, which is the
 * honest answer — the extractor's own rule is that an admitted gap beats an
 * invented colour.
 */
export function contrastPaletteFromBrandColors(colors: readonly BrandColor[]): ContrastPalette {
  const tokens: ContrastTokens = {};
  const names: ContrastTokenNames = {};

  const claim = (slot: ContrastSlot | null, color: BrandColor): void => {
    if (!slot || tokens[slot] !== undefined) return;
    const rgb = parseHexColor(color.hex);
    if (!rgb) return;
    tokens[slot] = toHexColor(rgb);
    // Leading `--` stripped. The contract says `token` carries none, but it is
    // model-written and only checked for being a string, so a `--brand-text`
    // became the name `--brand-text` and a fix then looked for
    // `----brand-text`, matched nothing, and left the card showing a colour
    // that was never written.
    if (color.token) names[slot] = color.token.trim().replace(/^--/, "").toLowerCase();
  };

  for (const color of colors) claim(matchContrastSlot(color.token), color);
  for (const color of colors) claim(ROLE_SLOTS[color.role] ?? null, color);
  return { tokens, names };
}

/** The audit the Brand Review Card renders for a delivered `brand.json`. */
export const auditBrandColors = (
  colors: readonly BrandColor[],
  options?: AuditContrastOptions,
): ContrastAudit => {
  const palette = contrastPaletteFromBrandColors(colors);
  return auditContrast(palette.tokens, { ...options, names: palette.names });
};

/** The audit behind a saved system's warning badge. */
export const auditTokensCss = (css: string, options?: AuditContrastOptions): ContrastAudit => {
  const palette = contrastPaletteFromTokensCss(css);
  return auditContrast(palette.tokens, { ...options, names: palette.names });
};
