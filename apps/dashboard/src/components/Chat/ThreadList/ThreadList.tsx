import { ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { queries } from '../../../zero/queries';
import { QueryResultType } from '@rocicorp/zero';
import { useAuthContext } from '../../../providers/AuthProvider';
import { useLocation } from 'react-router-dom';
import { ChatBubble } from '../ChatBubble/ChatBubble';
import { MessageHoverToolbar } from '../HoverActionsToolbar/MessageHoverToolbar';
import { useThreadListInitialScroll } from './useThreadListInitialScroll';
import type { ThreadListItemWithSeparator } from '../../../utils/chatUtils';
import { DatePill } from '../DatePill';
import { MessageType, ChannelScopeType } from '@xyne/shared';
import { MessageMetadata } from '../../ui/MessageBubble/MessageBubble.utils';
import { ConversationWithTicket } from '../../ui/MessageBubble/MessageBubble.types';
import { useMessageEdit, withEditSurface } from '../../../providers/EditProvider';
import { useShortcutById } from '../../../shortcuts';
import { findLastEditableMessage, isEventFromEmptyInput } from '../../../utils/chatUtils';
import { ArrowDown, ArrowUp, ChevronUp } from 'lucide-react';
import { AttachmentRef } from '../../../machines/attachmentViewerMachine';
import { useThreadReadTracking } from '../../../hooks/useThreadReadTracking';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { getInitialMessageFromConversation } from '../../../utils/conversationMessageHelpers';

type ThreadListProps = {
  channelId: string;
  conversationId: string;
  threadMessages: QueryResultType<typeof queries.conversationMessagesV2>;
  initialScrollOffset?: number;
  onScrollPositionChange?: (position: number) => void;
  isTicketThread?: boolean;
  isFlowStep?: boolean;
  messagesWithSeparators?: ThreadListItemWithSeparator[] | undefined;
  channelScopeType?: ChannelScopeType | undefined;
  conversation?: ConversationWithTicket | undefined;
  workflowNumberMap?: Map<string, number>;
  disableAskAI?: boolean;
  enableCollapsing?: boolean;
  enableJumpFab?: boolean;
  /** When false, hash deep-link scroll waits until Zero reports the thread query complete (avoids scroll before prepends). */
  isMessagesLoaded?: boolean;
  conversationParticipant?: { lastReadAt?: number | null };
  /** Scroll to and highlight this specific message on mount. Overrides URL-hash-based scroll. */
  matchedMessageId?: string | null;
  /** Tag being inspected from the thread header. Passed straight through to the bubbles. */
  inspectedTag?: string | null;
  /** Overrides the bubbles' default profile navigation (pass a noop to disable it, e.g. SDLC panels). */
  onUserClick?: ((userId: string) => void) | undefined;
  spawnedTicketMessageIds?: ReadonlySet<string> | undefined;
};

/** Space reserved below the last message for the typing / agent-activity bar, which
    overlays the top edge of the composer. Mirrors the virtualizer `paddingEnd` in
    ChatListV4. Applied as padding-bottom on the scroll container, so scroll-to-bottom
    (`scrollHeight - clientHeight`) naturally lands with the last message clear of it. */
const ACTIVITY_BAR_PADDING = 28;

const ThreadList = ({
  channelId,
  conversationId,
  threadMessages,
  initialScrollOffset,
  onScrollPositionChange,
  isTicketThread = false,
  isFlowStep = false,
  messagesWithSeparators,
  channelScopeType,
  conversation,
  workflowNumberMap,
  disableAskAI,
  enableCollapsing = false,
  enableJumpFab = true,
  isMessagesLoaded = true,
  conversationParticipant,
  matchedMessageId,
  inspectedTag = null,
  onUserClick,
  spawnedTicketMessageIds,
}: ThreadListProps): ReactElement => {
  const { user } = useAuthContext();
  const { isEditingMessage, isEditingHere, requestEdit } = useMessageEdit();
  const location = useLocation();
  const activityNavigationNonce =
    (location.state as { activityNavigationNonce?: number } | null)?.activityNavigationNonce ?? 0;
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollContentRef = useRef<HTMLDivElement>(null);
  // Container for the shared hover toolbar overlay (one toolbar per list).
  const hoverToolbarContainerRef = useRef<HTMLDivElement>(null);
  const hasAppliedInitialScrollRef = useRef(false);
  const scrollIdleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isEventFromThreadInput = useCallback(
    (event: KeyboardEvent): boolean => isEventFromEmptyInput(event, conversationId),
    [conversationId],
  );

  // Pre-compute all thread attachments for gallery navigation
  const allThreadAttachments: AttachmentRef[] = useMemo(() => {
    if (!threadMessages) return [];

    const result = threadMessages.flatMap(msg => {
      if (!msg.hasAttachment || !msg.attachments?.length) return [];

      const ordered = [...msg.attachments].sort(
        (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
      );

      return ordered.map(att => ({
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
  }, [threadMessages, channelId, conversation?.replyCount]);

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

    if (isEditingMessage(message.messageId)) {
      scrollToMessage();
      return;
    }

    requestEdit(message.messageId, scrollToMessage);
  }, [conversationId, threadMessages, user?.id, isEditingMessage, requestEdit]);

  useShortcutById('composer.editLastMessage', handleEditLastMessage, {
    enabled: threadMessages.length > 0,
    when: isEventFromThreadInput,
  });
  const [isExpanded, setIsExpanded] = useState(false);
  const [isNearBottom, setIsNearBottom] = useState(false);
  const [isNearTop, setIsNearTop] = useState(true);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [isScrolling, setIsScrolling] = useState(false);
  const isNearBottomRef = useRef(isNearBottom);
  useEffect(() => {
    isNearBottomRef.current = isNearBottom;
  }, [isNearBottom]);

  const isEditingRef = useRef(false);
  useEffect(() => {
    isEditingRef.current = isEditingHere;
  }, [isEditingHere]);

  const lastAutoScrolledMessageIdRef = useRef<string | null>(null);

  const threadTicketId = useMemo(() => {
    if (!isTicketThread || !conversation) return '';
    const initMsg = getInitialMessageFromConversation(conversation) ?? conversation.initialMessage;
    return ((initMsg?.metadata as Record<string, unknown>)?.['ticketId'] as string) || '';
  }, [isTicketThread, conversation]);

  // Subtickets cannot be nested: hide the action when the thread's ticket is itself a subticket.
  const [threadTicketParentSubTicket] = useCachedQuery(
    queries.subTicketByMappedTicketId({ mappedTicketId: threadTicketId }),
    { enabled: !!threadTicketId },
  );
  const isThreadTicketSubTicket = !!threadTicketParentSubTicket;

  const {
    firstUnreadIndex,
    updateLastReadAt,
    savedScrollPosition,
    saveScrollPosition,
    isTrackingHydrated,
  } = useThreadReadTracking(conversationId, threadMessages, {
    disableScrollTracking: enableCollapsing,
  });

  const showFab = enableJumpFab && hasOverflow && !isNearBottom && threadMessages.length > 0;
  const showScrollToTopFab =
    enableJumpFab &&
    hasOverflow &&
    !isNearTop &&
    threadMessages.length > 0 &&
    (!isNearBottom || isScrolling);

  const handleJumpToLatest = useCallback(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight - container.clientHeight;
      updateLastReadAt();
      setIsNearBottom(true);
      setIsNearTop(false);
    }
  }, [updateLastReadAt]);

  const handleScrollToTop = useCallback(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTop = 0;
      setIsNearTop(true);
      setIsNearBottom(false);
    }
  }, []);

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
    lastAutoScrolledMessageIdRef.current = null;
    setIsNearBottom(false);
    setIsNearTop(true);
    setHasOverflow(false);
    setIsScrolling(false);
  }, [conversationId, location.key, location.hash, activityNavigationNonce, matchedMessageId]);

  useThreadListInitialScroll({
    scrollContainerRef,
    conversationId,
    location,
    threadMessages,
    enableCollapsing,
    firstUnreadIndex,
    savedScrollPosition,
    initialScrollOffset,
    isMessagesLoaded,
    isTrackingHydrated,
    hasAppliedInitialScrollRef,
    setIsNearBottom,
    matchedMessageId: matchedMessageId ?? null,
  });
  const isThreadsRoute =
    location.pathname.includes('/chat/threads') || location.pathname.includes('/chat/dir/threads');

  // Handle collapsible thread logic - when on /chat/threads route or  when enableCollapsing is true
  const shouldCollapse = (enableCollapsing || isThreadsRoute) && !isExpanded;

  // Calculate which messages to display based on collapse state and unread status
  const { visibleMessages, hiddenCount } = (() => {
    if (!shouldCollapse || !threadMessages || threadMessages.length === 0) {
      return { visibleMessages: threadMessages, hiddenCount: 0 };
    }

    const rootMessage = threadMessages[0]!;
    const replies = threadMessages.slice(1); // everything after root

    if (replies.length === 0) {
      return { visibleMessages: threadMessages, hiddenCount: 0 };
    }

    // Timestamp-based unread detection using per-conversation lastReadAt
    const lastReadAt = conversationParticipant?.lastReadAt;

    if (lastReadAt !== undefined && lastReadAt !== null) {
      // Find all replies created after lastReadAt
      const unreadReplies = replies.filter(m => {
        const messageTime = new Date(m.createdAt).getTime();
        return messageTime > lastReadAt;
      });

      if (unreadReplies.length > 0) {
        const readRepliesCount = replies.length - unreadReplies.length;
        return {
          visibleMessages: [rootMessage, ...unreadReplies],
          hiddenCount: readRepliesCount,
        };
      }
      // If no unread replies, fall through to show last N
    }

    // DEFAULT: No unread replies — show root + last 3 replies
    const MAX_VISIBLE_REPLIES = 3;
    if (replies.length <= MAX_VISIBLE_REPLIES) {
      return { visibleMessages: threadMessages, hiddenCount: 0 };
    }

    const lastReplies = replies.slice(-MAX_VISIBLE_REPLIES);
    const olderCount = replies.length - MAX_VISIBLE_REPLIES;
    return {
      visibleMessages: [rootMessage, ...lastReplies],
      hiddenCount: olderCount,
    };
  })();

  // messageId -> index lookup for the ticket-thread render path. A per-item
  // threadMessages.findIndex() made that path O(n²) per render on long threads.
  const messageIndexById = useMemo(() => {
    const map = new Map<string, number>();
    threadMessages.forEach((m, i) => map.set(m.messageId, i));
    return map;
  }, [threadMessages]);

  const firstUnreadReplyIndex = useMemo(() => {
    const lastReadAt = conversationParticipant?.lastReadAt;
    if (typeof lastReadAt !== 'number' || !visibleMessages || visibleMessages.length <= 1) {
      return -1;
    }
    return visibleMessages.findIndex(
      (m, i) => i > 0 && new Date(m.createdAt).getTime() > lastReadAt,
    );
  }, [visibleMessages, conversationParticipant?.lastReadAt, user?.id]);

  /**
   * 2️⃣ Auto-scroll on new messages
   *    - Always scroll if the latest message is from current user
   *    - Otherwise scroll only when user is already near bottom
   *    - Skip if we've navigated to a specific message via link
   */
  useEffect(() => {
    const latestMessage = threadMessages?.[threadMessages.length - 1];
    const latestMessageId = latestMessage?.messageId ?? null;
    const isAppend = latestMessageId !== lastAutoScrolledMessageIdRef.current;
    lastAutoScrolledMessageIdRef.current = latestMessageId;

    const container = scrollContainerRef.current;
    if (!container || !threadMessages?.length) return;
    if (!hasAppliedInitialScrollRef.current) return;
    if (!enableJumpFab && !hasOverflow) return;
    if (!isAppend) return;

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
      // Discount the reserved activity-bar padding so "does the content overflow"
      // keeps its original meaning — otherwise every short thread would report
      // overflow purely because of the padding and switch on the jump FAB.
      const overflow = container.scrollHeight > container.clientHeight + 8 + ACTIVITY_BAR_PADDING;
      setHasOverflow(overflow);
      if (isEditingRef.current) return;
      if (!overflow) {
        setIsNearBottom(true);
        return;
      }
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      setIsNearBottom(distanceFromBottom < 150);
    };

    const observer = new ResizeObserver(() => {
      const wasNearBottom = isNearBottomRef.current;
      recomputeOverflow();
      if (wasNearBottom) {
        container.scrollTop = container.scrollHeight - container.clientHeight;
        setIsNearBottom(true);
      }
    });

    observer.observe(container);
    observer.observe(content);
    recomputeOverflow();

    return (): void => {
      observer.disconnect();
    };
  }, [threadMessages, location.key, location.hash, activityNavigationNonce]);

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
      if (!isEditingRef.current) {
        setIsNearBottom(distanceFromBottom < 150);
      }
      setIsNearTop(container.scrollTop < 150);

      setIsScrolling(true);
      if (scrollIdleTimeoutRef.current) {
        clearTimeout(scrollIdleTimeoutRef.current);
      }
      scrollIdleTimeoutRef.current = setTimeout(() => {
        setIsScrolling(false);
        // Persist scroll position once scrolling settles. Calling saveScrollPosition on
        // EVERY scroll event updated savedScrollPosition state per tick, re-rendering the
        // entire (unvirtualized) ChatBubble list on each scroll frame — a CPU spike on
        // long threads. The unmount effect below still persists the final position.
        saveScrollPosition(container.scrollTop);
      }, 1000);

      if (onScrollPositionChange) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          onScrollPositionChange(container.scrollTop);
        }, 300);
      }
    };

    container.addEventListener('scroll', handleScroll);

    return (): void => {
      container.removeEventListener('scroll', handleScroll);
      clearTimeout(timeoutId);
      if (scrollIdleTimeoutRef.current) {
        clearTimeout(scrollIdleTimeoutRef.current);
      }
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
      <div ref={hoverToolbarContainerRef} className='relative flex-1 min-h-0 bg-background'>
        {/* ONE shared hover-actions toolbar for the thread (zero-render hover). */}
        <MessageHoverToolbar containerRef={hoverToolbarContainerRef} />
        <div
          data-component='ThreadList'
          ref={scrollContainerRef}
          className='h-full overflow-auto no-scrollbar pt-4'
          style={{ paddingBottom: ACTIVITY_BAR_PADDING }}
        >
          <div ref={scrollContentRef} className='flex min-h-full flex-col justify-end'>
            {messagesWithSeparators.map((item, index) => {
              if (item.type === 'date-separator') {
                return <DatePill key={`date-separator-${index}`} dateText={item.dateText} />;
              }

              const threadMessage = item.data;
              const messageIndex = messageIndexById.get(threadMessage.messageId) ?? -1;
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

              const isActivityItem = (
                neighbor: ThreadListItemWithSeparator | undefined,
              ): boolean => {
                if (!neighbor || neighbor.type !== 'message') return false;
                const neighborMetadata = neighbor.data.metadata as Record<string, unknown> | null;
                return (
                  neighbor.data.msgType === MessageType.SYSTEM &&
                  neighborMetadata?.['isTicketActivity'] === true
                );
              };
              const isPrevRenderedItemAnActivity = isActivityItem(
                messagesWithSeparators[index - 1],
              );
              const isNextRenderedItemAnActivity = isActivityItem(
                messagesWithSeparators[index + 1],
              );

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
                      {...(onUserClick && { onUserClick })}
                      {...(spawnedTicketMessageIds && { spawnedTicketMessageIds })}
                      isFirstInThread={messageIndex === 0}
                      isTicketThread={isTicketThread}
                      isFlowStep={isFlowStep}
                      isThreadTicketSubTicket={isThreadTicketSubTicket}
                      channelScopeType={channelScopeType}
                      allThreadAttachments={allThreadAttachments}
                      workflowNumber={workflowNumberMap?.get(threadMessage.messageId)}
                      isPrevActivity={isPrevRenderedItemAnActivity}
                      isNextActivity={isNextRenderedItemAnActivity}
                      {...(disableAskAI !== undefined && { disableAskAI })}
                      {...(conversation && { conversation })}
                      highlightMessageId={matchedMessageId ?? null}
                      inspectedTag={inspectedTag}
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
        {showScrollToTopFab && (
          <button
            onClick={handleScrollToTop}
            className={`absolute ${showFab ? 'bottom-20' : 'bottom-6'} right-6 bg-background border border-border rounded-full p-3 shadow-lg hover:shadow-xl transition-all duration-200 hover:bg-accent z-50`}
            aria-label='Scroll to top'
            data-track-category='THREAD_PANEL'
            data-track-name='THREAD_SCROLL_TO_TOP'
          >
            <ArrowUp className='w-5 h-5 text-foreground' />
          </button>
        )}
      </div>
    );
  }

  // Default render without date separators
  return (
    <div ref={hoverToolbarContainerRef} className='relative flex-1 min-h-0 bg-background'>
      {/* ONE shared hover-actions toolbar for the thread (zero-render hover). */}
      <MessageHoverToolbar containerRef={hoverToolbarContainerRef} />
      <div
        data-component='ThreadList'
        ref={scrollContainerRef}
        className='h-full overflow-auto no-scrollbar pt-4'
        style={{ paddingBottom: ACTIVITY_BAR_PADDING }}
      >
        <div ref={scrollContentRef} className='flex min-h-full flex-col justify-end'>
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
                {index === firstUnreadReplyIndex && (
                  <div className='relative py-3'>
                    <div className='absolute left-0 right-0 top-1/2 h-px bg-destructive z-0'></div>
                    <div className='relative z-5 flex items-center justify-center'>
                      <span className='text-xs text-destructive bg-background px-2 font-medium'>
                        New Messages
                      </span>
                    </div>
                  </div>
                )}
                <div id={`thread-message-${conversationId}-${threadMessage.messageId}`}>
                  <ChatBubble
                    message={threadMessage}
                    channelId={channelId}
                    showAvatar={showAvatar}
                    context='thread'
                    {...(onUserClick && { onUserClick })}
                    {...(spawnedTicketMessageIds && { spawnedTicketMessageIds })}
                    isFirstInThread={index === 0}
                    isTicketThread={isTicketThread}
                    isFlowStep={isFlowStep}
                    isThreadTicketSubTicket={isThreadTicketSubTicket}
                    channelScopeType={channelScopeType}
                    allThreadAttachments={allThreadAttachments}
                    workflowNumber={workflowNumberMap?.get(threadMessage.messageId)}
                    {...(disableAskAI !== undefined && { disableAskAI })}
                    {...(conversation && { conversation })}
                    highlightMessageId={matchedMessageId ?? null}
                    inspectedTag={inspectedTag}
                  />
                </div>
                {!enableCollapsing &&
                  !isThreadsRoute &&
                  index === 0 &&
                  visibleMessages.length > 1 && (
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
                      className='flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors'
                      data-track-category='THREAD_PANEL'
                      data-track-name='EXPAND_THREAD'
                      data-track-metadata={JSON.stringify({ hiddenCount })}
                    >
                      <span className='mr-0.5'>↳</span>
                      <span>
                        Show {hiddenCount} older {hiddenCount === 1 ? 'reply' : 'replies'}
                      </span>
                    </button>
                    <div className='flex-1 bg-border h-[1px]'></div>
                  </div>
                )}
              </div>
            );
          })}
          {isExpanded && isThreadsRoute && (
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
      {showScrollToTopFab && (
        <button
          onClick={handleScrollToTop}
          className={`absolute ${showFab ? 'bottom-20' : 'bottom-6'} right-6 bg-background border border-border rounded-full p-3 shadow-lg hover:shadow-xl transition-all duration-200 hover:bg-accent z-50`}
          aria-label='Scroll to top'
          data-track-category='THREAD_PANEL'
          data-track-name='THREAD_SCROLL_TO_TOP'
        >
          <ArrowUp className='w-5 h-5 text-foreground' />
        </button>
      )}
    </div>
  );
};

export default withEditSurface(ThreadList);
