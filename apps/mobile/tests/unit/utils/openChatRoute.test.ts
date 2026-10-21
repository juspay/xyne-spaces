import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import {
  CHAT_OPEN_GUARD_WINDOW_MS,
  getChatOpenAttemptId,
  releaseChatOpen,
  tryBeginChatOpen,
} from '@/src/utils/chatOpenGuard';

describe('chat open guard', () => {
  it('collapses the same target while allowing a different exact message', () => {
    const first = { channelId: 'channel-1', conversationId: 'conversation-1', messageId: 'a' };
    const second = { channelId: 'channel-1', conversationId: 'conversation-1', messageId: 'b' };

    const firstAttempt = tryBeginChatOpen(first);
    const secondAttempt = tryBeginChatOpen(second);
    assert.ok(firstAttempt);
    assert.equal(tryBeginChatOpen(first), null);
    assert.ok(secondAttempt);

    releaseChatOpen(firstAttempt);
    releaseChatOpen(secondAttempt);
  });

  it('allows the same target again after an explicit release', () => {
    const target = { channelId: 'channel-release' };
    const firstAttempt = tryBeginChatOpen(target);
    assert.ok(firstAttempt);
    releaseChatOpen(firstAttempt);
    const secondAttempt = tryBeginChatOpen(target);
    assert.ok(secondAttempt);
    releaseChatOpen(secondAttempt);
  });

  it('can reuse the active attempt when a route push is re-asserted', () => {
    const target = { channelId: 'channel-reassert' };
    const firstAttempt = tryBeginChatOpen(target);
    assert.ok(firstAttempt);
    assert.equal(tryBeginChatOpen(target), null);
    assert.equal(getChatOpenAttemptId(target), firstAttempt);
    releaseChatOpen(firstAttempt);
  });

  it('keeps the guard until the four-second hard cap', () => {
    const target = { channelId: 'channel-timeout' };
    mock.timers.enable({ apis: ['setTimeout'] });

    try {
      const firstAttempt = tryBeginChatOpen(target);
      assert.ok(firstAttempt);
      mock.timers.tick(CHAT_OPEN_GUARD_WINDOW_MS - 1);
      assert.equal(tryBeginChatOpen(target), null);
      mock.timers.tick(1);
      const secondAttempt = tryBeginChatOpen(target);
      assert.ok(secondAttempt);
      releaseChatOpen(secondAttempt);
    } finally {
      mock.timers.reset();
    }
  });

  it('does not let an older route release a newer attempt', () => {
    const target = { channelId: 'channel-stale-release' };
    mock.timers.enable({ apis: ['setTimeout'] });

    try {
      const firstAttempt = tryBeginChatOpen(target);
      assert.ok(firstAttempt);
      mock.timers.tick(CHAT_OPEN_GUARD_WINDOW_MS);

      const secondAttempt = tryBeginChatOpen(target);
      assert.ok(secondAttempt);
      releaseChatOpen(firstAttempt);
      assert.equal(tryBeginChatOpen(target), null);

      releaseChatOpen(secondAttempt);
      const thirdAttempt = tryBeginChatOpen(target);
      assert.ok(thirdAttempt);
      releaseChatOpen(thirdAttempt);
    } finally {
      mock.timers.reset();
    }
  });

  it('releases a resolver attempt by attempt identity', () => {
    const unresolvedTarget = { channelId: 'channel-resolved', messageId: 'message-1' };
    const attempt = tryBeginChatOpen(unresolvedTarget);
    assert.ok(attempt);

    releaseChatOpen(attempt);

    const nextAttempt = tryBeginChatOpen(unresolvedTarget);
    assert.ok(nextAttempt);
    releaseChatOpen(nextAttempt);
  });
});
