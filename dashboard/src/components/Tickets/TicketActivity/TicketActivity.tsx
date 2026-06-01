import { ReactElement, ReactNode, useMemo, useState } from 'react';
import {
  Activity,
  ArrowUpDown,
  Calendar,
  FileText,
  SquareKanban,
  Tag,
  Archive,
  GitMerge,
} from 'lucide-react';
import {
  ActivityType,
  TicketReferenceRelation,
  type TicketActivity as TicketActivityType,
  type User,
  type UserGroup,
  type PRActivityValue,
  type ReferenceTicketActivityValue,
  type SubticketActivityValue,
  type BaseActivityValue,
} from '@xyne/shared';
import { formatReferenceLabel } from '../../../hooks/useTicketReferences';
import { formatDistanceToNow } from 'date-fns';
import { TicketPriorityIcon } from '../../../assets/icons';
import { TicketStatusIcon } from '../../../assets/icons';
import SmallUserAvatar from '../../UserAvatar/SmallUserAvatar';
import { formatPRActivityParts } from '../../../utils/activityFormatter';

interface TicketActivityProps {
  activities: TicketActivityType[] | undefined;
  users: User[] | undefined;
  boards?: { id: string; name: string }[];
  userGroups: UserGroup[] | undefined;
}

/**
 * Combined activity value type for all activity types.
 * Derived from imported types in @xyne/shared to avoid redundancy.
 * All fields are optional for safe access across different activity types.
 */
type ActivityValue = Partial<
  BaseActivityValue &
    PRActivityValue &
    ReferenceTicketActivityValue &
    SubticketActivityValue & {
      reason?: string;
    }
>;

type SortOrder = 'newest' | 'oldest';

const formatTimestamp = (timestamp: number | Date): string => {
  try {
    const date = typeof timestamp === 'number' ? new Date(timestamp) : timestamp;
    return formatDistanceToNow(date, { addSuffix: true });
  } catch {
    return 'Unknown time';
  }
};

const getActivityDescription = (
  activity: TicketActivityType,
  users: User[] | undefined,
  boards?: { id: string; name: string }[],
  userGroups?: UserGroup[],
): { description: string; details: ReactNode; hideActorName?: boolean } => {
  const value = activity.value as ActivityValue | null;
  const referenceTitle =
    value?.targetTicketTitle || value?.targetTicketXyneId || value?.targetTicketId || 'ticket';

  switch (activity.activityType) {
    case ActivityType.TITLE:
      return {
        description: 'updated title',
        details: (
          <>
            from <span className='font-semibold'>{value?.oldValue || ''}</span> to{' '}
            <span className='font-semibold'>{value?.newValue || ''}</span>
          </>
        ),
      };

    case ActivityType.DESCRIPTION:
      return {
        description: 'updated description',
        details: '',
      };

    case ActivityType.STATUS:
    case ActivityType.STAGE_NAME:
      if (value?.field === 'stageName') {
        return {
          description: 'moved ticket',
          details: (
            <>
              from <span className='font-semibold'>{value?.oldValue || ''}</span> to{' '}
              <span className='font-semibold'>{value?.newValue || ''}</span>
            </>
          ),
        };
      }
      return {
        description: 'changed status',
        details: (
          <>
            from <span className='font-semibold'>{value?.oldValue || ''}</span> to{' '}
            <span className='font-semibold'>{value?.newValue || ''}</span>
          </>
        ),
      };

    case ActivityType.PR_REVIEWER: {
      const newUser = users?.find(u => u.id === value?.newValue);
      const updatedByUser = users?.find(u => u.id === activity.updatedBy);

      return updatedByUser === newUser
        ? {
            description: 'self-assigned as PR Reviewer',
            details: '',
          }
        : {
            description: 'assigned PR Reviewer',
            details: <span className='font-semibold'>{newUser?.name || 'Unassigned'}</span>,
          };
    }

    case ActivityType.QA: {
      const oldUser = users?.find(u => u.id === value?.oldValue);
      const newUser = users?.find(u => u.id === value?.newValue);
      const updatedByUser = users?.find(u => u.id === activity.updatedBy);

      return updatedByUser === newUser
        ? {
            description: 'self-assigned as QA',
            details: '',
          }
        : {
            description: 'assigned QA',
            details: value?.oldValue ? (
              <>
                from <span className='font-semibold'>{oldUser?.name || 'Unassigned'}</span> to{' '}
                <span className='font-semibold'>{newUser?.name || 'Unassigned'}</span>
              </>
            ) : (
              <span className='font-semibold'>{newUser?.name || 'Unassigned'}</span>
            ),
          };
    }

    case ActivityType.ASSIGNED_TO: {
      const oldUser = users?.find(u => u.id === value?.oldValue);
      const newUser = users?.find(u => u.id === value?.newValue);
      const updatedByUser = users?.find(u => u.id === activity.updatedBy);

      // Auto-assigned by the system (email classification worker)
      const isAutoAssigned =
        value?.reason === 'AI classification' || value?.reason === 'Default channel group';
      if (isAutoAssigned) {
        return {
          description: 'Auto-assigned',
          details: (
            <>
              to <span className='font-semibold'>{newUser?.name || 'Unassigned'}</span>
            </>
          ),
          hideActorName: true,
        };
      }

      return updatedByUser === newUser
        ? {
            description: 'self-assigned the ticket',
            details: '',
          }
        : {
            description: 'changed assignment',
            details: (
              <>
                from <span className='font-semibold'>{oldUser?.name || 'Unassigned'}</span> to{' '}
                <span className='font-semibold'>{newUser?.name || 'Unassigned'}</span>
              </>
            ),
          };
    }

    case ActivityType.TICKET_TYPE:
      return {
        description: 'changed ticket type',
        details: (
          <>
            from <span className='font-semibold'>{value?.oldValue || 'none'}</span> to{' '}
            <span className='font-semibold'>{value?.newValue || 'none'}</span>
          </>
        ),
      };

    case ActivityType.PRIORITY: {
      const isAiPriority = value?.reason === 'AI priority classification';
      return {
        description: isAiPriority ? 'Auto-assigned priority' : 'changed priority',
        details: (
          <>
            from <span className='font-semibold'>{value?.oldValue || ''}</span> to{' '}
            <span className='font-semibold'>{value?.newValue || ''}</span>
          </>
        ),
        hideActorName: isAiPriority,
      };
    }

    case ActivityType.STAGE_ETA:
      return {
        description: `updated stage deadline`,
        details: (
          <>
            from{' '}
            <span className='font-semibold'>
              {value?.oldValue ? new Date(value.oldValue).toLocaleDateString() : 'none'}
            </span>{' '}
            to{' '}
            <span className='font-semibold'>
              {value?.newValue ? new Date(value.newValue).toLocaleDateString() : 'none'}
            </span>
          </>
        ),
      };

    case ActivityType.USER_GROUP_ID: {
      const oldGroup = userGroups?.find(g => g.id === value?.oldValue);
      const newGroup = userGroups?.find(g => g.id === value?.newValue);

      if (value?.newValue && value?.oldValue) {
        return {
          description: 'transferred ticket',
          details: (
            <>
              from <span className='font-semibold'>{oldGroup?.name || 'Unknown'}</span> to{' '}
              <span className='font-semibold'>{newGroup?.name || 'Unknown'}</span>
            </>
          ),
        };
      } else if (value?.newValue) {
        return {
          description: 'transferred ticket',
          details: (
            <>
              to <span className='font-semibold'>{newGroup?.name || 'Unknown'}</span>
            </>
          ),
        };
      }
      return {
        description: 'removed user group',
        details: oldGroup ? <span className='font-semibold'>{oldGroup.name}</span> : <span />,
      };
    }

    case ActivityType.METADATA:
      return {
        description: 'updated metadata',
        details: '',
      };

    case ActivityType.REFERENCE_TICKET: {
      const action = value?.action;
      if (action === 'created') {
        return {
          description: 'added related ticket',
          details: (
            <>
              <span className='font-semibold'>{referenceTitle}</span> (
              {formatReferenceLabel(value?.relationType as TicketReferenceRelation)})
            </>
          ),
        };
      }

      if (action === 'removed') {
        return {
          description: 'removed related ticket',
          details: (
            <>
              <span className='font-semibold'>{referenceTitle}</span> (
              {formatReferenceLabel(value?.relationType as TicketReferenceRelation)})
            </>
          ),
        };
      }

      if (action === 'updated') {
        return {
          description: 'updated related ticket label',
          details: (
            <>
              from{' '}
              <span className='font-semibold'>
                {formatReferenceLabel(value?.oldRelationType as TicketReferenceRelation)}
              </span>{' '}
              to{' '}
              <span className='font-semibold'>
                {formatReferenceLabel(value?.relationType as TicketReferenceRelation)}
              </span>{' '}
              for <span className='font-semibold'>{referenceTitle}</span>
            </>
          ),
        };
      }

      return {
        description: 'updated related ticket',
        details: <span className='font-semibold'>{referenceTitle}</span>,
      };
    }

    case ActivityType.SUBTICKET_CREATED: {
      const subTicketXyneId =
        value?.subTicketXyneId || value?.subTicketId?.substring(0, 8).toUpperCase();
      return {
        description: 'created subticket',
        details: <span className='font-semibold'>{subTicketXyneId}</span>,
      };
    }

    case ActivityType.BOARD: {
      const oldBoard = boards?.find(b => b.id === value?.oldValue);
      const newBoard = boards?.find(b => b.id === value?.newValue);
      return {
        description: 'moved ticket from board',
        details: (
          <>
            <span className='font-semibold'>{oldBoard?.name || value?.oldValue || ''}</span> to{' '}
            <span className='font-semibold'>{newBoard?.name || value?.newValue || ''}</span>
          </>
        ),
      };
    }

    case ActivityType.IS_ARCHIVED:
      return {
        description: 'archived the ticket',
        details: '',
      };

    case ActivityType.MERGED: {
      const srcId = (activity.value as Record<string, unknown> | null)?.['sourceTicketId'] as
        | string
        | undefined;
      const srcXyneId = (activity.value as Record<string, unknown> | null)?.[
        'sourceTicketXyneId'
      ] as string | undefined;
      if (srcId) {
        return {
          description: 'merged',
          details: (
            <>
              <span className='font-semibold'>{srcXyneId || srcId}</span> into this ticket
            </>
          ),
        };
      }
      return {
        description: 'merged this ticket into',
        details: <span className='font-semibold'>{referenceTitle}</span>,
      };
    }

    case ActivityType.UNMERGED: {
      const srcId = (activity.value as Record<string, unknown> | null)?.['sourceTicketId'] as
        | string
        | undefined;
      const srcXyneId = (activity.value as Record<string, unknown> | null)?.[
        'sourceTicketXyneId'
      ] as string | undefined;
      if (srcId) {
        return {
          description: 'unmerged',
          details: (
            <>
              <span className='font-semibold'>{srcXyneId || srcId}</span> from this ticket
            </>
          ),
        };
      }
      return {
        description: 'unmerged this ticket from',
        details: <span className='font-semibold'>{referenceTitle}</span>,
      };
    }

    case ActivityType.TAGS: {
      const action = value?.action;
      const labelName = value?.newValue || value?.oldValue || '';
      if (action === 'removed') {
        return {
          description: 'removed a label:',
          details: <span className='font-semibold'>{labelName}</span>,
        };
      }
      return {
        description: 'added a label:',
        details: <span className='font-semibold'>{labelName}</span>,
      };
    }

    case ActivityType.PR: {
      const parts = formatPRActivityParts(value as PRActivityValue);

      return {
        description: '',
        details: (
          <span>
            {parts.map((part, i) => {
              switch (part.type) {
                case 'text':
                  return <span key={i}>{part.value}</span>;
                case 'strong':
                  return (
                    <span key={i} className='font-semibold'>
                      {part.value}
                    </span>
                  );
                case 'link':
                  return (
                    <a
                      key={i}
                      href={part.href}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='font-semibold text-blue-600 hover:underline'
                    >
                      {part.value}
                    </a>
                  );
              }
            })}
          </span>
        ),
      };
    }

    default:
      return {
        description: 'made a change',
        details: '',
      };
  }
};

export const getActivityIcon = (activity: TicketActivityType): ReactElement => {
  switch (activity.activityType) {
    case ActivityType.PRIORITY:
      return <TicketPriorityIcon size={12} />;
    case ActivityType.STATUS:
    case ActivityType.STAGE_NAME:
    case ActivityType.PR:
      return <TicketStatusIcon size={12} />;
    case ActivityType.TAGS:
      return <Tag size={12} className='text-gray-400' />;
    case ActivityType.ETA:
    case ActivityType.STAGE_ETA:
      return <Calendar size={12} />;
    case ActivityType.SUBTICKET_CREATED:
      return <FileText size={12} className='text-blue-600' />;
    case ActivityType.BOARD:
      return <SquareKanban size={12} className='text-purple-600' />;
    case ActivityType.IS_ARCHIVED:
      return <Archive size={12} className='text-amber-600' />;
    case ActivityType.MERGED:
      return <GitMerge size={12} className='text-blue-600' />;
    case ActivityType.UNMERGED:
      return <GitMerge size={12} className='text-green-600' />;
    case ActivityType.PR_REVIEWER:
    case ActivityType.QA:
    case ActivityType.ASSIGNED_TO:
      return <SmallUserAvatar userId={activity.updatedBy} />;
    default:
      return <SmallUserAvatar userId={activity.updatedBy} />;
  }
};

export const TicketActivity = ({
  activities,
  users,
  userGroups,
  boards,
}: TicketActivityProps): ReactElement => {
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');

  const sortedActivities = useMemo(() => {
    if (!activities) return [];

    return [...activities].sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();

      return sortOrder === 'newest' ? timeB - timeA : timeA - timeB;
    });
  }, [activities, sortOrder]);

  const toggleSort = () => {
    setSortOrder(prev => (prev === 'newest' ? 'oldest' : 'newest'));
  };
  return (
    <div className='mt-8' data-testid='ticket-activity-section'>
      <div className='flex items-center justify-between'>
        <h3 className='text-base font-semibold text-foreground mb-4 flex items-center gap-2'>
          Activity
        </h3>

        <button
          onClick={toggleSort}
          className='flex items-center text-[13px] text-muted-foreground gap-2'
          title={sortOrder === 'newest' ? 'Newest to oldest' : 'Oldest to newest'}
          data-track-category='Tickets'
          data-track-name='ToggleActivitySort'
          data-track-metadata={JSON.stringify({ sortOrder })}
        >
          <ArrowUpDown size={13} />
          {sortOrder === 'newest' ? <p>Oldest</p> : <p>Newest</p>}
        </button>
      </div>

      {sortedActivities.length > 0 ? (
        <div className='relative' data-testid='ticket-activity-list'>
          {sortedActivities.map((activity, index) => (
            <ActivityComponent
              key={activity.id}
              activity={activity}
              index={index}
              users={users}
              userGroups={userGroups}
              {...(boards !== undefined ? { boards } : {})}
              activities={sortedActivities}
            />
          ))}
        </div>
      ) : (
        <div className='text-center py-12 text-muted-foreground'>
          <Activity className='w-12 h-12 mx-auto mb-3 opacity-50' />
          <p className='text-sm'>No activity yet</p>
        </div>
      )}
    </div>
  );
};

export const ActivityComponent = ({
  activity,
  index,
  users,
  boards,
  userGroups,
  activities,
}: {
  activity: TicketActivityType;
  index: number;
  users: User[] | undefined;
  boards?: { id: string; name: string }[];
  userGroups: UserGroup[] | undefined;
  activities: TicketActivityType[];
}) => {
  const activityUser = users?.find(u => u.id === activity.updatedBy);
  const { description, details, hideActorName } = getActivityDescription(
    activity,
    users,
    boards,
    userGroups,
  );
  const isLast = index === activities.length - 1;

  return (
    <div
      key={activity.id}
      className='relative flex items-start gap-3'
      data-testid={`ticket-activity-item-${activity.activityType}`}
    >
      {/* Icon */}
      <div className='flex flex-col items-center self-stretch mt-2'>
        {getActivityIcon(activity)}
        {!isLast && <span className='w-0 flex-1 my-1 border-[0.8px] border-border' />}
      </div>

      {/* Content */}
      <div className='flex-1 min-w-0 mt-1 pb-6'>
        <div className='flex items-center justify-between gap-3'>
          <p className='text-sm text-muted-foreground'>
            {activity.activityType !== ActivityType.PR &&
              !hideActorName &&
              (activityUser?.name || 'Someone')}{' '}
            {description}
            {details && <span className='text-muted-foreground'> {details}</span>}
          </p>
          <span className='text-xs text-muted-foreground whitespace-nowrap flex-shrink-0'>
            {formatTimestamp(activity.timestamp)}
          </span>
        </div>
      </div>
    </div>
  );
};
