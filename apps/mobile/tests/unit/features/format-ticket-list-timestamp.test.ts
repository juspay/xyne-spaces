import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatTicketListTimestamp } from '@/src/features/xyne-desks/tickets/utils/format-ticket-list-timestamp';

// Build timestamps from LOCAL date components so the branch (today / yesterday /
// this year / older) is stable regardless of the machine timezone or run date.
const now = new Date();
const atLocal = (y: number, mo: number, d: number, h = 12, mi = 0): number =>
  new Date(y, mo, d, h, mi, 0, 0).getTime();

describe('formatTicketListTimestamp', () => {
  it('returns an empty string for a falsy timestamp', () => {
    assert.equal(formatTicketListTimestamp(0), '');
  });

  it('formats a time today as "h:mm aaa"', () => {
    assert.equal(
      formatTicketListTimestamp(atLocal(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0)),
      '12:00 pm',
    );
    assert.equal(
      formatTicketListTimestamp(atLocal(now.getFullYear(), now.getMonth(), now.getDate(), 9, 5)),
      '9:05 am',
    );
  });

  it('labels yesterday as "Yesterday"', () => {
    assert.equal(
      formatTicketListTimestamp(atLocal(now.getFullYear(), now.getMonth(), now.getDate() - 1)),
      'Yesterday',
    );
  });

  it('formats an earlier date this year as "d MMM" with no year', () => {
    // Pick a day this year that is definitely neither today nor yesterday.
    const ts =
      now.getMonth() >= 3
        ? atLocal(now.getFullYear(), now.getMonth() - 3, 15)
        : atLocal(now.getFullYear(), now.getMonth() + 3, 15);
    const out = formatTicketListTimestamp(ts);
    assert.match(out, /^15 [A-Z][a-z]{2}$/);
    assert.doesNotMatch(out, /\d{4}/);
  });

  it('includes the year for a date in a previous year', () => {
    const lastYear = now.getFullYear() - 1;
    assert.equal(formatTicketListTimestamp(atLocal(lastYear, 5, 15)), `15 Jun ${lastYear}`);
  });
});
