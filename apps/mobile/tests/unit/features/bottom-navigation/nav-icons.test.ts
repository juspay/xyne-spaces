import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

/**
 * Reads the icons as text rather than importing them: they pull in
 * `react-native-svg`, and these are the pure logic tests.
 */
const ICON_DIR = path.join(process.cwd(), 'src/features/bottom-navigation/icons');

/** Takes opacity as a prop on purpose — it is a grip affordance, not a destination. */
const ALLOWED_OPACITY = new Set(['drag-icon.tsx']);

function iconFiles(): string[] {
  return readdirSync(ICON_DIR).filter(name => name.endsWith('.tsx'));
}

describe('bottom navigation icons', () => {
  it('bakes no opacity into the artwork', () => {
    const offenders = iconFiles().filter(name => {
      if (ALLOWED_OPACITY.has(name)) return false;
      return /opacity=\{[\d.]+\}|opacity="[\d.]+"/u.test(
        readFileSync(path.join(ICON_DIR, name), 'utf8'),
      );
    });

    assert.deepEqual(
      offenders,
      [],
      `These icons dim themselves, so the colour the bar passes cannot reach full
strength and they read as faded beside the others. Figma exports a group with
an opacity; drop it and let the palette decide:\n  ${offenders.join('\n  ')}`,
    );
  });

  it('draws every stroked destination icon at the shared stroke weight', () => {
    const offenders = iconFiles()
      .filter(name => name !== 'drag-icon.tsx')
      .filter(name => {
        const source = readFileSync(path.join(ICON_DIR, name), 'utf8');
        // A filled icon has no outline to weight, so the rule binds only the
        // ones that stroke. Every destination icon strokes today; this keeps a
        // future filled one from being reported as a violation.
        if (!source.includes('stroke={')) return false;
        return !source.includes('strokeWidth = NAV_ICON_STROKE_WIDTH');
      });

    assert.deepEqual(
      offenders,
      [],
      `These icons default to their own stroke weight instead of the shared one,
which is what made some look lighter than their neighbours in the pill:\n  ${offenders.join('\n  ')}`,
    );
  });
});

/**
 * The pill highlight is set optimistically on tap and only corrected when
 * navigation changes `activeIndex`. A destination that pushes a screen never
 * changes it, so `useActiveTab` has to know which pills switch tab and which
 * do not. That branch only matters while such destinations exist.
 */
describe('pushable destinations', () => {
  it('keeps at least one destination that pushes instead of switching tab', () => {
    const source = readFileSync(path.join(ICON_DIR, '..', 'model', 'catalog.ts'), 'utf8');

    assert.ok(
      source.includes('externalHref:'),
      `No destination pushes a screen any more. If that is deliberate, the
\`switchesTab\` branch in use-active-tab.ts is dead and should go with it.`,
    );
  });
});
