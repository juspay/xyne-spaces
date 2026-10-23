import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getChatOpenAttemptId,
  getChatOpenGuardKey,
  releaseChatOpen,
  tryBeginChatOpen,
} from '@/src/utils/chatOpenGuard';

describe('getChatOpenGuardKey', () => {
  it('falls back to the "channel" container when no thread/conversation is given', () => {
    assert.equal(getChatOpenGuardKey({ channelId: 'c1' }), 'c1:channel:');
  });

  it('prefers threadId, then conversationId, for the container segment', () => {
    assert.equal(getChatOpenGuardKey({ channelId: 'c1', threadId: 't1' }), 'c1:t1:');
    assert.equal(getChatOpenGuardKey({ channelId: 'c1', conversationId: 'cv1' }), 'c1:cv1:');
    assert.equal(
      getChatOpenGuardKey({ channelId: 'c1', threadId: 't1', conversationId: 'cv1' }),
      'c1:t1:',
    );
  });

  it('appends the messageId when present', () => {
    assert.equal(
      getChatOpenGuardKey({ channelId: 'c1', threadId: 't1', messageId: 'm1' }),
      'c1:t1:m1',
    );
  });
});

describe('tryBeginChatOpen / getChatOpenAttemptId / releaseChatOpen', () => {
  it('returns an attempt id for a fresh target and null for a duplicate in-flight target', () => {
    const target = { channelId: 'guard-fresh-1' };
    const attemptId = tryBeginChatOpen(target);
    assert.ok(attemptId && /^chat-open-\d+$/.test(attemptId));
    // second tap while still in flight is suppressed
    assert.equal(tryBeginChatOpen(target), null);
    releaseChatOpen(attemptId);
  });

  it('exposes the active attempt id via getChatOpenAttemptId', () => {
    const target = { channelId: 'guard-active-1' };
    assert.equal(getChatOpenAttemptId(target), null);
    const attemptId = tryBeginChatOpen(target);
    assert.equal(getChatOpenAttemptId(target), attemptId);
    releaseChatOpen(attemptId);
    assert.equal(getChatOpenAttemptId(target), null);
  });

  it('allows a new attempt once the previous one is released', () => {
    const target = { channelId: 'guard-release-1' };
    const first = tryBeginChatOpen(target);
    assert.ok(first);
    releaseChatOpen(first);
    const second = tryBeginChatOpen(target);
    assert.ok(second);
    assert.notEqual(second, first);
    releaseChatOpen(second);
  });

  it('scopes the guard by key: different targets do not block each other', () => {
    const a = tryBeginChatOpen({ channelId: 'guard-scope-a' });
    const b = tryBeginChatOpen({ channelId: 'guard-scope-b' });
    assert.ok(a);
    assert.ok(b);
    assert.notEqual(a, b);
    releaseChatOpen(a);
    releaseChatOpen(b);
  });

  it('treats a null/undefined attempt id release as a no-op', () => {
    assert.doesNotThrow(() => releaseChatOpen(null));
    assert.doesNotThrow(() => releaseChatOpen(undefined));
  });
});
