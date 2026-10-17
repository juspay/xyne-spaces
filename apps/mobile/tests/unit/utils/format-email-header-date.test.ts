// Pin timezone so date-fns format() output is deterministic in CI.
process.env['TZ'] = 'UTC';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatEmailHeaderDate } from '@/src/features/xyne-desks/detail/utils/format-email-header-date';

describe('formatEmailHeaderDate', () => {
  it('returns empty short + "Unknown date" full for missing timestamps', () => {
    const expected = { short: '', full: 'Unknown date' };
    assert.deepEqual(formatEmailHeaderDate(null), expected);
    assert.deepEqual(formatEmailHeaderDate(undefined), expected);
    assert.deepEqual(formatEmailHeaderDate(0), expected);
  });

  it('formats a past (non-today) timestamp with day/month short + full labels', () => {
    // 2020-06-15 is a Monday.
    const ts = Date.parse('2020-06-15T08:30:00Z');
    assert.deepEqual(formatEmailHeaderDate(ts), {
      short: '15 Jun',
      full: 'Mon, June 15, 2020 at 8:30 AM',
    });
  });
});
