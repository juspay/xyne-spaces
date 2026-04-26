import { ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { findLastEditableMessage, isEventFromEmptyInput } from '../../../utils/chatUtils';
import { ArrowDown, ChevronRight, ChevronUp } from 'lucide-react';
import { AttachmentRef } from '../../../machines/attachmentViewerMachine';
import { useThreadReadTracking } from '../../../hooks/useThreadReadTracking';

type ThreadListProps = {
  channelId: string;
  conversationId: string;
  threadMessages: QueryResultType<typeof queries.conversationMessagesV2>;
  initialScrollOffset?: number;
  onScrollPositionChange?: (position: number) => void;
  isTicketThread?: boolean;
  messagesWithSeparators?: ThreadListItemWithSeparator[] | undefined;
  channelScopeType?: ChannelScopeType | undefined;
  conversation?: ConversationWithTicket | undefined;
  workflowNumberMap?: Map<string, number>;
  disableAskAI?: boolean;
  enableCollapsing?: boolean;
  enableJumpFab?: boolean;
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
  workflowNumberMap,
  disableAskAI,
  enableCollapsing = false,
  enableJumpFab = true,
}: ThreadListProps): ReactElement => {
  const { user } = useAuthContext();
  const { editingMessageId, requestEdit } = useEditContext();
  const location = useLocation();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollContentRef = useRef<HTMLDivElement>(null);
  const hasAppliedInitialScrollRef = useRef(false);

  const isEventFromThreadInput = useCallback(
    (event: KeyboardEvent): boolean => isEventFromEmptyInput(event, conversationId),
    [conversationId],
  );

  // Pre-compute all thread attachments for gallery navigation
  const allThreadAttachments: AttachmentRef[] = useMemo(() => {
    if (!threadMessages) return [];

    const result = threadMessages.flatMap(msg => {
      if (!msg.hasAttachment || !msg.attachments?.length) return [];

      return msg.attachments.map(att => ({
        attachmentId: att.id,
        fileName: att.originalFilename,
        fileUrl: `/attachments/${att.id}/download`,
        mimeType: att.mimetype,
        fileSize: att.size,
        thumbnailUrl: att.thumbnailUrl,
        conversationId: msg.conversationId,
        channelId: channelId,
        replyCount: conversation?.replyCount ?? 0,
      }));
    });

    return result;
  }, [threadMessages, channelId]);

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
  const [isNearBottom, setIsNearBottom] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);

  const { firstUnreadIndex, updateLastReadAt, savedScrollPosition, saveScrollPosition } =
    useThreadReadTracking(conversationId, threadMessages, {
      disableScrollTracking: enableCollapsing,
    });

  const showFab = enableJumpFab && hasOverflow && !isNearBottom && threadMessages.length > 0;

  const handleJumpToLatest = useCallback(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight - container.clientHeight;
      updateLastReadAt();
      setIsNearBottom(true);
    }
  }, [updateLastReadAt]);

  // Check if the previous message is a system message
  const isPreviousMessageSystem = (
    messageIndex: number,
    messages: typeof threadMessages,
  ): boolean => {
    if (messageIndex === 0) return false;
    const prevMsg = messages[messageIndex - 1];
    return prevMsg?.msgType === MessageType.SYSTEM;
  };

  useEffect(() => {
    hasAppliedInitialScrollRef.current = false;
    setIsNearBottom(false);
    setHasOverflow(false);
  }, [conversationId, location.key]);

  // Handle collapsible thread logic - only when enableCollapsing is true
  const shouldCollapse = enableCollapsing && !isExpanded;
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

  /**
   * 1️⃣ On initial load → force scroll to specific message, first unread, saved position, or bottom
   *    Priority: message navigation > first unread > saved position > bottom
   */
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !threadMessages?.length) return;
    if (hasAppliedInitialScrollRef.current) return;
    if (enableCollapsing && typeof initialScrollOffset !== 'number' && !location.hash) {
      hasAppliedInitialScrollRef.current = true;
      return;
    }

    const originConversationId = extractOriginFromHash(location.hash);
    const targetMessageId = extractMessageIdFromHash(location.hash);

    requestAnimationFrame(() => {
      // Priority 1: Check for specific message navigation from URL hash
      if (originConversationId === conversationId && targetMessageId) {
        const elementId = `thread-message-${conversationId}-${targetMessageId}`;
        const targetElement = document.getElementById(elementId);
        if (targetElement) {
          targetElement.scrollIntoView({ behavior: 'auto', block: 'start' });
          hasAppliedInitialScrollRef.current = true;
          return;
        }
      }

      // Priority 1.5: Scroll to first unread message
      if (!enableCollapsing && firstUnreadIndex !== null && threadMessages[firstUnreadIndex]) {
        const elementId = `thread-message-${conversationId}-${threadMessages[firstUnreadIndex].messageId}`;
        const targetElement = document.getElementById(elementId);
        if (targetElement) {
          targetElement.scrollIntoView({ behavior: 'auto', block: 'start' });
          hasAppliedInitialScrollRef.current = true;
          return;
        }
      }

      // Priority 2: Use saved scroll position
      if (!enableCollapsing && savedScrollPosition !== null) {
        container.scrollTop = savedScrollPosition;
        hasAppliedInitialScrollRef.current = true;
        return;
      }

      // Priority 2.5: Use provided initialScrollOffset
      if (typeof initialScrollOffset === 'number') {
        container.scrollTop = initialScrollOffset;
        hasAppliedInitialScrollRef.current = true;
        return;
      }

      // Priority 3: Default to TOP (new thread behavior)
      container.scrollTop = 0;
      hasAppliedInitialScrollRef.current = true;
      setIsNearBottom(false);
    });
  }, [
    channelId,
    conversationId,
    enableCollapsing,
    location.hash,
    location.key,
    firstUnreadIndex,
    savedScrollPosition,
    initialScrollOffset,
    threadMessages,
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
    if (!hasAppliedInitialScrollRef.current) return;
    if (!enableJumpFab && !hasOverflow) return;

    const latestMessage = threadMessages[threadMessages.length - 1];
    const isFromCurrentUser = latestMessage?.senderId === user?.id;

    const threshold = 100;
    const currentlyNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < threshold;

    if (isFromCurrentUser || currentlyNearBottom) {
      container.scrollTop = container.scrollHeight - container.clientHeight;
      updateLastReadAt();
      setIsNearBottom(true);
    }
  }, [enableJumpFab, hasOverflow, threadMessages, user?.id, updateLastReadAt]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    const content = scrollContentRef.current;
    if (!container || !content) return;

    const recomputeOverflow = (): void => {
      const overflow = container.scrollHeight > container.clientHeight + 8;
      setHasOverflow(overflow);
      if (!overflow) {
        setIsNearBottom(true);
        return;
      }
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      setIsNearBottom(distanceFromBottom < 150);
    };

    const observer = new ResizeObserver(() => {
      recomputeOverflow();
    });

    observer.observe(container);
    observer.observe(content);
    recomputeOverflow();

    return (): void => {
      observer.disconnect();
    };
  }, [threadMessages]);

  /**
   * Track scroll position changes for persistence (debounced)
   *  Only active when onScrollPositionChange is provided
   */
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    let timeoutId: NodeJS.Timeout;

    const handleScroll = (): void => {
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      setIsNearBottom(distanceFromBottom < 150);

      if (onScrollPositionChange) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          onScrollPositionChange(container.scrollTop);
        }, 300);
      }

      saveScrollPosition(container.scrollTop);
    };

    container.addEventListener('scroll', handleScroll);

    return (): void => {
      container.removeEventListener('scroll', handleScroll);
      clearTimeout(timeoutId);
    };
  }, [onScrollPositionChange, saveScrollPosition]);

  useEffect(() => {
    return () => {
      const container = scrollContainerRef.current;
      if (container) {
        saveScrollPosition(container.scrollTop);
      }
    };
  }, [saveScrollPosition]);

  // Render with date separators for ticket threads
  if (isTicketThread && messagesWithSeparators) {
    return (
      <div className='relative flex-1 min-h-0 bg-background'>
        <div
          data-component='ThreadList'
          ref={scrollContainerRef}
          className='h-full overflow-auto no-scrollbar py-6'
        >
          <div ref={scrollContentRef}>
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
                isPreviousMessageSystem(messageIndex, threadMessages) ||
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
                      allThreadAttachments={allThreadAttachments}
                      workflowNumber={workflowNumberMap?.get(threadMessage.messageId)}
                      {...(disableAskAI !== undefined && { disableAskAI })}
                      {...(conversation && { conversation })}
                    />
                  </div>
                  {messageIndex === 0 && threadMessages.length > 1 && (
                    <div className='flex items-center my-3 pl-2 gap-2'>
                      <span className='flex text-xs text-muted-foreground'>
                        {threadMessages.length - 1}{' '}
                        {threadMessages.length - 1 === 1 ? 'reply' : 'replies'}
                      </span>
                      <div className='flex-1 bg-border w-full h-[1px]'></div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {showFab && (
          <button
            onClick={handleJumpToLatest}
            className='absolute bottom-6 right-6 bg-background border border-border rounded-full p-3 shadow-lg hover:shadow-xl transition-all duration-200 hover:bg-accent z-50'
            aria-label='Scroll to bottom'
            data-track-category='THREAD_PANEL'
            data-track-name='THREAD_SCROLL_TO_BOTTOM'
          >
            <ArrowDown className='w-5 h-5 text-foreground' />
          </button>
        )}
      </div>
    );
  }

  // Default render without date separators
  return (
    <div className='relative flex-1 min-h-0 bg-background'>
      <div
        data-component='ThreadList'
        ref={scrollContainerRef}
        className='h-full overflow-auto no-scrollbar py-6'
      >
        <div ref={scrollContentRef}>
          {visibleMessages.map((threadMessage, index) => {
            const showAvatar =
              enableCollapsing ||
              index < 2 ||
              !threadMessage ||
              visibleMessages[index - 1]?.senderId !== threadMessage.senderId ||
              isPreviousMessageSystem(index, visibleMessages) ||
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
                    allThreadAttachments={allThreadAttachments}
                    workflowNumber={workflowNumberMap?.get(threadMessage.messageId)}
                    {...(disableAskAI !== undefined && { disableAskAI })}
                    {...(conversation && { conversation })}
                  />
                </div>
                {!enableCollapsing && index === 0 && visibleMessages.length > 1 && (
                  <div className='flex items-center pb-2 pl-2 gap-2'>
                    <span className='flex text-xs text-muted-foreground'>
                      {visibleMessages.length - 1}{' '}
                      {visibleMessages.length - 1 === 1 ? 'reply' : 'replies'}
                    </span>
                    <div className='flex-1 bg-border w-full h-[1px]'></div>
                  </div>
                )}
                {/* Show collapse/expand button after first message when in collapsed mode */}
                {shouldShowCollapseButton && (
                  <div className='flex items-center my-1 px-2 gap-2'>
                    <button
                      onClick={() => setIsExpanded(true)}
                      className='flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors group'
                      data-track-category='THREAD_PANEL'
                      data-track-name='EXPAND_THREAD'
                      data-track-metadata={JSON.stringify({ hiddenCount })}
                    >
                      <ChevronRight className='w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground' />
                      <span>
                        {hiddenCount} hidden {hiddenCount === 1 ? 'reply' : 'replies'}
                      </span>
                    </button>
                    <div className='flex-1 bg-border h-[1px]'></div>
                  </div>
                )}
              </div>
            );
          })}
          {isExpanded && visibleMessages.length > MIN_MESSAGES_TO_COLLAPSE && (
            <div className='flex items-center my-1.5 px-2 gap-2'>
              <button
                onClick={() => setIsExpanded(false)}
                className='flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors group'
                data-track-category='THREAD_PANEL'
                data-track-name='COLLAPSE_THREAD'
              >
                <ChevronUp className='w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground' />
                <span>Collapse thread</span>
              </button>
              <div className='flex-1 bg-border h-[1px]'></div>
            </div>
          )}
        </div>
      </div>
      {showFab && (
        <button
          onClick={handleJumpToLatest}
          className='absolute bottom-6 right-6 bg-background border border-border rounded-full p-3 shadow-lg hover:shadow-xl transition-all duration-200 hover:bg-accent z-50'
          aria-label='Scroll to bottom'
          data-track-category='THREAD_PANEL'
          data-track-name='THREAD_SCROLL_TO_BOTTOM'
        >
          <ArrowDown className='w-5 h-5 text-foreground' />
        </button>
      )}
    </div>
  );
};

export default ThreadList;
