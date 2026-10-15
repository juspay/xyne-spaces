import type { EtaManagementView } from '@xyne/shared';
import {
  Calendar,
  Check,
  ChevronRight,
  Clock,
  Folder,
  Hash,
  Shapes,
  Star,
  Tag,
  UserRound,
  Users,
} from 'lucide-react-native';
import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import Avatar from '@/src/components/ui/avatar';
import { cn } from '@/src/utils/cn';

import { EtaAcknowledgeBanner } from './eta-acknowledge-banner';
import { EtaManagementBadges } from './eta-management-badges';
import { getLabelChipClass, getLabelTextClass, getPriorityTextClass } from './helpers';
import type { MetaRow } from './types';

type OverviewMetaRowsArgs = {
  ticketMetaIconColor: string;
  destructiveColor: string;
  assigneeDisplayName: string;
  assigneeUserId: string | null;
  isAssigneeUpdating: boolean;
  userGroupDisplayName: string;
  ticketUserGroupId: string | null;
  isUserGroupUpdating: boolean;
  createdAtLabel: string;
  boardName: string;
  labels: readonly string[];
  statusLabel: string;
  createdByUserId: string | null | undefined;
  reporterName: string;
  priorityLabel: string;
  selectedTicketType: string | null;
  channelName: string;
  dueDateLabel: string;
  dueDateTextColor: string;
  isDueDateOverdue: boolean;
  etaManagementView: EtaManagementView | null;
  showStatusDeadline: boolean;
  statusDeadlineLabel: string;
  isStatusDeadlineOverdue: boolean;
  onOpenAssignee: () => void;
  onOpenUserGroup: () => void;
  onOpenBoard: () => void;
  onOpenLabels: () => void;
  onOpenStatus: () => void;
  onOpenPriority: () => void;
  onOpenType: () => void;
  onOpenDueDate: () => void;
  onOpenStatusDeadline: () => void;
  onAcknowledgeEtaRisk: (reason: string) => Promise<boolean>;
};

export function buildOverviewMetaRows(args: OverviewMetaRowsArgs): MetaRow[] {
  const {
    ticketMetaIconColor,
    destructiveColor,
    assigneeDisplayName,
    assigneeUserId,
    isAssigneeUpdating,
    userGroupDisplayName,
    ticketUserGroupId,
    isUserGroupUpdating,
    createdAtLabel,
    boardName,
    labels,
    statusLabel,
    createdByUserId,
    reporterName,
    priorityLabel,
    selectedTicketType,
    channelName,
    dueDateLabel,
    dueDateTextColor,
    isDueDateOverdue,
    etaManagementView,
    showStatusDeadline,
    statusDeadlineLabel,
    isStatusDeadlineOverdue,
    onOpenAssignee,
    onOpenUserGroup,
    onOpenBoard,
    onOpenLabels,
    onOpenStatus,
    onOpenPriority,
    onOpenType,
    onOpenDueDate,
    onOpenStatusDeadline,
    onAcknowledgeEtaRisk,
  } = args;

  const rows: MetaRow[] = [
    {
      key: 'assignee',
      icon: <UserRound size={18} color={ticketMetaIconColor} />,
      label: 'Assignee',
      value: (
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={`Assignee: ${assigneeDisplayName}`}
          accessibilityState={{ disabled: isAssigneeUpdating }}
          disabled={isAssigneeUpdating}
          onPress={onOpenAssignee}
          className={cn(
            'flex-1 flex-row items-center gap-2 active:opacity-70',
            isAssigneeUpdating && 'opacity-50',
          )}
        >
          <Avatar userIds={assigneeUserId ? [assigneeUserId] : []} size={20} />
          <Text className='flex-1 text-[14px] font-medium text-foreground'>
            {assigneeDisplayName}
          </Text>
          <ChevronRight size={18} color={ticketMetaIconColor} strokeWidth={2.25} />
        </Pressable>
      ),
    },
    {
      key: 'user-group',
      icon: <Users size={18} color={ticketMetaIconColor} />,
      label: 'User Group',
      value: (
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={`User Group: ${userGroupDisplayName}`}
          accessibilityState={{ disabled: isUserGroupUpdating }}
          disabled={isUserGroupUpdating}
          onPress={onOpenUserGroup}
          className={cn(
            'flex-1 flex-row items-center gap-2 active:opacity-70',
            isUserGroupUpdating && 'opacity-50',
          )}
        >
          <Users size={16} color={ticketMetaIconColor} />
          <Text
            className={cn(
              'flex-1 text-[14px] font-medium',
              ticketUserGroupId ? 'text-foreground' : 'text-ticket-meta-left-text',
            )}
          >
            {userGroupDisplayName}
          </Text>
          <ChevronRight size={18} color={ticketMetaIconColor} strokeWidth={2.25} />
        </Pressable>
      ),
    },
    {
      key: 'created-at',
      icon: <Calendar size={18} color={ticketMetaIconColor} />,
      label: 'Created at',
      value: (
        <Text className='flex-1 text-[14px] font-medium text-foreground'>{createdAtLabel}</Text>
      ),
    },
    {
      key: 'project',
      icon: <Folder size={18} color={ticketMetaIconColor} />,
      label: 'Board',
      value: (
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={`Board: ${boardName}`}
          onPress={onOpenBoard}
          className='flex-1 flex-row items-center gap-2 active:opacity-70'
        >
          <Text className='flex-1 text-[14px] font-medium text-foreground'>{boardName}</Text>
          <ChevronRight size={18} color={ticketMetaIconColor} strokeWidth={2.25} />
        </Pressable>
      ),
    },
    {
      key: 'labels',
      icon: <Tag size={18} color={ticketMetaIconColor} />,
      label: 'Labels',
      value: (
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={labels.length > 0 ? `Labels: ${labels.join(', ')}` : 'Labels: none'}
          onPress={onOpenLabels}
          className='flex-1 flex-row items-center gap-2 active:opacity-70'
        >
          <View className='min-w-0 flex-1 flex-row flex-wrap gap-2'>
            {labels.length > 0 ? (
              labels.map((label: string) => (
                <View
                  key={label}
                  className={cn('rounded-full px-2 py-0.5', getLabelChipClass(label))}
                >
                  <Text className={cn('text-[14px] font-medium', getLabelTextClass(label))}>
                    {label}
                  </Text>
                </View>
              ))
            ) : (
              <Text className='text-[14px] font-medium text-ticket-meta-left-text'>—</Text>
            )}
          </View>
          <ChevronRight size={18} color={ticketMetaIconColor} strokeWidth={2.25} />
        </Pressable>
      ),
    },
    {
      key: 'status',
      icon: <Check size={18} color={ticketMetaIconColor} />,
      label: 'Status',
      value: (
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={`Status: ${statusLabel}`}
          onPress={onOpenStatus}
          className='flex-1 flex-row items-center gap-2 active:opacity-70'
        >
          <Text className='flex-1 text-[14px] font-medium text-foreground'>{statusLabel}</Text>
          <ChevronRight size={18} color={ticketMetaIconColor} strokeWidth={2.25} />
        </Pressable>
      ),
    },
    {
      key: 'reporter',
      icon: <UserRound size={18} color={ticketMetaIconColor} />,
      label: 'Created by',
      value: (
        <View className='flex-1 flex-row items-center gap-2'>
          <Avatar userIds={createdByUserId ? [createdByUserId] : []} size={20} />
          <Text className='flex-1 text-[14px] font-medium text-foreground'>{reporterName}</Text>
        </View>
      ),
    },
    {
      key: 'priority',
      icon: <Star size={18} color={ticketMetaIconColor} />,
      label: 'Priority',
      value: (
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={`Priority: ${priorityLabel}`}
          onPress={onOpenPriority}
          className='flex-1 flex-row items-center gap-2 active:opacity-70'
        >
          <Text
            className={cn('flex-1 text-[14px] font-medium', getPriorityTextClass(priorityLabel))}
          >
            {priorityLabel}
          </Text>
          <ChevronRight size={18} color={ticketMetaIconColor} strokeWidth={2.25} />
        </Pressable>
      ),
    },
    {
      key: 'type',
      icon: <Shapes size={18} color={ticketMetaIconColor} />,
      label: 'Type',
      value: (
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={`Type: ${selectedTicketType ?? 'Unset'}`}
          onPress={onOpenType}
          className='flex-1 flex-row items-center gap-2 active:opacity-70'
        >
          <Text className='flex-1 text-[14px] font-medium text-foreground'>
            {selectedTicketType ?? '—'}
          </Text>
          <ChevronRight size={18} color={ticketMetaIconColor} strokeWidth={2.25} />
        </Pressable>
      ),
    },
    {
      key: 'channel',
      icon: <Hash size={18} color={ticketMetaIconColor} />,
      label: 'Channel',
      value: <Text className='flex-1 text-[14px] font-medium text-foreground'>{channelName}</Text>,
    },
    {
      key: 'due-date',
      icon: (
        <Calendar size={18} color={isDueDateOverdue ? destructiveColor : ticketMetaIconColor} />
      ),
      label: 'Due Date',
      value: (
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={
            isDueDateOverdue ? `Due Date: ${dueDateLabel}, Overdue` : `Due Date: ${dueDateLabel}`
          }
          onPress={onOpenDueDate}
          className='min-w-0 flex-1 flex-row items-start gap-2 active:opacity-70'
        >
          <View className='min-w-0 flex-1'>
            <Text
              className='text-[14px] font-medium'
              style={{ color: isDueDateOverdue ? destructiveColor : dueDateTextColor }}
            >
              {dueDateLabel}
            </Text>
            {etaManagementView ? (
              <View className='mt-1.5'>
                <EtaManagementBadges view={etaManagementView} showOverdue={isDueDateOverdue} />
              </View>
            ) : null}
          </View>
          <ChevronRight size={18} color={ticketMetaIconColor} strokeWidth={2.25} />
        </Pressable>
      ),
      footer:
        etaManagementView !== null ? (
          <EtaAcknowledgeBanner view={etaManagementView} onAcknowledge={onAcknowledgeEtaRisk} />
        ) : null,
    },
  ];

  if (showStatusDeadline) {
    rows.push({
      key: 'status-deadline',
      icon: (
        <Clock size={18} color={isStatusDeadlineOverdue ? destructiveColor : ticketMetaIconColor} />
      ),
      label: 'Status Deadline',
      value: (
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={
            isStatusDeadlineOverdue
              ? `Status Deadline: ${statusDeadlineLabel}, Stage Overdue`
              : `Status Deadline: ${statusDeadlineLabel}`
          }
          onPress={onOpenStatusDeadline}
          className='min-w-0 flex-1 flex-row items-center gap-2 active:opacity-70'
        >
          <Text
            className='min-w-0 flex-1 text-[14px] font-medium'
            style={{ color: isStatusDeadlineOverdue ? destructiveColor : dueDateTextColor }}
          >
            {statusDeadlineLabel}
          </Text>
          {isStatusDeadlineOverdue ? (
            <View className='rounded bg-destructive/10 px-1.5 py-0.5'>
              <Text className='text-[11px] font-medium text-destructive'>Stage Overdue</Text>
            </View>
          ) : null}
          <ChevronRight size={18} color={ticketMetaIconColor} strokeWidth={2.25} />
        </Pressable>
      ),
    });
  }

  return rows;
}

/** Thin wrapper when a React tree is preferred over calling the builder directly. */
export function OverviewMetaRows(props: OverviewMetaRowsArgs): ReactElement | null {
  void props;
  return null;
}
