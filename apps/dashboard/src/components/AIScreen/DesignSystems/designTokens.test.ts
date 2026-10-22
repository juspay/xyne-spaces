import { describe, expect, it } from 'vitest';

import {
  familyOf,
  formatCreatedAt,
  normalizeHex,
  orderedPalette,
  parseDesignTokens,
  readCustomProperties,
  sourceLabel,
  stripCssComments,
  toHex,
  type TokenColor,
} from './designTokens';

const TOKENS = `
:root {
  --brand-primary: #2563EB;
  --brand-accent: #f97316;
  --brand-background: #FFFFFF;
  --brand-text: rgb(15, 23, 42);
  --brand-border: #e2e8f0;
  --font-heading: Inter, system-ui, sans-serif;
  --font-body: "Source Sans 3", Helvetica, sans-serif;
  --radius-card: 8px;
  --space-3: 12px;
  --shadow-card: 0 1px 2px rgba(0,0,0,.05);
  --text-display: 40px;
}
`;

describe('stripCssComments', () => {
  it('removes a closed comment and keeps the rest', () => {
    expect(stripCssComments('a /* note */ b')).toBe('a  b');
  });

  it('treats an unterminated comment as running to the end', () => {
    expect(stripCssComments('a /* note')).toBe('a ');
  });

  it('stays fast on many unclosed openers', () => {
    const started = Date.now();
    stripCssComments('x'.repeat(100) + '/*a/'.repeat(120_000));
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe('normalizeHex', () => {
  it.each([
    ['#abc', '#AABBCC'],
    ['#AABBCC', '#AABBCC'],
    ['#aabbccdd', '#AABBCC'],
    ['#abcd', '#AABBCC'],
    ['  #2563eb  ', '#2563EB'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeHex(input)).toBe(expected);
  });

  it.each(['', '#ab', '#gggggg', 'rgb(0,0,0)', 'red'])('returns null for %s', input => {
    expect(normalizeHex(input)).toBeNull();
  });
});

describe('toHex', () => {
  it.each([
    ['rgb(15, 23, 42)', '#0F172A'],
    ['rgba(37, 99, 235, 0.5)', '#2563EB'],
    ['rgb(100%, 0%, 0%)', '#FF0000'],
  ])('converts %s to %s', (input, expected) => {
    expect(toHex(input)).toBe(expected);
  });

  it.each(['hsl(210 40% 50%)', 'oklch(0.55 0.02 250)', 'rgb(1,2)', 'rgb(300,0,0)'])(
    'returns null for %s it cannot resolve',
    input => {
      expect(toHex(input)).toBeNull();
    },
  );
});

describe('familyOf', () => {
  it.each([
    ['Inter, system-ui, sans-serif', 'Inter'],
    ['"Source Sans 3", Helvetica', 'Source Sans 3'],
    ["'Fira Code'", 'Fira Code'],
  ])('takes the first family of %s', (stack, expected) => {
    expect(familyOf(stack)).toBe(expected);
  });
});

describe('readCustomProperties', () => {
  it('reads each declaration once, first value winning', () => {
    const props = readCustomProperties(':root{--a:1px;--b:2px}.x{--a:9px}');
    expect(props).toEqual([
      { token: 'a', value: '1px' },
      { token: 'b', value: '2px' },
    ]);
  });

  it('ignores a commented-out declaration', () => {
    const props = readCustomProperties(':root{ /* --ghost: #000; */ --real: #FFF; }');
    expect(props.map(p => p.token)).toEqual(['real']);
  });
});

describe('parseDesignTokens', () => {
  it.each([null, undefined, '', '   '])('reports empty for %s', input => {
    expect(parseDesignTokens(input).isEmpty).toBe(true);
  });

  it('reports empty for css that holds no custom properties', () => {
    expect(parseDesignTokens('body { color: red; }').isEmpty).toBe(true);
  });

  it('sorts colours into the palette with their roles and hexes', () => {
    const { colors } = parseDesignTokens(TOKENS);
    expect(colors.map(c => [c.token, c.role, c.hex])).toEqual([
      ['brand-primary', 'primary', '#2563EB'],
      ['brand-accent', 'accent', '#F97316'],
      ['brand-background', 'background', '#FFFFFF'],
      ['brand-text', 'text', '#0F172A'],
      ['brand-border', 'border', '#E2E8F0'],
    ]);
  });

  it('keeps the raw value for a colour it cannot turn into a hex', () => {
    const { colors } = parseDesignTokens(':root{--brand-muted: oklch(0.55 0.02 250);}');
    expect(colors[0]).toMatchObject({
      role: 'muted',
      hex: null,
      value: 'oklch(0.55 0.02 250)',
    });
  });

  it('separates fonts, radii, spacing, shadows and type steps', () => {
    const tokens = parseDesignTokens(TOKENS);
    expect(tokens.fonts.map(f => f.family)).toEqual(['Inter', 'Source Sans 3']);
    expect(tokens.radii.map(r => r.token)).toEqual(['radius-card']);
    expect(tokens.spacing.map(s => s.token)).toEqual(['space-3']);
    expect(tokens.shadows.map(s => s.token)).toEqual(['shadow-card']);
    expect(tokens.typeSteps.map(t => t.token)).toEqual(['text-display']);
    expect(tokens.isEmpty).toBe(false);
  });

  it.each([
    ['--brand-text-muted', 'muted'],
    ['--brand-muted-text', 'text'],
    ['--surface-background', 'background'],
    ['--brand-primary', 'primary'],
  ])('resolves %s to the most specific role, not the first listed', (token, role) => {
    const { colors } = parseDesignTokens(`:root{${token}: #123456;}`);
    expect(colors[0]?.role).toBe(role);
  });

  it('does not mistake a font token for a colour', () => {
    const { colors, fonts } = parseDesignTokens(":root{--font-mono: 'Fira Code', monospace;}");
    expect(colors).toEqual([]);
    expect(fonts).toHaveLength(1);
  });
});

describe('orderedPalette', () => {
  it('puts known roles in brand order and unknown tokens last', () => {
    const colors = [
      { token: 'zz-custom', value: '#111', hex: '#111111', role: null },
      { token: 'brand-text', value: '#222', hex: '#222222', role: 'text' },
      { token: 'brand-primary', value: '#333', hex: '#333333', role: 'primary' },
    ] as TokenColor[];
    expect(orderedPalette(colors).map(c => c.token)).toEqual([
      'brand-primary',
      'brand-text',
      'zz-custom',
    ]);
  });

  it('leaves the input array untouched', () => {
    const colors = [
      { token: 'b', value: '#222', hex: '#222222', role: 'text' },
      { token: 'a', value: '#111', hex: '#111111', role: 'primary' },
    ] as TokenColor[];
    orderedPalette(colors);
    expect(colors.map(c => c.token)).toEqual(['b', 'a']);
  });
});

describe('sourceLabel', () => {
  it.each([
    ['url', 'Website'],
    ['repo', 'Repository'],
    ['screenshot', 'Screenshot'],
    ['manual', 'Manual'],
  ])('labels %s as %s', (source, expected) => {
    expect(sourceLabel(source)).toBe(expected);
  });

  it('falls back to a source it does not know', () => {
    expect(sourceLabel('figma')).toBe('figma');
  });
});

describe('formatCreatedAt', () => {
  it('returns a readable date', () => {
    expect(formatCreatedAt('2026-01-15T10:00:00.000Z')).not.toBe('');
  });

  it('returns an empty string for an unusable value', () => {
    expect(formatCreatedAt('not-a-date')).toBe('');
  });
});
