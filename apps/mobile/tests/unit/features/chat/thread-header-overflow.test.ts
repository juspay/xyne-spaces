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
        currentCallChannelId: 'other-channel',
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
        currentCallChannelId: 'other-channel',
        channelId: 'channel-1',
      }),
      'already-in-call',
    );
    assert.equal(
      getThreadCallBlockReason({
        canUseMemberActions: true,
        isInCall: true,
        currentCallChannelId: 'channel-1',
        channelId: 'channel-1',
      }),
      null,
    );
    assert.equal(
      getThreadCallBlockReason({
        canUseMemberActions: true,
        isInCall: false,
        currentCallChannelId: null,
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

it('keeps recordings accessible while preventing another recording in an archived thread', () => {
  const actions = getThreadHeaderOverflowActions(false, { canEdit: false, recordingActive: true });
  assert.equal(actions.find(action => action.id === 'take-notes')?.label, 'Open recording');
  assert.equal(actions.find(action => action.id === 'take-notes')?.disabled, false);
  assert.equal(
    actions.find(action => action.id === 'thread-tags'),
    undefined,
  );
  assert.equal(
    getThreadHeaderOverflowActions(false, { canEdit: false }).find(
      action => action.id === 'take-notes',
    )?.disabled,
    true,
  );
});

it('blocks a different thread call in the same channel, including a channel-wide call', () => {
  const args = {
    canUseMemberActions: true,
    isInCall: true,
    currentCallChannelId: 'channel',
    channelId: 'channel',
    threadId: 'thread',
  };
  assert.equal(
    getThreadCallBlockReason({ ...args, currentConversationId: 'other-thread' }),
    'already-in-call',
  );
  assert.equal(
    getThreadCallBlockReason({ ...args, currentConversationId: null }),
    'already-in-call',
  );
  assert.equal(getThreadCallBlockReason({ ...args, currentConversationId: 'thread' }), null);
});

it('offers context on editable threads without ticket creation', () => {
  const actions = getThreadHeaderOverflowActions(false, { canEdit: true });
  assert.equal(actions.find(action => action.id === 'add-context')?.disabled, false);
  assert.equal(actions.map(action => String(action.id)).includes('create-ticket'), false);
  assert.equal(
    getThreadHeaderOverflowActions(false)
      .map(action => String(action.id))
      .includes('create-ticket'),
    false,
  );
  assert.equal(
    getThreadHeaderOverflowActions(false, { canEdit: false }).find(
      action => action.id === 'add-context',
    )?.disabled,
    true,
  );
});

it('shows tags only when opted in on an editable thread', () => {
  assert.equal(
    getThreadHeaderOverflowActions(false).some(a => a.id === 'thread-tags'),
    false,
  );
  assert.equal(
    getThreadHeaderOverflowActions(false, { showThreadTags: true, canEdit: true }).some(
      a => a.id === 'thread-tags',
    ),
    true,
  );
  assert.equal(
    getThreadHeaderOverflowActions(false, { showThreadTags: true, canEdit: false }).some(
      a => a.id === 'thread-tags',
    ),
    false,
  );
});
