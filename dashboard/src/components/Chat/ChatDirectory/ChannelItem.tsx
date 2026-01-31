import { ReactElement, useRef, useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Hash, Pencil, Headphones, X } from 'lucide-react';
import { ChannelVisibility, Channel } from '@xyne/shared';
import { isDMChannel } from './ChatDirectory.utils';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import ChatLock from '../../icons/ChatLock';
import { useSelector } from '@xstate/react';
import { roomActor } from '../../../machines/roomMachine';
import { useGetChannelUserStatus } from '../../../hooks/useChannels';
import Badge from '../../ui/Badge';
import Avatar from '../../ui/Avatar/Avatar';
import useMeasure from '../../../hooks/useMeasure';
import Tooltip from '../../ui/Tooltip';
import { cn } from '../../../utils/classNames';
import { useZero } from '@rocicorp/zero/react';
import { mutators } from '../../../zero/mutators';

interface ChannelItemProps {
  channel: Channel;
  activeChannelId?: string | undefined;
  currentUserID: string;
  draftMessage?: string | undefined;
  unreadCount?: number;
}

const ChannelItem = ({
  channel,
  activeChannelId,
  currentUserID,
  draftMessage,
  unreadCount = 0,
}: ChannelItemProps): ReactElement => {
  const [isHovered, setIsHovered] = useState(false);
  const zero = useZero();
  const navigate = useNavigate();

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

  const handleCloseDm = (e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    zero.mutate(mutators.channel.closeDm({ channelId: channel.id }));
    // If currently viewing this DM, navigate away
    if (isActive) {
      void navigate('/chat/dir');
    }
  };

  const getIcon = (): ReactElement => {
    if (isDM && avatarUserId) {
      return <Avatar userId={avatarUserId} size='sm' />;
    }

    return isPrivate ? <ChatLock color={isActive ? '#1D1E1F' : '#464C53'} /> : <Hash size={12} />;
  };

  // Truncation detection for tooltip
  const nameRef = useRef<HTMLSpanElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

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
      sideOffset={6}
      {...(!isTruncated && { open: false })} // <= disable tooltip when not truncated
    >
      <Link
        to={`/chat/dir/${channel.id}`}
        className={cn(
          'text-base flex items-center gap-2 rounded-lg px-2 h-8 transition-colors',
          'hover:bg-[#E4E6E7] hover:text-[#181B1D]',

          isActive ? 'bg-[#E4E6E7]' : 'bg-transparent',

          shouldShowBold
            ? '!font-bold text-[#181B1D]'
            : isActive
              ? 'font-normal text-[#181B1D]'
              : 'font-normal text-[#788187]',
        )}
        style={shouldShowBold ? { fontWeight: '700' } : undefined}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div className='flex items-center gap-2 w-full min-w-0'>
          <div className={`flex items-center justify-center flex-shrink-0 `}>{getIcon()}</div>

          <span ref={nameRef} className='text-[13px] flex-1 truncate min-w-0'>
            {displayName}
          </span>
          {hasActiveCall && <Headphones size={14} className='text-[#464C53] shrink-0' />}
          {draftMessage && !isActive && (
            <Tooltip
              content={
                <div className='max-w-xs text-center'>
                  <span className='font-semibold mb-1'>Draft</span>
                  <span className='text-xs opacity-90 line-clamp-2 mb-1'>
                    &quot;{draftMessage}&quot;
                  </span>
                </div>
              }
              side='top'
              sideOffset={6}
            >
              <span className='ml-1' aria-label='Has draft'>
                <Pencil size={10} aria-hidden='true' />
              </span>
            </Tooltip>
          )}
          {unreadCount > 0 && !isActive && (
            <Badge variant='success' className='font-mono'>
              {unreadCount > 10 ? '10+' : unreadCount}
            </Badge>
          )}
          {/* Close button for DMs - shown on hover */}
          {isDM && isHovered && (
            <button
              onClick={handleCloseDm}
              className='p-1 rounded hover:bg-gray-300 transition-colors shrink-0'
              aria-label='Close conversation'
              title='Close conversation'
            >
              <X size={14} className='text-gray-500 hover:text-gray-700' />
            </button>
          )}
        </div>
      </Link>
    </Tooltip>
  );
};

export default ChannelItem;
