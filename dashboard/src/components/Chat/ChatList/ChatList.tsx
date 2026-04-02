import { QueryResultType } from '@rocicorp/zero';
import { ReactElement, useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { queries } from '../../../zero/queries';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuthContext } from '../../../providers/AuthProvider';
import { WebsiteSelectionPopup } from '../WebsiteSelectionPopup/WebsiteSelectionPopup';
import {
  insertDateSeparatorsForCombinedMessages,
  type ChatListItemWithSeparator,
} from '../../../utils/chatUtils';
import { CombinedMessageItem, combineMessages, extractOriginFromHash } from './ChatListUtils';
import { ChatListItem } from '../ChatListItem/ChatListItem';
import { useVirtualizer, observeElementOffset } from '@tanstack/react-virtual';
import Button from '../../ui/Button';
import { ArrowDown } from 'lucide-react';
import { ChannelScopeType } from '@xyne/shared';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { getInitialMessageFromConversation } from '../../../utils/conversationMessageHelpers';

type ChatListProps = {
  channelId: string;
  messages: QueryResultType<typeof queries.channelConversationsV2> | undefined;
  projectId?: string | undefined;
  channelScopeType?: ChannelScopeType | undefined;
};

const ChatList = ({
  channelId,
  messages,
  projectId,
  channelScopeType,
}: ChatListProps): ReactElement => {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const location = useLocation();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prevMessageLengthRef = useRef(0);
  const hasInitialScrolledRef = useRef<string | null>(null);

  // Website selection popup state
  const [showWebsitePopup, setShowWebsitePopup] = useState(false);
  const [popupPosition, setPopupPosition] = useState({ x: 0, y: 0 });
  const [selectedText, setSelectedText] = useState('');
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  // Emoji picker state for scroll lock
  const [isAnyEmojiPickerOpen, setIsAnyEmojiPickerOpen] = useState(false);

  const handleOpenThread = (conversationId: string): void => {
    void navigate(`/chat/dir/${channelId}/${conversationId}`);
  };

  const [replyToChannelThreadMessages] = useCachedQuery(
    queries.channelAndThreadMessagesV2({ channelId }),
  );
  const combinedMessages = useMemo((): CombinedMessageItem[] => {
    // messages comes from channelConversationsV2 but combineMessages expects channelConversationsPaginatedV2;
    // the two types share all fields used by combineMessages, so the cast is safe.
    return combineMessages(
      messages as unknown as
        | QueryResultType<typeof queries.channelConversationsPaginatedV2>
        | undefined,
      replyToChannelThreadMessages,
    );
  }, [messages, replyToChannelThreadMessages]);

  const messagesWithDateSeparators = useMemo((): ChatListItemWithSeparator[] => {
    return insertDateSeparatorsForCombinedMessages(combinedMessages);
  }, [combinedMessages]);

  const { conversationId } = useParams();

  const virtualizer = useVirtualizer({
    count: messagesWithDateSeparators.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 50,
    paddingStart: 25,
    overscan: 2,
    // TODO: Implement initial offset when possible
    // initialOffset: ((): number => {
    //   if (typeof localStorage !== 'undefined') {
    //     const saved = localStorage.getItem(`chat-scroll-${channelId}`);
    //     console.log(saved);
    //     if (saved) {
    //       return parseInt(saved, 10);
    //     }
    //   }
    //   return 0;
    // })(),
    observeElementOffset: (instance, cb) => {
      return observeElementOffset(instance, (offset, isScrolling) => {
        localStorage.setItem(`chat-scroll-${channelId}`, String(offset));
        cb(offset, isScrolling);
      });
    },
    onChange: () => {
      const scrollOffset = virtualizer.scrollOffset ?? 0;
      const totalSize = virtualizer.getTotalSize();
      const container = scrollContainerRef.current;
      const clientHeight = container?.clientHeight ?? 0;

      const distanceFromBottom = totalSize - scrollOffset - clientHeight;
      setShowScrollToBottom(prev => {
        if (!prev && distanceFromBottom > 300) return true; // show
        if (prev && distanceFromBottom < 100) return false; // hide
        return prev;
      });
    },
  });

  const virtualItems = virtualizer.getVirtualItems();

  /**
   * Scrolls to the bottom of the chat list
   */
  const scrollToBottom = useCallback(
    (smooth: boolean = false) => {
      if (messagesWithDateSeparators.length === 0) return;

      const lastIndex = messagesWithDateSeparators.length - 1;

      if (!smooth) {
        virtualizer.scrollToIndex(lastIndex, { align: 'end' });
        return;
      }

      // Get the value — may be undefined
      const offsetTuple = virtualizer.getOffsetForIndex(lastIndex, 'end');

      if (!offsetTuple) return; // <-- safety check

      const [targetOffset] = offsetTuple;

      scrollContainerRef.current?.scrollTo({
        top: targetOffset,
        behavior: 'smooth',
      });
    },
    [messagesWithDateSeparators.length, virtualizer],
  );

  /**
   * Scrolls to a specific message by conversation ID (origin navigation)
   */
  const scrollToOrigin = useCallback(
    (originId: string): boolean => {
      // Find the index of the message with matching conversationId
      const targetIndex = messagesWithDateSeparators.findIndex(item => {
        if (item.type === 'date-separator') return false;
        if (item.type === 'conversation') {
          return item.data.conversationId === originId;
        }
        // For thread messages
        return item.data.conversationId === originId;
      });

      if (targetIndex !== -1) {
        virtualizer.scrollToIndex(targetIndex, { align: 'center' });
        return true; // Successfully scrolled
      }
      return false; // Origin not found
    },
    [messagesWithDateSeparators, virtualizer],
  );

  /**
   * Determines whether we should auto-scroll to bottom
   * Returns true if:
   * - Latest message is from current user, OR
   * - User is already near bottom (within 100px)
   */
  const shouldScrollToBottom = useCallback((): boolean => {
    if (combinedMessages.length === 0) return false;

    const latestMessage = combinedMessages[combinedMessages.length - 1];
    const container = scrollContainerRef.current;
    if (!container || !latestMessage) return false;

    // Check if latest message is from current user
    let isFromCurrentUser = false;
    let isSystemMessageForMentions = false;
    if (latestMessage.type === 'conversation') {
      isFromCurrentUser = latestMessage.data.createdBy === user?.id;
      isSystemMessageForMentions =
        latestMessage.data.createdBy === 'user' &&
        (() => {
          const initMsg = getInitialMessageFromConversation(latestMessage.data);
          return (
            typeof initMsg?.metadata === 'object' &&
            initMsg?.metadata !== null &&
            (initMsg.metadata as Record<string, unknown>)['messageSubtype'] ===
              'user_not_in_channel'
          );
        })();
    } else {
      isFromCurrentUser = latestMessage.data.senderId === user?.id;
    }

    // Check if user is near bottom (within 100px)
    const scrollOffset = virtualizer.scrollOffset ?? 0;
    const totalSize = virtualizer.getTotalSize();
    const clientHeight = container.clientHeight;
    const distanceFromBottom = totalSize - scrollOffset - clientHeight;
    const isNearBottom = distanceFromBottom < 100;

    const shouldScroll = isFromCurrentUser || isNearBottom || isSystemMessageForMentions;
    // Scroll if: user sent message OR user is near bottom
    return shouldScroll;
  }, [combinedMessages, user?.id, virtualizer]);

  /**
   * Scroll to origin message if hash is present in URL
   */
  useEffect(() => {
    if (messagesWithDateSeparators.length === 0) return;

    const originId = extractOriginFromHash(location.hash);
    if (originId) {
      // Small delay to ensure virtualizer is ready and items are measured
      const timeoutId = setTimeout(() => {
        scrollToOrigin(originId);
      }, 100);

      return (): void => clearTimeout(timeoutId);
    }
    return undefined;
  }, [location.hash, scrollToOrigin, messagesWithDateSeparators.length]);

  /**
   * Scroll to bottom on initial load if no saved position exists and no origin hash
   */
  useEffect(() => {
    if (messagesWithDateSeparators.length === 0) return;

    // Only do initial scroll once per channel
    if (hasInitialScrolledRef.current === channelId) return;
    hasInitialScrolledRef.current = channelId;

    // Skip if origin hash is present
    const hasOriginHash = extractOriginFromHash(location.hash);
    if (hasOriginHash) return;

    // Scroll to bottom (no saved position logic for now)
    scrollToBottom();
  }, [channelId, scrollToBottom, messagesWithDateSeparators.length, location.hash]);

  /**
   * Auto-scroll to bottom when NEW messages are added (not on metadata changes)
   */
  useEffect(() => {
    const currentLength = combinedMessages.length;
    const previousLength = prevMessageLengthRef.current;

    // Only proceed if length actually increased (new messages added)
    if (currentLength > previousLength) {
      if (shouldScrollToBottom()) {
        scrollToBottom();
      }
    }

    // Update ref for next comparison
    prevMessageLengthRef.current = currentLength;
  }, [combinedMessages.length, shouldScrollToBottom, scrollToBottom]);

  /**
   * Handle text selection within the chat list
   * Shows website popup when text is selected
   */
  const handleTextSelection = useCallback((event: MouseEvent): void => {
    const selection = window.getSelection();
    const text = selection?.toString().trim() || '';

    if (text.length > 0) {
      // Check if selection is within our chat list container
      const container = scrollContainerRef.current;
      if (container && container.contains(selection?.anchorNode as Node)) {
        setSelectedText(text);
        setPopupPosition({
          x: event.clientX + 10, // Offset slightly from cursor
          y: event.clientY - 10,
        });
        setShowWebsitePopup(true);
      }
    } else {
      setShowWebsitePopup(false);
    }
  }, []);

  const handleClosePopup = useCallback((): void => {
    setShowWebsitePopup(false);
    setSelectedText('');
  }, []);

  /**
   * 4️⃣ Text selection event listener for website popup
   */
  useEffect(() => {
    document.addEventListener('mouseup', handleTextSelection);

    return (): void => {
      document.removeEventListener('mouseup', handleTextSelection);
    };
  }, [handleTextSelection]);

  if (!messagesWithDateSeparators || messagesWithDateSeparators.length === 0) {
    return (
      <div className='text-center text-muted-foreground flex-1 flex items-center justify-center'>
        <p className='text-muted-foreground'>No conversations in this channel yet</p>
      </div>
    );
  }

  return (
    <div
      data-component='ChatList'
      ref={scrollContainerRef}
      className={`flex-1 relative no-scrollbar min-h-0  ${isAnyEmojiPickerOpen ? 'overflow-hidden' : 'overflow-auto'}`}
    >
      {showScrollToBottom && (
        <Button
          onClick={() => scrollToBottom(true)}
          className={`pr-5 sticky top-[98.5%] left-1/2 right-1/2 -translate-y-[100%] -translate-x-1/2 z-40 rounded-full flex items-center gap-1 ${conversationId ? 'max-[500px]:hidden' : ''}`}
          data-track-category='CHAT_LIST'
          data-track-name='SCROLL_TO_BOTTOM'
          data-track-metadata={JSON.stringify({ channelId })}
        >
          <span>
            <ArrowDown />
          </span>
          Latest Messages
        </Button>
      )}
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            transform: `translateY(${virtualItems[0]?.start ?? 0}px)`,
          }}
        >
          {virtualItems.map(virtualItem => {
            const item = messagesWithDateSeparators[virtualItem.index];
            if (!item) return null;

            return (
              <ChatListItem
                key={virtualItem.key}
                item={item}
                index={virtualItem.index}
                chatListItems={messagesWithDateSeparators}
                channelId={channelId}
                projectId={projectId}
                channelScopeType={channelScopeType}
                handleOpenThread={handleOpenThread}
                measureRef={virtualizer.measureElement}
                dataIndex={virtualItem.index}
                onEmojiPickerOpenChange={setIsAnyEmojiPickerOpen}
              />
            );
          })}
        </div>
      </div>

      {/* Website Selection Popup */}
      <WebsiteSelectionPopup
        isVisible={showWebsitePopup}
        position={popupPosition}
        selectedText={selectedText}
        onClose={handleClosePopup}
      />
    </div>
  );
};

export default ChatList;
