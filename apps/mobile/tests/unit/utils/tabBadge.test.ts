import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getTabBadgeMinWidth } from '@/src/utils/tabBadge';

describe('getTabBadgeMinWidth', () => {
  it('keeps the native circular size when there is no badge or one digit', () => {
    assert.equal(getTabBadgeMinWidth(undefined), 18);
    assert.equal(getTabBadgeMinWidth('9'), 18);
  });

  it('expands to display two-digit counts without truncation', () => {
    assert.equal(getTabBadgeMinWidth('90'), 24);
    assert.equal(getTabBadgeMinWidth('99'), 24);
  });

  it('expands to display the capped count label', () => {
    assert.equal(getTabBadgeMinWidth('99+'), 32);
  });
});
