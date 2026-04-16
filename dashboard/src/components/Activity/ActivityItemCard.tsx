import { ReactElement, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useZero } from '../../hooks/useZero';
import { Activity } from '@xyne/shared';
import { mutators } from '../../zero/mutators';
import { useChannel } from '../../hooks/useChannels';
import { useChannelDisplayName } from '../../hooks/useChannelDisplayName';
import { useAuthContextValues } from '../../hooks/useAuth';
import { usePlatform } from '../../hooks/usePlatform';
import UserAvatar from '../UserAvatar/UserAvatar';
import { AvatarSize } from '@juspay/blend-design-system';
import { formatDistanceToNow, isToday } from 'date-fns';
import { formatTimeAmPm } from '../../utils/dateUtils';
import { UserHoverWrapper } from '../ui/UserMentionPopover/UserMentionPopover';
import { cn } from '../../utils/classNames';
import { Button } from '../ui/Button';
import { GenericMentionHoverPopover } from '../ui/GenericMentionPopover/GenericMentionPopover';

interface ActivityItemCardProps {
  activity: Activity;
  actorId: string;
  actorName: string;
  isExpanded?: boolean;
  channelId: string | undefined;
  badgeIcon: ReactNode;
  badgeColorClass?: string;
  description: ReactNode;
  targetPath: string;
  children: ReactNode;
  className?: string;
  actorAction?: string;
}

export const ActivityItemCard = ({
  activity,
  actorId,
  actorName,
  channelId,
  isExpanded = true,
  badgeIcon,
  badgeColorClass,
  description,
  targetPath,
  children,
  className,
  actorAction,
}: ActivityItemCardProps): ReactElement | null => {
  const navigate = useNavigate();
  const context = useAuthContextValues();
  const zero = useZero();
  const { isMobile } = usePlatform();

  const channel = useChannel(channelId || '');
  const { displayName: channelDisplayName } = useChannelDisplayName(channel, context.userID);

  const handleClick = () => {
    if (!activity.isRead) {
      void zero.mutate(mutators.activities.markAsRead({ activityId: activity.id }));
    }
    if (targetPath) {
      void navigate(targetPath);
    }
  };

  const getTimestampDisplay = (date: number | Date) => {
    const dateObj = typeof date === 'number' ? new Date(date) : date;
    if (isToday(dateObj)) {
      return formatTimeAmPm(dateObj);
    }
    return formatDistanceToNow(dateObj, { addSuffix: true });
  };

  const activityTimestamp = activity.updatedAt ?? activity.createdAt;

  return (
    <Button
      variant='ghost'
      role='button'
      onClick={handleClick}
      className={cn(
        'group flex w-full items-start gap-3 p-4 text-left transition-colors duration-150 h-auto rounded-none border-b border-border',
        !activity.isRead ? 'bg-muted hover:bg-accent' : 'bg-card hover:bg-muted',
        className,
      )}
      data-track-category='ACTIVITY'
      data-track-name='OPEN_ACTIVITY_ITEM'
      data-track-metadata={JSON.stringify({
        activityId: activity.id,
        actorAction: activity.actorAction,
        isRead: activity.isRead,
      })}
    >
      <div className='relative flex-shrink-0'>
        <UserHoverWrapper userId={actorId}>
          <button
            onClick={e => e.stopPropagation()}
            tabIndex={0}
            data-track-category='ACTIVITY'
            data-track-name='VIEW_USER_AVATAR'
            data-track-metadata={JSON.stringify({ activityId: activity.id, userId: actorId })}
          >
            <UserAvatar userId={actorId} size={AvatarSize.REGULAR} showActiveStatus={false} />
            <div
              className={cn(
                'absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-muted border-[0.5px] p-1',
                badgeColorClass,
              )}
            >
              {badgeIcon}
            </div>
          </button>
        </UserHoverWrapper>
      </div>

      <div className='flex flex-1 flex-col min-w-0 overflow-hidden'>
        <div className='flex w-full items-start justify-between gap-2 flex-wrap'>
          <div className='flex flex-wrap items-baseline gap-x-1.5 text-sm leading-snug min-w-0 flex-1'>
            {isMobile ? (
              <span className='font-semibold text-foreground'>{actorName}</span>
            ) : (
              <UserHoverWrapper userId={actorId}>
                <button
                  className='font-semibold text-foreground hover:underline flex-shrink-0'
                  onClick={e => e.stopPropagation()}
                  data-track-category='ACTIVITY'
                  data-track-name='VIEW_USER_PROFILE'
                  data-track-metadata={JSON.stringify({ activityId: activity.id, userId: actorId })}
                >
                  {actorName}
                </button>
              </UserHoverWrapper>
            )}

            <span className='text-muted-foreground flex-shrink-0'>{description}</span>

            {actorAction !== 'paused_from_assignment' &&
              actorAction !== 'resumed_from_assignment' &&
              actorAction !== 'workflow_question' &&
              (isMobile ? (
                <span className='font-semibold text-foreground'>
                  {`#${channel ? channelDisplayName : 'Unknown Channel'}`}
                </span>
              ) : (
                <GenericMentionHoverPopover
                  data={{
                    icon: '#',
                    title: channelDisplayName,
                    subtitle: channel?.description || 'Channel',
                  }}
                >
                  <button
                    className='font-semibold text-foreground hover:underline cursor-pointer text-left whitespace-normal'
                    onClick={e => e.stopPropagation()}
                    data-track-category='ACTIVITY'
                    data-track-name='VIEW_CHANNEL'
                    data-track-metadata={JSON.stringify({
                      activityId: activity.id,
                      channelId: activity.channelId,
                      channelName: channelDisplayName,
                    })}
                  >
                    {`#${channel ? channelDisplayName : 'Unknown Channel'}`}
                  </button>
                </GenericMentionHoverPopover>
              ))}
          </div>

          <span className='flex-shrink-0 whitespace-nowrap text-xs text-muted-foreground ml-auto sm:ml-2'>
            {getTimestampDisplay(activityTimestamp)}
          </span>
        </div>

        {/* Content Body */}
        <div
          className={cn(
            'mt-px w-full text-foreground',
            isExpanded
              ? 'whitespace-normal break-normal'
              : 'line-clamp-1 break-normal whitespace-normal',
          )}
        >
          {children}
        </div>
      </div>
    </Button>
  );
};
