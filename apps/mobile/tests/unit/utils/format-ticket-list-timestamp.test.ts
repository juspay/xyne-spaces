process.env['TZ'] = 'UTC';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { formatTicketListTimestamp } from '@/src/features/xyne-desks/tickets/utils/format-ticket-list-timestamp';

describe('formatTicketListTimestamp', () => {
  it('returns empty string for a falsy timestamp', () => {
    assert.equal(formatTicketListTimestamp(0), '');
  });

  it('formats a timestamp that lands today as a "h:mm aaa" clock time', () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 31, 0);
    // TZ pinned to UTC, so local == UTC and the wall clock is deterministic.
    assert.equal(formatTicketListTimestamp(today.getTime()), '2:31 pm');
  });

  it('labels a timestamp from yesterday as "Yesterday"', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(9, 0, 0, 0);
    assert.equal(formatTicketListTimestamp(yesterday.getTime()), 'Yesterday');
  });

  it('formats an older date in the current year as "d MMM" (no year)', () => {
    // Jan 2 of the current year — same year, not today/yesterday for normal run dates.
    const thisYear = new Date(new Date().getFullYear(), 0, 2, 9, 0, 0);
    assert.equal(formatTicketListTimestamp(thisYear.getTime()), '2 Jan');
  });

  it('formats a date from a previous year as "d MMM yyyy"', () => {
    const past = new Date(2000, 0, 15, 9, 0, 0);
    assert.equal(formatTicketListTimestamp(past.getTime()), '15 Jan 2000');
  });
});
