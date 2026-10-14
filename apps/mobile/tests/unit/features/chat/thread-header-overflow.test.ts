import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getThreadCallBlockReason,
  getThreadHeaderOverflowActions,
  shouldBlockSubscriptionToggle,
} from '@/src/features/chat/thread-header/thread-header-overflow';

describe('getThreadHeaderOverflowActions', () => {
  it('labels subscribe when the thread is not followed', () => {
    const [, subscription] = getThreadHeaderOverflowActions(false);
    assert.equal(subscription?.id, 'toggle-subscription');
    assert.equal(subscription?.label, 'Subscribe to notifications');
    assert.equal(subscription?.systemImage, 'bell');
  });

  it('labels unsubscribe when the thread is followed', () => {
    const [, subscription] = getThreadHeaderOverflowActions(true);
    assert.equal(subscription?.label, 'Unsubscribe from notifications');
    assert.equal(subscription?.systemImage, 'bell.slash');
  });
});

describe('getThreadCallBlockReason', () => {
  it('blocks non-members before checking an in-progress call', () => {
    assert.equal(
      getThreadCallBlockReason({
        canUseMemberActions: false,
        isInCall: true,
        currentCallExternalId: 'other-channel',
        channelId: 'channel-1',
      }),
      'join-channel',
    );
  });

  it('blocks starting a call only when the user is already in a different call', () => {
    assert.equal(
      getThreadCallBlockReason({
        canUseMemberActions: true,
        isInCall: true,
        currentCallExternalId: 'other-channel',
        channelId: 'channel-1',
      }),
      'already-in-call',
    );
    assert.equal(
      getThreadCallBlockReason({
        canUseMemberActions: true,
        isInCall: true,
        currentCallExternalId: 'channel-1',
        channelId: 'channel-1',
      }),
      null,
    );
    assert.equal(
      getThreadCallBlockReason({
        canUseMemberActions: true,
        isInCall: false,
        currentCallExternalId: null,
        channelId: 'channel-1',
      }),
      null,
    );
  });
});

describe('shouldBlockSubscriptionToggle', () => {
  it('blocks empty thread ids, unresolved queries, and in-flight mutations', () => {
    assert.equal(
      shouldBlockSubscriptionToggle({
        threadId: '',
        isQueryResolving: false,
        isMutating: false,
        mutationInFlight: false,
      }),
      true,
    );
    assert.equal(
      shouldBlockSubscriptionToggle({
        threadId: 'thread-1',
        isQueryResolving: true,
        isMutating: false,
        mutationInFlight: false,
      }),
      true,
    );
    assert.equal(
      shouldBlockSubscriptionToggle({
        threadId: 'thread-1',
        isQueryResolving: false,
        isMutating: true,
        mutationInFlight: false,
      }),
      true,
    );
    assert.equal(
      shouldBlockSubscriptionToggle({
        threadId: 'thread-1',
        isQueryResolving: false,
        isMutating: false,
        mutationInFlight: true,
      }),
      true,
    );
    assert.equal(
      shouldBlockSubscriptionToggle({
        threadId: 'thread-1',
        isQueryResolving: false,
        isMutating: false,
        mutationInFlight: false,
      }),
      false,
    );
  });
});
