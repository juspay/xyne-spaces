import { ReactElement, useRef, useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Hash, Pencil, Headphones, X } from 'lucide-react';
import { ChannelVisibility, ChannelScopeType, ChannelType } from '@xyne/shared';
import { VisibleChannel } from '../../../machines/stateMachine';
import { isDMChannel, isGroupDMChannel, parseDMParticipantIds } from './ChatDirectory.utils';
import { useDraft, useDraftFromDB } from '../../../hooks/useDraft';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import ChatLock from '../../icons/ChatLock';
import { useChannelHasActiveCall } from '../../../hooks/useCalls';
import { useGetChannelUserStatus } from '../../../hooks/useChannels';
import Badge from '../../ui/Badge';
import Avatar from '../../ui/Avatar/Avatar';
import useMeasure from '../../../hooks/useMeasure';
import Tooltip from '../../ui/Tooltip';
import { cn } from '../../../utils/classNames';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { usePlatform } from '../../../hooks/usePlatform';
import { useUser } from '../../../hooks/useUsers';
import { StatusIndicator } from '../../ui/StatusIndicator';
import { standaloneNavigate } from '../../../utils/electronApp';
import { SupportChannelBadge } from '../SupportChannelBadge';

interface ChannelItemV2Props {
  channel: VisibleChannel;
  unreadCount?: number;
}

const stripHtml = (html: string): string => {
  if (!html) return '';
  if (typeof document === 'undefined') return html;

  const tmp = document.createElement('DIV');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
};

const ChannelItemV2 = ({ channel, unreadCount = 0 }: ChannelItemV2Props): ReactElement => {
  const [isHovered, setIsHovered] = useState(false);
  const zero = useZero();
  const { channelId: activeChannelId } = useParams();
  const context = useAuthContextValues();
  const navigate = useNavigate();
  const nameRef = useRef<HTMLSpanElement>(null);

  const [isTruncated, setIsTruncated] = useState(false);
  const currentUserID = context.userID;

  const { isMobile } = usePlatform();

  const draftMessage = useDraft(channel.id, null);
  const draftFromDB = useDraftFromDB(channel.id, null);
  const isActive = activeChannelId === channel.id;
  const shouldShowDraft =
    (draftMessage || (draftFromDB && draftFromDB.attachments.length > 0)) && !isActive;
  const isPrivate = channel.visibility === ChannelVisibility.PRIVATE;
  const isDM = isDMChannel(channel.scopeType);

  const hasActiveCall = useChannelHasActiveCall(channel.id);

  const { displayName, avatarUserId } = useChannelDisplayName(channel, currentUserID);

  const status = useGetChannelUserStatus(channel.id);
  const hasUnreadCount = unreadCount > 0;
  const shouldShowBold = isDM
    ? hasUnreadCount
    : hasUnreadCount ||
      (!!status?.lastViewedAt &&
        !!channel.channelStats?.lastActivityAt &&
        channel.channelStats.lastActivityAt > status.lastViewedAt);

  const shouldShowCloseButton = isDM && !isActive && unreadCount === 0 && !isMobile;

  // Get user status for 1-on-1 DMs only (not group DMs)
  const is1on1DM = channel.scopeType === ChannelScopeType.DM;
  const dmUser = useUser(is1on1DM && avatarUserId ? avatarUserId : '');

  // Check if this is a support channel
  const isSupportChannel = channel?.type === ChannelType.SUPPORT;

  const handleCloseDm = (e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    zero.mutate(mutators.channel.closeDm({ channelId: channel.id, updatedAt: Date.now() }));
    // If currently viewing this DM, navigate away
    if (isActive) {
      void navigate('/chat');
    }
  };

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
  const handleChannelClick = (e: React.MouseEvent<HTMLAnchorElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    standaloneNavigate(navigate, `/chat/dir/${channel.id}`, { event: e });
  };

  const bounds = useMeasure({ ref: nameRef, observeResize: true });

  useEffect(() => {
    checkTruncation();
  }, [bounds.width, displayName]);

  const draftTooltipContent = (
    <div className='flex flex-col items-center'>
      {draftMessage && <span>{stripHtml(draftMessage)}</span>}
      {draftFromDB && draftFromDB.attachments.length > 0 && (
        <span>{draftFromDB.attachments.length} attachment(s)</span>
      )}
    </div>
  );

  return (
    <Tooltip
      content={displayName}
      delayDuration={1000}
      side='top'
      {...(!isTruncated && { open: false })} // <= disable tooltip when not truncated
    >
      <Link
        className=''
        to={`/chat/dir/${channel.id}`}
        onClick={handleChannelClick}
        data-track-category='CHAT_SIDEBAR'
        data-track-name='OPEN_CHANNEL'
        data-track-metadata={JSON.stringify({
          channelId: channel.id,
          channelName: displayName,
          isDM,
        })}
      >
        <div
          className={cn(
            'flex items-center gap-2 h-8 group rounded-md px-1.5 transition-colors',
            isActive
              ? 'text-sidebar-primary-foreground font-medium bg-sidebar-item-active'
              : 'text-sidebar-secondary-foreground hover:text-sidebar-primary-foreground hover:bg-sidebar-item-hover',
            shouldShowBold && '!font-semibold text-sidebar-unread-foreground',
          )}
          style={shouldShowBold ? { fontWeight: '700' } : undefined}
        >
          <span className='flex items-center'>{getIcon()}</span>
          <span ref={nameRef} className=' text-sm flex-1 truncate min-w-0 flex items-center gap-2'>
            <span className='visual-regression-hide'>{displayName}</span>
            {isSupportChannel && <SupportChannelBadge />}
            {is1on1DM && (
              <StatusIndicator
                statusEmoji={dmUser?.statusEmoji}
                statusContent={dmUser?.statusContent}
                statusExpiryAt={dmUser?.statusExpiryAt}
                size='sm'
                showOnHover={true}
              />
            )}
          </span>
          {hasActiveCall && (
            <span className='shrink-0 rounded-full bg-status-success px-2 py-1 text-background'>
              <Headphones size={14} />
            </span>
          )}
          {shouldShowDraft && (
            <Tooltip content={draftTooltipContent} side='top' sideOffset={6}>
              <Pencil size={14} className='shrink-0' />
            </Tooltip>
          )}
          {unreadCount > 0 && !isActive && (
            <Badge className='font-mono h-[18px] bg-sidebar-badge-accent px-1.5 text-sidebar-badge-accent-foreground'>
              {unreadCount > 9 ? '9+' : unreadCount}
            </Badge>
          )}
          {shouldShowCloseButton && (
            <Tooltip content='Close conversation' side='top' sideOffset={6} delayDuration={500}>
              <button
                className='group-hover:block hidden p-1 rounded-md -blue'
                onClick={handleCloseDm}
                data-track-category='CHAT_SIDEBAR'
                data-track-name='CLOSE_DM_CHANNEL'
                data-track-metadata={JSON.stringify({
                  channelId: channel.id,
                  channelName: displayName,
                })}
              >
                <X size={14} className='shrink-0' />
              </button>
            </Tooltip>
          )}
        </div>
      </Link>
    </Tooltip>
  );

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
          'text-base flex items-center gap-2 rounded-lg px-2 h-8 transition-colors ',
          'hover:bg-muted hover:text-foreground',

          isActive ? 'bg-muted' : 'bg-transparent',

          unreadCount > 0
            ? 'font-medium text-foreground'
            : isActive
              ? 'font-normal text-foreground'
              : 'font-normal text-muted-foreground',
        )}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        data-track-category='CHAT_SIDEBAR'
        data-track-name='OPEN_CHANNEL'
        data-track-metadata={JSON.stringify({
          channelId: channel.id,
          channelName: displayName,
          isDM,
        })}
      >
        <div
          className={cn(
            'flex items-center gap-2 w-full min-w-0',
            isActive ? 'text-sidebar-text-primary' : 'text-sidebar-text-muted',
          )}
        >
          <div className={`flex items-center justify-center flex-shrink-0 `}>{getIcon()}</div>

          <span ref={nameRef} className={`text-sm flex-1 truncate min-w-0 `}>
            {displayName}
          </span>
          {hasActiveCall && <Headphones size={14} className='text-muted-foreground shrink-0' />}
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
              className='p-1 rounded hover:bg-accent transition-colors shrink-0'
              aria-label='Close conversation'
              title='Close conversation'
              data-track-category='CHAT_SIDEBAR'
              data-track-name='CLOSE_DM_CHANNEL'
              data-track-metadata={JSON.stringify({ channelId: channel.id })}
            >
              <X size={14} className='text-muted-foreground hover:text-foreground' />
            </button>
          )}
        </div>
      </Link>
    </Tooltip>
  );
};

export default ChannelItemV2;
