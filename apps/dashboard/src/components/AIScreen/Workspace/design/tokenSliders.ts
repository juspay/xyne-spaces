/**
 * Turning a design's own CSS variables into controls you can drag (XYNE-66834).
 *
 * The controls are generated from the custom properties the DELIVERED DOCUMENT
 * declares, not from a fixed list of names and not from the design system's
 * tokens.css. Two reasons, both learned from what the model actually emits:
 *
 *  - `design-skills/design-system/SKILL.md` tells the model to name tokens by
 *    purpose, and shows `--surface-raised`, `--text-muted`, `--space-3`. Brand
 *    extraction produces `--brand-primary`, `--radius-md`, `--text-display`. A
 *    control list hardcoded to `--radius` / `--primary` / `--font-size-base`
 *    would match none of those.
 *  - Only a variable the document declares can be overridden in the preview. If
 *    the system calls it `--brand-primary` and the artifact calls it
 *    `--color-primary`, a slider built from the system's name moves nothing and
 *    looks broken rather than empty.
 *
 * So this module takes the name/value map the frame reports and decides what
 * each one is, what unit it carries, and what range is sane to drag it through.
 * Pure: no DOM, no CSS parsing, no network.
 */

export type TokenSliderKind = 'radius' | 'accent' | 'spacing' | 'fontSize';

export type TokenSliderUnit = 'px' | 'rem' | 'em' | '%' | 'none';

export interface TokenSliderControl {
  /** The custom property, `--` included, exactly as the document declared it. */
  name: string;
  kind: TokenSliderKind;
  /** The value as declared, which is what Reset restores. */
  originalValue: string;
  /** Short label for the control row — the name without its prefix. */
  label: string;
}

export interface TokenRangeControl extends TokenSliderControl {
  kind: 'radius' | 'spacing' | 'fontSize';
  unit: TokenSliderUnit;
  /** Parsed from `originalValue`; the slider starts here. */
  value: number;
  min: number;
  max: number;
  step: number;
}

export interface TokenColorControl extends TokenSliderControl {
  kind: 'accent';
  /** Six-digit hex, upper case. Only colours we can round-trip become controls. */
  value: string;
}

export type TokenControl = TokenRangeControl | TokenColorControl;

export const isColorControl = (control: TokenControl): control is TokenColorControl =>
  control.kind === 'accent';

/** Names that say outright what they are, most specific first. */
const NAME_PATTERNS: ReadonlyArray<{ kind: TokenSliderKind; pattern: RegExp }> = [
  { kind: 'radius', pattern: /radius|rounded|corner/ },
  { kind: 'spacing', pattern: /spacing|space|gap|gutter|inset/ },
  { kind: 'fontSize', pattern: /font-size|fontsize|text-size|type-scale|leading|line-height/ },
  { kind: 'accent', pattern: /accent|primary|brand/ },
];

/**
 * `--text-*` and `--type-*`, which the house vocabulary uses for BOTH.
 *
 * `--text-muted` is a colour and `--text-display` is a size, so the name alone
 * cannot decide — matching `text` would put a colour on a px slider, and not
 * matching it would drop a real type scale. The value decides: a length is a
 * size, and anything else (a colour, a font stack) is left alone rather than
 * guessed at. Not treated as accent either — muted body text is not the accent
 * anyone is reaching for.
 */
const AMBIGUOUS_TEXT = /^--(text|type|font)-/;

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const LENGTH = /^(-?\d*\.?\d+)(px|rem|em|%)?$/i;

/** Six-digit upper-case hex, or null when the value is not a hex colour we can
 *  put back into the document unchanged. `rgb()`/`hsl()`/`oklch()` are left
 *  alone on purpose: a colour input round-trips hex, and rewriting a declared
 *  `oklch()` as hex would silently narrow the gamut the designer chose. */
export function toHexColor(value: string): string | null {
  const match = HEX.exec(value.trim());
  if (!match) return null;
  const digits = match[1]!;
  const full =
    digits.length === 3
      ? digits
          .split('')
          .map(d => d + d)
          .join('')
      : digits;
  return `#${full.toUpperCase()}`;
}

export interface ParsedLength {
  value: number;
  unit: TokenSliderUnit;
}

/** A single numeric length, or null. Anything compound — `8px 12px`, `calc(...)`,
 *  `clamp(...)` — is not a slider: one number cannot describe it, and writing one
 *  back would throw away the other half. */
export function parseLength(raw: string): ParsedLength | null {
  const match = LENGTH.exec(raw.trim());
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = (match[2]?.toLowerCase() ?? 'none') as TokenSliderUnit;
  return { value, unit };
}

/**
 * Drag ranges, per kind and unit.
 *
 * Each range brackets the declared value rather than replacing it: a design
 * whose radius is already 32px should still be draggable, so the max lifts to
 * fit. Without that, opening the panel would snap an out-of-range token to the
 * nearest bound and silently restyle the design before anyone touched a
 * control.
 */
function rangeFor(
  kind: TokenRangeControl['kind'],
  parsed: ParsedLength,
): {
  min: number;
  max: number;
  step: number;
} {
  const rem = parsed.unit === 'rem' || parsed.unit === 'em';
  if (kind === 'radius') {
    const max = rem ? 3 : 48;
    return { min: 0, max: Math.max(max, Math.ceil(parsed.value)), step: rem ? 0.0625 : 1 };
  }
  if (kind === 'spacing') {
    const max = rem ? 6 : 96;
    return { min: 0, max: Math.max(max, Math.ceil(parsed.value)), step: rem ? 0.0625 : 1 };
  }
  // Font size. The floor is 8, not 0: a 0px type scale is not a design anyone
  // is reaching for with a slider, and a draggable range that spends half its
  // travel on unreadable text is worse than a narrow one.
  const floor = rem ? 0.5 : 8;
  const ceiling = rem ? 6 : 96;
  return {
    min: Math.min(floor, parsed.value),
    max: Math.max(ceiling, Math.ceil(parsed.value)),
    step: rem ? 0.0625 : 1,
  };
}

const labelFor = (name: string): string => name.replace(/^--/, '');

function classify(name: string, value: string): TokenSliderKind | null {
  const lower = name.toLowerCase();
  for (const { kind, pattern } of NAME_PATTERNS) {
    if (pattern.test(lower)) return kind;
  }
  // Decided by the value, not the name. See AMBIGUOUS_TEXT.
  if (AMBIGUOUS_TEXT.test(lower) && parseLength(value)) return 'fontSize';
  return null;
}

/** Control order: accent first, then the geometry, then type. Matches the order
 *  someone reaches for them, and keeps the panel stable as a design changes. */
const KIND_ORDER: Record<TokenSliderKind, number> = {
  accent: 0,
  radius: 1,
  spacing: 2,
  fontSize: 3,
};

/**
 * Controls for the variables worth dragging, in panel order.
 *
 * A declared variable becomes a control only when its name says what it is AND
 * its value is something a control can round-trip. Everything else is skipped
 * rather than guessed at: a control that writes back a value the design cannot
 * use is worse than no control.
 */
export function buildTokenControls(declared: Record<string, string>): TokenControl[] {
  const controls: TokenControl[] = [];

  for (const [name, rawValue] of Object.entries(declared)) {
    const value = rawValue.trim();
    if (!value) continue;
    const kind = classify(name, value);
    if (!kind) continue;

    if (kind === 'accent') {
      const hex = toHexColor(value);
      if (!hex) continue;
      controls.push({ name, kind, originalValue: value, label: labelFor(name), value: hex });
      continue;
    }

    const parsed = parseLength(value);
    if (!parsed) continue;
    // A unitless length is only safe for a scale factor, and these are all
    // absolute lengths — writing `12` back where `12px` was declared would
    // change nothing in CSS and look like a dead slider.
    if (parsed.unit === 'none' || parsed.unit === '%') continue;
    controls.push({
      name,
      kind,
      originalValue: value,
      label: labelFor(name),
      unit: parsed.unit,
      value: parsed.value,
      ...rangeFor(kind, parsed),
    });
  }

  return controls.sort((a, b) => {
    const byKind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    return byKind !== 0 ? byKind : a.name.localeCompare(b.name);
  });
}

/** The value to write for a control at a given slider position. */
export function formatControlValue(control: TokenControl, next: number | string): string {
  if (isColorControl(control)) return String(next);
  const numeric = typeof next === 'number' ? next : Number(next);
  if (!Number.isFinite(numeric)) return control.originalValue;
  // Trailing zeros removed so a rem value reads `0.5rem`, not `0.5000rem`.
  const rounded = Math.round(numeric * 10_000) / 10_000;
  return `${rounded}${control.unit === 'none' ? '' : control.unit}`;
}

/** Only the controls moved away from what the document declared. Reset and Save
 *  both work off this, so a no-op save cannot write a style block. */
export function changedOverrides(
  controls: TokenControl[],
  overrides: Record<string, string>,
): Record<string, string> {
  const changed: Record<string, string> = {};
  for (const control of controls) {
    const next = overrides[control.name];
    if (next === undefined) continue;
    if (next.trim() === control.originalValue.trim()) continue;
    changed[control.name] = next;
  }
  return changed;
}

/** The id of the block "Save to design" writes, so a second save replaces the
 *  first instead of stacking another one on top. */
export const SLIDER_OVERRIDE_STYLE_ID = 'xyne-slider-overrides';

/**
 * Nothing here is written into a document unescaped without passing this first.
 *
 * Values arrive from a model-written stylesheet and travel back into a `<style>`
 * block, so a value carrying `;`, `}` or `<` could close the rule or the element
 * and inject markup into the saved design. Refused rather than escaped: no real
 * token value contains them. Same guard as the design export path in
 * XYNE-66832.
 */
export const isEmittableValue = (value: string): boolean => !/[;{}<>"'\\]/.test(value);

/** `--name` with nothing that could end the declaration or start a selector. */
export const isEmittableName = (name: string): boolean => /^--[A-Za-z0-9_-]{1,80}$/.test(name);

/**
 * A `:root` block for the moved controls, or "" when nothing moved.
 *
 * `!important` because the design's own `:root` rule is already in the document
 * and may be more specific or simply later; the override has to win without
 * rewriting the rule it is overriding, so the original values stay visible in
 * the source for anyone reading the saved file.
 */
export function buildOverrideStyleBlock(overrides: Record<string, string>): string {
  const declarations = Object.entries(overrides)
    .filter(([name, value]) => isEmittableName(name) && isEmittableValue(value))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `  ${name}: ${value.trim()} !important;`);
  if (declarations.length === 0) return '';
  return `:root {\n${declarations.join('\n')}\n}`;
}
