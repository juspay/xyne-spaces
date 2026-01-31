import { ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { queries } from '../../../zero/queries';
import { QueryResultType } from '@rocicorp/zero';
import { useAuthContext } from '../../../providers/AuthProvider';
import { useLocation } from 'react-router-dom';
import { ChatBubble } from '../ChatBubble/ChatBubble';
import { extractOriginFromHash, extractMessageIdFromHash } from '../ChatList/ChatListUtils';
import type { ThreadListItemWithSeparator } from '../../../utils/chatUtils';
import { DatePill } from '../DatePill';
import { MessageType, ChannelScopeType } from '@xyne/shared';
import { MessageMetadata } from '../../ui/MessageBubble/MessageBubble.utils';
import { ConversationWithTicket } from '../../ui/MessageBubble/MessageBubble.types';
import { useEditContext } from '../../../providers/EditProvider';
import { useShortcutById } from '../../../shortcuts';
import { findLastEditableMessage, isEventFromInput } from '../../../utils/chatUtils';
import { ChevronRight, ChevronUp } from 'lucide-react';

type ThreadListProps = {
  channelId: string;
  conversationId: string;
  threadMessages: QueryResultType<typeof queries.conversationMessages>;
  initialScrollOffset?: number;
  onScrollPositionChange?: (position: number) => void;
  isTicketThread?: boolean;
  messagesWithSeparators?: ThreadListItemWithSeparator[] | undefined;
  channelScopeType?: ChannelScopeType | undefined;
  conversation?: ConversationWithTicket | undefined;
};

const ThreadList = ({
  channelId,
  conversationId,
  threadMessages,
  initialScrollOffset,
  onScrollPositionChange,
  isTicketThread = false,
  messagesWithSeparators,
  channelScopeType,
  conversation,
}: ThreadListProps): ReactElement => {
  const { user } = useAuthContext();
  const { editingMessageId, requestEdit } = useEditContext();
  const location = useLocation();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [hasInitiallyScrolled, setHasInitiallyScrolled] = useState<string | null>(null);
  const [hasNavigatedToMessage, setHasNavigatedToMessage] = useState(false);

  const isEventFromThreadInput = useCallback(
    (event: KeyboardEvent): boolean => isEventFromInput(event, conversationId),
    [conversationId],
  );

  const handleEditLastMessage = useCallback(() => {
    const result = findLastEditableMessage(threadMessages, user?.id, msg => msg);
    if (!result) return;
    const message = result.item;
    if (!message) return;

    const scrollToMessage = (): void => {
      const elementId = `thread-message-${conversationId}-${message.messageId}`;
      const targetElement = document.getElementById(elementId);
      if (targetElement) {
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };

    if (editingMessageId === message.messageId) {
      scrollToMessage();
      return;
    }

    requestEdit(message.messageId, scrollToMessage);
  }, [conversationId, threadMessages, user?.id, editingMessageId, requestEdit]);

  useShortcutById('composer.editLastMessage', handleEditLastMessage, {
    enabled: threadMessages.length > 0,
    when: isEventFromThreadInput,
  });
  const [isExpanded, setIsExpanded] = useState(false);

  const isThreadsRoute = location.pathname.startsWith('/chat/threads');

  // Handle collapsible thread logic - only when enableCollapsing is true
  const shouldCollapse = isThreadsRoute && !isExpanded;
  const MIN_MESSAGES_TO_COLLAPSE = 6;

  // Calculate which messages to display based on collapse state
  const { visibleMessages, hiddenCount } = (() => {
    if (!shouldCollapse || !threadMessages || threadMessages.length <= MIN_MESSAGES_TO_COLLAPSE) {
      return { visibleMessages: threadMessages, hiddenCount: 0 };
    }

    const first = threadMessages[0]!;
    const last = threadMessages.slice(-3);
    const hidden = threadMessages.length - 4;

    return {
      visibleMessages: [first, ...last],
      hiddenCount: hidden,
    };
  })();

  // Reset navigation flag when conversation changes
  useEffect(() => {
    setHasNavigatedToMessage(false);
  }, [conversationId]);

  /**
   * 1️⃣ On initial load → force scroll to specific message, saved position, or bottom
   *    Priority: message navigation > saved position > bottom (classic chat behavior)
   */
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !threadMessages?.length) return;

    // Only scroll on initial load for this channel
    if (hasInitiallyScrolled !== channelId) {
      setHasInitiallyScrolled(channelId);

      // wait for React to layout before scrolling
      requestAnimationFrame(() => {
        // Priority 1: Check for specific message navigation from URL hash
        const originConversationId = extractOriginFromHash(location.hash);
        const targetMessageId = extractMessageIdFromHash(location.hash);

        if (originConversationId === conversationId && targetMessageId) {
          const elementId = `thread-message-${conversationId}-${targetMessageId}`;
          const targetElement = document.getElementById(elementId);

          if (targetElement) {
            targetElement.scrollIntoView({ behavior: 'auto', block: 'center' });
            setHasNavigatedToMessage(true);
            return;
          }
          // If target message not found, fall through to existing logic
        }

        // Priority 2: Use saved scroll position
        if (initialScrollOffset !== undefined) {
          container.scrollTop = initialScrollOffset;
        } else {
          // Priority 3: Default to bottom (classic chat behavior)
          container.scrollTop = container.scrollHeight - container.clientHeight;
        }
      });
    }
  }, [
    channelId,
    conversationId,
    threadMessages?.length,
    hasInitiallyScrolled,
    initialScrollOffset,
    location.hash,
  ]);

  /**
   * 2️⃣ Auto-scroll on new messages
   *    - Always scroll if the latest message is from current user
   *    - Otherwise scroll only when user is already near bottom
   *    - Skip if we've navigated to a specific message via link
   */
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !threadMessages?.length) return;

    if (hasNavigatedToMessage) {
      return;
    }

    const latestMessage = threadMessages[threadMessages.length - 1];
    const isFromCurrentUser = latestMessage?.senderId === user?.id;

    const threshold = 100;
    const currentlyNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < threshold;

    if (isFromCurrentUser || currentlyNearBottom) {
      container.scrollTop = container.scrollHeight - container.clientHeight;
    }
  }, [threadMessages, user?.id, hasNavigatedToMessage]);

  /**
   * 3️⃣ Track scroll position changes for persistence
   *    Save current scroll position when user scrolls (debounced)
   */
  const debouncedScrollHandler = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || !onScrollPositionChange) return;

    // Reset navigation flag when user manually scrolls
    setHasNavigatedToMessage(false);
    onScrollPositionChange(container.scrollTop);
  }, [onScrollPositionChange]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !onScrollPositionChange) return;

    let timeoutId: NodeJS.Timeout;

    const handleScroll = (): void => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(debouncedScrollHandler, 300);
    };

    container.addEventListener('scroll', handleScroll);

    return (): void => {
      container.removeEventListener('scroll', handleScroll);
      clearTimeout(timeoutId);
    };
  }, [debouncedScrollHandler, onScrollPositionChange]);

  // Render with date separators for ticket threads
  if (isTicketThread && messagesWithSeparators) {
    return (
      <div
        data-component='ThreadList'
        ref={scrollContainerRef}
        className='flex-1 overflow-auto no-scrollbar min-h-0 bg-white py-6'
      >
        {messagesWithSeparators.map((item, index) => {
          if (item.type === 'date-separator') {
            return <DatePill key={`date-separator-${index}`} dateText={item.dateText} />;
          }

          const threadMessage = item.data;
          const messageIndex = threadMessages.findIndex(
            m => m.messageId === threadMessage.messageId,
          );
          const previousMessage = threadMessages[messageIndex - 1];
          const previousMessageMetadata = previousMessage?.metadata as MessageMetadata | null;
          const isPreviousMessageAWorkflowMessage =
            (previousMessage?.msgType === MessageType.SYSTEM &&
              previousMessageMetadata?.workflowId &&
              previousMessageMetadata?.ticketId) ||
            (previousMessage?.msgType === MessageType.BOT &&
              previousMessageMetadata?.xyneId &&
              previousMessageMetadata?.ticketId);
          const prevMsgMetadataasRecord = previousMessage?.metadata as Record<
            string,
            unknown
          > | null;
          const isPreviousMessageAnActivity =
            previousMessage?.msgType === MessageType.SYSTEM &&
            prevMsgMetadataasRecord?.['isTicketActivity'] === true;

          const showAvatar =
            messageIndex < 2 ||
            !threadMessage ||
            threadMessages[messageIndex - 1]?.senderId !== threadMessage.senderId ||
            !!isPreviousMessageAWorkflowMessage ||
            isPreviousMessageAnActivity ||
            (!!threadMessages[messageIndex - 1] &&
              Math.abs(
                new Date(threadMessage.createdAt).getTime() -
                  new Date(threadMessages[messageIndex - 1]!.createdAt).getTime(),
              ) > 300000);

          return (
            <div key={threadMessage.messageId}>
              <div id={`thread-message-${conversationId}-${threadMessage.messageId}`}>
                <ChatBubble
                  message={threadMessage}
                  channelId={channelId}
                  showAvatar={showAvatar}
                  context='thread'
                  isFirstInThread={messageIndex === 0}
                  isTicketThread={isTicketThread}
                  channelScopeType={channelScopeType}
                  {...(conversation && { conversation })}
                />
              </div>
              {messageIndex === 0 && threadMessages.length > 1 && (
                <div className='flex items-center my-3 pl-2 gap-2'>
                  <span className='flex text-xs text-gray-500'>
                    {threadMessages.length - 1}{' '}
                    {threadMessages.length - 1 === 1 ? 'reply' : 'replies'}
                  </span>
                  <div className='flex-1 bg-gray-200 w-full h-[1px]'></div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // Default render without date separators
  return (
    <div
      data-component='ThreadList'
      ref={scrollContainerRef}
      className='flex-1 overflow-auto no-scrollbar min-h-0 bg-white py-6'
    >
      {visibleMessages.map((threadMessage, index) => {
        const showAvatar =
          isThreadsRoute ||
          index < 2 ||
          !threadMessage ||
          visibleMessages[index - 1]?.senderId !== threadMessage.senderId ||
          (!!visibleMessages[index - 1] &&
            Math.abs(
              new Date(threadMessage.createdAt).getTime() -
                new Date(visibleMessages[index - 1]!.createdAt).getTime(),
            ) > 300000);

        const shouldShowCollapseButton = index === 0 && hiddenCount > 0;

        return (
          <div key={threadMessage.messageId}>
            <div id={`thread-message-${conversationId}-${threadMessage.messageId}`}>
              <ChatBubble
                message={threadMessage}
                channelId={channelId}
                showAvatar={showAvatar}
                context='thread'
                isFirstInThread={index === 0}
                isTicketThread={isTicketThread}
                channelScopeType={channelScopeType}
                {...(conversation && { conversation })}
              />
            </div>
            {!isThreadsRoute && index === 0 && visibleMessages.length > 1 && (
              <div className='flex items-center pb-2 pl-2 gap-2'>
                <span className='flex text-xs text-gray-500'>
                  {visibleMessages.length - 1}{' '}
                  {visibleMessages.length - 1 === 1 ? 'reply' : 'replies'}
                </span>
                <div className='flex-1 bg-gray-200 w-full h-[1px]'></div>
              </div>
            )}
            {/* Show collapse/expand button after first message when in collapsed mode */}
            {shouldShowCollapseButton && (
              <div className='flex items-center my-1 px-2 gap-2'>
                <button
                  onClick={() => setIsExpanded(true)}
                  className='flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors group'
                >
                  <ChevronRight className='w-3.5 h-3.5 text-gray-500 group-hover:text-gray-700' />
                  <span>
                    {hiddenCount} hidden {hiddenCount === 1 ? 'reply' : 'replies'}
                  </span>
                </button>
                <div className='flex-1 bg-gray-200 h-[1px]'></div>
              </div>
            )}
          </div>
        );
      })}
      {isExpanded && visibleMessages.length > MIN_MESSAGES_TO_COLLAPSE && (
        <div className='flex items-center my-1.5 px-2 gap-2'>
          <button
            onClick={() => setIsExpanded(false)}
            className='flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors group'
          >
            <ChevronUp className='w-3.5 h-3.5 text-gray-500 group-hover:text-gray-700' />
            <span>Collapse thread</span>
          </button>
          <div className='flex-1 bg-gray-200 h-[1px]'></div>
        </div>
      )}
    </div>
  );
};

export default ThreadList;
