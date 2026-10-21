import { ChannelScopeType, ChannelVisibility } from '@xyne/shared';

export type MemberActionId = 'make-admin' | 'remove-admin' | 'remove';

export type MemberAction = {
  id: MemberActionId;
  label: string;
  systemImage: 'person.badge.plus' | 'person.badge.minus' | 'trash';
  destructive: boolean;
};

export type MemberActionFlags = {
  canManage: boolean;
  canRemove: boolean;
  showMenu: boolean;
};

export function getMemberActionFlags(args: {
  currentUserId: string;
  isChannelCreator: boolean;
  canRemoveParticipants: boolean;
  targetUserId: string;
  targetIsCreator: boolean;
}): MemberActionFlags {
  const isSelf = args.currentUserId === args.targetUserId;

  // Shared mutator: creator may change roles; a non-creator admin cannot grant
  // ADMIN or modify an existing admin, so Make/Remove admin stay creator-only.
  const canManage = args.isChannelCreator && !isSelf && !args.targetIsCreator;

  const canRemove = args.canRemoveParticipants && !isSelf && !args.targetIsCreator;

  return {
    canManage,
    canRemove,
    showMenu: canManage || canRemove,
  };
}

export function canRemoveParticipantsInChannel(args: {
  scopeType: ChannelScopeType | undefined;
  currentUserIsAdmin: boolean;
}): boolean {
  return args.scopeType === ChannelScopeType.DEFAULT && args.currentUserIsAdmin;
}

/**
 * Header/About member counts.
 *
 * `channel_stats.participantCount` is owned by the server
 * `removeChannelParticipant` helper. The client `removeParticipant` mutator
 * deletes the row but does not touch that denormalized field, so prefer the
 * live `channel_participants` query once it has rows. Fall back to stats
 * while the query is still empty (deferred header fetch, first paint).
 */
export function resolveChannelMemberCount(args: {
  liveParticipantCount: number;
  statsParticipantCount: number | undefined;
}): number {
  if (args.liveParticipantCount > 0) return args.liveParticipantCount;
  return args.statsParticipantCount ?? 0;
}

export function getMemberActions(args: {
  canManage: boolean;
  canRemove: boolean;
  targetIsAdmin: boolean;
}): MemberAction[] {
  const actions: MemberAction[] = [];

  if (args.canManage) {
    actions.push(
      args.targetIsAdmin
        ? {
            id: 'remove-admin',
            label: 'Remove admin',
            systemImage: 'person.badge.minus',
            destructive: false,
          }
        : {
            id: 'make-admin',
            label: 'Make admin',
            systemImage: 'person.badge.plus',
            destructive: false,
          },
    );
  }

  if (args.canRemove) {
    actions.push({
      id: 'remove',
      label: 'Remove',
      systemImage: 'trash',
      destructive: true,
    });
  }

  return actions;
}

export function getRemoveMemberCopy(args: {
  memberName: string;
  channelName: string;
  visibility: ChannelVisibility | undefined;
}): { title: string; description: string } {
  return {
    title: `Remove ${args.memberName} from ${args.channelName}?`,
    description:
      args.visibility === ChannelVisibility.PRIVATE
        ? 'This person will no longer have access to the channel and can only rejoin by invitation.'
        : 'This person will lose access to the channel but may rejoin later.',
  };
}
