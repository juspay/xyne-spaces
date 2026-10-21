import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { shouldOpenActivityThread } from '@/src/components/activity/activity-v2-navigation-logic';

describe('Activity message route classification', () => {
  it('uses an explicit thread relation when initial-message metadata is missing', () => {
    assert.equal(
      shouldOpenActivityThread({
        conversationId: 'thread-1',
        messageId: 'reply-1',
        isThreadActivity: true,
      }),
      true,
    );
  });

  it('uses the structural message relationship even with a stale false flag', () => {
    assert.equal(
      shouldOpenActivityThread({
        conversationId: 'thread-1',
        initialMessageId: 'parent-1',
        messageId: 'reply-1',
        isThreadActivity: false,
      }),
      true,
    );
  });

  it('uses reply actions only when stronger relation metadata is unavailable', () => {
    assert.equal(
      shouldOpenActivityThread({
        actorAction: 'replied_v2',
        conversationId: 'thread-1',
        messageId: 'reply-1',
        isThreadActivity: false,
      }),
      true,
    );
  });

  it('keeps an initial channel or DM message on the base conversation', () => {
    assert.equal(
      shouldOpenActivityThread({
        conversationId: 'conversation-1',
        initialMessageId: 'message-1',
        messageId: 'message-1',
        isThreadActivity: false,
      }),
      false,
    );
  });

  it('does not invent a thread when the Activity has no conversation identity', () => {
    assert.equal(
      shouldOpenActivityThread({
        actorAction: 'replied_v2',
        messageId: 'reply-1',
        isThreadActivity: true,
      }),
      false,
    );
  });

  it('keeps an ordinary Activity message on the base conversation when no thread signal exists', () => {
    assert.equal(
      shouldOpenActivityThread({
        actorAction: 'mentioned_user',
        conversationId: 'conversation-1',
        messageId: 'message-1',
        isThreadActivity: false,
      }),
      false,
    );
  });
});
