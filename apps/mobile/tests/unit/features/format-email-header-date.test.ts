import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatEmailHeaderDate } from '@/src/features/xyne-desks/detail/utils/format-email-header-date';

describe('formatEmailHeaderDate', () => {
  it('returns an empty short label and "Unknown date" for falsy timestamps', () => {
    const expected = { short: '', full: 'Unknown date' };
    assert.deepEqual(formatEmailHeaderDate(0), expected);
    assert.deepEqual(formatEmailHeaderDate(null), expected);
    assert.deepEqual(formatEmailHeaderDate(undefined), expected);
  });

  it('formats a past date as "d MMM" (short) and a full weekday label', () => {
    // Built from local components so the assertion is timezone-independent.
    // 2020-01-15 is a Wednesday.
    const ts = new Date(2020, 0, 15, 9, 30, 0).getTime();
    assert.deepEqual(formatEmailHeaderDate(ts), {
      short: '15 Jan',
      full: 'Wed, January 15, 2020 at 9:30 AM',
    });
  });

  it("uses a time-only short label ('h:mm aaa') for today's messages", () => {
    const now = new Date();
    const todayAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 5, 0).getTime();
    const { short, full } = formatEmailHeaderDate(todayAt);
    assert.match(short, /^\d{1,2}:\d{2} (am|pm)$/);
    assert.match(full, new RegExp(`${now.getFullYear()}`));
    assert.ok(full.includes(' at '));
  });
});
