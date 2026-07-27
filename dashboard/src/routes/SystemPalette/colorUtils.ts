import type { CSSProperties } from 'react';

const HEX_COLOR_RE = /^#[0-9a-f]{3,8}$/i;
const FUNCTIONAL_COLOR_RE = /^(rgb|rgba|hsl|hsla|color-mix|oklch|oklab|lab|lch)\(/i;
const BARE_HSL_TRIPLET_RE = /^-?[\d.]+\s+[\d.]+%\s+[\d.]+%(\s*\/\s*[\d.]+%?)?$/;
const COLOR_KEYWORDS = new Set(['transparent', 'currentcolor']);

/**
 * global.css mixes hex (`--sidebar-border: #e5ebf0`), rgba (`--metrics-bar-divider:
 * rgba(0, 0, 0, 0.5)`), and bare HSL triplets consumed as `hsl(var(--x))`
 * (`--primary: 0 97% 71%`). This normalizes any of those into a value that's
 * directly valid as a CSS `background-color`, wrapping the bare-triplet case in
 * `hsl(...)`. Returns null when the raw value isn't a colour at all (radius,
 * blur, opacity, font, url() tokens, …).
 */
export function toCssColor(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (COLOR_KEYWORDS.has(value.toLowerCase())) return value;
  if (HEX_COLOR_RE.test(value) || FUNCTIONAL_COLOR_RE.test(value)) return value;
  if (BARE_HSL_TRIPLET_RE.test(value)) return `hsl(${value})`;
  return null;
}

export function isColorValue(raw: string): boolean {
  return toCssColor(raw) !== null;
}

/** Checkerboard pattern so near-white and translucent swatches stay visible. */
export const CHECKERBOARD_STYLE: CSSProperties = {
  backgroundImage: [
    'linear-gradient(45deg, #80808033 25%, transparent 25%)',
    'linear-gradient(-45deg, #80808033 25%, transparent 25%)',
    'linear-gradient(45deg, transparent 75%, #80808033 75%)',
    'linear-gradient(-45deg, transparent 75%, #80808033 75%)',
  ].join(', '),
  backgroundSize: '10px 10px',
  backgroundPosition: '0 0, 0 5px, 5px -5px, -5px 0px',
};
