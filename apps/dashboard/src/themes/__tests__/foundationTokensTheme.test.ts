import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { XYNE_FOUNDATION_TOKENS } from '../XYNE_FOUNDATION_TOKENS';

const globalCss = readFileSync(new URL('../../global.css', import.meta.url), 'utf8');

const THEMED_FAMILIES = ['gray', 'primary', 'purple', 'orange', 'red', 'green', 'yellow'] as const;

const themeColor = (name: string) =>
  globalCss
    .match(new RegExp(`--color-${name}:\\s*([^;]+);`))?.[1]
    ?.trim()
    .toLowerCase();

describe('XYNE_FOUNDATION_TOKENS and the Tailwind theme in global.css', () => {
  for (const family of THEMED_FAMILIES) {
    it(`keeps every xyne-${family} shade in sync`, () => {
      const shades = Object.entries(XYNE_FOUNDATION_TOKENS.colors[family]);
      expect(shades.length).toBeGreaterThan(0);
      for (const [shade, hex] of shades) {
        expect(themeColor(`xyne-${family}-${shade}`), `xyne-${family}-${shade}`).toBe(
          hex.toLowerCase(),
        );
      }
    });
  }
});
