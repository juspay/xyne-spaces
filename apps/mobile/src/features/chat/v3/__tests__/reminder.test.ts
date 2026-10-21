import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CUSTOM_REMINDER_DEFAULT_DELAY_MS as v2Delay,
  REMINDER_PRESETS as v2Presets,
} from '@/src/features/chat/v2/components/message-actions-sheet/message-reminder-config';
import {
  buildReminderMessagePreview as v2Preview,
  getPendingReminderFromMetadata as v2Pending,
  getReminderDueInLabel as v2Label,
  upsertReminderMetadataWithContext as v2Upsert,
} from '@/src/features/chat/v2/components/message-actions-sheet/message-reminder-utils';

import {
  CUSTOM_REMINDER_DEFAULT_DELAY_MS,
  REMINDER_PRESETS,
  buildReminderMessagePreview,
  getPendingReminderFromMetadata,
  getReminderDueInLabel,
  isFutureReminder,
  mergeDatePart,
  mergeTimePart,
  reminderLabelByMessageId,
  upsertReminderMetadataWithContext,
} from '../model/reminder';

const pendingMeta = {
  reminder: {
    enabled: true,
    status: 'PENDING',
    remindAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  },
};

const context = {
  messagePreview: 'hello',
  conversationId: 'conv-1',
  initialMessageId: 'msg-1',
  channelId: 'chan-1',
};

const withoutTimestamps = (metadata: Record<string, unknown>): Record<string, unknown> => {
  const reminder = { ...(metadata['reminder'] as Record<string, unknown>) };
  delete reminder['createdAt'];
  delete reminder['updatedAt'];
  return { ...metadata, reminder };
};

describe('§8.1 reminder read-path', (): void => {
  it('matches v2 pending detection', (): void => {
    const ours = getPendingReminderFromMetadata(pendingMeta);
    const theirs = v2Pending(pendingMeta);
    assert.ok(ours);
    assert.ok(theirs);
    assert.equal(ours.remindAt, theirs.remindAt);
    assert.equal(ours.status, theirs.status);
    assert.equal(getPendingReminderFromMetadata({ reminder: { enabled: false } }), null);
    assert.equal(v2Pending({ reminder: { enabled: false } }), null);
  });

  it('keeps legacy numeric reminder timestamps readable', (): void => {
    const legacy = {
      reminder: { enabled: true, status: 'PENDING', remindAt: Date.now() + 60_000 },
    };
    assert.deepEqual(getPendingReminderFromMetadata(legacy), v2Pending(legacy));
  });

  it('matches v2 due labels at the same instant', (): void => {
    const pending = getPendingReminderFromMetadata(pendingMeta);
    const v2 = v2Pending(pendingMeta);
    assert.ok(pending && v2);
    assert.equal(getReminderDueInLabel(pending), v2Label(v2));
  });

  it('indexes reminder copy by message id', (): void => {
    const labels = reminderLabelByMessageId([
      { entityId: 'm1', entityType: 'MESSAGE', metadata: pendingMeta },
      { entityId: 'm2', entityType: 'TICKET', metadata: pendingMeta },
    ]);
    assert.equal(labels.has('m1'), true);
    assert.equal(labels.get('m1')?.startsWith('Reminder Set - '), true);
    assert.equal(labels.has('m2'), false);
  });
});

describe('§8.1 reminder write-path', (): void => {
  it('matches v2 upsert shape (ignoring generated timestamps)', (): void => {
    const remindAtMs = Date.UTC(2030, 0, 1, 9, 0, 0);
    const previous = {
      reminder: { createdAt: '2020-01-01T00:00:00.000Z' },
      completion: { done: true },
      snoozeUntil: 123,
    };
    const ours = upsertReminderMetadataWithContext(previous, remindAtMs, {
      ...context,
      threadId: 'th-1',
      senderName: 'Ada',
    });
    const theirs = v2Upsert(previous, remindAtMs, {
      ...context,
      threadId: 'th-1',
      senderName: 'Ada',
    });
    assert.deepEqual(withoutTimestamps(ours), withoutTimestamps(theirs));
    assert.equal(
      (ours['reminder'] as Record<string, unknown>)['createdAt'],
      '2020-01-01T00:00:00.000Z',
    );
    assert.equal(ours['completion'], undefined);
    assert.equal(ours['snoozeUntil'], undefined);
  });

  it('matches v2 preview stripping, fallback, and truncation', (): void => {
    const samples: [string | null, boolean][] = [
      ['<p>Hello <b>world</b></p>', false],
      ['a &amp; b &lt;c&gt;', false],
      ['a<br/>b', false],
      ['<img data-emoji="true" alt=":smile:" />', false],
      ['', true],
      ['   ', false],
      [null, false],
      ['a'.repeat(200), false],
    ];
    for (const [content, hasAttachment] of samples) {
      assert.equal(
        buildReminderMessagePreview(content, hasAttachment),
        v2Preview(content, hasAttachment),
      );
    }
  });

  it('adopts v2 preset ids, labels, and the custom default delay', (): void => {
    assert.deepEqual(
      REMINDER_PRESETS.map(item => item.id),
      v2Presets.map(item => item.id),
    );
    assert.deepEqual(
      REMINDER_PRESETS.map(item => item.label),
      v2Presets.map(item => item.label),
    );
    assert.equal(CUSTOM_REMINDER_DEFAULT_DELAY_MS, v2Delay);
  });

  it('merges date/time parts and rejects a non-future custom time', (): void => {
    const current = new Date(2030, 0, 1, 15, 30, 0);
    const datePart = mergeDatePart(current, new Date(2030, 5, 15, 0, 0, 0));
    assert.equal(datePart.getFullYear(), 2030);
    assert.equal(datePart.getMonth(), 5);
    assert.equal(datePart.getDate(), 15);
    const timePart = mergeTimePart(current, new Date(2030, 0, 1, 9, 5, 0));
    assert.equal(timePart.getHours(), 9);
    assert.equal(timePart.getMinutes(), 5);
    assert.equal(isFutureReminder(10, 10), false);
    assert.equal(isFutureReminder(11, 10), true);
  });
});
