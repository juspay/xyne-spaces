import { ReactElement, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useZero } from '@rocicorp/zero/react';
import { Activity } from '@xyne/shared';
import { mutators } from '../../zero/mutators';
import { useChannel } from '../../hooks/useChannels';
import { useChannelDisplayName } from '../../hooks/useChannelDisplayName';
import { useAuthContextValues } from '../../hooks/useAuth';
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

  return (
    <Button
      variant='ghost'
      role='button'
      onClick={handleClick}
      className={cn(
        'group flex w-full items-start gap-3 p-4 text-left transition-colors duration-150 h-auto rounded-none border-b border-[#F2F2F3]',
        !activity.isRead ? 'bg-[#F2F2F3] hover:bg-[#EDF3F7]' : 'bg-white hover:bg-gray-50',
        className,
      )}
    >
      <div className='relative flex-shrink-0'>
        <UserHoverWrapper userId={actorId}>
          <button onClick={e => e.stopPropagation()} tabIndex={0}>
            <UserAvatar userId={actorId} size={AvatarSize.REGULAR} showActiveStatus={false} />
            <div
              className={cn(
                'absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#FAFAFA] border-[0.5px] p-1',
                badgeColorClass,
              )}
            >
              {badgeIcon}
            </div>
          </button>
        </UserHoverWrapper>
      </div>

      <div className='flex flex-1 flex-col min-w-0'>
        <div className='flex w-full items-start justify-between gap-2'>
          <div className='flex flex-wrap items-baseline gap-x-1.5 text-sm leading-snug'>
            <UserHoverWrapper userId={actorId}>
              <button
                className='font-semibold text-[#181B1D] hover:underline'
                onClick={e => e.stopPropagation()}
              >
                {actorName}
              </button>
            </UserHoverWrapper>

            <span className='text-[#505B62]'>{description}</span>

            {actorAction !== 'paused_from_assignment' && (
              <GenericMentionHoverPopover
                data={{
                  icon: '#',
                  title: channelDisplayName,
                  subtitle: channel?.description || 'Channel',
                }}
              >
                <button
                  className='font-semibold text-[#3B4145] hover:underline cursor-pointer'
                  onClick={e => e.stopPropagation()}
                >
                  {`#${channel ? channelDisplayName : 'Unknown Channel'}`}
                </button>
              </GenericMentionHoverPopover>
            )}
          </div>

          <span className='flex-shrink-0 whitespace-nowrap text-xs text-[#505B62]'>
            {getTimestampDisplay(activity.createdAt)}
          </span>
        </div>

        {/* Content Body */}
        <div
          className={cn(
            'mt-px w-full text-[#3B4145]',
            isExpanded ? '' : 'line-clamp-1 break-words whitespace-normal',
          )}
        >
          {children}
        </div>
      </div>
    </Button>
  );
};
