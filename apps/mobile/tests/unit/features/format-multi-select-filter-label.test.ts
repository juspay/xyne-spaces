import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatMultiSelectFilterLabel } from '@/src/features/xyne-desks/tickets/utils/format-multi-select-filter-label';

describe('formatMultiSelectFilterLabel', () => {
  it('returns the empty label when there are no values', () => {
    assert.equal(formatMultiSelectFilterLabel([], 'Stages'), 'Stages');
  });

  it('returns the single value when there is exactly one', () => {
    assert.equal(formatMultiSelectFilterLabel(['Open'], 'Stages'), 'Open');
  });

  it('trims the single value', () => {
    assert.equal(formatMultiSelectFilterLabel(['  Open  '], 'Stages'), 'Open');
  });

  it('falls back to the empty label when the single value is blank', () => {
    assert.equal(formatMultiSelectFilterLabel(['  '], 'Stages'), 'Stages');
  });

  it('returns "First + N more" for multiple values', () => {
    assert.equal(formatMultiSelectFilterLabel(['Open', 'Closed', 'X'], 'Stages'), 'Open + 2 more');
  });

  it('uses the raw (untrimmed-count) remainder for the "+ N more" suffix', () => {
    assert.equal(formatMultiSelectFilterLabel(['A', 'B'], 'Stages'), 'A + 1 more');
  });

  it('honours a different empty label', () => {
    assert.equal(formatMultiSelectFilterLabel([], 'Tags'), 'Tags');
  });
});
