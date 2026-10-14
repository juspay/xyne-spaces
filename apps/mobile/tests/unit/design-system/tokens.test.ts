import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { GENERATED_CSS_PATH, generateCss } from '../../../src/design-system/generate';
import { allThemes, resolveTheme } from '../../../src/design-system/tokens/palettes';
import { SEMANTIC_ROLES, cssVar } from '../../../src/design-system/tokens/roles';

const APP_ROOT = resolve(import.meta.dirname, '..', '..', '..');

test('the committed CSS matches the tokens it was generated from', () => {
  assert.equal(
    readFileSync(resolve(APP_ROOT, GENERATED_CSS_PATH), 'utf8'),
    generateCss(),
    'generated/ is stale — run `pnpm run theme:generate` and commit the result',
  );
});

test('every theme defines every role', () => {
  for (const theme of allThemes()) {
    for (const role of SEMANTIC_ROLES) {
      assert.ok(
        typeof theme.roles[role] === 'string' && theme.roles[role].length > 0,
        `theme '${theme.id}' (${theme.mode}) is missing '${role}'`,
      );
    }
  }
});

/**
 * Uniwind builds the `@theme` block that registers Tailwind utilities from the
 * *first* theme only. A role missing there generates no utility class at all,
 * and does so silently — no warning, no build failure, just a class that never
 * matches. `light` is first, so it has to carry the union.
 */
test('the light variant declares every role any variant declares', () => {
  const css = generateCss();
  const blocks = new Map<string, string>();

  for (const match of css.matchAll(/@variant (\w+) \{([^}]*)\}/g)) {
    blocks.set(match[1] ?? '', match[2] ?? '');
  }

  const light = blocks.get('light');
  assert.ok(light !== undefined, 'generated CSS has no `light` variant');

  for (const [variant, block] of blocks) {
    for (const role of SEMANTIC_ROLES) {
      if (!block.includes(cssVar(role))) continue;

      assert.ok(
        light.includes(cssVar(role)),
        `'${cssVar(role)}' is in '${variant}' but not 'light', so it generates no utility class`,
      );
    }
  }
});

test('an unknown stored theme id falls back instead of throwing', () => {
  // A preference outlives the build that wrote it: someone who picks a palette
  // and then installs an older build must still be able to launch.
  const theme = resolveTheme('nope' as never, 'dark');

  assert.equal(theme.variant, 'dark');
  assert.equal(theme.mode, 'dark');
});
