import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { deriveBubbleAccent, type BubbleAccent } from '@/src/theme/bubbleAccent';
import {
  MIN_GRAPHIC_CONTRAST,
  MIN_TEXT_CONTRAST,
  contrastBetween,
} from '@/src/theme/accent-contrast';

const HEX6 = /^#[0-9a-f]{6}$/;
const RGBA = /^rgba\(\d+, \d+, \d+, [0-9.]+\)$/;
const ACCENT_KEYS: (keyof BubbleAccent)[] = ['accentBg', 'accentFg', 'accentSoft', 'accentText'];

const LIGHT_SURFACE = '#ffffff';
const DARK_SURFACE = '#0b0b0f';

// A spread of saturated and near-neutral bubble colours across both surfaces.
const CASES: ReadonlyArray<readonly [string, string, string]> = [
  ['#3b82f6', 'light', LIGHT_SURFACE],
  ['#3b82f6', 'dark', DARK_SURFACE],
  ['#ef4444', 'light', LIGHT_SURFACE],
  ['#22c55e', 'dark', DARK_SURFACE],
  ['#d8fdd2', 'light', LIGHT_SURFACE],
  ['#134d37', 'dark', DARK_SURFACE],
];

describe('deriveBubbleAccent', () => {
  it('returns the full accent shape with well-formed colour strings', () => {
    for (const [bg, theme, surface] of CASES) {
      const accent = deriveBubbleAccent(bg, theme, surface);
      for (const key of ACCENT_KEYS) {
        assert.equal(typeof accent[key], 'string', `${key} should be a string (${bg}/${theme})`);
      }
      assert.match(accent.accentBg, HEX6, `accentBg hex for ${bg}/${theme}`);
      assert.match(accent.accentText, HEX6, `accentText hex for ${bg}/${theme}`);
      assert.match(accent.accentSoft, RGBA, `accentSoft rgba for ${bg}/${theme}`);
    }
  });

  it('chooses a near-black or white foreground label', () => {
    for (const [bg, theme, surface] of CASES) {
      const { accentFg } = deriveBubbleAccent(bg, theme, surface);
      assert.ok(
        accentFg === '#ffffff' || accentFg === '#111827',
        `accentFg should be black/white, got ${accentFg} for ${bg}/${theme}`,
      );
    }
  });

  it('pins accentBg above the graphic contrast floor against the surface', () => {
    for (const [bg, theme, surface] of CASES) {
      const { accentBg } = deriveBubbleAccent(bg, theme, surface);
      const ratio = contrastBetween(accentBg, surface);
      // ensureContrast steps in 0.02 lightness increments; allow a hairline for hex rounding.
      assert.ok(
        ratio >= MIN_GRAPHIC_CONTRAST - 0.1,
        `accentBg/${surface} contrast ${ratio.toFixed(2)} < ${MIN_GRAPHIC_CONTRAST} for ${bg}/${theme}`,
      );
    }
  });

  it('pins accentText above the stricter text contrast floor against the surface', () => {
    for (const [bg, theme, surface] of CASES) {
      const { accentText } = deriveBubbleAccent(bg, theme, surface);
      const ratio = contrastBetween(accentText, surface);
      assert.ok(
        ratio >= MIN_TEXT_CONTRAST - 0.1,
        `accentText/${surface} contrast ${ratio.toFixed(2)} < ${MIN_TEXT_CONTRAST} for ${bg}/${theme}`,
      );
    }
  });

  it('keeps the accent label readable against its own fill', () => {
    for (const [bg, theme, surface] of CASES) {
      const { accentBg, accentFg } = deriveBubbleAccent(bg, theme, surface);
      const ratio = contrastBetween(accentFg, accentBg);
      assert.ok(
        ratio >= MIN_TEXT_CONTRAST - 0.1,
        `accentFg/accentBg contrast ${ratio.toFixed(2)} too low for ${bg}/${theme}`,
      );
    }
  });

  it('is deterministic for identical inputs', () => {
    assert.deepEqual(
      deriveBubbleAccent('#3b82f6', 'light', LIGHT_SURFACE),
      deriveBubbleAccent('#3b82f6', 'light', LIGHT_SURFACE),
    );
  });
});
