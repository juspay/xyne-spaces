import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { intentKeyFor, type OpenIntent } from '../intent/openIntent.types';
import { parseOpenIntent } from '../intent/parseOpenIntent';

const mustParse = (raw: Record<string, unknown>): OpenIntent => {
  const result = parseOpenIntent(raw);
  assert.equal(result.ok, true, result.ok ? '' : result.error.reason);
  if (!result.ok) {
    throw new Error('parse failed');
  }
  return result.value;
};

describe('parseOpenIntent', (): void => {
  it('classifies an anchor-free link as a channel open with hints only', (): void => {
    const intent = mustParse({ channelId: 'channel-1', source: 'deeplink', openStartedAtMs: 99 });
    assert.equal(intent.surface.kind, 'channel');
    assert.equal(intent.intentKey, 'channel:channel-1');
    assert.equal(intent.hint.messageId, undefined);
    assert.equal(intent.hint.createdAt, undefined);
  });

  it('preserves every external location field without synthesizing a landing cursor', (): void => {
    const intent = mustParse({
      channelId: 'channel-1',
      threadId: 'thread-1',
      origin: 'conversation-1',
      messageId: 'message-1',
      createdAt: 123,
      source: 'deeplink',
    });
    assert.deepEqual(intent.hint, {
      channelId: 'channel-1',
      threadId: 'thread-1',
      conversationId: 'conversation-1',
      messageId: 'message-1',
      createdAt: 123,
    });
  });

  it('rejects a link without a channel identity', (): void => {
    const result = parseOpenIntent({ channelId: '  ', messageId: 'message-1', source: 'deeplink' });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.reason, 'invalid-intent');
    }
  });

  it('preserves notification and Activity as link sources, not landing policies', (): void => {
    const notification = mustParse({
      channelId: 'channel-1',
      origin: 'conversation-1',
      messageId: 'message-1',
      source: 'notification',
    });
    const activity = mustParse({
      channelId: 'channel-1',
      origin: 'conversation-1',
      source: 'activity',
    });
    assert.equal(notification.entry, 'notification');
    assert.equal(activity.entry, 'activity');
  });

  it('computes a stable surface intentKey that ignores the landing message', (): void => {
    const a = mustParse({
      channelId: 'channel-1',
      threadId: 'thread-1',
      messageId: 'm-1',
      source: 'notification',
    });
    const b = mustParse({
      channelId: 'channel-1',
      threadId: 'thread-1',
      messageId: 'm-2',
      source: 'notification',
    });
    assert.equal(a.intentKey, b.intentKey);
    assert.equal(a.intentKey, intentKeyFor(a.surface));
  });

  it('treats a channel replies tap as a local tap', (): void => {
    const intent = mustParse({
      channelId: 'channel-1',
      threadId: 'thread-1',
      from: 'channel_thread',
    });
    assert.equal(intent.entry, 'tap');
    assert.equal(intent.hint.messageId, undefined);
  });

  it('classifies a channel-list unread open from the frozen last-viewed cursor', (): void => {
    const intent = mustParse({
      channelId: 'channel-1',
      source: 'tap',
      unreadOpen: '1',
      unreadCount: '4',
      unreadLastViewedAt: '1700000000000',
      unreadLastViewedConversationId: 'conversation-9',
    });
    assert.equal(intent.hint.unreadBoundaryAt, 1700000000000);
    assert.equal(intent.hint.unreadCount, 4);
    assert.equal(intent.hint.unreadBoundaryConversationId, 'conversation-9');
  });

  it('keeps Activity conversation identity in the hint without a requestedMessage', (): void => {
    const intent = mustParse({
      channelId: 'channel-1',
      origin: 'conversation-1',
      messageId: 'message-1',
      createdAt: 123,
      source: 'activity',
    });
    assert.equal(intent.hint.conversationId, 'conversation-1');
    assert.equal(intent.hint.messageId, 'message-1');
    assert.equal(intent.hint.createdAt, 123);
    assert.equal(intent.entry, 'activity');
  });

  it('treats an unavailable cursor as not-found, not a hanging skeleton', (): void => {
    const parsed = parseOpenIntent({
      channelId: 'channel-1',
      conversationId: 'conversation-1',
      source: 'activity',
      resolving: 'unavailable',
    });
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.equal(parsed.error.reason, 'not-found');
    }
  });
});
