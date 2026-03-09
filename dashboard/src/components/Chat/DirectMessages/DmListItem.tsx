import { ReactElement, KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  type Channel,
  MessageType,
  isForwardedMessageXml,
  parseForwardedMessageXml,
  ChannelScopeType,
} from '@xyne/shared';
import Avatar from '../../ui/Avatar/Avatar';

import { cn } from '../../ui/Dialog';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import { queries } from '../../../zero/queries';
import { formatElapsedTime } from '../../../utils/dateUtils';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { usePlatform } from '../../../hooks/usePlatform';
import { useUser } from '../../../hooks/useUsers';
import { StatusIndicator } from '../../ui/StatusIndicator';

interface DmListItemProps {
  channel: Channel;
  unreadCount?: number;
  isSelected?: boolean;
}

// Helper: robustly strip HTML tags using DOM parser
const stripHtml = (html: string): string => {
  if (!html) return '';
  if (typeof document === 'undefined') return html;

  const tmp = document.createElement('DIV');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
};

export const DmListItem = ({
  channel,
  unreadCount = 0,
  isSelected = false,
}: DmListItemProps): ReactElement => {
  const navigate = useNavigate();
  const context = useAuthContextValues();

  // Fetch latest message using the query from queries.ts
  const [latestConversation] = useCachedQuery(
    queries.channelLatestMessage({ channelId: channel.id }),
  );
  const lastMessage = latestConversation?.initialMessage;

  const { displayName, avatarUserId } = useChannelDisplayName(channel, context.userID);

  // Get user for status (only for 1-on-1 DMs)
  const isDM = channel.scopeType === ChannelScopeType.DM;
  const targetUser = useUser(isDM && avatarUserId ? avatarUserId : '');

  // 3. Format elapsed time (now, 5m, 2h, 3d, 1 month, 2 years, etc.)
  const formatTime = (timestamp?: number): string => {
    if (!timestamp) return '';
    return formatElapsedTime(timestamp);
  };

  // 4. Preview Text Logic
  const getPreviewText = (): string => {
    if (!lastMessage) return 'No messages yet';

    const isSelfDm = avatarUserId === context.userID;
    const prefix = lastMessage.senderId === context.userID && !isSelfDm ? 'You: ' : '';

    // Handle forwarded messages - content is XML, need to parse it
    if (
      lastMessage.msgType === MessageType.FORWARDED &&
      isForwardedMessageXml(lastMessage.content)
    ) {
      const parsed = parseForwardedMessageXml(lastMessage.content);
      if (parsed) {
        const text = parsed.optionalText || parsed.content;
        return `${prefix}${stripHtml(text || 'Forwarded a message')}`;
      }
    }

    let content =
      lastMessage.content || (lastMessage.attachments?.length ? 'Sent an attachment' : 'Message');

    // Clean any HTML tags from the message
    content = stripHtml(content);

    return `${prefix}${content}`;
  };

  const handleClick = (): void => {
    // Navigate to /chat/dm/:channelId for both mobile and desktop
    void navigate(`/chat/dm/${channel.id}?fromDM=true`);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleClick();
    }
  };

  const { isMobile } = usePlatform();

  if (isMobile) {
    return (
      <button
        className='w-full flex items-start gap-3 px-2 text-left text-select-none active:scale-[0.98] transition-all duration-200'
        onClick={handleClick}
        aria-label={`Open conversation with ${displayName}`}
        data-track-category='DM_LIST'
        data-track-name='OpenDMConversation'
        data-track-metadata={JSON.stringify({ channelId: channel.id, displayName })}
      >
        <DMItemAvatar userId={avatarUserId || null} scopeType={channel.scopeType} />
        <div className='w-full flex-1 min-w-0 space-y-1'>
          <div className='w-full flex items-start justify-between gap-3 min-w-0'>
            <div className='flex items-center gap-1.5 min-w-0 flex-1'>
              <p className='text-[16px] tracking-[-0.32px] text-foreground font-medium min-w-0 truncate'>
                {displayName}
              </p>
              {isDM && (
                <StatusIndicator
                  statusEmoji={targetUser?.presenceStatus?.statusEmoji}
                  statusContent={targetUser?.presenceStatus?.statusContent}
                  statusExpiryAt={targetUser?.presenceStatus?.statusExpiryAt}
                  size='sm'
                  className='text-[14px]'
                />
              )}
            </div>
            <p className='shrink-0 text-[14px] tracking-[-0.28px] text-muted-foreground'>
              {formatTime(lastMessage?.createdAt)}
            </p>
          </div>
          <div className='w-full flex items-start justify-between gap-3 min-w-0'>
            <div
              className={cn(
                'min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[14px] font-normal leading-[1.35] text-muted-foreground',
              )}
            >
              {getPreviewText()}
            </div>
            {unreadCount > 0 ? (
              <div className='font-["Geist_Mono"] text-[14px] font-semibold leading-[1.2] text-[#FFF] shrink-0 bg-[#6276be] flex flex-col items-center justify-center px-[6px] py-px rounded-[999px] h-[18px] min-w-[18px]'>
                {unreadCount}
              </div>
            ) : null}
          </div>
        </div>
      </button>
    );
  }

  return (
    <div className='w-full border-b border-border last:border-0 mt-0'>
      <div
        key={`dm-${channel.id}`}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={cn(
          'flex w-full items-center gap-[12px] px-4 py-3 cursor-pointer transition-colors',
          'hover:bg-accent active:bg-accent',
          isSelected && 'bg-accent',
        )}
        role='button'
        tabIndex={0}
        aria-label={`Open conversation with ${displayName}`}
        data-track-category='DM'
        data-track-name='OPEN_DM_CONVERSATION'
        data-track-metadata={JSON.stringify({ channelId: channel.id, channelName: channel.name })}
      >
        {/* Avatar */}
        <div className='relative shrink-0 size-[48px] rounded-[8px] overflow-visible'>
          <Avatar
            userId={avatarUserId}
            size='lg'
            className='size-full rounded-[8px]'
            showActiveStatus={channel.scopeType === ChannelScopeType.DM}
          />
        </div>

        {/* Content Container */}
        <div className='flex flex-1 flex-col justify-center min-w-0 gap-[4px]'>
          {/* Top Row: Name and Time */}
          <div className='flex items-center justify-between gap-[4px] w-full'>
            <div className='flex items-center gap-1.5 min-w-0 flex-1'>
              <h4 className="font-['Inter'] font-semibold text-[16px] text-foreground tracking-[-0.32px] truncate leading-[1.2]">
                {displayName}
              </h4>
              {isDM && (
                <StatusIndicator
                  statusEmoji={targetUser?.presenceStatus?.statusEmoji}
                  statusContent={targetUser?.presenceStatus?.statusContent}
                  statusExpiryAt={targetUser?.presenceStatus?.statusExpiryAt}
                  size='sm'
                  className='text-[14px]'
                />
              )}
            </div>
            {lastMessage && (
              <span className="shrink-0 font-['Inter'] font-normal text-[12px] text-muted-foreground tracking-[-0.24px] leading-[1.2]">
                {formatTime(lastMessage.createdAt)}
              </span>
            )}
          </div>

          {/* Bottom Row: Message and Badge */}
          <div className='flex items-start justify-between gap-[4px] w-full'>
            <p
              className={cn(
                "font-['Inter'] font-normal text-[14px] text-muted-foreground tracking-[-0.28px] leading-[1.35] truncate flex-1",
                unreadCount > 0 && 'text-foreground font-medium',
              )}
            >
              {getPreviewText()}
            </p>
            {unreadCount > 0 && (
              <div className='shrink-0 bg-[#6276be] flex flex-col items-center justify-center px-[6px] py-px rounded-[999px] h-[18px] min-w-[18px]'>
                <span className="font-['Geist_Mono'] text-[14px] font-semibold leading-[1.2] text-[#FFF]">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const DMItemAvatar = ({
  userId,
  scopeType,
}: {
  userId: string | null;
  scopeType: ChannelScopeType;
}): ReactElement => {
  return (
    <div className='size-[44px] rounded-md shrink-0 flex items-center justify-center overflow-visible mt-[3px]'>
      <Avatar userId={userId} size='lg' showActiveStatus={scopeType === ChannelScopeType.DM} />
    </div>
  );
};
