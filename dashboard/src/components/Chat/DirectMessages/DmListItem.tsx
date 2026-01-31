// src/components/Chat/DirectMessages/DmListItem.tsx

import { ReactElement, KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Channel } from '@xyne/shared';
import Avatar from '../../ui/Avatar/Avatar';

import { cn } from '../../ui/Dialog';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import { queries } from '../../../zero/queries';
import { formatThreadTimestamp } from '../../../utils/dateUtils';
import { useCachedQuery } from '../../../hooks/useCachedQuery';

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

  // 3. Format Time using formatThreadTimestamp
  const formatTime = (timestamp?: number): string => {
    if (!timestamp) return '';
    return formatThreadTimestamp(timestamp);
  };

  // 4. Preview Text Logic
  const getPreviewText = (): string => {
    if (!lastMessage) return 'No messages yet';

    const prefix = lastMessage.senderId === context.userID ? 'You: ' : '';
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

  return (
    <div className='w-full border-b border-gray-100 last:border-0 mt-0'>
      <div
        key={`dm-${channel.id}`}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={cn(
          'flex w-full items-center gap-[12px] px-4 py-3 cursor-pointer transition-colors',
          'hover:bg-gray-50 active:bg-gray-100',
          isSelected && 'bg-gray-100',
        )}
        role='button'
        tabIndex={0}
        aria-label={`Open conversation with ${displayName}`}
      >
        {/* Avatar */}
        <div className='relative shrink-0 size-[48px] rounded-[8px]'>
          <Avatar userId={avatarUserId} size='lg' className='size-full rounded-[8px]' />
        </div>

        {/* Content Container */}
        <div className='flex flex-1 flex-col justify-center min-w-0 gap-[4px]'>
          {/* Top Row: Name and Time */}
          <div className='flex items-center justify-between gap-[4px] w-full'>
            <h4 className="font-['Inter'] font-semibold text-[16px] text-[#181b1d] tracking-[-0.32px] truncate leading-[1.2]">
              {displayName}
            </h4>
            {lastMessage && (
              <span className="shrink-0 font-['Inter'] font-normal text-[12px] text-[#788187] tracking-[-0.24px] leading-[1.2]">
                {formatTime(lastMessage.createdAt)}
              </span>
            )}
          </div>

          {/* Bottom Row: Message and Badge */}
          <div className='flex items-start justify-between gap-[4px] w-full'>
            <p
              className={cn(
                "font-['Inter'] font-normal text-[14px] text-[#788187] tracking-[-0.28px] leading-[1.35] truncate flex-1",
                unreadCount > 0 && 'text-[#181b1d] font-medium',
              )}
            >
              {getPreviewText()}
            </p>
            {unreadCount > 0 && (
              <div className='shrink-0 bg-[#6276be] flex flex-col items-center justify-center px-[6px] py-px rounded-[999px] h-[18px] min-w-[18px]'>
                <span className="font-['Geist_Mono'] font-semibold text-[11px] text-white leading-[1.2]">
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
