import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { LOTUS_USER_ID_STORAGE_KEY, toRouteTargetFromMessage } from '@/src/notifications/tapCache';
import type { ParsedMessage } from '@/src/notifications/types';

const asMessage = (value: Partial<ParsedMessage>): ParsedMessage =>
  ({
    channelId: 'c1',
    isThread: false,
    notificationId: 'n1',
    rawData: {},
    ...value,
  }) as ParsedMessage;

describe('LOTUS_USER_ID_STORAGE_KEY', () => {
  it('is a stable storage key', () => {
    assert.equal(LOTUS_USER_ID_STORAGE_KEY, '@lotus_user_id');
  });
});

describe('toRouteTargetFromMessage', () => {
  it('returns null when the channel id is blank', () => {
    assert.equal(toRouteTargetFromMessage(asMessage({ channelId: '   ' })), null);
    assert.equal(toRouteTargetFromMessage(asMessage({ channelId: '' })), null);
  });

  it('routes a non-thread message to its conversation with createdAt', () => {
    const target = toRouteTargetFromMessage(
      asMessage({
        channelId: 'c1',
        conversationId: 'conv1',
        conversationCreatedAt: 1699999999999,
      }),
    );
    assert.deepEqual(target, {
      channelId: 'c1',
      conversationId: 'conv1',
      createdAt: '1699999999999',
    });
  });

  it('routes a thread message to its threadId and omits the conversation', () => {
    const target = toRouteTargetFromMessage(
      asMessage({
        channelId: 'c1',
        isThread: true,
        threadId: 'th1',
        conversationId: 'conv1',
        conversationCreatedAt: 1699999999999,
      }),
    );
    assert.deepEqual(target, {
      channelId: 'c1',
      threadId: 'th1',
      createdAt: '1699999999999',
    });
  });

  it('falls back to conversationId as the thread target when threadId is missing', () => {
    const target = toRouteTargetFromMessage(
      asMessage({ channelId: 'c1', isThread: true, conversationId: 'conv1' }),
    );
    assert.deepEqual(target, { channelId: 'c1', threadId: 'conv1' });
  });

  it('includes a ticketId resolved from the raw notification data', () => {
    const target = toRouteTargetFromMessage(
      asMessage({ channelId: 'c1', rawData: { ticketId: 'T1' } }),
    );
    assert.deepEqual(target, { channelId: 'c1', ticketId: 'T1' });
  });

  it('passes through messageId and scopeType when present', () => {
    const target = toRouteTargetFromMessage(
      asMessage({ channelId: 'c1', messageId: 'm1', scopeType: 'DM' }),
    );
    assert.deepEqual(target, { channelId: 'c1', messageId: 'm1', scopeType: 'DM' });
  });

  it('copies FCM metadata and server notification identity for header-resolve logs', () => {
    const metadata =
      '{"channelId":"c1","conversationId":"conv1","messageId":"m1","senderName":"Ada","channelTitle":"ms_testing"}';
    const target = toRouteTargetFromMessage(
      asMessage({
        channelId: 'c1',
        type: 'THREAD_REPLY',
        backendNotificationId: 'notif-server-1',
        notificationId: 'tray-slot-channel-id',
        rawData: {
          notificationId: 'notif-server-1',
          type: 'THREAD_REPLY',
          metadata,
        },
      }),
    );
    assert.deepEqual(target, {
      channelId: 'c1',
      notificationId: 'notif-server-1',
      notificationType: 'THREAD_REPLY',
      metadata,
    });
  });

  it('falls back to cached thread ticket id when payload omits ticketId', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../../src/notifications/tapCache.ts', import.meta.url)),
      'utf8',
    );
    assert.equal(/getCachedThreadTicketId/.test(source), true);
    const target = toRouteTargetFromMessage(
      asMessage({
        channelId: 'c1',
        isThread: true,
        threadId: 'th1',
        messageId: 'm1',
      }),
    );
    assert.equal(target?.threadId, 'th1');
    assert.equal(target?.messageId, 'm1');
    assert.equal('ticketId' in (target ?? {}), false);
  });
});
