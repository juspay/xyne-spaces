import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  effectiveChipsForScope,
  scopeToChip,
  scopedPlaceholder,
} from '@/src/features/global-search/utils/scope';
import type { SearchFilterChip, SearchScope } from '@/src/features/global-search/types';

const scope: SearchScope = { channelId: 'chan-1', label: 'engineering' };

const fromChip: SearchFilterChip = {
  id: 'user-1',
  label: 'Ada',
  prefix: 'from:',
  entityType: 'user',
};

const otherInChip: SearchFilterChip = {
  id: 'chan-2',
  label: 'random',
  prefix: 'in:',
  entityType: 'channel',
};

describe('scopeToChip', () => {
  it('builds an in: chip carrying the channel id', () => {
    assert.deepEqual(scopeToChip(scope), {
      id: 'chan-1',
      label: 'engineering',
      prefix: 'in:',
      entityType: 'channel',
    });
  });
});

describe('effectiveChipsForScope', () => {
  it('passes filters through unchanged when there is no scope', () => {
    assert.deepEqual(effectiveChipsForScope([fromChip], null), [fromChip]);
  });

  it('appends exactly one in: chip when scoped', () => {
    const result = effectiveChipsForScope([], scope);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.prefix, 'in:');
    assert.equal(result[0]?.id, 'chan-1');
  });

  it('replaces a user-added in: chip rather than appending it', () => {
    // Regression guard: buildInParam comma-joins in: ids and the backend ORs
    // them, so appending would let a user search outside the scoped channel.
    const result = effectiveChipsForScope([otherInChip], scope);
    const inChips = result.filter(chip => chip.prefix === 'in:');
    assert.equal(inChips.length, 1);
    assert.equal(inChips[0]?.id, 'chan-1');
    assert.ok(!result.some(chip => chip.id === 'chan-2'));
  });

  it('keeps from: chips alongside the scope', () => {
    const result = effectiveChipsForScope([fromChip, otherInChip], scope);
    assert.deepEqual(
      result.map(chip => chip.id),
      ['user-1', 'chan-1'],
    );
  });

  it('does not mutate the input array', () => {
    const filters = [fromChip, otherInChip];
    effectiveChipsForScope(filters, scope);
    assert.equal(filters.length, 2);
  });
});

describe('scopedPlaceholder', () => {
  it('names the conversation', () => {
    assert.equal(scopedPlaceholder(scope), 'Search in engineering');
  });

  it('truncates a long conversation name', () => {
    const long = scopedPlaceholder({ channelId: 'c', label: 'a'.repeat(60) });
    assert.ok(long.length < 'Search in '.length + 60);
    assert.ok(long.endsWith('…'));
  });
});
