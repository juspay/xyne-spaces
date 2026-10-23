/* eslint-disable @typescript-eslint/naming-convention --
   Every fixture here is keyed by a CSS custom property, so `--radius-md` is the
   correct spelling and camelCase would be testing something that cannot occur. */
import { describe, expect, it } from 'vitest';
import {
  buildOverrideStyleBlock,
  buildTokenControls,
  changedOverrides,
  formatControlValue,
  isColorControl,
  isEmittableName,
  isEmittableValue,
  parseLength,
  toHexColor,
  type TokenColorControl,
  type TokenControl,
  type TokenRangeControl,
} from '../tokenSliders';
import { withSliderOverrides } from '../designDocument';

/**
 * The controls are generated from a model-written stylesheet, so the failures
 * that matter are the quiet ones: a slider that moves nothing because the value
 * could not be written back, a colour on a px slider, or a declared value
 * snapped into a range that restyles the design before anyone drags anything.
 */

const range = (controls: TokenControl[], name: string): TokenRangeControl => {
  const found = controls.find(c => c.name === name);
  if (!found || isColorControl(found)) throw new Error(`${name} is not a range control`);
  return found;
};

const color = (controls: TokenControl[], name: string): TokenColorControl => {
  const found = controls.find(c => c.name === name);
  if (!found || !isColorControl(found)) throw new Error(`${name} is not a colour control`);
  return found;
};

describe('toHexColor', () => {
  it('expands and upper-cases', () => {
    expect(toHexColor('#abc')).toBe('#AABBCC');
    expect(toHexColor('  #2563eb ')).toBe('#2563EB');
  });

  it('refuses colours a colour input cannot round-trip', () => {
    // Rewriting a declared oklch() as hex would narrow the gamut the designer
    // chose, so these are left alone rather than approximated.
    for (const value of [
      'rgb(0 0 0)',
      'oklch(0.55 0.02 250)',
      'hsl(210 40% 50%)',
      'red',
      '#12345',
    ]) {
      expect(toHexColor(value)).toBeNull();
    }
  });
});

describe('parseLength', () => {
  it('reads the number and the unit', () => {
    expect(parseLength('8px')).toEqual({ value: 8, unit: 'px' });
    expect(parseLength('0.5rem')).toEqual({ value: 0.5, unit: 'rem' });
    expect(parseLength(' 1.25em ')).toEqual({ value: 1.25, unit: 'em' });
    expect(parseLength('12')).toEqual({ value: 12, unit: 'none' });
  });

  it('refuses anything one number cannot describe', () => {
    // Writing one number back over `8px 12px` would throw away the other half.
    for (const value of ['8px 12px', 'calc(1rem + 2px)', 'clamp(1rem, 2vw, 2rem)', 'auto', '']) {
      expect(parseLength(value)).toBeNull();
    }
  });
});

describe('buildTokenControls', () => {
  it('classifies by what the name says', () => {
    const controls = buildTokenControls({
      '--radius-md': '8px',
      '--space-3': '12px',
      '--font-size-base': '16px',
      '--brand-primary': '#2563eb',
    });
    expect(controls.map(c => [c.name, c.kind])).toEqual([
      ['--brand-primary', 'accent'],
      ['--radius-md', 'radius'],
      ['--space-3', 'spacing'],
      ['--font-size-base', 'fontSize'],
    ]);
  });

  it('matches the vocabulary the design skill actually tells the model to use', () => {
    // --surface-raised / --text-muted / --space-3 are the skill's own examples,
    // and brand extraction emits --brand-* / --radius-* / --text-display. A
    // control list hardcoded to --radius / --primary would match none of them.
    const controls = buildTokenControls({
      '--brand-accent': '#f97316',
      '--rounded-lg': '12px',
      '--gutter': '24px',
      '--text-display': '40px',
    });
    expect(controls.map(c => c.kind)).toEqual(['accent', 'radius', 'spacing', 'fontSize']);
  });

  it('does not put a colour on a length slider', () => {
    // `--text-muted` is a COLOUR in the house vocabulary and `--text-display` is
    // a size. Matching `text` alone would have made the first a px slider.
    const controls = buildTokenControls({ '--text-muted': '#6B7280', '--text-display': '40px' });
    expect(controls.map(c => c.name)).toEqual(['--text-display']);
  });

  it('skips a variable whose value cannot be written back', () => {
    const controls = buildTokenControls({
      '--radius-md': 'clamp(4px, 1vw, 12px)',
      '--space-fluid': 'calc(1rem + 2px)',
      '--brand-primary': 'oklch(0.55 0.02 250)',
      '--radius-sm': '4px',
    });
    // Only the one a slider can honestly drive. A control that writes a value
    // the design cannot use is worse than no control.
    expect(controls.map(c => c.name)).toEqual(['--radius-sm']);
  });

  it('skips a unitless or percentage length', () => {
    // Writing `12` back where `12px` was declared changes nothing in CSS, which
    // reads as a dead slider.
    const controls = buildTokenControls({ '--radius-md': '12', '--space-rel': '50%' });
    expect(controls).toEqual([]);
  });

  it('lets the value decide for a name used by both colours and sizes', () => {
    // --text-* and --font-* carry colours, font stacks AND sizes in the house
    // vocabulary, so the name cannot decide. A length is a size; a font stack
    // is left alone rather than put on a px slider.
    const controls = buildTokenControls({
      '--text-display': '40px',
      '--text-muted': '#6B7280',
      '--font-heading': 'Inter, system-ui, sans-serif',
      '--type-scale-lg': '1.5rem',
    });
    expect(controls.map(c => [c.name, c.kind])).toEqual([
      ['--text-display', 'fontSize'],
      ['--type-scale-lg', 'fontSize'],
    ]);
  });

  it('skips a variable whose name says nothing', () => {
    expect(buildTokenControls({ '--shadow-card': '0 1px 2px rgba(0,0,0,.05)' })).toEqual([]);
    expect(buildTokenControls({ '--duration-fast': '150ms' })).toEqual([]);
  });

  it('ignores an empty declaration', () => {
    expect(buildTokenControls({ '--radius-md': '   ' })).toEqual([]);
  });

  it('keeps the declared value as the original, for Reset', () => {
    const controls = buildTokenControls({ '--radius-md': ' 8px ' });
    expect(range(controls, '--radius-md').originalValue).toBe('8px');
  });

  it('labels a control without the -- prefix', () => {
    expect(buildTokenControls({ '--radius-md': '8px' })[0]?.label).toBe('radius-md');
  });

  describe('ranges', () => {
    it('brackets px lengths sensibly', () => {
      const controls = buildTokenControls({
        '--radius-md': '8px',
        '--space-3': '12px',
        '--font-size-base': '16px',
      });
      expect(range(controls, '--radius-md')).toMatchObject({ min: 0, max: 48, step: 1, value: 8 });
      expect(range(controls, '--space-3')).toMatchObject({ min: 0, max: 96, step: 1 });
      expect(range(controls, '--font-size-base')).toMatchObject({ min: 8, max: 96, step: 1 });
    });

    it('switches to a rem-sized range and a finer step', () => {
      const controls = buildTokenControls({ '--radius-md': '0.5rem' });
      expect(range(controls, '--radius-md')).toMatchObject({
        unit: 'rem',
        value: 0.5,
        max: 3,
        step: 0.0625,
      });
    });

    it('lifts the max to fit a value already past it', () => {
      // Opening the panel must not snap an out-of-range token to the nearest
      // bound — that would restyle the design before anyone touched a control.
      const controls = buildTokenControls({ '--radius-pill': '999px' });
      const control = range(controls, '--radius-pill');
      expect(control.value).toBe(999);
      expect(control.max).toBeGreaterThanOrEqual(999);
    });

    it('drops the font floor to fit a smaller declared value', () => {
      const controls = buildTokenControls({ '--font-size-fine': '6px' });
      const control = range(controls, '--font-size-fine');
      expect(control.min).toBeLessThanOrEqual(6);
      expect(control.value).toBe(6);
    });
  });

  it('orders accent, radius, spacing, then type', () => {
    const controls = buildTokenControls({
      '--font-size-base': '16px',
      '--space-3': '12px',
      '--radius-md': '8px',
      '--brand-primary': '#2563eb',
    });
    expect(controls.map(c => c.kind)).toEqual(['accent', 'radius', 'spacing', 'fontSize']);
  });

  it('orders by name within a kind, so the panel is stable', () => {
    const controls = buildTokenControls({
      '--radius-sm': '4px',
      '--radius-lg': '16px',
      '--radius-md': '8px',
    });
    expect(controls.map(c => c.name)).toEqual(['--radius-lg', '--radius-md', '--radius-sm']);
  });
});

describe('formatControlValue', () => {
  const radius = (): TokenRangeControl =>
    range(buildTokenControls({ '--radius-md': '8px' }), '--radius-md');

  it("appends the control's own unit", () => {
    expect(formatControlValue(radius(), 16)).toBe('16px');
  });

  it('keeps a rem value readable', () => {
    const control = range(buildTokenControls({ '--radius-md': '0.5rem' }), '--radius-md');
    expect(formatControlValue(control, 0.75)).toBe('0.75rem');
    expect(formatControlValue(control, 1)).toBe('1rem');
  });

  it('passes a colour through unchanged', () => {
    const control = color(buildTokenControls({ '--brand-primary': '#2563eb' }), '--brand-primary');
    expect(formatControlValue(control, '#FF0000')).toBe('#FF0000');
  });

  it('falls back to the declared value rather than writing NaN', () => {
    expect(formatControlValue(radius(), Number.NaN)).toBe('8px');
  });
});

describe('changedOverrides', () => {
  const controls = buildTokenControls({ '--radius-md': '8px', '--space-3': '12px' });

  it('keeps only what moved', () => {
    expect(changedOverrides(controls, { '--radius-md': '16px' })).toEqual({
      '--radius-md': '16px',
    });
  });

  it('drops a value dragged back to where it started', () => {
    // Otherwise a round trip would write a style block that changes nothing.
    expect(changedOverrides(controls, { '--radius-md': '8px' })).toEqual({});
    expect(changedOverrides(controls, { '--radius-md': ' 8px ' })).toEqual({});
  });

  it('ignores a name that is not a control', () => {
    expect(changedOverrides(controls, { '--not-a-control': '1px' })).toEqual({});
  });
});

describe('buildOverrideStyleBlock', () => {
  it("writes a :root block that wins over the design's own rule", () => {
    const block = buildOverrideStyleBlock({ '--radius-md': '16px', '--brand-primary': '#FF0000' });
    expect(block).toBe(
      ':root {\n  --brand-primary: #FF0000 !important;\n  --radius-md: 16px !important;\n}',
    );
  });

  it('returns nothing when nothing moved, so no empty block is written', () => {
    expect(buildOverrideStyleBlock({})).toBe('');
  });

  it('refuses a value that could close the rule or the style element', () => {
    // These values travel from a model-written stylesheet back into a <style>
    // block in a saved design.
    const block = buildOverrideStyleBlock({
      '--radius-md': '8px} body{display:none',
      '--brand-primary': '#fff</style><script>alert(1)</script>',
      '--space-3': '12px',
    });
    expect(block).toBe(':root {\n  --space-3: 12px !important;\n}');
    expect(block).not.toContain('script');
    expect(block).not.toContain('display:none');
  });

  it('refuses a name that could start a selector', () => {
    expect(buildOverrideStyleBlock({ '--x}body{color:red': '1px' })).toBe('');
    expect(buildOverrideStyleBlock({ 'not-a-variable': '1px' })).toBe('');
  });
});

describe('emission guards', () => {
  it('accepts ordinary token values and names', () => {
    expect(isEmittableValue('8px')).toBe(true);
    expect(isEmittableValue('#2563EB')).toBe(true);
    expect(isEmittableName('--brand-primary')).toBe(true);
  });

  it('refuses the characters that end a declaration or open a tag', () => {
    for (const value of ['8px;', '8px}', 'a{b', '<script>', 'a"b', "a'b", 'a\\b']) {
      expect(isEmittableValue(value)).toBe(false);
    }
    for (const name of ['brand', '--', '--a b', '--a;b', '']) {
      expect(isEmittableName(name)).toBe(false);
    }
  });
});

describe('withSliderOverrides', () => {
  const DOC =
    '<!DOCTYPE html><html><head><style>:root{--radius-md:8px}</style></head><body><p>hi</p></body></html>';

  it('writes one override block and leaves the original rule readable', () => {
    const saved = withSliderOverrides(DOC, { '--radius-md': '16px' });
    expect(saved).toContain('id="xyne-slider-overrides"');
    expect(saved).toContain('--radius-md: 16px !important;');
    // The model's own values stay in the file, so the saved design still shows
    // what it started from.
    expect(saved).toContain('--radius-md:8px');
  });

  it('replaces its own block instead of stacking another', () => {
    const once = withSliderOverrides(DOC, { '--radius-md': '16px' });
    const twice = withSliderOverrides(once, { '--radius-md': '24px' });
    expect(twice.match(/xyne-slider-overrides/g)).toHaveLength(1);
    expect(twice).toContain('--radius-md: 24px !important;');
    expect(twice).not.toContain('16px !important');
  });

  it('removes the block when everything is reset back', () => {
    const once = withSliderOverrides(DOC, { '--radius-md': '16px' });
    const cleared = withSliderOverrides(once, {});
    expect(cleared).not.toContain('xyne-slider-overrides');
  });

  it('returns the document untouched when there is nothing to do', () => {
    // Re-serializing normalises markup, which would read as a change nobody
    // made.
    expect(withSliderOverrides(DOC, {})).toBe(DOC);
  });

  it('cannot be used to inject markup into a saved design', () => {
    const saved = withSliderOverrides(DOC, {
      '--radius-md': '8px</style><script>alert(1)</script>',
    });
    expect(saved).toBe(DOC);
    expect(saved).not.toContain('alert(1)');
  });
});
