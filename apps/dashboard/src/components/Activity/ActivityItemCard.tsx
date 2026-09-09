import React, { createContext, ReactElement, ReactNode, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { useZero } from '../../hooks/useZero';
import {
  activitySkipMarkAsReadThreadRef,
  activitySkipMarkAsReadChannelRef,
} from './activitySkipMarkAsRead';
import { Activity, ChannelType, isDeskChannelType } from '@xyne/shared';
import { mutators } from '../../zero/mutators';
import { resolveSdlcActivityTarget } from './sdlcActivityNavigation';

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
import { differenceInCalendarDays, format, isToday, isYesterday } from 'date-fns';
import { formatTimeAmPm } from '../../utils/dateUtils';
import { UserHoverWrapper } from '../ui/UserMentionPopover/UserMentionPopover';
import { cn } from '../../utils/classNames';
import { Button } from '../ui/Button';
import { SquareCheck, SquareDot } from 'lucide-react';
import { Tooltip } from '../ui/Tooltip';
import { ChannelChipGlyph } from '../Chat/ChatDirectory/FilterChipNode';

interface ActivityItemCardProps {
  activity: Activity;
  actorId: string;
  actorName: string;
  isExpanded?: boolean;
  channelId: string | undefined;
  badgeIcon?: ReactNode;
  badgeColorClass?: string;
  titlePrefix?: ReactNode;
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
  unresolvedChannelLabel?: string;
  onCustomAction?: () => void;
}

export const ActivityItemCard = ({
  activity,
  actorId,
  actorName,
  channelId,
  isExpanded = true,
  badgeIcon,
  badgeColorClass,
  titlePrefix,
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
  unresolvedChannelLabel = 'Unknown Channel',
  onCustomAction,
}: ActivityItemCardProps): ReactElement | null => {
  const navigate = useNavigate();
  const context = useAuthContextValues();
  const { baseRoute } = useRouteContext();
  const zero = useZero();
  const { isMobile } = usePlatform();
  const nofocusRef = useContext(NofocusRefContext);

  const channel = useChannel(channelId || '');
  const { displayName: channelDisplayName } = useChannelDisplayName(channel, context.userID);
  const displayedChannelName = channel ? channelDisplayName : unresolvedChannelLabel;
  const isDeskChannel = isDeskChannelType(channel?.type) || channel?.type === ChannelType.SUPPORT;

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

    if (onCustomAction) {
      onCustomAction();
      return;
    }

    // In the Activity panel, open desk/Support tickets inside the panel's own
    // outlet (so the activity list stays mounted) instead of redirecting to the
    // full /support inbox. The embedded ticket route only exists under
    // /chat/activity, so only rewrite there; everywhere else keep /support.
    const embeddedTicketPath =
      baseRoute === '/chat/activity' && supportTargetPath
        ? supportTargetPath.replace(/^\/support\//, `${baseRoute}/ticket/`)
        : undefined;
    const defaultPath = isDeskChannel
      ? (embeddedTicketPath ?? supportTargetPath ?? (channelId ? `/support/${channelId}` : ''))
      : targetPath;
    const path = resolveSdlcActivityTarget({
      activity,
      channelType: channel?.type,
      fallbackPath: defaultPath,
    });

    if (path) {
      const pathWithActivityId =
        focusThread && !isDeskChannel && !path.startsWith('/sdlc/')
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
    if (isYesterday(dateObj)) {
      return 'Yesterday';
    }
    const daysAgo = differenceInCalendarDays(new Date(), dateObj);
    if (daysAgo > 0 && daysAgo < 7) {
      return format(dateObj, 'EEEE');
    }
    return dateObj.getFullYear() === new Date().getFullYear()
      ? format(dateObj, 'MMM d')
      : format(dateObj, 'MMM d, yyyy');
  };

  const activityTimestamp = activity.updatedAt ?? activity.createdAt;

  const openChannel = () => {
    if (!channelId) return;
    void navigate(
      resolveSdlcActivityTarget({
        activity: { channelId },
        channelType: channel?.type,
        fallbackPath: isDeskChannel ? `/support/${channelId}` : `${baseRoute}/${channelId}`,
      }),
    );
  };

  const handleChannelClick = (e: React.MouseEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    e.preventDefault();
    openChannel();
  };

  const handleChannelKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.stopPropagation();
      e.preventDefault();
      openChannel();
    }
  };

  const showChannelChip =
    actorAction !== 'paused_from_assignment' &&
    actorAction !== 'resumed_from_assignment' &&
    actorAction !== 'workflow_question' &&
    Boolean(channelId);

  const channelChipInner = (
    <>
      <span className='flex shrink-0 opacity-70'>
        <ChannelChipGlyph channel={channel} size={12} />
      </span>
      <span className='truncate'>{displayedChannelName}</span>
    </>
  );

  const channelChipClass =
    'inline-flex min-w-0 max-w-[55%] flex-shrink-0 items-center gap-1 rounded-[6px] bg-activity-chip px-1.5 py-[1px] text-xs font-medium leading-[18px] text-foreground/90 transition-colors';

  return (
    <Button
      variant='ghost'
      role='button'
      onClick={handleClick}
      className={cn(
        'group flex w-full font-normal items-start gap-3 px-3 py-2.5 text-left transition-colors duration-150 h-auto rounded-[14px] border border-transparent',
        activity.isRead ? 'bg-transparent' : 'bg-activity-sidebar-primary',
        'hover:!bg-sidebar-accent',
        'data-[selected]:!bg-sidebar-accent data-[selected]:border-sidebar-border',
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
      <div className='relative flex-shrink-0 pt-px'>
        <UserHoverWrapper userId={actorId}>
          <button
            onClick={e => e.stopPropagation()}
            tabIndex={0}
            data-track-category='ACTIVITY'
            data-track-name='VIEW_USER_AVATAR'
            data-track-metadata={JSON.stringify({ activityId: activity.id, userId: actorId })}
          >
            <UserAvatar userId={actorId} size={AvatarSize.REGULAR} showActiveStatus={false} />
            {badgeIcon ? (
              <div
                className={cn(
                  'absolute -bottom-1 -right-1 flex size-5 [&_svg]:size-3.5 [&_span]:text-xs leading-none items-center justify-center rounded-full bg-muted border-[0.5px]',
                  badgeColorClass,
                )}
              >
                {badgeIcon}
              </div>
            ) : null}
          </button>
        </UserHoverWrapper>
      </div>

      <div className='flex flex-1 flex-col min-w-0 overflow-hidden'>
        <div className='flex w-full items-center gap-2'>
          <div className='flex min-w-0 flex-1 items-center gap-1.5 [&>span]:min-w-0'>
            {titlePrefix && <span className='inline-flex flex-shrink-0'>{titlePrefix}</span>}
            {isMobile ? (
              <span
                className={cn(
                  'truncate text-[15px] font-semibold leading-5',
                  activity.isRead ? 'text-muted-foreground' : 'text-foreground',
                )}
              >
                {actorName}
              </span>
            ) : (
              <UserHoverWrapper userId={actorId}>
                <button
                  className={cn(
                    'block max-w-full truncate text-[15px] font-semibold leading-5 hover:underline',
                    activity.isRead ? 'text-muted-foreground' : 'text-foreground',
                  )}
                  onClick={e => e.stopPropagation()}
                  data-track-category='ACTIVITY'
                  data-track-name='VIEW_USER_PROFILE'
                  data-track-metadata={JSON.stringify({ activityId: activity.id, userId: actorId })}
                >
                  {actorName}
                </button>
              </UserHoverWrapper>
            )}
          </div>

          <span className='flex-shrink-0 flex items-center gap-1.5 whitespace-nowrap text-xs tabular-nums text-muted-foreground'>
            {!isMobile &&
              !['reacted', 'removed'].includes(activity.actorAction) &&
              !isDeskChannel &&
              (activity.isRead ? (
                <Tooltip content='Mark as unread' delayDuration={0} side='top'>
                  <div
                    role='button'
                    tabIndex={0}
                    onClick={handleMarkAsUnread}
                    onKeyDown={handleMarkAsUnreadKeyDown}
                    className='-m-1 p-1 opacity-0 group-hover:opacity-100 transition-opacity rounded-md hover:bg-accent/50 cursor-pointer'
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
                    className='-m-1 p-1 opacity-0 group-hover:opacity-100 transition-opacity rounded-md hover:bg-accent/50 cursor-pointer'
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
              <span className='h-2 w-2 rounded-full bg-primary flex-shrink-0' />
            )}
            {getTimestampDisplay(activityTimestamp)}
          </span>
        </div>

        <div
          className={cn(
            'mt-0.5 flex w-full min-w-0 items-center gap-1.5',
            activity.isRead ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          <span
            className={cn(
              'min-w-0 truncate [&_span]:text-[13px] [&_span]:leading-[18px]',
              activity.isRead ? '' : '[&_span]:text-foreground',
            )}
          >
            {description}
          </span>
          {showChannelChip &&
            (isMobile ? (
              <span className={channelChipClass}>{channelChipInner}</span>
            ) : (
              <Tooltip content={displayedChannelName} delayDuration={400} side='top'>
                <span
                  role='button'
                  tabIndex={0}
                  className={cn(channelChipClass, 'cursor-pointer hover:bg-activity-chip-hover')}
                  onClick={handleChannelClick}
                  onKeyDown={handleChannelKeyDown}
                  data-track-category='ACTIVITY'
                  data-track-name='VIEW_CHANNEL'
                  data-track-metadata={JSON.stringify({
                    activityId: activity.id,
                    channelId: activity.channelId,
                    channelName: displayedChannelName,
                  })}
                >
                  {channelChipInner}
                </span>
              </Tooltip>
            ))}
        </div>

        <div
          className={cn(
            'mt-1 w-full',
            activity.isRead
              ? 'text-muted-foreground [&_.jp-message-html]:text-muted-foreground'
              : 'text-foreground',
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
