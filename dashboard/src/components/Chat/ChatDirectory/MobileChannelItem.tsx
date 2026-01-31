import { ReactElement, useRef, useState, useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Hash, Pencil, Headphones } from 'lucide-react';
import { ChannelVisibility, Channel } from '@xyne/shared';
import { isDMChannel } from './ChatDirectory.utils';
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

interface MobileChannelItemProps {
  channel: Channel;
  unreadCount?: number;
}

const MobileChannelItem = ({ channel, unreadCount = 0 }: MobileChannelItemProps): ReactElement => {
  const { channelId: activeChannelId } = useParams();
  const context = useAuthContextValues();

  const nameRef = useRef<HTMLSpanElement>(null);

  const [isTruncated, setIsTruncated] = useState(false);
  const currentUserID = context.userID;

  // Get draft message from localStorage
  const draftMessage = useMemo<string | undefined>(() => {
    try {
      const stored = localStorage.getItem('channel-draft-message');
      if (!stored) return undefined;
      const allDrafts = JSON.parse(stored) as Record<string, { text: string } | undefined>;
      return allDrafts[channel.id]?.text.trim() || undefined;
    } catch {
      return undefined;
    }
  }, [channel.id]);

  const isActive = activeChannelId === channel.id;
  const isPrivate = channel.visibility === ChannelVisibility.PRIVATE;
  const isDM = isDMChannel(channel.scopeType);

  // Get active calls from roomActor
  const activeCalls = useSelector(roomActor, state => state.context.activeCalls);
  const hasActiveCall = activeCalls?.some(call => call.channelId === channel.id);

  const { displayName, avatarUserId } = useChannelDisplayName(channel, currentUserID);

  const status = useGetChannelUserStatus(channel.id);
  const hasUnreadCount = unreadCount > 0;
  const shouldShowBold = isDM
    ? hasUnreadCount
    : hasUnreadCount ||
      (!!status?.lastViewedAt &&
        !!channel.lastActivityAt &&
        channel.lastActivityAt > status.lastViewedAt);

  const getIcon = (): ReactElement => {
    if (isDM && avatarUserId) {
      return <Avatar userId={avatarUserId} size='sm' />;
    }

    return isPrivate ? <ChatLock color={isActive ? '#1D1E1F' : '#464C53'} /> : <Hash size={12} />;
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
              <div className='absolute bottom-0 right-0 size-[6px] bg-[#00c951] border border-white rounded-full' />
            )} */}
          </div>
          <span
            ref={nameRef}
            className={cn(
              'flex-1 truncate min-w-0 text-[16px] leading-[1.2] tracking-[-0.32px]',
              shouldShowBold ? 'font-semibold text-[#181B1D]' : 'font-medium text-[#788187]',
            )}
          >
            {displayName}
          </span>
          {hasActiveCall && <Headphones size={14} className='shrink-0' />}
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
