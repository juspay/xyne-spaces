import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ChannelScopeType } from '@xyne/shared';

import {
  canRemoveParticipantsInChannel,
  getMemberActionFlags,
  getMemberActions,
  resolveChannelMemberCount,
  type MemberActionId,
} from '@/src/features/chat/channel-members/channel-member-actions';

const CREATOR = 'creator';
const ADMIN = 'admin';
const MEMBER = 'member';
const OTHER_ADMIN = 'other-admin';

function actionIds(args: {
  currentUserId: string;
  isChannelCreator: boolean;
  canRemoveParticipants: boolean;
  targetUserId: string;
  targetIsCreator: boolean;
  targetIsAdmin: boolean;
}): MemberActionId[] {
  const flags = getMemberActionFlags({
    currentUserId: args.currentUserId,
    isChannelCreator: args.isChannelCreator,
    canRemoveParticipants: args.canRemoveParticipants,
    targetUserId: args.targetUserId,
    targetIsCreator: args.targetIsCreator,
  });
  return getMemberActions({
    canManage: flags.canManage,
    canRemove: flags.canRemove,
    targetIsAdmin: args.targetIsAdmin,
  }).map(action => action.id);
}

describe('channel member permission matrix', () => {
  describe('role actions', () => {
    it('lets a creator who is not an admin make and remove admins', () => {
      assert.deepEqual(
        actionIds({
          currentUserId: CREATOR,
          isChannelCreator: true,
          canRemoveParticipants: false,
          targetUserId: MEMBER,
          targetIsCreator: false,
          targetIsAdmin: false,
        }),
        ['make-admin'],
      );
      assert.deepEqual(
        actionIds({
          currentUserId: CREATOR,
          isChannelCreator: true,
          canRemoveParticipants: false,
          targetUserId: ADMIN,
          targetIsCreator: false,
          targetIsAdmin: true,
        }),
        ['remove-admin'],
      );
    });

    it('hides Make admin and Remove admin from a non-creator admin', () => {
      assert.deepEqual(
        actionIds({
          currentUserId: ADMIN,
          isChannelCreator: false,
          canRemoveParticipants: true,
          targetUserId: MEMBER,
          targetIsCreator: false,
          targetIsAdmin: false,
        }),
        ['remove'],
      );
      assert.deepEqual(
        actionIds({
          currentUserId: ADMIN,
          isChannelCreator: false,
          canRemoveParticipants: true,
          targetUserId: OTHER_ADMIN,
          targetIsCreator: false,
          targetIsAdmin: true,
        }),
        ['remove'],
      );
    });

    it('never exposes role actions on self or the channel creator', () => {
      assert.deepEqual(
        actionIds({
          currentUserId: CREATOR,
          isChannelCreator: true,
          canRemoveParticipants: true,
          targetUserId: CREATOR,
          targetIsCreator: true,
          targetIsAdmin: true,
        }),
        [],
      );
      assert.deepEqual(
        actionIds({
          currentUserId: ADMIN,
          isChannelCreator: false,
          canRemoveParticipants: true,
          targetUserId: CREATOR,
          targetIsCreator: true,
          targetIsAdmin: true,
        }),
        [],
      );
    });

    it('hides every action from a regular member', () => {
      assert.deepEqual(
        actionIds({
          currentUserId: MEMBER,
          isChannelCreator: false,
          canRemoveParticipants: false,
          targetUserId: ADMIN,
          targetIsCreator: false,
          targetIsAdmin: true,
        }),
        [],
      );
    });
  });

  describe('remove', () => {
    it('lets a default-channel admin remove anyone except self and the creator', () => {
      assert.equal(
        canRemoveParticipantsInChannel({
          scopeType: ChannelScopeType.DEFAULT,
          currentUserIsAdmin: true,
        }),
        true,
      );
      assert.deepEqual(
        actionIds({
          currentUserId: ADMIN,
          isChannelCreator: false,
          canRemoveParticipants: true,
          targetUserId: MEMBER,
          targetIsCreator: false,
          targetIsAdmin: false,
        }),
        ['remove'],
      );
    });

    it('hides Remove on non-default channels even for admins', () => {
      assert.equal(
        canRemoveParticipantsInChannel({
          scopeType: ChannelScopeType.GROUP_DM,
          currentUserIsAdmin: true,
        }),
        false,
      );
    });

    it('lets a creator who is also an admin both change roles and remove', () => {
      assert.deepEqual(
        actionIds({
          currentUserId: CREATOR,
          isChannelCreator: true,
          canRemoveParticipants: true,
          targetUserId: MEMBER,
          targetIsCreator: false,
          targetIsAdmin: false,
        }),
        ['make-admin', 'remove'],
      );
    });
  });
});

describe('resolveChannelMemberCount', () => {
  it('prefers the live participant query after a client-side remove', () => {
    assert.equal(
      resolveChannelMemberCount({
        liveParticipantCount: 4,
        statsParticipantCount: 5,
      }),
      4,
    );
  });

  it('falls back to denormalized stats while the live query is still empty', () => {
    assert.equal(
      resolveChannelMemberCount({
        liveParticipantCount: 0,
        statsParticipantCount: 5,
      }),
      5,
    );
  });

  it('returns 0 when neither source has a count yet', () => {
    assert.equal(
      resolveChannelMemberCount({
        liveParticipantCount: 0,
        statsParticipantCount: undefined,
      }),
      0,
    );
  });
});
