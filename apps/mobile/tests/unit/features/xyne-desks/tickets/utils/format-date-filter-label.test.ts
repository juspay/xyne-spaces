import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  dateStringToEndMs,
  dateStringToStartMs,
  formatDateFilterLabel,
  formatShortFilterDate,
  getDatePresetRange,
  isDateRangeActive,
  matchDatePreset,
  msToDateInputValue,
} from '@/src/features/xyne-desks/tickets/utils/format-date-filter-label';

describe('format-date-filter-label / ms conversions', () => {
  it('maps a calendar day to UTC start and end of day', () => {
    assert.equal(dateStringToStartMs('2024-01-15'), Date.UTC(2024, 0, 15, 0, 0, 0, 0));
    assert.equal(dateStringToEndMs('2024-01-15'), Date.UTC(2024, 0, 15, 23, 59, 59, 999));
  });

  it('round-trips a date string through start-ms and back', () => {
    assert.equal(msToDateInputValue(dateStringToStartMs('2024-06-30')), '2024-06-30');
  });

  it('formats a short filter date with month and year', () => {
    const label = formatShortFilterDate(Date.UTC(2024, 5, 15, 12, 0, 0));
    assert.match(label, /Jun/);
    assert.match(label, /2024/);
  });
});

describe('format-date-filter-label / formatDateFilterLabel', () => {
  it('returns "Date" for an empty range', () => {
    assert.equal(formatDateFilterLabel(null), 'Date');
    assert.equal(formatDateFilterLabel(undefined), 'Date');
    assert.equal(formatDateFilterLabel({}), 'Date');
  });

  it('labels preset ranges', () => {
    assert.equal(formatDateFilterLabel(getDatePresetRange('today')), 'Today');
    assert.equal(formatDateFilterLabel(getDatePresetRange('week')), 'Last 7 days');
    assert.equal(formatDateFilterLabel(getDatePresetRange('month')), 'Last 30 days');
  });

  it('collapses a same-day custom range to a single date', () => {
    const day = Date.UTC(2020, 0, 1, 6, 0, 0);
    assert.equal(formatDateFilterLabel({ start: day, end: day }), formatShortFilterDate(day));
  });

  it('renders an inclusive multi-day custom range with a dash', () => {
    const start = Date.UTC(2020, 0, 1, 6, 0, 0);
    const end = Date.UTC(2020, 0, 7, 6, 0, 0);
    assert.match(formatDateFilterLabel({ start, end }), / – /);
  });

  it('renders open-ended ranges', () => {
    const start = Date.UTC(2020, 0, 1, 6, 0, 0);
    const end = Date.UTC(2020, 0, 7, 6, 0, 0);
    assert.match(formatDateFilterLabel({ start }), /^From /);
    assert.match(formatDateFilterLabel({ end }), /^Until /);
  });
});

describe('format-date-filter-label / presets', () => {
  it('produces a today range whose end is one ms before the next day', () => {
    const range = getDatePresetRange('today');
    assert.ok(range.start !== undefined && range.end !== undefined);
    assert.equal((range.end as number) - (range.start as number), 24 * 60 * 60 * 1000 - 1);
  });

  it('spans 7 and 30 days for week and month presets', () => {
    const week = getDatePresetRange('week');
    const month = getDatePresetRange('month');
    const dayMs = 24 * 60 * 60 * 1000;
    assert.ok(week.start !== undefined && week.end !== undefined);
    assert.ok(month.start !== undefined && month.end !== undefined);
    assert.equal(Math.round(((week.end as number) - (week.start as number)) / dayMs), 8);
    assert.equal(Math.round(((month.end as number) - (month.start as number)) / dayMs), 31);
  });

  it('matches a preset range back to its preset name', () => {
    assert.equal(matchDatePreset(getDatePresetRange('today')), 'today');
    assert.equal(matchDatePreset(getDatePresetRange('week')), 'week');
    assert.equal(matchDatePreset(getDatePresetRange('month')), 'month');
  });

  it('returns null when a range does not match any preset', () => {
    assert.equal(matchDatePreset({ start: 0, end: 1000 }), null);
    assert.equal(matchDatePreset({ start: 100 }), null);
  });
});

describe('format-date-filter-label / isDateRangeActive', () => {
  it('is active when either bound is present', () => {
    assert.equal(isDateRangeActive({ start: 1 }), true);
    assert.equal(isDateRangeActive({ end: 1 }), true);
  });

  it('is inactive for empty or nullish ranges', () => {
    assert.equal(isDateRangeActive({}), false);
    assert.equal(isDateRangeActive(null), false);
    assert.equal(isDateRangeActive(undefined), false);
  });
});
