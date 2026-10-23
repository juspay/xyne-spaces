/**
 * The contract between a brand-extraction run and the Brand Review Card.
 *
 * `/brand` (XYNE-66818) extracts from a URL or a screenshot; `/brand` from a
 * GitHub repo (XYNE-66819) extracts from Tailwind config, CSS variables and
 * components. Both deliver the SAME three files, so the card renders either
 * without knowing which produced it:
 *
 *   DESIGN.md   — the prose contract, injected into /design runs verbatim
 *   tokens.css  — custom properties, consumed by generated artifacts
 *   brand.json  — this payload, for rendering the review card
 *
 * A fourth file, tokens.dark.css, rides along only when the source actually
 * carries a dark theme (XYNE-66829). Optional on purpose: most sources have one
 * theme, and deriving a dark palette by inverting a light one yields a system
 * that is subtly wrong everywhere it is later used.
 *
 * Keep this shape additive. The card tolerates unknown fields, but a renamed
 * one silently empties a section of the card rather than failing loudly.
 */

/** Delivered alongside DESIGN.md and tokens.css. Both extractors use exactly
 *  these names so the card can find them without guessing. */
export const BRAND_SUMMARY_FILENAME = "brand.json";
export const BRAND_DESIGN_MD_FILENAME = "DESIGN.md";
export const BRAND_TOKENS_CSS_FILENAME = "tokens.css";
/** Delivered only when `darkThemeSource` is set. */
export const BRAND_TOKENS_DARK_CSS_FILENAME = "tokens.dark.css";

/** How the source expressed its dark theme. Recorded so the card can say where
 *  a dark palette came from instead of presenting it as given. */
export const BRAND_DARK_THEME_SOURCES = [
  "prefers-color-scheme",
  "class",
  "theme-file",
] as const;
export type BrandDarkThemeSource = (typeof BRAND_DARK_THEME_SOURCES)[number];

/** What the colour is used for on the source, not what it looks like. A
 *  palette the card can group is far more useful than a flat swatch list. */
export const BRAND_COLOR_ROLES = [
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
] as const;
export type BrandColorRole = (typeof BRAND_COLOR_ROLES)[number];

export interface BrandColor {
  /** `#RRGGBB`, uppercase. Alpha is dropped — a token needs a flat value. */
  hex: string;
  /** Token name without the `--` prefix, e.g. `brand-primary`. Must match the
   *  custom property emitted in tokens.css. */
  token: string;
  role: BrandColorRole;
  /** How many elements resolved to this colour. Drives ordering, and lets the
   *  card show a dominant colour ahead of an incidental one. Absent when the
   *  source was a screenshot, where frequency cannot be counted. */
  occurrences?: number;
}

export interface BrandFont {
  /** The family as authored, e.g. `Inter`. No fallback stack. */
  family: string;
  /** The rest of the stack, so the card can preview a near miss when the
   *  family is not installed. */
  fallbacks?: string[];
  role: "heading" | "body" | "mono";
  /** Weights actually used on the source, ascending. */
  weights?: number[];
  /** Absolute URL of a webfont file, when the source loads one. */
  sourceUrl?: string;
}

export interface BrandTypeStep {
  /** `h1`…`h6`, or a scale name like `sm`. */
  name: string;
  sizePx: number;
  lineHeightPx?: number;
  weight?: number;
  letterSpacingPx?: number;
}

export interface BrandScaleValue {
  token: string;
  /** Raw CSS value, e.g. `8px`, `0.5rem`, `0 1px 2px rgba(0,0,0,.05)`. */
  value: string;
}

export type BrandAssetKind = "logo" | "favicon" | "screenshot-desktop" | "screenshot-mobile";

export interface BrandAssetRef {
  kind: BrandAssetKind;
  /** Filename as delivered next to brand.json. */
  file: string;
  mimeType?: string;
  width?: number;
  height?: number;
}

export interface BrandSummary {
  /** Bump only for a breaking change; the card refuses an unknown version
   *  rather than rendering a half-understood payload. */
  version: 1;
  /** Proposed name for the saved DesignSystem. The user can rename on save. */
  name: string;
  source: "url" | "screenshot" | "repo";
  /** Present when source is `url`; the page actually extracted from, after
   *  redirects. */
  sourceUrl?: string;
  /** Present when source is `repo` (XYNE-66819). */
  sourceRepo?: string;
  sourceCommit?: string;
  extractedAt: string;
  colors: BrandColor[];
  /**
   * The dark counterpart of `colors`, same roles and token names.
   *
   * Set only when `darkThemeSource` is too — the two travel together, and a
   * dark palette with no stated provenance is indistinguishable from one the
   * extractor invented. Type, spacing and radii are deliberately NOT duplicated:
   * real sources vary colour between themes and keep the rest, so a second
   * type scale would be noise the card has to explain.
   */
  colorsDark?: BrandColor[];
  /** Where the dark theme was found. Absent means the source had none. */
  darkThemeSource?: BrandDarkThemeSource;
  fonts: BrandFont[];
  typeScale: BrandTypeStep[];
  radii?: BrandScaleValue[];
  spacing?: BrandScaleValue[];
  shadows?: BrandScaleValue[];
  assets?: BrandAssetRef[];
  /**
   * Things the extractor could NOT determine, named plainly — e.g.
   * "no webfont file found", "shadows not detected".
   *
   * This exists so a gap is visible in the card instead of being filled with a
   * plausible invention. An extractor that guesses a brand colour is worse
   * than one that admits it could not find one.
   */
  gaps?: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isHex = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9A-F]{6}$/i.test(value);

const isStringArray = (value: unknown): boolean =>
  value === undefined || (Array.isArray(value) && value.every((v) => typeof v === "string"));

const isNumberArray = (value: unknown): boolean =>
  value === undefined || (Array.isArray(value) && value.every((v) => typeof v === "number"));

const isOptionalString = (value: unknown): boolean =>
  value === undefined || typeof value === "string";

const isOptionalNumber = (value: unknown): boolean =>
  value === undefined || typeof value === "number";

/** Shared by `colors` and `colorsDark` so the two sets can never drift apart
 *  in how strictly they are checked. */
const isColorList = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.every(
    (color) =>
      isRecord(color) &&
      isHex(color["hex"]) &&
      typeof color["token"] === "string" &&
      (BRAND_COLOR_ROLES as readonly string[]).includes(String(color["role"])) &&
      isOptionalNumber(color["occurrences"]),
  );

/**
 * Validate a payload before the card renders it. The file is written by a
 * model inside a sandbox, so it is untrusted input.
 *
 * EVERY field the card reads is checked, not just the required ones. An
 * earlier version validated only the required fields, which let
 * `gaps: "none"` or `fallbacks: "Arial"` through — both pass a shape check and
 * then throw inside render (`.map`/`.join` of a string, or an object as a
 * React child). Because the message is persisted, that throw repeats on every
 * reload and the conversation cannot be opened again. A field that is cheap to
 * check here is expensive to get wrong there.
 */
export function isBrandSummary(value: unknown): value is BrandSummary {
  if (!isRecord(value)) return false;
  if (value["version"] !== 1) return false;
  if (typeof value["name"] !== "string" || !value["name"].trim()) return false;
  if (value["source"] !== "url" && value["source"] !== "screenshot" && value["source"] !== "repo") {
    return false;
  }
  if (typeof value["extractedAt"] !== "string") return false;

  // Rendered verbatim by the card's source line.
  if (!isOptionalString(value["sourceUrl"])) return false;
  if (!isOptionalString(value["sourceRepo"])) return false;
  if (!isOptionalString(value["sourceCommit"])) return false;

  if (!isColorList(value["colors"])) return false;

  // Validated exactly as strictly as `colors`: these hexes also become inline
  // style values once the card's theme toggle is switched to dark.
  //
  // Shape is enforced, pairing is not. A dark palette with no `darkThemeSource`
  // is incomplete rather than malformed, and refusing the payload would blank a
  // perfectly good light palette too — so the card treats dark as available
  // only when both are present and otherwise just omits the toggle.
  if (value["colorsDark"] !== undefined && !isColorList(value["colorsDark"])) return false;
  if (
    value["darkThemeSource"] !== undefined &&
    !(BRAND_DARK_THEME_SOURCES as readonly string[]).includes(String(value["darkThemeSource"]))
  ) {
    return false;
  }

  const fonts = value["fonts"];
  if (!Array.isArray(fonts)) return false;
  const fontsOk = fonts.every(
    (font) =>
      isRecord(font) &&
      typeof font["family"] === "string" &&
      (font["role"] === "heading" || font["role"] === "body" || font["role"] === "mono") &&
      // The card joins this into a font-family stack.
      isStringArray(font["fallbacks"]) &&
      isNumberArray(font["weights"]) &&
      isOptionalString(font["sourceUrl"]),
  );
  if (!fontsOk) return false;

  const typeScale = value["typeScale"];
  if (!Array.isArray(typeScale)) return false;
  const typeScaleOk = typeScale.every(
    (step) =>
      isRecord(step) &&
      typeof step["name"] === "string" &&
      typeof step["sizePx"] === "number" &&
      isOptionalNumber(step["lineHeightPx"]) &&
      // Becomes a fontWeight style value.
      isOptionalNumber(step["weight"]) &&
      isOptionalNumber(step["letterSpacingPx"]),
  );
  if (!typeScaleOk) return false;

  // The card maps over gaps and renders each as a list item.
  if (!isStringArray(value["gaps"])) return false;

  const assets = value["assets"];
  if (assets !== undefined) {
    if (!Array.isArray(assets)) return false;
    const assetsOk = assets.every(
      (asset) =>
        isRecord(asset) &&
        typeof asset["kind"] === "string" &&
        typeof asset["file"] === "string" &&
        isOptionalString(asset["mimeType"]) &&
        isOptionalNumber(asset["width"]) &&
        isOptionalNumber(asset["height"]),
    );
    if (!assetsOk) return false;
  }

  const radiiOk = [value["radii"], value["spacing"], value["shadows"]].every((scale) => {
    if (scale === undefined) return true;
    if (!Array.isArray(scale)) return false;
    return scale.every(
      (entry) =>
        isRecord(entry) && typeof entry["token"] === "string" && typeof entry["value"] === "string",
    );
  });
  return radiiOk;
}

/** Parse the delivered brand.json. Returns null for anything that is not a
 *  valid payload, so callers never branch on a half-parsed object. */
export function parseBrandSummary(raw: string): BrandSummary | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isBrandSummary(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
