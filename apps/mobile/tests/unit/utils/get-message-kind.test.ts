// Pin timezone so calendar-day comparison is deterministic in CI.
process.env['TZ'] = 'UTC';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MessageType, type User } from '@xyne/shared';

import {
  getMessageKind,
  isSameDay,
  isContinuationOf,
} from '@/src/components/message-composer/utils/getMessageKind';
import type { MessageItem } from '@/src/components/message-composer/message-composer.types';

const CURRENT_USER = { id: 'user-self' } as unknown as User;

const item = (overrides: Partial<MessageItem>): MessageItem =>
  ({
    isDeleted: false,
    msgType: MessageType.USER,
    senderId: 'user-other',
    createdAt: Date.parse('2020-06-15T08:30:00Z'),
    ...overrides,
  }) as unknown as MessageItem;

describe('getMessageKind', () => {
  it('classifies deleted / bot / system messages first', () => {
    assert.equal(getMessageKind(item({ isDeleted: true }), CURRENT_USER), 'DELETED');
    assert.equal(getMessageKind(item({ msgType: MessageType.BOT }), CURRENT_USER), 'BOT');
    assert.equal(getMessageKind(item({ msgType: MessageType.SYSTEM }), CURRENT_USER), 'SYSTEM');
  });

  it('distinguishes the current user from others', () => {
    assert.equal(getMessageKind(item({ senderId: 'user-self' }), CURRENT_USER), 'CURRENT_USER');
    assert.equal(getMessageKind(item({ senderId: 'user-other' }), CURRENT_USER), 'OTHER_USER');
  });

  it('treats messages as OTHER_USER when there is no current user', () => {
    assert.equal(getMessageKind(item({ senderId: 'user-self' }), undefined), 'OTHER_USER');
  });
});

describe('isSameDay', () => {
  it('is true within the same calendar day and false across days', () => {
    assert.equal(
      isSameDay(Date.parse('2020-06-15T01:00:00Z'), Date.parse('2020-06-15T23:00:00Z')),
      true,
    );
    assert.equal(
      isSameDay(Date.parse('2020-06-15T23:00:00Z'), Date.parse('2020-06-16T01:00:00Z')),
      false,
    );
  });
});

describe('isContinuationOf', () => {
  const base = item({ senderId: 'u1', msgType: MessageType.USER });

  it('is false without a previous message', () => {
    assert.equal(isContinuationOf(base, undefined), false);
  });

  it('is false when sender or type differ', () => {
    assert.equal(
      isContinuationOf(base, item({ senderId: 'u2', msgType: MessageType.USER })),
      false,
    );
    assert.equal(isContinuationOf(base, item({ senderId: 'u1', msgType: MessageType.BOT })), false);
  });

  it('is true for same sender/type on the same day, false across days', () => {
    assert.equal(
      isContinuationOf(
        item({
          senderId: 'u1',
          msgType: MessageType.USER,
          createdAt: Date.parse('2020-06-15T09:00:00Z'),
        }),
        item({
          senderId: 'u1',
          msgType: MessageType.USER,
          createdAt: Date.parse('2020-06-15T08:00:00Z'),
        }),
      ),
      true,
    );
    assert.equal(
      isContinuationOf(
        item({
          senderId: 'u1',
          msgType: MessageType.USER,
          createdAt: Date.parse('2020-06-16T09:00:00Z'),
        }),
        item({
          senderId: 'u1',
          msgType: MessageType.USER,
          createdAt: Date.parse('2020-06-15T08:00:00Z'),
        }),
      ),
      false,
    );
  });
});
