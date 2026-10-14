import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getTicketListItemPosition,
  getTicketListItemBorderRadius,
} from '@/src/features/xyne-desks/tickets/utils/get-ticket-list-item-position';

const OUTER = 12;
const INNER = 3;

describe('getTicketListItemPosition', () => {
  it('returns "single" for a one-item group', () => {
    assert.equal(getTicketListItemPosition(0, 1), 'single');
  });

  it('returns "single" for a degenerate/empty total', () => {
    assert.equal(getTicketListItemPosition(0, 0), 'single');
  });

  it('classifies first / middle / last within a 3-item group', () => {
    assert.equal(getTicketListItemPosition(0, 3), 'first');
    assert.equal(getTicketListItemPosition(1, 3), 'middle');
    assert.equal(getTicketListItemPosition(2, 3), 'last');
  });

  it('has no middle in a 2-item group', () => {
    assert.equal(getTicketListItemPosition(0, 2), 'first');
    assert.equal(getTicketListItemPosition(1, 2), 'last');
  });
});

describe('getTicketListItemBorderRadius', () => {
  it('rounds all four corners with the outer radius for "single"', () => {
    assert.deepEqual(getTicketListItemBorderRadius('single'), {
      borderTopLeftRadius: OUTER,
      borderTopRightRadius: OUTER,
      borderBottomLeftRadius: OUTER,
      borderBottomRightRadius: OUTER,
    });
  });

  it('rounds the top outer and bottom inner for "first"', () => {
    assert.deepEqual(getTicketListItemBorderRadius('first'), {
      borderTopLeftRadius: OUTER,
      borderTopRightRadius: OUTER,
      borderBottomLeftRadius: INNER,
      borderBottomRightRadius: INNER,
    });
  });

  it('uses inner radius on all corners for "middle"', () => {
    assert.deepEqual(getTicketListItemBorderRadius('middle'), {
      borderTopLeftRadius: INNER,
      borderTopRightRadius: INNER,
      borderBottomLeftRadius: INNER,
      borderBottomRightRadius: INNER,
    });
  });

  it('rounds the top inner and bottom outer for "last"', () => {
    assert.deepEqual(getTicketListItemBorderRadius('last'), {
      borderTopLeftRadius: INNER,
      borderTopRightRadius: INNER,
      borderBottomLeftRadius: OUTER,
      borderBottomRightRadius: OUTER,
    });
  });

  it('"first" and "last" are vertical mirrors of each other', () => {
    const first = getTicketListItemBorderRadius('first');
    const last = getTicketListItemBorderRadius('last');
    assert.equal(first.borderTopLeftRadius, last.borderBottomLeftRadius);
    assert.equal(first.borderBottomLeftRadius, last.borderTopLeftRadius);
  });
});
