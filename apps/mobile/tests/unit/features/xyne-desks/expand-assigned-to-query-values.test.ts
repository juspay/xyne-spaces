import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { expandAssignedToQueryValues } from '@/src/features/xyne-desks/tickets/utils/expand-assigned-to-query-values';

describe('expandAssignedToQueryValues', () => {
  it('expands bare ids to bare + user: forms', () => {
    assert.deepEqual(expandAssignedToQueryValues(['u-1']), ['u-1', 'user:u-1']);
  });

  it('normalizes prefixed ids and de-duplicates', () => {
    assert.deepEqual(expandAssignedToQueryValues(['user:u-1', 'u-1']), ['u-1', 'user:u-1']);
  });

  it('skips empty values', () => {
    assert.deepEqual(expandAssignedToQueryValues(['', '  ', 'user:']), []);
  });
});
