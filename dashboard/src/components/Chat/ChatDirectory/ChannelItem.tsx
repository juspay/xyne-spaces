import { ReactElement, useRef, useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Hash, Pencil, Headphones, X } from 'lucide-react';
import { ChannelVisibility, NotificationLevel } from '@xyne/shared';
import { VisibleChannel } from '../../../machines/stateMachine';
import { isDMChannel } from './ChatDirectory.utils';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import ChatLock from '../../icons/ChatLock';
import { useChannelHasActiveCall } from '../../../hooks/useCalls';
import { useGetChannelUserStatus } from '../../../hooks/useChannels';
import Badge from '../../ui/Badge';
import Avatar from '../../ui/Avatar/Avatar';
import Tooltip from '../../ui/Tooltip';
import { cn } from '../../../utils/classNames';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';

interface ChannelItemProps {
  channel: VisibleChannel;
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
  const zero = useZero();
  const navigate = useNavigate();

  const isActive = activeChannelId === channel.id;
  const isPrivate = channel.visibility === ChannelVisibility.PRIVATE;
  const isDM = isDMChannel(channel.scopeType);

  const hasActiveCall = useChannelHasActiveCall(channel.id);

  const { displayName, avatarUserId } = useChannelDisplayName(channel, currentUserID);

  const status = useGetChannelUserStatus(channel.id);
  const hasUnreadCount = unreadCount > 0;
  const isMuted = status?.desktopNotificationLevel === NotificationLevel.NONE;
  const shouldShowBold = isDM
    ? hasUnreadCount
    : !isMuted &&
      (hasUnreadCount ||
        (!!status?.lastViewedAt &&
          !!channel.channelStats?.lastActivityAt &&
          channel.channelStats?.lastActivityAt > status.lastViewedAt));

  const handleCloseDm = (e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    zero.mutate(mutators.channel.closeDm({ channelId: channel.id, updatedAt: Date.now() }));
    // If currently viewing this DM, navigate away
    if (isActive) {
      void navigate('/chat/dir');
    }
  };

  const getIcon = (): ReactElement => {
    if (isDM && avatarUserId) {
      return <Avatar userId={avatarUserId} size='sm' />;
    }

    return isPrivate ? (
      <ChatLock color={isActive ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))'} />
    ) : (
      <Hash size={12} />
    );
  };

  // Truncation detection for tooltip
  const nameRef = useRef<HTMLSpanElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useEffect(() => {
    const el = nameRef.current;
    if (!el) {
      setIsTruncated(false);
      return;
    }
    setIsTruncated(el.scrollWidth > el.clientWidth);
  }, [displayName]);

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
          'group/chitem text-base flex items-center gap-2 rounded-lg px-2 h-8 transition-colors',
          'hover:bg-muted hover:text-foreground',

          isActive ? 'bg-muted' : 'bg-transparent',

          shouldShowBold
            ? '!font-bold text-foreground'
            : isActive
              ? 'font-normal text-foreground'
              : 'font-normal text-muted-foreground',
        )}
        style={shouldShowBold ? { fontWeight: '700' } : undefined}
        data-track-category='CHAT_SIDEBAR'
        data-track-name='OPEN_CHANNEL'
        data-track-metadata={JSON.stringify({
          channelId: channel.id,
          channelName: displayName,
          isDM,
        })}
      >
        <div className='flex items-center gap-2 w-full min-w-0'>
          <div className={`flex items-center justify-center flex-shrink-0 `}>{getIcon()}</div>

          <span ref={nameRef} className='text-[13px] flex-1 truncate min-w-0'>
            {displayName}
          </span>
          {hasActiveCall && (
            <span className='shrink-0 rounded-full bg-status-success px-2 py-1 text-background'>
              <Headphones size={14} />
            </span>
          )}
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
          {/* Close button for DMs - revealed on hover via CSS (no React re-render) */}
          {isDM && (
            <button
              onClick={handleCloseDm}
              className='invisible pointer-events-none group-hover/chitem:visible group-hover/chitem:pointer-events-auto p-1 rounded hover:bg-accent transition-colors shrink-0'
              aria-label='Close conversation'
              title='Close conversation'
              data-track-category='CHAT_SIDEBAR'
              data-track-name='CLOSE_DM_CHANNEL'
              data-track-metadata={JSON.stringify({
                channelId: channel.id,
                channelName: displayName,
              })}
            >
              <X size={14} className='text-muted-foreground hover:text-foreground' />
            </button>
          )}
        </div>
      </Link>
    </Tooltip>
  );
};

export default ChannelItem;
