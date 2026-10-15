import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  upsertReminderMetadataWithContext,
  getPendingReminderFromMetadata,
  getReminderDueInLabel,
  buildReminderMessagePreview,
  type PendingReminderMetadata,
  type ReminderMetadataContext,
} from '@/src/features/chat/v2/components/message-actions-sheet/message-reminder-utils';

const context = (overrides: Partial<ReminderMetadataContext> = {}): ReminderMetadataContext => ({
  messagePreview: 'Ship the release',
  conversationId: 'conv-1',
  initialMessageId: 'msg-1',
  channelId: 'chan-1',
  ...overrides,
});

describe('upsertReminderMetadataWithContext', () => {
  it('writes an enabled PENDING reminder carrying the context', () => {
    const remindAt = Date.UTC(2030, 0, 1, 9, 0, 0);
    const result = upsertReminderMetadataWithContext({}, remindAt, context());
    const reminder = result['reminder'] as Record<string, unknown>;

    assert.equal(reminder['enabled'], true);
    assert.equal(reminder['status'], 'PENDING');
    assert.equal(reminder['remindAt'], new Date(remindAt).toISOString());
    assert.equal(reminder['messagePreview'], 'Ship the release');
    assert.equal(reminder['conversationId'], 'conv-1');
    assert.equal(reminder['initialMessageId'], 'msg-1');
    assert.equal(reminder['channelId'], 'chan-1');
  });

  it('omits optional context fields that are not provided', () => {
    const result = upsertReminderMetadataWithContext({}, Date.now() + 1000, context());
    const reminder = result['reminder'] as Record<string, unknown>;
    assert.equal('threadId' in reminder, false);
    assert.equal('channelName' in reminder, false);
    assert.equal('senderName' in reminder, false);
  });

  it('includes optional context fields when present', () => {
    const result = upsertReminderMetadataWithContext(
      {},
      Date.now() + 1000,
      context({ threadId: 'thread-1', channelName: 'general', senderName: 'Ada' }),
    );
    const reminder = result['reminder'] as Record<string, unknown>;
    assert.equal(reminder['threadId'], 'thread-1');
    assert.equal(reminder['channelName'], 'general');
    assert.equal(reminder['senderName'], 'Ada');
  });

  it('preserves an existing createdAt while advancing updatedAt', () => {
    const existing = {
      reminder: { createdAt: '2020-01-01T00:00:00.000Z' },
    };
    const result = upsertReminderMetadataWithContext(existing, Date.now() + 1000, context());
    const reminder = result['reminder'] as Record<string, unknown>;
    assert.equal(reminder['createdAt'], '2020-01-01T00:00:00.000Z');
    assert.notEqual(reminder['updatedAt'], '2020-01-01T00:00:00.000Z');
  });

  it('clears stale completion and snooze markers on re-arm', () => {
    const existing = { completion: { done: true }, snoozeUntil: '2020-01-01T00:00:00.000Z' };
    const result = upsertReminderMetadataWithContext(existing, Date.now() + 1000, context());
    assert.equal('completion' in result, false);
    assert.equal('snoozeUntil' in result, false);
  });

  it('treats non-object metadata as empty', () => {
    const result = upsertReminderMetadataWithContext(null, Date.now() + 1000, context());
    assert.equal(typeof result['reminder'], 'object');
  });
});

describe('getPendingReminderFromMetadata', () => {
  const validReminder = (remindAt: string) => ({
    reminder: {
      enabled: true,
      status: 'PENDING',
      remindAt,
      messagePreview: 'x',
      conversationId: 'c',
      initialMessageId: 'm',
      channelId: 'ch',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    },
  });

  it('returns the reminder when enabled, PENDING, and parseable', () => {
    const remindAt = new Date(Date.now() + 60_000).toISOString();
    const result = getPendingReminderFromMetadata(validReminder(remindAt));
    assert.notEqual(result, null);
    assert.equal((result as PendingReminderMetadata).status, 'PENDING');
  });

  it('returns null when disabled', () => {
    const md = validReminder(new Date().toISOString());
    md.reminder.enabled = false;
    assert.equal(getPendingReminderFromMetadata(md), null);
  });

  it('returns null when status is not PENDING', () => {
    const md = validReminder(new Date().toISOString());
    (md.reminder as { status: string }).status = 'SENT';
    assert.equal(getPendingReminderFromMetadata(md), null);
  });

  it('returns null when remindAt is not a valid timestamp', () => {
    assert.equal(getPendingReminderFromMetadata(validReminder('not-a-date')), null);
  });

  it('returns null for absent or malformed metadata', () => {
    assert.equal(getPendingReminderFromMetadata(null), null);
    assert.equal(getPendingReminderFromMetadata({}), null);
  });
});

describe('getReminderDueInLabel', () => {
  const make = (remindAt: string): PendingReminderMetadata =>
    ({
      enabled: true,
      status: 'PENDING',
      remindAt,
      messagePreview: 'x',
      conversationId: 'c',
      initialMessageId: 'm',
      channelId: 'ch',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    }) satisfies PendingReminderMetadata;

  it('reports "Due now" when the time has passed', () => {
    assert.equal(getReminderDueInLabel(make(new Date(Date.now() - 1000).toISOString())), 'Due now');
  });

  it('reports minutes for sub-hour windows', () => {
    assert.equal(
      getReminderDueInLabel(make(new Date(Date.now() + 30 * 60_000).toISOString())),
      'Due in 30m',
    );
  });

  it('reports hours for sub-day windows', () => {
    assert.equal(
      getReminderDueInLabel(make(new Date(Date.now() + 5 * 60 * 60_000).toISOString())),
      'Due in 5h',
    );
  });

  it('reports days for sub-week windows', () => {
    assert.equal(
      getReminderDueInLabel(make(new Date(Date.now() + 3 * 24 * 60 * 60_000).toISOString())),
      'Due in 3d',
    );
  });

  it('falls back to "Reminder Set" for an unparseable remindAt', () => {
    assert.equal(getReminderDueInLabel(make('not-a-date')), 'Reminder Set');
  });
});

describe('buildReminderMessagePreview', () => {
  it('strips tags and decodes entities to plain text', () => {
    assert.equal(
      buildReminderMessagePreview('<p>Hello&nbsp;<b>world</b> &amp; more</p>', false),
      'Hello world & more',
    );
  });

  it('turns <br> and block closes into spaces via newline collapse', () => {
    assert.equal(buildReminderMessagePreview('line1<br>line2', false), 'line1 line2');
  });

  it('keeps custom-emoji alt text', () => {
    assert.equal(
      buildReminderMessagePreview('<img data-emoji="true" alt=":tada:" src="x"> party', false),
      ':tada: party',
    );
  });

  it('falls back to Attachment when empty and an attachment exists', () => {
    assert.equal(buildReminderMessagePreview('', true), 'Attachment');
  });

  it('falls back to Message when empty and no attachment', () => {
    assert.equal(buildReminderMessagePreview(null, false), 'Message');
  });

  it('truncates overly long previews with an ellipsis', () => {
    const long = 'a'.repeat(200);
    const preview = buildReminderMessagePreview(long, false);
    assert.equal(preview.length, 142);
    assert.ok(preview.endsWith('...'));
  });
});
