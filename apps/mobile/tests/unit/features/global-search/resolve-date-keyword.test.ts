import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveDateKeyword } from '@/src/features/global-search/utils/filter-model';

describe('resolveDateKeyword', () => {
  // Fixed UTC instant so window math is stable across CI timezones.
  const now = new Date('2026-04-15T15:30:00.000Z');

  it('resolves last 7 days to concrete after/before dates', () => {
    const bounds = resolveDateKeyword('last 7 days', now);
    assert.deepEqual(bounds, { after: '2026-04-08', before: '2026-04-15' });
  });

  it('resolves yesterday as a single day', () => {
    const bounds = resolveDateKeyword('yesterday', now);
    assert.deepEqual(bounds, { after: '2026-04-14', before: '2026-04-14' });
  });

  it('returns null for unknown keywords', () => {
    assert.equal(resolveDateKeyword('last hour', now), null);
    assert.equal(resolveDateKeyword('', now), null);
  });
});
