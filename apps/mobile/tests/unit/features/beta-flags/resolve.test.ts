import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  effectiveGrants,
  revokedFlagKeys,
  visibleBetaFlags,
} from '@/src/features/beta-flags/resolve';
import type { FlagKey } from '@/src/flags/registry';

const catalog = [
  { key: 'ui.shell', label: 'New navigation', description: 'The new bottom bar.' },
  { key: 'not.in.this.build', label: 'Future thing', description: 'Ships later.' },
];

describe('visibleBetaFlags', () => {
  it('shows only what CAC granted', () => {
    assert.deepEqual(visibleBetaFlags(catalog, []), []);
    assert.deepEqual(
      visibleBetaFlags(catalog, ['ui.shell']).map(f => f.key),
      ['ui.shell'],
    );
  });

  it('skips a granted key this build cannot implement', () => {
    // Lets a flag be added to Superposition before the release that implements
    // it, without older installs rendering a switch that does nothing.
    assert.deepEqual(
      visibleBetaFlags(catalog, ['ui.shell', 'not.in.this.build']).map(f => f.key),
      ['ui.shell'],
    );
  });

  it('takes label and description from CAC, so copy changes need no release', () => {
    const [flag] = visibleBetaFlags(catalog, ['ui.shell']);

    assert.equal(flag?.label, 'New navigation');
    assert.equal(flag?.description, 'The new bottom bar.');
  });
});

describe('revokedFlagKeys', () => {
  const on = ['ui.shell'] as FlagKey[];

  it('finds a flag the user has on but is no longer granted', () => {
    assert.deepEqual(revokedFlagKeys([], on), ['ui.shell']);
  });

  it('reports nothing while the grant still stands', () => {
    assert.deepEqual(revokedFlagKeys(['ui.shell'], on), []);
  });

  it('ignores flags the user never turned on', () => {
    assert.deepEqual(revokedFlagKeys([], []), []);
  });
});

describe('effectiveGrants', () => {
  const off = { force: [], disabled: false };

  it('passes the per-user grants through when no global switch is set', () => {
    assert.deepEqual(effectiveGrants(['ui.shell'], off), ['ui.shell']);
  });

  it('forces a flag on for someone whose override does not grant it', () => {
    // The point of `force`: promoting a feature to everyone must not be
    // undone by an existing per-email override, including an empty one.
    assert.deepEqual(effectiveGrants([], { force: ['ui.shell'], disabled: false }), ['ui.shell']);
  });

  it('does not duplicate a flag that is both granted and forced', () => {
    assert.deepEqual(effectiveGrants(['ui.shell'], { force: ['ui.shell'], disabled: false }), [
      'ui.shell',
    ]);
  });

  it('lets disabled win over both grants and force', () => {
    assert.deepEqual(effectiveGrants(['ui.shell'], { force: ['ui.shell'], disabled: true }), []);
  });

  it('revokes everything the user had on once disabled is set', () => {
    const allowed = effectiveGrants(['ui.shell'], { force: [], disabled: true });

    assert.deepEqual(revokedFlagKeys(allowed, ['ui.shell'] as FlagKey[]), ['ui.shell']);
  });
});
