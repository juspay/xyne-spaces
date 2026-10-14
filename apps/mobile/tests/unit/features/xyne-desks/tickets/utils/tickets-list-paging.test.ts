import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TICKETS_MAX_PAGES, TICKETS_PAGE_SIZE } from '@/src/features/xyne-desks/tickets/constants';
import {
  computeTicketsListPaging,
  nextTicketsListPages,
  shouldAutoGrowTicketsList,
  ticketsListLimitForPages,
} from '@/src/features/xyne-desks/tickets/utils/tickets-list-paging';

describe('ticketsListLimitForPages', () => {
  it('adds one sentinel row to the window', () => {
    assert.equal(ticketsListLimitForPages(1), TICKETS_PAGE_SIZE + 1);
    assert.equal(ticketsListLimitForPages(3), TICKETS_PAGE_SIZE * 3 + 1);
    assert.equal(ticketsListLimitForPages(0), TICKETS_PAGE_SIZE + 1);
  });
});

describe('computeTicketsListPaging', () => {
  it('reports more when the sentinel row came back', () => {
    const paging = computeTicketsListPaging({
      pages: 1,
      receivedCount: TICKETS_PAGE_SIZE + 1,
      isComplete: true,
    });
    assert.equal(paging.hasMore, true);
    assert.equal(paging.visibleLimit, TICKETS_PAGE_SIZE);
  });

  it('reports no more on a short page', () => {
    assert.equal(
      computeTicketsListPaging({ pages: 1, receivedCount: 7, isComplete: true }).hasMore,
      false,
    );
  });

  it('assumes more while a grown window is still loading', () => {
    const paging = computeTicketsListPaging({
      pages: 2,
      receivedCount: 51,
      isComplete: false,
    });
    assert.equal(paging.hasMore, true);
    assert.equal(paging.isLoadingMore, true);
  });
});

describe('nextTicketsListPages', () => {
  it('grows by one when more is available and idle', () => {
    assert.equal(
      nextTicketsListPages(1, { hasMore: true, isLoadingMore: false, visibleLimit: 50 }),
      2,
    );
  });

  it('never exceeds the cap', () => {
    assert.equal(
      nextTicketsListPages(TICKETS_MAX_PAGES, {
        hasMore: true,
        isLoadingMore: false,
        visibleLimit: 500,
      }),
      TICKETS_MAX_PAGES,
    );
  });
});

describe('shouldAutoGrowTicketsList', () => {
  const idleMore = { hasMore: true, isLoadingMore: false, visibleLimit: 50 };

  it('grows when Inbox/All Mail or dates thinned the page', () => {
    assert.equal(shouldAutoGrowTicketsList(3, true, idleMore), true);
    assert.equal(shouldAutoGrowTicketsList(3, false, idleMore), false);
    assert.equal(shouldAutoGrowTicketsList(TICKETS_PAGE_SIZE, true, idleMore), false);
  });
});
