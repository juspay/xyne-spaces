import { TicketPriority, TicketStatusV2, UserStatus } from '@xyne/shared';
import { getPriorityIcon } from '../TicketCard/TicketCard.utils';
import Avatar from '../../ui/Avatar/Avatar';
import { Tag, UserDefault as UserIcon } from '@xyne/icons';
import {
  STAGE_STATUS_META,
  StageIndicator,
  StageStatusIcon,
} from '../../../utils/board/stageStatusIcon';
import { cn } from '../../../utils/classNames';
import { useMemo } from 'react';
import type { User, UserGroup } from '../../../machines/stateMachine';
import { EntityOption, StageOptionSource, StatusEntityOption } from './TicketTableTypes';
import { getUserDisplayName, withYouLabel } from '../../../utils/userDisplayName';
import { channelMembersFirst, currentUserFirst } from '../../../utils/channelMembersFirst';

export const TAG_COLORS = [
  'bg-red-500',
  'bg-blue-500',
  'bg-green-500',
  'bg-orange-500',
  'bg-purple-500',
  'bg-pink-500',
  'bg-teal-500',
  'bg-indigo-500',
];

const STATUS_OPTION_ORDER = [
  TicketStatusV2.TODO,
  TicketStatusV2.STARTED,
  TicketStatusV2.PAUSED,
  TicketStatusV2.CANCELLED,
  TicketStatusV2.COMPLETED,
];

export const StatusOptions: StatusEntityOption[] = STATUS_OPTION_ORDER.map(value => {
  const meta = STAGE_STATUS_META[value];
  return {
    label: meta.label,
    value,
    icon: <StageStatusIcon status={value} />,
    bgColor: meta.bgColor,
    textColor: meta.textColor,
  };
});

export const PriorityOptions: EntityOption[] = [
  { label: 'Low', value: TicketPriority.LOW, icon: getPriorityIcon(TicketPriority.LOW) },
  { label: 'Medium', value: TicketPriority.MEDIUM, icon: getPriorityIcon(TicketPriority.MEDIUM) },
  { label: 'High', value: TicketPriority.HIGH, icon: getPriorityIcon(TicketPriority.HIGH) },
  {
    label: 'Critical',
    value: TicketPriority.CRITICAL,
    icon: getPriorityIcon(TicketPriority.CRITICAL),
  },
];

// Pure helper functions (keep these as-is for direct use)
export const getAssigneeOptions = (
  users: User[],
  userGroups: UserGroup[],
  // When provided, channel members are floated above non-members. Omitted by
  // the cross-channel table/bulk callers, which have no single channel to rank by.
  memberIds?: Set<string>,
  // When provided, the current user is pinned to the very top and labelled "(You)".
  selfId?: string,
): EntityOption[] => {
  // On channel-scoped lists (the board card passes memberIds), rank channel
  // members first, then sink deactivated users to the bottom. Stable sort keeps
  // the members-first order within each activation group.
  const rankedUsers = memberIds
    ? [...channelMembersFirst(users, u => u.id, memberIds)].sort(
        (a, b) =>
          Number(a.status === UserStatus.INACTIVE) - Number(b.status === UserStatus.INACTIVE),
      )
    : users;
  // Then float the current user to the very top (only the board card passes selfId).
  const orderedUsers = currentUserFirst(rankedUsers, u => u.id, selfId);
  const userOptions: EntityOption[] = orderedUsers.map(user => ({
    value: `user:${user.id}`,
    label: withYouLabel(getUserDisplayName(user), user.id === selfId),
    subtitle: user.email,
    icon: <Avatar userId={user.id} size='sm' className='rounded-full' />,
    isDeactivated: user.status === UserStatus.INACTIVE,
  }));

  // Filter out deactivated groups (isActive !== false)
  const activeGroups = userGroups.filter(group => group.isActive !== false);
  const groupOptions: EntityOption[] = activeGroups.map(group => ({
    value: `group:${group.id}`,
    label: group.name,
    subtitle: 'Group',
    icon: (
      <div className='w-5 h-5 rounded-lg bg-border flex items-center justify-center'>
        <span className='text-xs font-medium text-muted-foreground'>
          {group.name.charAt(0).toUpperCase()}
        </span>
      </div>
    ),
  }));

  return [...userOptions, ...groupOptions];
};

/** The columns an assignee pick actually writes. */
export interface AssigneeTicketUpdate {
  assignedTo: string | null;
  userGroupId?: string;
}

/**
 * Inverse of `getAssigneeOptions`. Its `user:<id>` / `group:<id>` values map onto a
 * bare id in `assignedTo` and a group in `userGroupId` — writing the encoded value
 * back is rejected ("assignee must be an active user"). Unassign clears the agent,
 * not the team, which outlives it on autoassignment boards.
 */
export const assigneeOptionToTicketUpdate = (value: string | null): AssigneeTicketUpdate => {
  if (value?.startsWith('group:')) {
    return { assignedTo: null, userGroupId: value.slice('group:'.length) };
  }
  if (value) return { assignedTo: value.replace(/^user:/, '') };
  return { assignedTo: null };
};

export const UNASSIGNED_OPTION: EntityOption = {
  value: '',
  label: 'Unassigned',
  icon: (
    <div className='w-5 h-5 rounded-full border border-dashed border-muted-foreground flex items-center justify-center'>
      <UserIcon className='w-3 h-3' strokeWidth={1.5} />
    </div>
  ),
};

export const getStageOptions = (stages: StageOptionSource[] = []): EntityOption[] => {
  return stages.map(stage => ({
    value: stage.name,
    label: stage.name,
    icon: <StageIndicator stages={stages} stageName={stage.name} />,
  }));
};

export const getTagOptions = (tags: string[] = []): EntityOption[] => {
  return tags.map((tagName, index) => ({
    value: tagName,
    label: tagName,
    icon: <span className={cn('size-1.5 rounded-full', TAG_COLORS[index % TAG_COLORS.length])} />,
  }));
};

export const getTagsWithCreateOption = (
  availableTags: string[],
  searchValue: string,
): EntityOption[] => {
  const baseOptions = getTagOptions(availableTags);
  const trimmedSearch = searchValue.trim();

  if (trimmedSearch && !availableTags.some(t => t.toLowerCase() === trimmedSearch.toLowerCase())) {
    return [
      {
        value: trimmedSearch,
        label: `Create "${trimmedSearch}"`,
        icon: <Tag size={14} className='text-blue-600' />,
      },
      ...baseOptions,
    ];
  }
  return baseOptions;
};

export const useAssigneeOptions = (
  users: User[],
  userGroups: UserGroup[],
  memberIds?: Set<string>,
  selfId?: string,
) => {
  return useMemo(() => {
    return [UNASSIGNED_OPTION, ...getAssigneeOptions(users, userGroups, memberIds, selfId)];
  }, [users, userGroups, memberIds, selfId]);
};

export const useStageOptions = (stages: StageOptionSource[] = []) => {
  return useMemo(() => getStageOptions(stages), [stages]);
};
