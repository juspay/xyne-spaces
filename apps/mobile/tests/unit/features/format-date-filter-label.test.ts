import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  dateStringToStartMs,
  dateStringToEndMs,
  msToDateInputValue,
  formatShortFilterDate,
  formatDateFilterLabel,
  getDatePresetRange,
  matchDatePreset,
  isDateRangeActive,
} from '@/src/features/xyne-desks/tickets/utils/format-date-filter-label';

// Build timestamps from LOCAL calendar components at noon so locale formatting
// is stable regardless of the runner timezone (noon avoids DST/day-boundary edges).
const localNoon = (y: number, m0: number, d: number) => new Date(y, m0, d, 12, 0, 0).getTime();
const JAN15 = localNoon(2024, 0, 15);
const JAN20 = localNoon(2024, 0, 20);

describe('date string <-> ms helpers', () => {
  it('maps a calendar day to UTC midnight and UTC end-of-day', () => {
    assert.equal(dateStringToStartMs('2024-01-15'), Date.parse('2024-01-15T00:00:00.000Z'));
    assert.equal(dateStringToEndMs('2024-01-15'), Date.parse('2024-01-15T23:59:59.999Z'));
  });

  it('round-trips a UTC-midnight ms back to its date input value', () => {
    assert.equal(msToDateInputValue(dateStringToStartMs('2024-01-15')), '2024-01-15');
  });
});

describe('formatShortFilterDate', () => {
  it('formats a local-noon timestamp as "Mon D, YYYY"', () => {
    assert.equal(formatShortFilterDate(JAN15), 'Jan 15, 2024');
  });
});

describe('formatDateFilterLabel', () => {
  it('returns "Date" when the range is null/empty', () => {
    assert.equal(formatDateFilterLabel(null), 'Date');
    assert.equal(formatDateFilterLabel(undefined), 'Date');
    assert.equal(formatDateFilterLabel({}), 'Date');
  });

  it('formats a custom start..end range with an en-dash separator', () => {
    assert.equal(
      formatDateFilterLabel({ start: JAN15, end: JAN20 }),
      'Jan 15, 2024 \u2013 Jan 20, 2024',
    );
  });

  it('collapses a same-day range to a single date label', () => {
    assert.equal(formatDateFilterLabel({ start: JAN15, end: JAN15 }), 'Jan 15, 2024');
  });

  it('labels an open-ended range with From / Until', () => {
    assert.equal(formatDateFilterLabel({ start: JAN15 }), 'From Jan 15, 2024');
    assert.equal(formatDateFilterLabel({ end: JAN15 }), 'Until Jan 15, 2024');
  });

  it('renders the built-in presets as their canonical labels', () => {
    assert.equal(formatDateFilterLabel(getDatePresetRange('today')), 'Today');
    assert.equal(formatDateFilterLabel(getDatePresetRange('week')), 'Last 7 days');
    assert.equal(formatDateFilterLabel(getDatePresetRange('month')), 'Last 30 days');
  });
});

describe('getDatePresetRange / matchDatePreset', () => {
  it('produces ranges that round-trip back to their preset id', () => {
    assert.equal(matchDatePreset(getDatePresetRange('today')), 'today');
    assert.equal(matchDatePreset(getDatePresetRange('week')), 'week');
    assert.equal(matchDatePreset(getDatePresetRange('month')), 'month');
  });

  it('the "today" preset spans one day minus a millisecond', () => {
    const today = getDatePresetRange('today');
    assert.ok(today.start !== undefined && today.end !== undefined);
    assert.equal(today.end! - today.start!, 24 * 60 * 60 * 1000 - 1);
  });

  it('returns null for a range that matches no preset', () => {
    assert.equal(matchDatePreset({ start: JAN15, end: JAN20 }), null);
  });

  it('returns null when only one bound is present', () => {
    assert.equal(matchDatePreset({ start: JAN15 }), null);
    assert.equal(matchDatePreset({ end: JAN15 }), null);
  });
});

describe('isDateRangeActive', () => {
  it('is false for null / empty ranges', () => {
    assert.equal(isDateRangeActive(null), false);
    assert.equal(isDateRangeActive(undefined), false);
    assert.equal(isDateRangeActive({}), false);
  });

  it('is true when either bound is set', () => {
    assert.equal(isDateRangeActive({ start: JAN15 }), true);
    assert.equal(isDateRangeActive({ end: JAN15 }), true);
  });
});
