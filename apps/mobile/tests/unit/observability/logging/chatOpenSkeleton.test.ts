import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  abandonChatOpenSkeleton,
  beginChatOpenSkeleton,
  completeChatOpenSkeleton,
  resetChatOpenSkeleton,
  subscribeChatOpenSkeletonCompleted,
} from '@/src/observability/logging/chat/chatOpenSkeleton';

afterEach(() => {
  resetChatOpenSkeleton();
});

describe('chatOpenSkeleton', () => {
  it('records placeholder visible time when the list is revealed', () => {
    beginChatOpenSkeleton({
      identityKey: 'channel-1',
      surface: 'channel',
      entry: 'direct',
      nowMs: 100,
    });

    const completed = completeChatOpenSkeleton({
      identityKey: 'channel-1',
      surface: 'channel',
      nowMs: 480,
    });

    assert.deepEqual(completed, {
      durationMs: 380,
      outcome: 'revealed',
      surface: 'channel',
      entry: 'direct',
    });
  });

  it('does not complete a cache-hit open that never showed a skeleton', () => {
    assert.equal(
      completeChatOpenSkeleton({ identityKey: 'channel-1', surface: 'channel', nowMs: 200 }),
      null,
    );
  });

  it('does not restart T0 while the same placeholder stays visible', () => {
    beginChatOpenSkeleton({
      identityKey: 'channel-1',
      surface: 'channel',
      entry: 'direct',
      nowMs: 100,
    });
    beginChatOpenSkeleton({
      identityKey: 'channel-1',
      surface: 'channel',
      entry: 'direct',
      nowMs: 250,
    });

    const completed = completeChatOpenSkeleton({
      identityKey: 'channel-1',
      surface: 'channel',
      nowMs: 400,
    });

    assert.equal(completed?.durationMs, 300);
  });

  it('tracks channel and thread placeholders independently', () => {
    beginChatOpenSkeleton({
      identityKey: 'open-1',
      surface: 'channel',
      entry: 'direct',
      nowMs: 100,
    });
    beginChatOpenSkeleton({
      identityKey: 'open-1',
      surface: 'thread',
      entry: 'notification',
      nowMs: 120,
    });

    const thread = completeChatOpenSkeleton({
      identityKey: 'open-1',
      surface: 'thread',
      nowMs: 300,
    });
    const channel = completeChatOpenSkeleton({
      identityKey: 'open-1',
      surface: 'channel',
      nowMs: 500,
    });

    assert.equal(thread?.durationMs, 180);
    assert.equal(thread?.surface, 'thread');
    assert.equal(channel?.durationMs, 400);
    assert.equal(channel?.surface, 'channel');
  });

  it('abandons an open that unmounts while the skeleton is still visible', () => {
    const completed: Array<{ outcome: string; durationMs: number }> = [];
    const unsubscribe = subscribeChatOpenSkeletonCompleted(event => {
      completed.push({ outcome: event.outcome, durationMs: event.durationMs });
    });

    beginChatOpenSkeleton({
      identityKey: 'channel-1',
      surface: 'channel',
      entry: 'notification',
      nowMs: 50,
    });
    abandonChatOpenSkeleton({
      identityKey: 'channel-1',
      surface: 'channel',
      nowMs: 900,
    });

    unsubscribe();
    assert.deepEqual(completed, [{ outcome: 'abandoned', durationMs: 850 }]);
    assert.equal(
      completeChatOpenSkeleton({ identityKey: 'channel-1', surface: 'channel', nowMs: 1200 }),
      null,
    );
  });
});
