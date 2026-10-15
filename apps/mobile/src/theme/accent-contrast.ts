/**
 * The chat bubble palette spans near-white yellows and near-black indigos. The
 * accent derived for chat *content* sits on the bubble itself, so it is tuned
 * for that surface — dropped onto the screen background it can fall to ~2.1:1.
 *
 * These helpers push the derived accent along its own lightness ramp until it
 * clears a contrast floor against whatever surface it is drawn on, preserving
 * hue and saturation so the colour still reads as the user's choice.
 */

type Rgb = { r: number; g: number; b: number };
type Hsl = { h: number; s: number; l: number };

/** WCAG 1.4.11 minimum for non-text graphics. */
export const MIN_GRAPHIC_CONTRAST = 3;

const clampChannel = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

export const parseHexColor = (value: string): Rgb | null => {
  const hex = value.trim().replace(/^#/, '');
  const normalized =
    hex.length === 3
      ? hex
          .split('')
          .map(char => `${char}${char}`)
          .join('')
      : hex;

  if (normalized.length !== 6 || !/^[0-9a-f]{6}$/i.test(normalized)) return null;

  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
};

const toHex = ({ r, g, b }: Rgb): string =>
  `#${[r, g, b].map(channel => clampChannel(channel).toString(16).padStart(2, '0')).join('')}`;

const toLinear = (channel: number): number => {
  const normalized = channel / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
};

const luminance = ({ r, g, b }: Rgb): number =>
  0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

export const contrastRatio = (a: Rgb, b: Rgb): number => {
  const first = luminance(a);
  const second = luminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
};

const rgbToHsl = ({ r, g, b }: Rgb): Hsl => {
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
  if (max === red) {
    h = ((green - blue) / delta) % 6;
  } else if (max === green) {
    h = (blue - red) / delta + 2;
  } else {
    h = (red - green) / delta + 4;
  }

  return { h: (h * 60 + 360) % 360, s, l };
};

const hueToRgb = (p: number, q: number, t: number): number => {
  let next = t;
  if (next < 0) next += 1;
  if (next > 1) next -= 1;
  if (next < 1 / 6) return p + (q - p) * 6 * next;
  if (next < 1 / 2) return q;
  if (next < 2 / 3) return p + (q - p) * (2 / 3 - next) * 6;
  return p;
};

const hslToRgb = ({ h, s, l }: Hsl): Rgb => {
  if (s === 0) {
    const value = clampChannel(l * 255);
    return { r: value, g: value, b: value };
  }

  const normalizedHue = h / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return {
    r: clampChannel(hueToRgb(p, q, normalizedHue + 1 / 3) * 255),
    g: clampChannel(hueToRgb(p, q, normalizedHue) * 255),
    b: clampChannel(hueToRgb(p, q, normalizedHue - 1 / 3) * 255),
  };
};

/** WCAG 1.4.3 minimum for normal-size text. */
export const MIN_TEXT_CONTRAST = 4.5;

const NEAR_BLACK = '#111827';
const WHITE = '#ffffff';

/** Whether `color` is dark enough that content drawn on it should be light. */
export const isDarkSurface = (color: string): boolean => {
  const rgb = parseHexColor(color);
  return rgb ? luminance(rgb) <= 0.18 : false;
};

/**
 * Whichever of near-black / white is more legible on `background`. Used for CTA
 * labels, which sit on the accent rather than on the screen.
 */
export const readableTextOn = (background: string): string => {
  const surface = parseHexColor(background);
  if (!surface) return WHITE;

  const black = parseHexColor(NEAR_BLACK);
  const white = parseHexColor(WHITE);
  if (!black || !white) return WHITE;

  return contrastRatio(surface, white) >= contrastRatio(surface, black) ? WHITE : NEAR_BLACK;
};

/** Contrast between two hex colours; 1 when either cannot be parsed. */
export const contrastBetween = (a: string, b: string): number => {
  const first = parseHexColor(a);
  const second = parseHexColor(b);
  if (!first || !second) return 1;
  return contrastRatio(first, second);
};

/** `color` at `alpha`, for tinted chip backgrounds. */
export const withAlpha = (color: string, alpha: number): string => {
  const rgb = parseHexColor(color);
  if (!rgb) return color;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
};

const LIGHTNESS_STEP = 0.02;

/**
 * Darken (on a light surface) or lighten (on a dark one) until `color` clears
 * `minRatio` against `background`. Hue and saturation are untouched. Returns the
 * input unchanged when it already passes, or when either colour cannot be
 * parsed — callers should degrade to their own default rather than crash.
 */
export const ensureContrast = (
  color: string,
  background: string,
  minRatio: number = MIN_GRAPHIC_CONTRAST,
): string => {
  const source = parseHexColor(color);
  const surface = parseHexColor(background);

  if (!source || !surface) return color;
  if (contrastRatio(source, surface) >= minRatio) return color;

  const hsl = rgbToHsl(source);
  // A light surface needs a darker accent, and vice versa.
  const darken = luminance(surface) > 0.18;
  let candidate = source;

  for (let step = 1; step <= Math.ceil(1 / LIGHTNESS_STEP); step += 1) {
    const lightness = darken ? hsl.l - step * LIGHTNESS_STEP : hsl.l + step * LIGHTNESS_STEP;
    if (lightness < 0 || lightness > 1) break;

    candidate = hslToRgb({ h: hsl.h, s: hsl.s, l: lightness });
    if (contrastRatio(candidate, surface) >= minRatio) return toHex(candidate);
  }

  // Ramp exhausted (a fully saturated hue can cap out); return the best found.
  return toHex(candidate);
};
