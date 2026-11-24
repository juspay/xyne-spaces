import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  scheduleConfirmLabel,
  scheduleDateLabel,
  scheduledPillAccessibilityLabel,
  scheduledPillLabel,
  scheduleWhenLabel,
} from '@/src/features/conversation/model/schedule-time';

// Tuesday 24 Nov 2026, 3:40 pm. Built inside each test, as its other dates
// are: other test files pin TZ when they load.
const now = (): Date => new Date(2026, 10, 24, 15, 40);

describe('scheduleDateLabel', () => {
  it('writes the weekday, day and short month', () => {
    assert.equal(scheduleDateLabel(new Date(2026, 10, 25, 9, 0)), 'Wed 25 Nov');
    assert.equal(scheduleDateLabel(new Date(2026, 10, 30, 9, 0)), 'Mon 30 Nov');
  });
});

describe('scheduleWhenLabel', () => {
  it('adds the clock after a comma', () => {
    assert.equal(scheduleWhenLabel(new Date(2026, 10, 25, 9, 0)), 'Wed 25 Nov, 9:00 am');
    assert.equal(scheduleWhenLabel(new Date(2026, 11, 1, 14, 5)), 'Tue 1 Dec, 2:05 pm');
  });
});

describe('scheduleConfirmLabel', () => {
  it('says when it sends', () => {
    assert.equal(scheduleConfirmLabel(new Date(2026, 10, 25, 9, 0)), 'Sends Wed 25 Nov at 9:00 am');
  });
});

describe('scheduledPillLabel', () => {
  it('says today for later the same day', () => {
    assert.equal(
      scheduledPillLabel(1, new Date(2026, 10, 24, 21, 0), now()),
      'Scheduled for today, 9:00 pm',
    );
  });

  it('says tomorrow for the next day, even just after midnight', () => {
    assert.equal(
      scheduledPillLabel(1, new Date(2026, 10, 25, 9, 0), now()),
      'Scheduled for tomorrow, 9:00 am',
    );
    assert.equal(
      scheduledPillLabel(1, new Date(2026, 10, 25, 0, 5), now()),
      'Scheduled for tomorrow, 12:05 am',
    );
  });

  it('names the weekday up to six days out', () => {
    assert.equal(
      scheduledPillLabel(1, new Date(2026, 10, 27, 9, 0), now()),
      'Scheduled for Fri, 9:00 am',
    );
    assert.equal(
      scheduledPillLabel(1, new Date(2026, 10, 30, 9, 0), now()),
      'Scheduled for Mon, 9:00 am',
    );
  });

  it('writes the date from a week out', () => {
    assert.equal(
      scheduledPillLabel(1, new Date(2026, 11, 1, 9, 0), now()),
      'Scheduled for 1 Dec, 9:00 am',
    );
    assert.equal(
      scheduledPillLabel(1, new Date(2027, 0, 12, 9, 0), now()),
      'Scheduled for 12 Jan, 9:00 am',
    );
  });

  it('counts several and names the next', () => {
    assert.equal(
      scheduledPillLabel(3, new Date(2026, 10, 25, 9, 0), now()),
      '3 scheduled · next tomorrow, 9:00 am',
    );
  });
});

describe('scheduledPillAccessibilityLabel', () => {
  it('reads as a sentence that says what a tap does', () => {
    assert.equal(
      scheduledPillAccessibilityLabel(1, new Date(2026, 10, 25, 9, 0), now()),
      'A message is scheduled for tomorrow at 9:00 am. Opens your scheduled messages.',
    );
    assert.equal(
      scheduledPillAccessibilityLabel(2, new Date(2026, 10, 27, 9, 0), now()),
      '2 messages scheduled, the next Fri at 9:00 am. Opens your scheduled messages.',
    );
  });
});
