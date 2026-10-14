import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ChannelScopeType } from '@xyne/shared';

import { canPromoteConversationToChannel } from '@/src/features/chat/promoteToChannelPolicy';

describe('promote to channel policy', () => {
  it('offers promotion to a participant of a group DM', () => {
    assert.equal(
      canPromoteConversationToChannel({
        scopeType: ChannelScopeType.GROUP_DM,
        isParticipant: true,
      }),
      true,
    );
  });

  it('hides promotion from a non-participant of a group DM', () => {
    assert.equal(
      canPromoteConversationToChannel({
        scopeType: ChannelScopeType.GROUP_DM,
        isParticipant: false,
      }),
      false,
    );
  });

  it('hides promotion for a 1:1 DM, which the server mutator rejects', () => {
    assert.equal(
      canPromoteConversationToChannel({
        scopeType: ChannelScopeType.DM,
        isParticipant: true,
      }),
      false,
    );
  });

  it('hides promotion for a conversation that is already a channel', () => {
    assert.equal(
      canPromoteConversationToChannel({
        scopeType: ChannelScopeType.DEFAULT,
        isParticipant: true,
      }),
      false,
    );
  });

  it('hides promotion while the channel row has not loaded yet', () => {
    assert.equal(
      canPromoteConversationToChannel({ scopeType: undefined, isParticipant: true }),
      false,
    );
  });
});
