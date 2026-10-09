// Pinned before the module under test is loaded: its Intl formatters are
// built once at import, so they bind whichever timezone is set then — and
// this suite shares a process with tests that set their own.
process.env['TZ'] = 'UTC';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatDmTimestamp, startOfLocalDay } from '@/src/features/dms/model/timestamp';

/** Local time, so the assertions read in the same timezone the code works in. */
function at(year: number, month: number, day: number, hour = 12, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

// A Friday.
const TODAY = startOfLocalDay(at(2026, 10, 9));

describe('formatDmTimestamp', () => {
  it('shows a 12-hour clock time for today', () => {
    assert.equal(formatDmTimestamp(at(2026, 10, 9, 13, 24), TODAY), '1:24 pm');
    assert.equal(formatDmTimestamp(at(2026, 10, 9, 9, 5), TODAY), '9:05 am');
  });

  it('shows Yesterday for the previous calendar day', () => {
    assert.equal(formatDmTimestamp(at(2026, 10, 8, 16, 0), TODAY), 'Yesterday');
  });

  it('counts calendar days, not elapsed hours', () => {
    // 11pm yesterday is two hours before 1am today. Bucketing on elapsed time
    // calls that "today" and prints a clock time for a day that has ended.
    assert.equal(formatDmTimestamp(at(2026, 10, 8, 23, 0), TODAY), 'Yesterday');
  });

  it('names the weekday inside the last seven days', () => {
    assert.equal(formatDmTimestamp(at(2026, 10, 6, 10, 0), TODAY), 'Tuesday');
    assert.equal(formatDmTimestamp(at(2026, 10, 3, 10, 0), TODAY), 'Saturday');
  });

  it('switches to a date on the seventh day, month first', () => {
    // The month abbreviation is the locale's ("Sept" in en-GB, "Sep" in
    // en-US), so it is read from Intl rather than hardcoded. The ordering is
    // ours and is asserted literally: month, space, day — never "22 Sept".
    const monthName = (ms: number): string =>
      new Intl.DateTimeFormat([], { month: 'short' }).format(new Date(ms));

    const sevenDaysAgo = at(2026, 10, 2, 10, 0);
    const older = at(2026, 9, 22, 10, 0);

    assert.equal(formatDmTimestamp(sevenDaysAgo, TODAY), `${monthName(sevenDaysAgo)} 2`);
    assert.equal(formatDmTimestamp(older, TODAY), `${monthName(older)} 22`);
  });

  it('puts the month before the day', () => {
    const label = formatDmTimestamp(at(2026, 9, 22, 10, 0), TODAY);
    assert.match(label, /^[^\d]+ 22$/, `expected "<Month> 22", got "${label}"`);
  });

  it('reads a future timestamp as today rather than as the past', () => {
    assert.equal(formatDmTimestamp(at(2026, 10, 10, 8, 30), TODAY), '8:30 am');
  });

  it('renders nothing for a conversation with no activity', () => {
    assert.equal(formatDmTimestamp(0, TODAY), '');
  });
});
