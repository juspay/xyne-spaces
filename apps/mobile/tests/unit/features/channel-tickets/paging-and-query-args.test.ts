import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TicketPriority } from '@xyne/shared';

import {
  CHANNEL_TICKETS_MAX_PAGES,
  CHANNEL_TICKETS_PAGE_SIZE,
} from '@/src/features/channel-tickets/constants';
import {
  buildChannelTicketsPageArgs,
  channelTicketsFiltersKey,
  channelTicketsLimitForPages,
  normalizeStringList,
} from '@/src/features/channel-tickets/query-args';
import {
  computeChannelTicketsPaging,
  nextChannelTicketsPages,
  shouldAutoGrowForClientFilter,
} from '@/src/features/channel-tickets/utils/paging-state';
import {
  CHANNEL_TICKET_COLUMNS,
  CHANNEL_TICKETS_TABLE_WIDTH,
  getChannelTicketColumnMeta,
} from '@/src/features/channel-tickets/columns';

describe('query args', () => {
  it('normalises lists to sorted unique values', () => {
    assert.deepEqual(normalizeStringList(['b', 'a', 'b']), ['a', 'b']);
    assert.deepEqual(normalizeStringList(undefined), []);
  });

  it('adds one sentinel row to the window limit', () => {
    assert.equal(channelTicketsLimitForPages(1), CHANNEL_TICKETS_PAGE_SIZE + 1);
    assert.equal(channelTicketsLimitForPages(3), CHANNEL_TICKETS_PAGE_SIZE * 3 + 1);
    assert.equal(channelTicketsLimitForPages(0), CHANNEL_TICKETS_PAGE_SIZE + 1);
  });

  it('omits empty filter args so the warm-up and the screen share a query key', () => {
    const args = buildChannelTicketsPageArgs('ch-1', true, {}, 1);
    assert.deepEqual(args, {
      channelId: 'ch-1',
      isMember: true,
      limit: CHANNEL_TICKETS_PAGE_SIZE + 1,
      start: null,
      dir: 'forward',
    });
    assert.deepEqual(
      buildChannelTicketsPageArgs('ch-1', true, { assigneeIds: [], priorities: [] }, 1),
      args,
    );
  });

  it('includes normalised filter args when set', () => {
    const args = buildChannelTicketsPageArgs(
      'ch-1',
      false,
      {
        assigneeIds: ['u-2', 'u-1'],
        priorities: [TicketPriority.HIGH, TicketPriority.CRITICAL],
        stageNames: ['Done'],
      },
      2,
    );
    assert.deepEqual(args.assignedTo, ['u-1', 'u-2']);
    assert.deepEqual(args.priority, [TicketPriority.CRITICAL, TicketPriority.HIGH]);
    assert.deepEqual(args.stageName, ['Done']);
    assert.equal(args.isMember, false);
    assert.equal(args.limit, CHANNEL_TICKETS_PAGE_SIZE * 2 + 1);
  });

  it('filters key is order-independent and empty for no filters', () => {
    assert.equal(channelTicketsFiltersKey({}), '||');
    assert.equal(
      channelTicketsFiltersKey({ assigneeIds: ['b', 'a'] }),
      channelTicketsFiltersKey({ assigneeIds: ['a', 'b'] }),
    );
    assert.notEqual(
      channelTicketsFiltersKey({ stageNames: ['x'] }),
      channelTicketsFiltersKey({ assigneeIds: ['x'] }),
    );
  });
});

describe('computeChannelTicketsPaging', () => {
  it('reports more when the sentinel row came back', () => {
    const paging = computeChannelTicketsPaging({
      pages: 1,
      receivedCount: CHANNEL_TICKETS_PAGE_SIZE + 1,
      isComplete: true,
    });
    assert.equal(paging.hasMore, true);
    assert.equal(paging.isLoadingMore, false);
    assert.equal(paging.visibleLimit, CHANNEL_TICKETS_PAGE_SIZE);
  });

  it('reports no more on a short page', () => {
    const paging = computeChannelTicketsPaging({ pages: 1, receivedCount: 7, isComplete: true });
    assert.equal(paging.hasMore, false);
  });

  it('assumes more while a grown window is still loading', () => {
    const paging = computeChannelTicketsPaging({ pages: 2, receivedCount: 51, isComplete: false });
    assert.equal(paging.hasMore, true);
    assert.equal(paging.isLoadingMore, true);
    assert.equal(paging.visibleLimit, CHANNEL_TICKETS_PAGE_SIZE * 2);
  });

  it('is not "loading more" on the very first page', () => {
    const paging = computeChannelTicketsPaging({ pages: 1, receivedCount: 0, isComplete: false });
    assert.equal(paging.isLoadingMore, false);
  });

  it('stops at the cap even when the sentinel is present', () => {
    const paging = computeChannelTicketsPaging({
      pages: CHANNEL_TICKETS_MAX_PAGES,
      receivedCount: CHANNEL_TICKETS_PAGE_SIZE * CHANNEL_TICKETS_MAX_PAGES + 1,
      isComplete: true,
    });
    assert.equal(paging.hasMore, false);
  });
});

describe('nextChannelTicketsPages', () => {
  it('grows by one when more is available and idle', () => {
    assert.equal(
      nextChannelTicketsPages(1, { hasMore: true, isLoadingMore: false, visibleLimit: 50 }),
      2,
    );
  });

  it('holds when nothing more can load or a load is in flight', () => {
    assert.equal(
      nextChannelTicketsPages(3, { hasMore: false, isLoadingMore: false, visibleLimit: 150 }),
      3,
    );
    assert.equal(
      nextChannelTicketsPages(3, { hasMore: true, isLoadingMore: true, visibleLimit: 150 }),
      3,
    );
  });

  it('never exceeds the cap', () => {
    assert.equal(
      nextChannelTicketsPages(CHANNEL_TICKETS_MAX_PAGES, {
        hasMore: true,
        isLoadingMore: false,
        visibleLimit: 500,
      }),
      CHANNEL_TICKETS_MAX_PAGES,
    );
  });
});

describe('shouldAutoGrowForClientFilter', () => {
  const idleMore = { hasMore: true, isLoadingMore: false, visibleLimit: 50 };

  it('grows only when a client filter thinned the page and more exists', () => {
    assert.equal(shouldAutoGrowForClientFilter(3, true, idleMore), true);
    assert.equal(shouldAutoGrowForClientFilter(3, false, idleMore), false);
    assert.equal(shouldAutoGrowForClientFilter(CHANNEL_TICKETS_PAGE_SIZE, true, idleMore), false);
    assert.equal(
      shouldAutoGrowForClientFilter(3, true, { ...idleMore, isLoadingMore: true }),
      false,
    );
    assert.equal(shouldAutoGrowForClientFilter(3, true, { ...idleMore, hasMore: false }), false);
  });
});

describe('columns', () => {
  it('has unique ids whose meta.key matches, and a positive width', () => {
    const ids = new Set<string>();
    for (const column of CHANNEL_TICKET_COLUMNS) {
      assert.equal(ids.has(column.id), false, column.id);
      ids.add(column.id);
      assert.equal(column.meta.key, column.id);
      assert.ok(column.size > 0);
    }
    assert.equal(
      CHANNEL_TICKETS_TABLE_WIDTH,
      CHANNEL_TICKET_COLUMNS.reduce((sum, c) => sum + c.size, 0),
    );
  });

  it('parses meta defensively', () => {
    assert.deepEqual(getChannelTicketColumnMeta({ key: 'age', align: 'center' }), {
      key: 'age',
      align: 'center',
    });
    assert.deepEqual(getChannelTicketColumnMeta({ key: 'ticket' }), {
      key: 'ticket',
      align: 'left',
    });
    assert.equal(getChannelTicketColumnMeta(undefined), null);
    assert.equal(getChannelTicketColumnMeta({}), null);
  });
});
