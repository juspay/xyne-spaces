import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FLOATING_CARD_NAV_BAR_GAP } from '@/src/features/conversation/constants';
import { floatingCardBottom } from '@/src/features/conversation/model/floating-card';

describe('floatingCardBottom', () => {
  it('floats at its gap over a home indicator', () => {
    assert.equal(floatingCardBottom(22, 34, false), 22);
  });

  it('clears a navigation bar that takes taps', () => {
    assert.equal(floatingCardBottom(22, 48, true), 48 + FLOATING_CARD_NAV_BAR_GAP);
  });

  it('keeps its gap above gesture navigation thinner than it', () => {
    assert.equal(floatingCardBottom(22, 0, true), 22);
    assert.equal(floatingCardBottom(26, 16, true), 26);
  });
});
