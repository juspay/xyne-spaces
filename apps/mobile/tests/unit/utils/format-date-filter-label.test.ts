// Pin timezone so toLocaleDateString / UTC-midnight parsing is deterministic in CI.
process.env['TZ'] = 'UTC';

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

describe('dateStringToStartMs / dateStringToEndMs', () => {
  it('maps a calendar day to UTC midnight and end-of-day', () => {
    assert.equal(dateStringToStartMs('2021-06-15'), Date.parse('2021-06-15T00:00:00.000Z'));
    assert.equal(dateStringToEndMs('2021-06-15'), Date.parse('2021-06-15T23:59:59.999Z'));
  });
});

describe('msToDateInputValue', () => {
  it('renders the UTC calendar day as YYYY-MM-DD', () => {
    assert.equal(msToDateInputValue(Date.parse('2021-06-15T12:34:00.000Z')), '2021-06-15');
  });
});

describe('formatShortFilterDate', () => {
  it('formats as "Mon D, YYYY"', () => {
    assert.equal(formatShortFilterDate(Date.parse('2021-06-15T00:00:00.000Z')), 'Jun 15, 2021');
  });
});

describe('formatDateFilterLabel', () => {
  it('returns "Date" when the range is empty', () => {
    assert.equal(formatDateFilterLabel(null), 'Date');
    assert.equal(formatDateFilterLabel(undefined), 'Date');
    assert.equal(formatDateFilterLabel({}), 'Date');
  });

  it('labels the built-in presets', () => {
    assert.equal(formatDateFilterLabel(getDatePresetRange('today')), 'Today');
    assert.equal(formatDateFilterLabel(getDatePresetRange('week')), 'Last 7 days');
    assert.equal(formatDateFilterLabel(getDatePresetRange('month')), 'Last 30 days');
  });

  it('collapses a custom single-day range to one date', () => {
    const day = Date.parse('2021-06-15T00:00:00.000Z');
    assert.equal(formatDateFilterLabel({ start: day, end: day }), 'Jun 15, 2021');
  });

  it('renders a custom start–end range with an en dash', () => {
    assert.equal(
      formatDateFilterLabel({
        start: Date.parse('2021-06-15T00:00:00.000Z'),
        end: Date.parse('2021-06-20T00:00:00.000Z'),
      }),
      'Jun 15, 2021 – Jun 20, 2021',
    );
  });

  it('labels open-ended ranges', () => {
    assert.equal(
      formatDateFilterLabel({ start: Date.parse('2021-06-15T00:00:00.000Z') }),
      'From Jun 15, 2021',
    );
    assert.equal(
      formatDateFilterLabel({ end: Date.parse('2021-06-15T00:00:00.000Z') }),
      'Until Jun 15, 2021',
    );
  });
});

describe('matchDatePreset', () => {
  it('recognizes each preset from its own generated range', () => {
    assert.equal(matchDatePreset(getDatePresetRange('today')), 'today');
    assert.equal(matchDatePreset(getDatePresetRange('week')), 'week');
    assert.equal(matchDatePreset(getDatePresetRange('month')), 'month');
  });

  it('returns null for a partial or non-preset range', () => {
    assert.equal(matchDatePreset({ start: 1 }), null);
    assert.equal(
      matchDatePreset({
        start: Date.parse('2021-06-15T00:00:00.000Z'),
        end: Date.parse('2021-06-20T00:00:00.000Z'),
      }),
      null,
    );
  });
});

describe('isDateRangeActive', () => {
  it('is true when either bound is set', () => {
    assert.equal(isDateRangeActive({ start: 1 }), true);
    assert.equal(isDateRangeActive({ end: 1 }), true);
  });

  it('is false for empty or nullish ranges', () => {
    assert.equal(isDateRangeActive({}), false);
    assert.equal(isDateRangeActive(null), false);
    assert.equal(isDateRangeActive(undefined), false);
  });
});
