import { ReactElement, useRef, useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Hash, Pencil, Headphones } from 'lucide-react';
import { ChannelVisibility } from '@xyne/shared';
import { isDMChannel, isGroupDMChannel, parseDMParticipantIds } from './ChatDirectory.utils';
import { useDraft } from '../../../hooks/useDraft';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import ChatLock from '../../icons/ChatLock';
import { useSelector } from '@xstate/react';
import { roomActor } from '../../../machines/roomMachine';
import { useGetChannelUserStatus } from '../../../hooks/useChannels';
import Avatar from '../../ui/Avatar/Avatar';
import useMeasure from '../../../hooks/useMeasure';
import Tooltip from '../../ui/Tooltip';
import { cn } from '../../../utils/classNames';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { useUser } from '../../../hooks/useUsers';
import { StatusIndicator } from '../../ui/StatusIndicator';
import { ChannelScopeType } from '@xyne/shared';
import { VisibleChannel } from '../../../machines/stateMachine';

interface MobileChannelItemProps {
  channel: VisibleChannel;
  unreadCount?: number;
}

const MobileChannelItem = ({ channel, unreadCount = 0 }: MobileChannelItemProps): ReactElement => {
  const { channelId: activeChannelId } = useParams();
  const context = useAuthContextValues();

  const nameRef = useRef<HTMLSpanElement>(null);

  const [isTruncated, setIsTruncated] = useState(false);
  const currentUserID = context.userID;

  // Get draft from state machine (reactive updates)
  const draftMessage = useDraft(channel.id, null);

  const isActive = activeChannelId === channel.id;
  const isPrivate = channel.visibility === ChannelVisibility.PRIVATE;
  const isDM = isDMChannel(channel.scopeType);

  // Get active calls from roomActor
  const activeCalls = useSelector(roomActor, state => state.context.activeCalls);
  const hasActiveCall = activeCalls?.some(call => call.channelId === channel.id);

  const { displayName, avatarUserId } = useChannelDisplayName(channel, currentUserID);

  // Get user status for 1-on-1 DMs only (not group DMs)
  const is1on1DM = channel.scopeType === ChannelScopeType.DM;
  const dmUser = useUser(is1on1DM && avatarUserId ? avatarUserId : '');

  const status = useGetChannelUserStatus(channel.id);
  const hasUnreadCount = unreadCount > 0;
  const shouldShowBold = isDM
    ? hasUnreadCount
    : hasUnreadCount ||
      (!!status?.lastViewedAt &&
        !!channel.channelStats?.lastActivityAt &&
        channel.channelStats?.lastActivityAt > status.lastViewedAt);

  /**
   * Returns the icon for the channel type:
   * - Group DM: participant count badge
   * - 1:1 DM: other user's avatar
   * - Private channel: lock icon
   * - Public channel: hash icon
   */
  const getIcon = (): ReactElement => {
    if (isGroupDMChannel(channel.scopeType)) {
      const participantCount = parseDMParticipantIds(channel).length;
      return (
        <span className='flex items-center justify-center size-5 rounded-md bg-sidebar-item-hover text-sidebar-secondary-foreground text-[10px] font-medium'>
          {participantCount}
        </span>
      );
    } else if (isDM && avatarUserId) {
      return (
        <Avatar
          userId={avatarUserId}
          size='sm'
          className='rounded-md size-5 flex items-center justify-center'
        />
      );
    }

    return isPrivate ? (
      <ChatLock color={isActive ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))'} />
    ) : (
      <Hash size={12} />
    );
  };

  const checkTruncation = (): void => {
    const el = nameRef.current;
    if (!el) {
      setIsTruncated(false);
      return;
    }

    const truncated = el.scrollWidth > el.clientWidth;
    setIsTruncated(truncated);
  };

  const bounds = useMeasure({ ref: nameRef, observeResize: true });

  useEffect(() => {
    checkTruncation();
  }, [bounds.width, displayName]);

  return (
    <Tooltip
      content={displayName}
      delayDuration={1000}
      side='top'
      {...(!isTruncated && { open: false })}
    >
      <Link className='' to={`/chat/dir/${channel.id}`}>
        <div
          className={cn(
            'flex items-center group py-[6px]',
            isDM ? 'gap-[12px]' : 'gap-[8px]',
            isActive && 'bg-sidebar-item-hover rounded-md px-2',
          )}
        >
          {/* Icon/Avatar with online status for DMs */}
          <div className='relative shrink-0 size-[24px] flex items-center justify-center'>
            {getIcon()}
            {/* Online status indicator for DMs - shown on the Avatar */}
            {/* {isDM && avatarUserId && (
              <div className='absolute bottom-0 right-0 size-[6px] bg-status-success border border-background rounded-full' />
            )} */}
          </div>
          <span
            ref={nameRef}
            className={cn(
              'flex-1 truncate min-w-0 text-[16px] leading-[1.2] tracking-[-0.32px] flex items-center gap-1.5',
              shouldShowBold
                ? 'font-semibold text-foreground'
                : 'font-medium text-muted-foreground',
            )}
          >
            <span className='truncate'>{displayName}</span>
            {is1on1DM && (
              <StatusIndicator
                statusEmoji={dmUser?.statusEmoji}
                statusContent={dmUser?.statusContent}
                statusExpiryAt={dmUser?.statusExpiryAt}
                size='sm'
                showOnHover={true}
                hideCallEmoji={hasActiveCall}
              />
            )}
          </span>
          {hasActiveCall && (
            <span className='shrink-0 rounded-full bg-status-success px-2 py-1 text-background'>
              <Headphones size={14} />
            </span>
          )}
          {draftMessage && !isActive && (
            <Tooltip content={draftMessage} side='top' sideOffset={6}>
              <Pencil size={14} className='shrink-0' />
            </Tooltip>
          )}
          {unreadCount > 0 && (
            <div className='bg-sidebar-badge-accent h-[18px] px-[6px] py-px rounded-full flex items-center justify-center'>
              <span className='font-mono font-semibold text-[11px] text-sidebar-badge-accent-foreground leading-normal'>
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            </div>
          )}
        </div>
      </Link>
    </Tooltip>
  );
};

export default MobileChannelItem;
