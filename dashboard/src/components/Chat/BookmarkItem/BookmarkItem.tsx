import { ReactElement, useState, useEffect, useRef } from 'react';
import { useNavigate, type NavigateFunction } from 'react-router-dom';
import { useRouteContext } from '../../../hooks/useRouteContext';
import { useZero } from '../../../hooks/useZero';
import { queries } from '../../../zero/queries';
import { useChannel } from '../../../hooks/useChannels';
import { Check, Clock } from 'lucide-react';
import { BookmarkEntityType, type Message, type Bookmark, Channel } from '@xyne/shared';
import Avatar from '../../ui/Avatar/Avatar';
import { useUserBookmarks } from '../../../hooks/useUserBookmarks';
import Tooltip from '../../ui/Tooltip/Tooltip';
import { RenderMessageWithHTML } from '../RenderMessageWithHTML/RenderMessageWithHTML';
import {
  MessageMetadata,
  formatDueIn,
  calculateSnoozeTime,
  formatDateWithTime,
} from '../utils/bookmarkUtils';
import { toast } from 'sonner';
import { mutators } from '../../../zero/mutators';
import { useUser } from '../../../hooks/useUsers';
import { useCachedQuery } from '../../../hooks/useCachedQuery';

export interface BookmarkItemProps {
  bookmarkId: string;
  entityId: string;
  entityType: BookmarkEntityType;
  createdAt: number;
  bookmarkMetadata: unknown;
  channelId?: string; // Optional: if provided, filter to only show messages from this channel
  showChannelName?: boolean; // Optional: show channel/DM name
  enableSnooze?: boolean; // Optional: enable snooze functionality (default: false)
  isMobile?: boolean; // Optional: whether rendering on mobile device
}

// Helper function to schedule snooze notification
const scheduleSnoozeNotification = (
  snoozeUntil: Date,
  message: Message,
  channel: Channel | null | undefined,
  getBookmarkByEntity: (entityId: string, entityType: BookmarkEntityType) => Bookmark | undefined,
  entityId: string,
  entityType: BookmarkEntityType,
  navigate: NavigateFunction,
  senderName?: string,
): void => {
  const timeUntilSnooze = snoozeUntil.getTime() - Date.now();

  if (timeUntilSnooze > 0) {
    setTimeout(() => {
      // Before showing notification, check if snooze is still active
      const currentBookmark = getBookmarkByEntity(entityId, entityType);
      // Only show notification if snooze is still set
      const bookmarkMetadata = currentBookmark?.metadata as MessageMetadata | undefined;
      if (currentBookmark?.metadata && bookmarkMetadata?.snoozeUntil) {
        showSnoozeNotification(message, channel, navigate, senderName);
      }
    }, timeUntilSnooze);
  }
};

// Helper function to show snooze notification
// Using a flexible type for the message with relationships
const showSnoozeNotification = (
  message: {
    messageId: string;
    conversationId: string;
    senderId?: string;
    conversation?: {
      initialMessageId?: string;
      channelId: string;
    } | null;
  },
  channel: Channel | null | undefined,
  navigate: NavigateFunction,
  senderName?: string,
): void => {
  const name = senderName || 'Unknown User';
  const channelName = channel?.name || 'Unknown Channel';
  const scopeType = channel?.scopeType;

  // Build the navigation link
  const channelId = channel?.id;
  const conversationId = message.conversationId;
  const initialMessageId = message.conversation?.initialMessageId;
  const isThreadReply = initialMessageId !== message.messageId;

  const basePath = '/chat/bookmarks'; // Notifications always go to bookmarks context
  const messageLink =
    channelId && conversationId
      ? isThreadReply
        ? `${basePath}/${channelId}/${conversationId}#origin=${conversationId}&messageId=${message.messageId}`
        : `${basePath}/${channelId}#origin=${conversationId}&messageId=${message.messageId}`
      : '/chat/bookmarks';

  // Format description based on scope type
  const description =
    String(scopeType) === 'DM' || String(scopeType) === 'GROUP_DM'
      ? `From ${name} in Direct Message`
      : `From ${name} in #${channelName}`;

  // Show in-app notification that stays until manually dismissed
  toast.info('Reminder: Bookmarked Message', {
    description,
    duration: Infinity, // Persist until manually closed
    action: {
      label: 'View',
      onClick: (): void => {
        void navigate(messageLink);
      },
    },
  });
};

export const BookmarkItem = ({
  entityId,
  entityType,
  bookmarkMetadata,
  channelId,
  showChannelName = false,
  enableSnooze = false,
  isMobile = false,
}: BookmarkItemProps): ReactElement | null => {
  const navigate = useNavigate();
  const { baseRoute } = useRouteContext();
  const zero = useZero();
  const { getBookmarkByEntity: getBookmarkByEntityFromHook } = useUserBookmarks();
  const [isHovered, setIsHovered] = useState(false);
  const [showSnoozeDropdown, setShowSnoozeDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch the message data - ALWAYS call hooks unconditionally
  const [message] = useCachedQuery(queries.getMessageForActivityV2({ messageId: entityId }));
  const channel = useChannel(message?.conversation?.channelId || '');
  const sender = useUser(message?.senderId ?? '');

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowSnoozeDropdown(false);
      }
    };

    if (showSnoozeDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return (): void => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showSnoozeDropdown]);

  // Close dropdown when hover is removed
  useEffect(() => {
    if (!isHovered) {
      setShowSnoozeDropdown(false);
    }
  }, [isHovered]);

  // NOW we can have conditional returns after all hooks are called
  // Currently only supporting MESSAGE type
  if (entityType !== BookmarkEntityType.MESSAGE) {
    return null;
  }

  if (!message) {
    return null;
  }

  // If channelId is provided, only show messages from this channel
  if (channelId && channel?.id !== channelId) {
    return null;
  }

  const messageChannelId = channel?.id;
  const conversationId = message.conversationId;
  const initialMessageId = message.conversation?.initialMessageId;

  // If this message is NOT the initial message of its conversation, it's a thread reply
  const isThreadReply = initialMessageId !== message.messageId;

  // If it's a thread reply, navigate to the thread view (channelId/conversationId)
  // Otherwise, navigate to the channel view with conversation highlighted
  // Use baseRoute to determine context: /chat/bookmarks -> /chat/bookmarks/:channelId, else /chat/dir/:channelId
  const messageLink =
    messageChannelId && conversationId
      ? isThreadReply
        ? `${baseRoute}/${messageChannelId}/${conversationId}#origin=${conversationId}&messageId=${message.messageId}`
        : `${baseRoute}/${messageChannelId}#origin=${conversationId}&messageId=${message.messageId}`
      : '#';

  const handleClick = (e: React.MouseEvent): void => {
    e.preventDefault();
    if (messageLink !== '#') {
      void navigate(messageLink, { state: { fromBookmarks: true } });
    }
  };

  // Get snooze info from bookmark metadata
  const metadata = bookmarkMetadata as MessageMetadata | undefined;
  const snoozeUntil = metadata?.snoozeUntil;

  const handleRemoveBookmark = (e: React.MouseEvent): void => {
    e.stopPropagation();
    void zero.mutate(
      mutators.bookmark.remove({
        entityId,
        entityType,
      }),
    );
  };

  const handleSnoozeClick = (e: React.MouseEvent): void => {
    e.stopPropagation();
    setShowSnoozeDropdown(!showSnoozeDropdown);
  };

  const handleSnoozeOption = (e: React.MouseEvent, option: string): void => {
    e.stopPropagation();
    setShowSnoozeDropdown(false);

    if (!enableSnooze) {
      return;
    }

    if (option === 'remove') {
      // Remove snooze - update bookmark metadata to remove snoozeUntil
      const currentMetadata: MessageMetadata = (bookmarkMetadata as MessageMetadata) || {};
      void zero.mutate(
        mutators.bookmark.updateMetadata({
          entityId,
          entityType,
          metadata: {
            ...currentMetadata,
            snoozeUntil: null,
          },
        }),
      );
      return;
    }

    // Calculate snooze time based on option
    const snoozeTime = calculateSnoozeTime(option);
    if (!snoozeTime) return;

    // Update bookmark metadata with snooze time
    const currentMetadata: MessageMetadata = (bookmarkMetadata as MessageMetadata) || {};
    void zero.mutate(
      mutators.bookmark.updateMetadata({
        entityId,
        entityType,
        metadata: {
          ...currentMetadata,
          snoozeUntil: snoozeTime.toISOString(),
        },
      }),
    );

    // Schedule notification
    scheduleSnoozeNotification(
      snoozeTime,
      message,
      channel,
      getBookmarkByEntityFromHook,
      entityId,
      entityType,
      navigate,
      sender?.name ?? 'Unknown User',
    );
  };

  return (
    <div
      onClick={handleClick}
      data-track-category='CHAT_BOOKMARK'
      data-track-name='Open_Bookmark'
      data-track-metadata={JSON.stringify({ entityId, entityType })}
      onKeyDown={(e): void => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick(e as unknown as React.MouseEvent);
        }
      }}
      onMouseEnter={(): void => setIsHovered(true)}
      onMouseLeave={(): void => setIsHovered(false)}
      className='relative block p-4 hover:bg-accent transition-colors duration-150 cursor-pointer border-b border-border'
      role='button'
      tabIndex={0}
    >
      {/* Snooze Badge - shown in bottom right if snoozed and not overdue */}
      {snoozeUntil && new Date(snoozeUntil).getTime() > Date.now() && !isHovered && (
        <div className='absolute bottom-2 right-2 z-10'>
          <span className='text-xs font-medium text-blue-600'>{formatDueIn(snoozeUntil)}</span>
        </div>
      )}

      {/* Action Toolbar - shown on hover, hidden on mobile */}
      {!isMobile && isHovered && (
        <div className='absolute bottom-2 right-2 z-10 flex items-center gap-1 bg-card border border-border rounded-md shadow-[0px_0px_8px_0px_rgba(5,5,6,0.04)] p-1'>
          <Tooltip content='Mark as done'>
            <button
              onClick={handleRemoveBookmark}
              className='p-1.5 rounded hover:bg-accent transition-colors duration-150'
              aria-label='Mark as done'
              data-testid='bookmark-mark-as-done-btn'
              data-track-category='CHAT_BOOKMARK'
              data-track-name='Mark_Bookmark_Done'
              data-track-metadata={JSON.stringify({ entityId })}
            >
              <Check size={16} className='text-[#788187]' strokeWidth={1.33} />
            </button>
          </Tooltip>
          <div className='relative'>
            <Tooltip content='Snooze'>
              <button
                onClick={handleSnoozeClick}
                className='p-1.5 rounded hover:bg-accent transition-colors duration-150'
                aria-label='Snooze'
                data-track-category='CHAT_BOOKMARK'
                data-track-name='Open_Snooze_Menu'
                data-track-metadata={JSON.stringify({ entityId })}
              >
                <Clock size={16} className='text-[#788187]' strokeWidth={1.33} />
              </button>
            </Tooltip>

            {/* Snooze Dropdown */}
            {showSnoozeDropdown && (
              <div
                ref={dropdownRef}
                className='absolute top-full right-0 mt-1 bg-popover border border-border rounded-md shadow-[0px_1px_8px_0px_rgba(0,0,0,0.15)] py-1 min-w-[200px] z-20'
                role='menu'
                tabIndex={-1}
                onKeyDown={(e): void => {
                  if (e.key === 'Escape') {
                    setShowSnoozeDropdown(false);
                  }
                }}
              >
                <button
                  onClick={(e): void => {
                    handleSnoozeOption(e, '30mins');
                  }}
                  className='w-full text-left px-4 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors'
                  data-track-category='CHAT_BOOKMARK'
                  data-track-name='Snooze_Bookmark_30_Mins'
                  data-track-metadata={JSON.stringify({ entityId })}
                >
                  30 mins
                </button>
                <button
                  onClick={(e): void => {
                    handleSnoozeOption(e, '1hour');
                  }}
                  className='w-full text-left px-4 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors'
                  data-track-category='CHAT_BOOKMARK'
                  data-track-name='Snooze_Bookmark_1_Hour'
                  data-track-metadata={JSON.stringify({ entityId })}
                >
                  1 hour
                </button>
                <button
                  onClick={(e): void => {
                    handleSnoozeOption(e, '3hours');
                  }}
                  className='w-full text-left px-4 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors'
                  data-track-category='CHAT_BOOKMARK'
                  data-track-name='Snooze_Bookmark_3_Hours'
                  data-track-metadata={JSON.stringify({ entityId })}
                >
                  3 hours
                </button>
                <button
                  onClick={(e): void => {
                    handleSnoozeOption(e, 'tomorrow');
                  }}
                  className='w-full text-left px-4 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors'
                  data-track-category='CHAT_BOOKMARK'
                  data-track-name='Snooze_Bookmark_Tomorrow'
                  data-track-metadata={JSON.stringify({ entityId })}
                >
                  Tomorrow at 9:00 AM
                </button>
                <button
                  onClick={(e): void => {
                    handleSnoozeOption(e, 'monday');
                  }}
                  className='w-full text-left px-4 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors'
                  data-track-category='CHAT_BOOKMARK'
                  data-track-name='Snooze_Bookmark_Monday'
                  data-track-metadata={JSON.stringify({ entityId })}
                >
                  Monday at 9:00 AM
                </button>
                <div className='border-t border-border my-1'></div>
                <button
                  onClick={(e): void => {
                    handleSnoozeOption(e, 'remove');
                  }}
                  className='w-full text-left px-4 py-2 text-sm text-foreground hover:bg-accent transition-colors'
                  data-track-category='CHAT_BOOKMARK'
                  data-track-name='Remove_Bookmark_Snooze'
                  data-track-metadata={JSON.stringify({ entityId })}
                >
                  Remove Snooze
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <div className={showChannelName ? 'space-y-2' : 'flex gap-3'}>
        {/* Channel/DM Name with Time - First Line (only if showChannelName is true) */}
        {showChannelName && (
          <div className='flex items-center justify-between gap-2'>
            <span
              className={`truncate font-inter ${
                String(channel?.scopeType) === 'DM' || String(channel?.scopeType) === 'GROUP_DM'
                  ? 'text-[13px] font-medium text-[#3B4145] leading-[100%]'
                  : 'text-sm text-[#1D1C1D]'
              }`}
            >
              {String(channel?.scopeType) === 'DM' || String(channel?.scopeType) === 'GROUP_DM'
                ? 'Direct Message'
                : `#${channel?.name || 'Unknown Channel'}`}
            </span>
            <span
              className='text-[11px] font-normal text-[#788187] leading-[100%] flex-shrink-0 ml-auto'
              style={{ fontFamily: 'Geist Mono' }}
            >
              {formatDateWithTime(message.createdAt)}
            </span>
          </div>
        )}

        {/* Avatar */}
        {!showChannelName && (
          <div className='flex-shrink-0'>
            <Avatar userId={message.senderId || ''} size='md' />
          </div>
        )}

        {/* Content */}
        <div className='flex-1 min-w-0'>
          {showChannelName && (
            <div className='flex gap-3'>
              {/* Avatar */}
              <div className='flex-shrink-0'>
                <Avatar userId={message.senderId || ''} size='md' />
              </div>

              {/* User name and message */}
              <div className='flex-1 min-w-0'>
                {/* User name */}
                <div className='text-[13.5px] font-semibold text-[#181B1D] leading-[100%] truncate mb-1 font-inter'>
                  {sender?.name || 'Unknown User'}
                </div>

                {/* Message preview */}
                <div className='text-sm text-muted-foreground whitespace-normal break-all'>
                  <RenderMessageWithHTML message={message.content} />
                </div>
              </div>
            </div>
          )}

          {!showChannelName && (
            <>
              {/* Header */}
              <div className='flex items-baseline justify-between gap-2 mb-1'>
                <span className='text-sm font-semibold text-foreground truncate'>
                  {sender?.name || 'Unknown User'}
                </span>
                <span className='text-xs text-muted-foreground flex-shrink-0 ml-auto'>
                  {formatDateWithTime(message.createdAt)}
                </span>
              </div>

              {/* Message preview */}
              <div className='text-sm text-muted-foreground line-clamp-2'>
                <RenderMessageWithHTML message={message.content} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
