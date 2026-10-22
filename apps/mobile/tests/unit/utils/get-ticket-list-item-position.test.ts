import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getTicketListItemPosition,
  getTicketListItemBorderRadius,
} from '@/src/features/xyne-desks/tickets/utils/get-ticket-list-item-position';
import {
  TICKET_LIST_CARD_RADIUS,
  TICKET_LIST_CORNER_RADIUS_DEFAULT,
} from '@/src/features/xyne-desks/tickets/constants';

const OUTER = TICKET_LIST_CARD_RADIUS;
const INNER = TICKET_LIST_CORNER_RADIUS_DEFAULT;

describe('getTicketListItemPosition', () => {
  it('treats a one-item (or empty) list as a single card', () => {
    assert.equal(getTicketListItemPosition(0, 1), 'single');
    assert.equal(getTicketListItemPosition(0, 0), 'single');
  });

  it('classifies first / middle / last within a group', () => {
    assert.equal(getTicketListItemPosition(0, 3), 'first');
    assert.equal(getTicketListItemPosition(1, 3), 'middle');
    assert.equal(getTicketListItemPosition(2, 3), 'last');
  });
});

describe('getTicketListItemBorderRadius', () => {
  it('rounds all corners for a single card', () => {
    assert.deepEqual(getTicketListItemBorderRadius('single'), {
      borderTopLeftRadius: OUTER,
      borderTopRightRadius: OUTER,
      borderBottomLeftRadius: OUTER,
      borderBottomRightRadius: OUTER,
    });
  });

  it('rounds only the outer edge for first and last cards', () => {
    assert.deepEqual(getTicketListItemBorderRadius('first'), {
      borderTopLeftRadius: OUTER,
      borderTopRightRadius: OUTER,
      borderBottomLeftRadius: INNER,
      borderBottomRightRadius: INNER,
    });
    assert.deepEqual(getTicketListItemBorderRadius('last'), {
      borderTopLeftRadius: INNER,
      borderTopRightRadius: INNER,
      borderBottomLeftRadius: OUTER,
      borderBottomRightRadius: OUTER,
    });
  });

  it('keeps all corners tight for middle cards', () => {
    assert.deepEqual(getTicketListItemBorderRadius('middle'), {
      borderTopLeftRadius: INNER,
      borderTopRightRadius: INNER,
      borderBottomLeftRadius: INNER,
      borderBottomRightRadius: INNER,
    });
  });
});
