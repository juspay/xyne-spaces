import React, { createContext, ReactElement, ReactNode, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { useZero } from '../../hooks/useZero';
import {
  activitySkipMarkAsReadThreadRef,
  activitySkipMarkAsReadChannelRef,
} from './activitySkipMarkAsRead';
import { Activity, ChannelType, isDeskChannelType } from '@xyne/shared';
import { mutators } from '../../zero/mutators';

/** Ref-based context: when current=true, ActivityItemCard appends ?nofocus=1 to navigation. */
const NofocusRefContext = createContext<React.RefObject<boolean>>({ current: false });
export const NofocusRefProvider = NofocusRefContext.Provider;
import { useChannel } from '../../hooks/useChannels';
import { useChannelDisplayName } from '../../hooks/useChannelDisplayName';
import { useAuthContextValues } from '../../hooks/useAuth';
import { useRouteContext } from '../../hooks/useRouteContext';
import { usePlatform } from '../../hooks/usePlatform';
import UserAvatar from '../UserAvatar/UserAvatar';
import { AvatarSize } from '../UserAvatar/UserAvatar';
import { formatDistanceToNow, isToday } from 'date-fns';
import { formatTimeAmPm } from '../../utils/dateUtils';
import { UserHoverWrapper } from '../ui/UserMentionPopover/UserMentionPopover';
import { cn } from '../../utils/classNames';
import { Button } from '../ui/Button';
import { GenericMentionHoverPopover } from '../ui/GenericMentionPopover/GenericMentionPopover';
import { SquareCheck, SquareDot } from 'lucide-react';
import { Tooltip } from '../ui/Tooltip';

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
  supportTargetPath?: string | undefined;
  children: ReactNode;
  className?: string;
  actorAction?: string;
  showUnreadDot?: boolean;
  linkedItemCreatedAt?: number;
  useActivityCutoff?: boolean;
  focusThread?: boolean;
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
  supportTargetPath,
  children,
  className,
  actorAction,
  showUnreadDot = false,
  linkedItemCreatedAt,
  useActivityCutoff = true,
  focusThread = false,
}: ActivityItemCardProps): ReactElement | null => {
  const navigate = useNavigate();
  const context = useAuthContextValues();
  const { baseRoute } = useRouteContext();
  const zero = useZero();
  const { isMobile } = usePlatform();
  const nofocusRef = useContext(NofocusRefContext);

  const channel = useChannel(channelId || '');
  const { displayName: channelDisplayName } = useChannelDisplayName(channel, context.userID);

  // Appends ?selectedActivity=id to path, preserving existing hash
  const appendSelectedActivity = (path: string): string => {
    const hashIdx = path.indexOf('#');
    const base = hashIdx >= 0 ? path.slice(0, hashIdx) : path;
    const hash = hashIdx >= 0 ? path.slice(hashIdx) : '';
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}selectedActivity=${activity.id}${hash}`;
  };

  // Appends ?focusThread=1 to path, preserving existing hash — signals ChatView to
  // open the thread directly without mounting the channel list (perf).
  const appendFocusThread = (path: string): string => {
    const hashIdx = path.indexOf('#');
    const base = hashIdx >= 0 ? path.slice(0, hashIdx) : path;
    const hash = hashIdx >= 0 ? path.slice(hashIdx) : '';
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}focusThread=1${hash}`;
  };

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Always mark as read on any click (including URL clicks per FR-4)
    if (!activity.isRead) {
      void zero.mutate(mutators.activities.markAsRead({ activityId: activity.id }));
    }
    // If the click originated from a hyperlink inside the message content,
    // let the browser handle it and do not navigate the card
    const target = e.target as HTMLElement;
    if (target.closest('a')) {
      return;
    }

    const isDeskChannel = isDeskChannelType(channel?.type);
    // In the Activity panel, open desk/Support tickets inside the panel's own
    // outlet (so the activity list stays mounted) instead of redirecting to the
    // full /support inbox. The embedded ticket route only exists under
    // /chat/activity, so only rewrite there; everywhere else keep /support.
    const embeddedTicketPath =
      baseRoute === '/chat/activity' && supportTargetPath
        ? supportTargetPath.replace(/^\/support\//, `${baseRoute}/ticket/`)
        : undefined;
    const path = isDeskChannel
      ? (embeddedTicketPath ?? supportTargetPath ?? (channelId ? `/support/${channelId}` : ''))
      : targetPath;

    if (path) {
      const pathWithActivityId =
        focusThread && !isDeskChannel
          ? appendFocusThread(appendSelectedActivity(path))
          : appendSelectedActivity(path);
      const state = {
        activityNavigationNonce: Date.now(),
        ...(linkedItemCreatedAt !== undefined ? { linkedItemCreatedAt } : {}),
        ...(useActivityCutoff && activity.conversationSeenCutoffAt
          ? { linkedCutoffCreatedAt: activity.conversationSeenCutoffAt }
          : {}),
      };

      if (nofocusRef.current) {
        const separator = pathWithActivityId.includes('?') ? '&' : '?';
        const hashIdx = pathWithActivityId.indexOf('#');
        const pathWithoutHash =
          hashIdx >= 0 ? pathWithActivityId.slice(0, hashIdx) : pathWithActivityId;
        const hash = hashIdx >= 0 ? pathWithActivityId.slice(hashIdx) : '';
        void navigate(`${pathWithoutHash}${separator}nofocus=1${hash}`, {
          state,
        });
      } else {
        void navigate(pathWithActivityId, {
          state,
        });
      }
    }
  };

  // Whether THIS card is the currently-open activity. Selection highlighting
  // is imperative (ActivityListView stamps `data-selected` on the row root —
  // no React state, no per-row router subscription), so read it back from the
  // DOM, with the ?selectedActivity= URL param as a fallback.
  const isCardActive = (origin: HTMLElement | null): boolean =>
    origin?.closest('[data-activity-id]')?.hasAttribute('data-selected') ||
    new URLSearchParams(window.location.search).get('selectedActivity') === activity.id;

  const doMarkAsUnread = (origin: HTMLElement | null) => {
    // Check if this is a reaction activity (excluded)
    if (['reacted', 'removed'].includes(activity.actorAction)) {
      return;
    }

    void zero.mutate(
      mutators.activities.markAsUnread({
        activityId: activity.id,
        timestamp: Date.now(),
      }),
    );

    if (isCardActive(origin)) {
      activitySkipMarkAsReadThreadRef.current = true;
      activitySkipMarkAsReadChannelRef.current = true;
    }
  };

  const handleMarkAsUnread = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation(); // Prevent triggering the card's onClick
    e.preventDefault();
    doMarkAsUnread(e.currentTarget);
  };

  const handleMarkAsUnreadKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.stopPropagation();
      e.preventDefault();
      doMarkAsUnread(e.currentTarget);
    }
  };

  const doMarkAsRead = () => {
    if (!activity.isRead) {
      void zero.mutate(mutators.activities.markAsRead({ activityId: activity.id }));
    }
  };

  const handleMarkAsRead = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    doMarkAsRead();
  };

  const handleMarkAsReadKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.stopPropagation();
      e.preventDefault();
      doMarkAsRead();
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
        'group flex w-full items-start gap-3 p-4 text-left transition-colors duration-150 h-auto rounded-none border-b border-border border-l-4',
        // Selection highlight is driven by the `data-selected` attribute that
        // ActivityListView stamps imperatively (no render needed to update).
        'border-l-transparent data-[selected]:border-l-foreground',
        !activity.isRead ? 'bg-accent hover:!bg-accent/50' : 'bg-card hover:!bg-muted/30',
        className,
      )}
      data-activity-id={activity.id}
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

          <span className='flex-shrink-0 flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground ml-auto sm:ml-2'>
            {!isMobile &&
              !['reacted', 'removed'].includes(activity.actorAction) &&
              !isDeskChannelType(channel?.type) &&
              channel?.type !== ChannelType.SUPPORT &&
              (activity.isRead ? (
                <Tooltip content='Mark as unread' delayDuration={0} side='top'>
                  <div
                    role='button'
                    tabIndex={0}
                    onClick={handleMarkAsUnread}
                    onKeyDown={handleMarkAsUnreadKeyDown}
                    className='opacity-0 group-hover:opacity-100 transition-opacity rounded hover:bg-accent/50 cursor-pointer'
                    aria-label='Mark as unread'
                    data-track-category='ACTIVITY'
                    data-track-name='MARK_AS_UNREAD'
                    data-track-metadata={JSON.stringify({
                      activityId: activity.id,
                      actorAction: activity.actorAction,
                    })}
                  >
                    <SquareDot className='w-3.5 h-3.5 text-muted-foreground hover:text-foreground' />
                  </div>
                </Tooltip>
              ) : (
                <Tooltip content='Mark as read' delayDuration={0} side='top'>
                  <div
                    role='button'
                    tabIndex={0}
                    onClick={handleMarkAsRead}
                    onKeyDown={handleMarkAsReadKeyDown}
                    className='opacity-0 group-hover:opacity-100 transition-opacity rounded hover:bg-accent/50 cursor-pointer'
                    aria-label='Mark as read'
                    data-track-category='ACTIVITY'
                    data-track-name='MARK_AS_READ'
                    data-track-metadata={JSON.stringify({
                      activityId: activity.id,
                      actorAction: activity.actorAction,
                    })}
                  >
                    <SquareCheck className='w-3.5 h-3.5 text-muted-foreground hover:text-foreground' />
                  </div>
                </Tooltip>
              ))}
            {showUnreadDot && !activity.isRead && (
              <span className='h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0' />
            )}
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
