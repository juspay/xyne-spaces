jest.mock('@/utils/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));

import { RRule } from 'rrule';
import { atWallClockTime } from './dateUtils';
import { seriesRuleAnchor } from './recurringSeriesAnchor';

const WEEKDAYS = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';

// Mirrors RecurringCallService.getNextOccurrence.
const nextOccurrence = (series: Parameters<typeof seriesRuleAnchor>[0], rule: string, after: Date) => {
  const options = RRule.parseString(rule);
  options.dtstart = seriesRuleAnchor(series);
  return new RRule(options).after(after, false);
};

describe('atWallClockTime', () => {
  it('converts a wall-clock time in a fixed-offset zone', () => {
    expect(atWallClockTime(new Date('2026-08-24T07:30:00Z'), '11:00', 'Asia/Calcutta').toISOString())
      .toBe('2026-08-24T05:30:00.000Z');
  });

  it('uses the calendar day in the target zone, not in UTC', () => {
    // 2026-08-23T19:00Z is already Aug 24 in IST.
    expect(atWallClockTime(new Date('2026-08-23T19:00:00Z'), '00:30', 'Asia/Calcutta').toISOString())
      .toBe('2026-08-23T19:00:00.000Z');
  });

  it('applies the offset in force on that day across a DST change', () => {
    expect(atWallClockTime(new Date('2026-10-23T12:00:00Z'), '09:00', 'Europe/London').toISOString())
      .toBe('2026-10-23T08:00:00.000Z'); // BST
    expect(atWallClockTime(new Date('2026-10-26T12:00:00Z'), '09:00', 'Europe/London').toISOString())
      .toBe('2026-10-26T09:00:00.000Z'); // GMT
  });
});

describe('seriesRuleAnchor', () => {
  // Created at 13:00 IST, later edited to 11:00 (startsOn is intentionally never updated).
  const editedSeries = {
    id: 'standup',
    startsOn: new Date('2026-08-24T07:30:00Z'),
    startTime: '11:00',
    timezone: 'Asia/Calcutta',
  };

  it('takes the time of day from startTime for an edited series', () => {
    expect(seriesRuleAnchor(editedSeries).toISOString()).toBe('2026-08-24T05:30:00.000Z');
  });

  it('does not add a same-day instance at the old time after the last buffered instance', () => {
    // Last instance shifted by the edit: Fri Oct 23, 11:00 IST. Next must be Mon Oct 26, 11:00 IST
    // (it used to come out as Fri Oct 23, 13:00 IST).
    const next = nextOccurrence(editedSeries, WEEKDAYS, new Date('2026-10-23T05:30:00Z'));
    expect(next?.toISOString()).toBe('2026-10-26T05:30:00.000Z');
  });

  it('keeps the exact original instant for an unedited series', () => {
    const startsOn = new Date('2026-08-24T05:30:00.123Z');
    expect(seriesRuleAnchor({ ...editedSeries, startsOn }).toISOString()).toBe(startsOn.toISOString());
  });

  it('falls back to startsOn when the timezone is invalid', () => {
    expect(seriesRuleAnchor({ ...editedSeries, timezone: 'Not/AZone' })).toEqual(editedSeries.startsOn);
  });
});
