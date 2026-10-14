import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildReminderMessagePreview,
  getPendingReminderFromMetadata,
  getReminderDueInLabel,
  upsertReminderMetadataWithContext,
  type PendingReminderMetadata,
  type ReminderMetadataContext,
} from '@/src/features/chat/v2/components/message-actions-sheet/message-reminder-utils';

const baseContext: ReminderMetadataContext = {
  messagePreview: 'hello',
  conversationId: 'conv-1',
  initialMessageId: 'msg-1',
  channelId: 'chan-1',
};

const asRecord = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;

describe('reminder-utils / upsertReminderMetadataWithContext', () => {
  it('writes an enabled pending reminder with an ISO remindAt', () => {
    const remindAtMs = Date.UTC(2030, 0, 1, 9, 0, 0);
    const next = upsertReminderMetadataWithContext({}, remindAtMs, baseContext);
    const reminder = asRecord(next['reminder']);
    assert.equal(reminder['enabled'], true);
    assert.equal(reminder['status'], 'PENDING');
    assert.equal(reminder['remindAt'], new Date(remindAtMs).toISOString());
    assert.equal(reminder['messagePreview'], 'hello');
    assert.equal(typeof reminder['createdAt'], 'string');
    assert.equal(typeof reminder['updatedAt'], 'string');
  });

  it('preserves a prior createdAt and clears completion/snooze state', () => {
    const previous = {
      reminder: { createdAt: '2020-01-01T00:00:00.000Z' },
      completion: { done: true },
      snoozeUntil: 123,
    };
    const next = upsertReminderMetadataWithContext(previous, Date.UTC(2030, 0, 1), baseContext);
    const reminder = asRecord(next['reminder']);
    assert.equal(reminder['createdAt'], '2020-01-01T00:00:00.000Z');
    assert.equal(next['completion'], undefined);
    assert.equal(next['snoozeUntil'], undefined);
  });

  it('only includes optional context fields when present', () => {
    const minimal = asRecord(upsertReminderMetadataWithContext({}, 1_000, baseContext)['reminder']);
    assert.ok(!('threadId' in minimal));
    assert.ok(!('channelName' in minimal));

    const full = asRecord(
      upsertReminderMetadataWithContext({}, 1_000, {
        ...baseContext,
        threadId: 'th-1',
        channelName: 'general',
        senderName: 'Jane',
      })['reminder'],
    );
    assert.equal(full['threadId'], 'th-1');
    assert.equal(full['channelName'], 'general');
    assert.equal(full['senderName'], 'Jane');
  });
});

describe('reminder-utils / getPendingReminderFromMetadata', () => {
  it('returns the reminder when it is enabled, pending and has a valid remindAt', () => {
    const reminder = getPendingReminderFromMetadata({
      reminder: { enabled: true, status: 'PENDING', remindAt: '2030-01-01T00:00:00.000Z' },
    });
    assert.ok(reminder);
    assert.equal(reminder.status, 'PENDING');
  });

  it('returns null when the reminder is disabled, non-pending or invalid', () => {
    assert.equal(getPendingReminderFromMetadata(null), null);
    assert.equal(getPendingReminderFromMetadata({ reminder: { enabled: false } }), null);
    assert.equal(
      getPendingReminderFromMetadata({ reminder: { enabled: true, status: 'DONE' } }),
      null,
    );
    assert.equal(
      getPendingReminderFromMetadata({
        reminder: { enabled: true, status: 'PENDING', remindAt: 'not-a-date' },
      }),
      null,
    );
  });
});

describe('reminder-utils / getReminderDueInLabel', () => {
  const makeReminder = (remindAt: string): PendingReminderMetadata => ({
    ...baseContext,
    enabled: true,
    status: 'PENDING',
    remindAt,
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
  });

  it('reports "Due now" for a past reminder', () => {
    assert.equal(
      getReminderDueInLabel(makeReminder(new Date(Date.now() - 1000).toISOString())),
      'Due now',
    );
  });

  it('reports minute, hour and day granularity for future reminders', () => {
    assert.match(
      getReminderDueInLabel(makeReminder(new Date(Date.now() + 31 * 60_000).toISOString())),
      /^Due in \d+m$/,
    );
    assert.match(
      getReminderDueInLabel(makeReminder(new Date(Date.now() + 3 * 3_600_000).toISOString())),
      /^Due in \d+h$/,
    );
    assert.match(
      getReminderDueInLabel(makeReminder(new Date(Date.now() + 2 * 86_400_000).toISOString())),
      /^Due in \d+d$/,
    );
  });

  it('reports a calendar date for reminders more than a week out', () => {
    assert.match(
      getReminderDueInLabel(makeReminder(new Date(Date.now() + 30 * 86_400_000).toISOString())),
      /^Due /,
    );
  });

  it('falls back to "Reminder Set" for an unparseable remindAt', () => {
    assert.equal(getReminderDueInLabel(makeReminder('garbage')), 'Reminder Set');
  });
});

describe('reminder-utils / buildReminderMessagePreview', () => {
  it('strips html tags and decodes entities', () => {
    assert.equal(buildReminderMessagePreview('<p>Hello <b>world</b></p>', false), 'Hello world');
    assert.equal(buildReminderMessagePreview('a &amp; b &lt;c&gt;', false), 'a & b <c>');
  });

  it('converts line breaks into spaces', () => {
    assert.equal(buildReminderMessagePreview('a<br/>b', false), 'a b');
  });

  it('extracts emoji alt text', () => {
    assert.equal(
      buildReminderMessagePreview('<img data-emoji="true" alt=":smile:" />', false),
      ':smile:',
    );
  });

  it('falls back to Attachment or Message for empty content', () => {
    assert.equal(buildReminderMessagePreview('', true), 'Attachment');
    assert.equal(buildReminderMessagePreview('   ', false), 'Message');
    assert.equal(buildReminderMessagePreview(null, false), 'Message');
  });

  it('truncates long previews to 140 characters with an ellipsis', () => {
    const preview = buildReminderMessagePreview('a'.repeat(200), false);
    assert.equal(preview.length, 142);
    assert.ok(preview.endsWith('...'));
  });
});
