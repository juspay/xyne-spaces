import { TicketPriority, TicketStatusV2 } from '@xyne/shared';
import { getPriorityIcon } from '../TicketCard/TicketCard.utils';
import { TicketStatusIcon } from '../../../assets/icons';
import Avatar from '../../ui/Avatar/Avatar';
import {
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleX,
  Signature,
  Tag,
  UserIcon,
} from 'lucide-react';
import { cn } from '../../../utils/classNames';
import { format, isToday, isTomorrow } from 'date-fns';
import { useMemo } from 'react';
import type { User, UserGroup } from '../../../machines/stateMachine';
import { EntityOption, StatusEntityOption } from './TicketTableTypes';
import { getUserDisplayName } from '../../../utils/userDisplayName';

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

export const StatusOptions: StatusEntityOption[] = [
  {
    label: 'Todo',
    value: TicketStatusV2.TODO,
    icon: <CircleDashed strokeWidth={2.5} className='w-3.5 h-3.5 text-orange-500' />,
    bgColor: 'bg-orange-50',
    textColor: 'text-orange-700',
  },
  {
    label: 'Started',
    value: TicketStatusV2.STARTED,
    icon: <CircleDot strokeWidth={2.5} className='w-3.5 h-3.5 text-blue-500' />,
    bgColor: 'bg-blue-50',
    textColor: 'text-blue-700',
  },
  {
    label: 'Paused',
    value: TicketStatusV2.PAUSED,
    icon: <Signature strokeWidth={2.5} className='w-3.5 h-3.5 text-teal-500' />,
    bgColor: 'bg-teal-50',
    textColor: 'text-teal-700',
  },
  {
    label: 'Cancelled',
    value: TicketStatusV2.CANCELLED,
    icon: <CircleX strokeWidth={2.5} className='w-3.5 h-3.5 text-red-500' />,
    bgColor: 'bg-red-50',
    textColor: 'text-red-700',
  },
  {
    label: 'Completed',
    value: TicketStatusV2.COMPLETED,
    icon: <CircleCheck strokeWidth={2.5} className='w-3.5 h-3.5 text-green-500' />,
    bgColor: 'bg-green-50',
    textColor: 'text-green-700',
  },
];

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
export const getAssigneeOptions = (users: User[], userGroups: UserGroup[]): EntityOption[] => {
  const userOptions: EntityOption[] = users.map(user => ({
    value: `user:${user.id}`,
    label: getUserDisplayName(user),
    subtitle: user.email,
    icon: <Avatar userId={user.id} size='sm' className='rounded-full' />,
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

export const UNASSIGNED_OPTION: EntityOption = {
  value: '',
  label: 'Unassigned',
  icon: (
    <div className='w-5 h-5 rounded-full border border-dashed border-muted-foreground flex items-center justify-center'>
      <UserIcon className='w-3 h-3' strokeWidth={1.5} />
    </div>
  ),
};

export const getStageOptions = (
  stages: Array<{ id: string; name: string }> = [],
): EntityOption[] => {
  return stages.map(stage => ({
    value: stage.name,
    label: stage.name,
    icon: <TicketStatusIcon size={14} />,
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

export const useAssigneeOptions = (users: User[], userGroups: UserGroup[]) => {
  return useMemo(() => {
    return [UNASSIGNED_OPTION, ...getAssigneeOptions(users, userGroups)];
  }, [users, userGroups]);
};

export const useStageOptions = (stages: Array<{ id: string; name: string }> = []) => {
  return useMemo(() => getStageOptions(stages), [stages]);
};

export const useTagOptions = (availableTags: string[] = []) => {
  return useMemo(() => getTagOptions(availableTags), [availableTags]);
};

export const useTagsWithCreateOption = (availableTags: string[], searchValue: string) => {
  return useMemo(
    () => getTagsWithCreateOption(availableTags, searchValue),
    [availableTags, searchValue],
  );
};

export const formatDueDate = (date: string | number | Date | null): string => {
  if (!date) return 'No due date';
  const d = new Date(date);

  if (isToday(d)) return 'Today';
  if (isTomorrow(d)) return 'Tomorrow';

  const currentYear = new Date().getFullYear();
  return d.getFullYear() === currentYear ? format(d, 'MMM d') : format(d, 'MMM d, yyyy');
};
