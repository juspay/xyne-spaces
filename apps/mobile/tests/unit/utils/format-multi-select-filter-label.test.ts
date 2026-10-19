import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatMultiSelectFilterLabel } from '@/src/features/xyne-desks/tickets/utils/format-multi-select-filter-label';

describe('formatMultiSelectFilterLabel', () => {
  it('returns the empty label when nothing is selected', () => {
    assert.equal(formatMultiSelectFilterLabel([], 'Stages'), 'Stages');
  });

  it('returns the single selected value, trimmed', () => {
    assert.equal(formatMultiSelectFilterLabel(['Open'], 'Stages'), 'Open');
    assert.equal(formatMultiSelectFilterLabel(['  Open  '], 'Stages'), 'Open');
  });

  it('falls back to the empty label when the only value is blank', () => {
    assert.equal(formatMultiSelectFilterLabel([''], 'Stages'), 'Stages');
    assert.equal(formatMultiSelectFilterLabel(['   '], 'Stages'), 'Stages');
  });

  it('summarizes multiple values as "First + N more"', () => {
    assert.equal(
      formatMultiSelectFilterLabel(['Open', 'Closed', 'Pending'], 'Stages'),
      'Open + 2 more',
    );
  });
});
