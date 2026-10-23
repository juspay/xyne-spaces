/**
 * Checks a generated artifact against the design system it was supposed to
 * follow.
 *
 * Pure string work on purpose: the caller already holds the HTML/CSS, and a
 * check that needed a live browser could only run where a sandbox exists. This
 * runs anywhere, including in tests.
 *
 * It reports, it does not enforce. A design system is reference material
 * (XYNE-66821), and a user's explicit request legitimately overrides it — so an
 * off-palette colour is a finding to surface, never a reason to fail a run.
 */

export interface DesignSystemQaFindings {
  /** Hex colours in the artifact that the system's tokens do not contain. */
  offPaletteColors: string[];
  /** Font families the artifact asks for that the system does not list. */
  unauthorizedFonts: string[];
}

/** `#abc`, `#aabbcc`, `#aabbccdd`. */
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;

/** Declared families, e.g. `font-family: "Inter", system-ui, sans-serif`. */
const FONT_FAMILY_RE = /font-family\s*:\s*([^;}{]+)/gi;

/** Generic CSS families are always allowed — they are fallbacks, not brand
 *  choices, and flagging them would bury the real findings. */
const GENERIC_FAMILIES = new Set([
  "inherit",
  "initial",
  "unset",
  "revert",
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "-apple-system",
  "blinkmacsystemfont",
  "emoji",
  "math",
  "fangsong",
]);

/** `#abc` and `#AABBCC` are the same colour; compare on one spelling. */
function normalizeHex(hex: string): string {
  const body = hex.slice(1).toLowerCase();
  const expanded =
    body.length === 3 || body.length === 4
      ? body
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : body;
  // Drop a fully opaque alpha channel so #112233 and #112233ff match.
  return expanded.length === 8 && expanded.endsWith("ff")
    ? `#${expanded.slice(0, 6)}`
    : `#${expanded}`;
}

function normalizeFamily(name: string): string {
  return name.trim().replace(/^['"]|['"]$/g, "").toLowerCase();
}

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Compare an artifact against the system's `tokens.css`.
 *
 * `allowedFonts` comes from the system's font list rather than tokens.css,
 * because a font is usually declared where it is used, not as a token.
 */
export function checkDesignSystemCompliance(
  artifact: string,
  tokensCss: string,
  allowedFonts: string[] = [],
): DesignSystemQaFindings {
  if (!artifact.trim()) return { offPaletteColors: [], unauthorizedFonts: [] };

  const palette = new Set((tokensCss.match(HEX_RE) ?? []).map(normalizeHex));
  const used = uniq((artifact.match(HEX_RE) ?? []).map(normalizeHex));
  // With no palette to compare against there is nothing to be off, and
  // reporting every colour as a violation would be noise, not a finding.
  const offPaletteColors = palette.size === 0 ? [] : used.filter((hex) => !palette.has(hex));

  const allowed = new Set(allowedFonts.map(normalizeFamily));
  const declared: string[] = [];
  for (const match of artifact.matchAll(FONT_FAMILY_RE)) {
    const stack = match[1];
    if (!stack) continue;
    for (const family of stack.split(",")) {
      const name = normalizeFamily(family);
      // A CSS variable resolves to a token that was itself checked.
      if (!name || name.startsWith("var(") || GENERIC_FAMILIES.has(name)) continue;
      declared.push(name);
    }
  }
  const unauthorizedFonts =
    allowed.size === 0 ? [] : uniq(declared).filter((name) => !allowed.has(name));

  return { offPaletteColors, unauthorizedFonts };
}
