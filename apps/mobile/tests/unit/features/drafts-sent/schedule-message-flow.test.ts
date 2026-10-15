import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { format } from 'date-fns';

import {
  CUSTOM_SCHEDULE_MIN_DELAY_MS,
  MAX_SCHEDULE_AHEAD_MS,
  SCHEDULE_PRESETS,
  defaultCustomScheduleTime,
  formatScheduleConfirmCopy,
  formatScheduledToast,
  formatUpcomingBanner,
  formatUpcomingBannerCount,
  listUpcomingDelayedMessages,
  nextMondayNineAm,
  pickUpcomingDelayedMessage,
  tomorrowNineAm,
  validateScheduledFor,
} from '@/src/features/drafts-sent/schedule-message-utils';
import {
  compareScheduled,
  formatScheduledChip,
  isScheduledDueSoon,
  parseDraftsSentTab,
  sortScheduled,
  type DelayedMessageRow,
} from '@/src/features/drafts-sent/drafts-sent-utils';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Wednesday 2026-08-19 14:30:00 local — mid-week afternoon for preset math. */
const FIXED_NOW = new Date(2026, 7, 19, 14, 30, 0, 0);
const FIXED_NOW_MS = FIXED_NOW.getTime();

const delayedRow = (
  overrides: Partial<{
    id: string;
    channelId: string;
    conversationId: string | null;
    scheduledFor: number;
    status: string;
  }> = {},
): DelayedMessageRow =>
  ({
    id: 'dm-1',
    channelId: 'ch-1',
    conversationId: null,
    scheduledFor: FIXED_NOW_MS + DAY_MS,
    status: 'PENDING',
    content: 'hello',
    updatedAt: FIXED_NOW_MS,
    ...overrides,
  }) as DelayedMessageRow;

describe('schedule presets', () => {
  it('exposes tomorrow and next-monday presets in order', () => {
    assert.deepEqual(
      SCHEDULE_PRESETS.map(preset => preset.id),
      ['tomorrow-9am', 'next-monday-9am'],
    );
  });

  it('keeps the sheet labels users tap in the drawer', () => {
    assert.deepEqual(
      SCHEDULE_PRESETS.map(preset => preset.label),
      ['Tomorrow 9:00 AM', 'Next Monday 9:00 AM'],
    );
  });

  it('computes tomorrow at 9:00 AM local from a fixed now', () => {
    const time = tomorrowNineAm(FIXED_NOW);
    const when = new Date(time);

    assert.equal(when.getFullYear(), 2026);
    assert.equal(when.getMonth(), 7);
    assert.equal(when.getDate(), 20);
    assert.equal(when.getHours(), 9);
    assert.equal(when.getMinutes(), 0);
    assert.equal(when.getSeconds(), 0);
    assert.equal(when.getMilliseconds(), 0);
  });

  it('computes the following Monday at 9:00 AM when today is Wednesday', () => {
    const time = nextMondayNineAm(FIXED_NOW);
    const when = new Date(time);

    assert.equal(when.getDay(), 1);
    assert.equal(when.getDate(), 24);
    assert.equal(when.getHours(), 9);
    assert.equal(when.getMinutes(), 0);
  });

  it('jumps a full week when today is already Monday', () => {
    const monday = new Date(2026, 7, 17, 10, 0, 0, 0);
    const time = nextMondayNineAm(monday);
    const when = new Date(time);

    assert.equal(when.getDay(), 1);
    assert.equal(when.getDate(), 24);
    assert.equal(when.getHours(), 9);
  });

  it('wires preset getTime to the same helpers', () => {
    assert.equal(SCHEDULE_PRESETS[0]?.getTime(FIXED_NOW), tomorrowNineAm(FIXED_NOW));
    assert.equal(SCHEDULE_PRESETS[1]?.getTime(FIXED_NOW), nextMondayNineAm(FIXED_NOW));
  });
});

describe('defaultCustomScheduleTime', () => {
  it('is at least one minute ahead and clears seconds', () => {
    const next = defaultCustomScheduleTime(FIXED_NOW);

    assert.ok(next.getTime() >= FIXED_NOW_MS + CUSTOM_SCHEDULE_MIN_DELAY_MS);
    assert.equal(next.getSeconds(), 0);
    assert.equal(next.getMilliseconds(), 0);
  });
});

describe('validateScheduledFor', () => {
  it('rejects times in the past or equal to now', () => {
    assert.equal(
      validateScheduledFor(FIXED_NOW_MS, FIXED_NOW_MS),
      'Scheduled messages must be in the future.',
    );
    assert.equal(
      validateScheduledFor(FIXED_NOW_MS - MINUTE_MS, FIXED_NOW_MS),
      'Scheduled messages must be in the future.',
    );
  });

  it('rejects times more than 100 days ahead', () => {
    assert.equal(
      validateScheduledFor(FIXED_NOW_MS + MAX_SCHEDULE_AHEAD_MS + MINUTE_MS, FIXED_NOW_MS),
      'You can only schedule up to 100 days ahead.',
    );
  });

  it('allows a time within the valid window', () => {
    assert.equal(validateScheduledFor(FIXED_NOW_MS + HOUR_MS, FIXED_NOW_MS), null);
    assert.equal(validateScheduledFor(FIXED_NOW_MS + MAX_SCHEDULE_AHEAD_MS, FIXED_NOW_MS), null);
  });
});

describe('schedule copy helpers', () => {
  const scheduledFor = new Date(2026, 7, 20, 9, 0, 0, 0).getTime();
  // Format at assertion time. Other unit tests set process TZ while loading,
  // so a label captured here would not match the helper's later format() call.
  const whenLabel = (): string => format(scheduledFor, 'MMM d, yyyy h:mm a');

  it('formats create vs reschedule confirm copy', () => {
    assert.equal(
      formatScheduleConfirmCopy(scheduledFor, 'create'),
      `This message will be sent on ${whenLabel()}.`,
    );
    assert.equal(
      formatScheduleConfirmCopy(scheduledFor, 'reschedule'),
      `This message will be rescheduled to ${whenLabel()}.`,
    );
  });

  it('formats the success toast', () => {
    assert.equal(formatScheduledToast(scheduledFor), `Message scheduled for ${whenLabel()}`);
  });

  it('formats the upcoming banner for a single send time', () => {
    assert.equal(
      formatUpcomingBanner(scheduledFor),
      `Your message will be sent at ${format(scheduledFor, 'h:mm a')} on ${format(scheduledFor, 'MMM d')}.`,
    );
  });

  it('formats upcoming banner counts with pluralization', () => {
    assert.equal(formatUpcomingBannerCount(1), 'You have 1 scheduled message.');
    assert.equal(formatUpcomingBannerCount(3), 'You have 3 scheduled messages.');
  });
});

describe('listUpcomingDelayedMessages', () => {
  const rows = [
    delayedRow({
      id: 'other-channel',
      channelId: 'ch-2',
      scheduledFor: FIXED_NOW_MS + HOUR_MS,
    }),
    delayedRow({
      id: 'past',
      scheduledFor: FIXED_NOW_MS - HOUR_MS,
    }),
    delayedRow({
      id: 'sent',
      status: 'SENT',
      scheduledFor: FIXED_NOW_MS + 2 * HOUR_MS,
    }),
    delayedRow({
      id: 'later',
      scheduledFor: FIXED_NOW_MS + 3 * HOUR_MS,
    }),
    delayedRow({
      id: 'sooner',
      scheduledFor: FIXED_NOW_MS + HOUR_MS,
    }),
    delayedRow({
      id: 'thread',
      conversationId: 'thread-1',
      scheduledFor: FIXED_NOW_MS + 30 * MINUTE_MS,
    }),
  ];

  it('keeps only pending future rows for the channel root conversation', () => {
    const upcoming = listUpcomingDelayedMessages(rows, 'ch-1', null, FIXED_NOW_MS);

    assert.deepEqual(
      upcoming.map(row => row.id),
      ['sooner', 'later'],
    );
  });

  it('scopes thread conversation ids separately from the channel root', () => {
    const upcoming = listUpcomingDelayedMessages(rows, 'ch-1', 'thread-1', FIXED_NOW_MS);

    assert.deepEqual(
      upcoming.map(row => row.id),
      ['thread'],
    );
  });

  it('returns the earliest upcoming row via pickUpcomingDelayedMessage', () => {
    const earliest = pickUpcomingDelayedMessage(rows, 'ch-1', null, FIXED_NOW_MS);
    assert.equal(earliest?.id, 'sooner');
  });

  it('returns undefined when nothing matches', () => {
    assert.equal(pickUpcomingDelayedMessage(rows, 'missing', null, FIXED_NOW_MS), undefined);
  });
});

describe('scheduled list helpers', () => {
  it('sorts pending scheduled rows soonest-first and drops non-pending', () => {
    const sorted = sortScheduled([
      delayedRow({ id: 'b', scheduledFor: FIXED_NOW_MS + 2 * HOUR_MS, status: 'PENDING' }),
      delayedRow({ id: 'done', scheduledFor: FIXED_NOW_MS + HOUR_MS, status: 'SENT' }),
      delayedRow({ id: 'a', scheduledFor: FIXED_NOW_MS + HOUR_MS, status: 'PENDING' }),
    ]);

    assert.deepEqual(
      sorted.map(row => row.id),
      ['a', 'b'],
    );
  });

  it('breaks scheduled ties by id', () => {
    const sameTime = FIXED_NOW_MS + HOUR_MS;
    assert.ok(
      compareScheduled(
        delayedRow({ id: 'a', scheduledFor: sameTime }),
        delayedRow({ id: 'b', scheduledFor: sameTime }),
      ) < 0,
    );
  });

  it('marks due-soon only inside the next hour', () => {
    assert.equal(isScheduledDueSoon(FIXED_NOW_MS + 30 * MINUTE_MS, FIXED_NOW_MS), true);
    assert.equal(isScheduledDueSoon(FIXED_NOW_MS + HOUR_MS, FIXED_NOW_MS), true);
    assert.equal(isScheduledDueSoon(FIXED_NOW_MS + HOUR_MS + 1, FIXED_NOW_MS), false);
    assert.equal(isScheduledDueSoon(FIXED_NOW_MS - MINUTE_MS, FIXED_NOW_MS), false);
  });

  it('formats scheduled chips for today, tomorrow, and other days', () => {
    const now = new Date();

    const today = new Date(now);
    today.setHours(18, 45, 0, 0);
    assert.equal(formatScheduledChip(today.getTime()), `Today, ${format(today, 'h:mm a')}`);

    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    assert.equal(
      formatScheduledChip(tomorrow.getTime()),
      `Tomorrow, ${format(tomorrow, 'h:mm a')}`,
    );

    const later = new Date(now);
    later.setDate(later.getDate() + 10);
    later.setHours(11, 30, 0, 0);
    assert.equal(formatScheduledChip(later.getTime()), format(later, 'MMM d, h:mm a'));
  });

  it('parses the scheduled deep-link tab and defaults unknown values', () => {
    assert.equal(parseDraftsSentTab('scheduled'), 'scheduled');
    assert.equal(parseDraftsSentTab('sent'), 'sent');
    assert.equal(parseDraftsSentTab('drafts'), 'drafts');
    assert.equal(parseDraftsSentTab('twin'), 'twin');
    assert.equal(parseDraftsSentTab('archived'), 'drafts');
    assert.equal(parseDraftsSentTab(undefined), 'drafts');
  });
});
