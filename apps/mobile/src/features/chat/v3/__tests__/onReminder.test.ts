import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyReminder } from '../overlays/onReminder';

const context = {
  messagePreview: 'hello',
  conversationId: 'c1',
  initialMessageId: 'm1',
  channelId: 'ch',
};

describe('applyReminder', (): void => {
  it('adds when there is no bookmark, and updates an active one', (): void => {
    const calls: unknown[] = [];
    const deps = {
      zero: {
        mutate: (payload: unknown): void => {
          calls.push(payload);
        },
      } as never,
      createId: (): string => 'bookmark-1',
      now: (): number => 9,
    };
    assert.equal(
      applyReminder(deps, { messageId: 'm1', remindAtMs: 1_000, existing: null, context }),
      'add',
    );
    assert.equal(
      applyReminder(deps, {
        messageId: 'm1',
        remindAtMs: 2_000,
        existing: { metadata: { reminder: { createdAt: '2020-01-01T00:00:00.000Z' } } },
        context,
      }),
      'update',
    );
    assert.equal(calls.length, 2);
  });

  it('adds again when the existing bookmark is deleted or completed', (): void => {
    const deps = {
      zero: { mutate: (): void => undefined } as never,
      createId: (): string => 'bookmark-2',
      now: (): number => 9,
    };
    assert.equal(
      applyReminder(deps, {
        messageId: 'm1',
        remindAtMs: 1_000,
        existing: { metadata: {}, isDeleted: true },
        context,
      }),
      'add',
    );
    assert.equal(
      applyReminder(deps, {
        messageId: 'm1',
        remindAtMs: 1_000,
        existing: { metadata: {}, isCompleted: true },
        context,
      }),
      'add',
    );
  });
});
