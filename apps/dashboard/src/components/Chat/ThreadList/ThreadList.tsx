import {
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { queries } from '../../../zero/queries';
import { QueryResultType } from '@rocicorp/zero';
import { useAuthContext } from '../../../providers/AuthProvider';
import { useLocation } from 'react-router-dom';
import { ChatBubble } from '../ChatBubble/ChatBubble';
import { PendingSendStatus } from '../PendingSendStatus/PendingSendStatus';
import { messageInteractionModality } from '../ChatBubble/hoveredMessageRef';
import { MessageHoverToolbar } from '../HoverActionsToolbar/MessageHoverToolbar';
import { usePlatform } from '../../../hooks/usePlatform';
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

/** Breathing room at both edges before a keyboard-selected row counts as visible. */
const SELECTION_VIEWPORT_PADDING = 8;
/**
 * Where a selection that had to scroll comes to rest, measured from the top of
 * the panel. No sticky date pill here (thread separators scroll inline), so
 * this is just the container's own `pt-4` worth of breathing room.
 */
const SELECTION_SCROLL_TOP_OFFSET = 16;

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

  // ── Keyboard navigation ────────────────────────────────────────────────────
  // Same contract as ChatListV4: Up/Down walk a selection through the rendered
  // rows, the shared toolbar arms whichever row is selected, and a click moves
  // the (invisible) starting point without painting anything. The thread list
  // is not virtualized, so every row is mounted and scrolling is plain DOM.
  const { isMobile } = usePlatform();
  const [keyboardSelectedMessageId, setKeyboardSelectedMessageId] = useState<string | null>(null);
  const messageListFocusRef = useRef<HTMLButtonElement>(null);
  /** Where the next arrow press starts from; a ref, so it never paints a row. */
  const navigationAnchorRef = useRef<string | null>(null);

  /** The rows this list actually renders, in order — the two render paths differ. */
  const navigableMessages =
    isTicketThread && messagesWithSeparators
      ? messagesWithSeparators.flatMap(item => (item.type === 'message' ? [item.data] : []))
      : visibleMessages;

  const isMessageListNavigationEvent = useCallback((event: KeyboardEvent): boolean => {
    const focusTarget = messageListFocusRef.current;
    if (!focusTarget || event.target !== focusTarget) return false;
    return document.activeElement === focusTarget;
  }, []);

  /** Scrolls only when the row is not already readable, then parks it at the top. */
  const scrollSelectionIntoView = useCallback((messageId: string): void => {
    const container = scrollContainerRef.current;
    const row = container?.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(messageId)}"]`,
    );
    if (!container || !row) return;

    const containerRect = container.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const top = containerRect.top + SELECTION_VIEWPORT_PADDING;
    const bottom = containerRect.bottom - SELECTION_VIEWPORT_PADDING;
    // A row taller than the viewport can never be fully contained, so any
    // overlap counts for those.
    const isReadable =
      rowRect.height >= containerRect.height
        ? rowRect.top < bottom && rowRect.bottom > top
        : rowRect.top >= top && rowRect.bottom <= bottom;
    if (isReadable) return;

    // scrollTop rather than scrollIntoView: this panel is mounted inside
    // dialogs and split views, and scrollIntoView walks every ancestor
    // scroller on its way up. Assigning past either end is clamped by the
    // browser, so the last replies land as far down as the content allows.
    container.scrollTop += rowRect.top - containerRect.top - SELECTION_SCROLL_TOP_OFFSET;
  }, []);

  const selectMessageAtIndex = useCallback(
    (index: number): void => {
      const message = navigableMessages[index];
      // Out of range at either end: the selection stays where it is.
      if (!message) return;
      navigationAnchorRef.current = message.messageId;
      setKeyboardSelectedMessageId(message.messageId);
      scrollSelectionIntoView(message.messageId);
    },
    [navigableMessages, scrollSelectionIntoView],
  );

  const findSelectedMessageIndex = useCallback((): number => {
    const anchorMessageId = keyboardSelectedMessageId ?? navigationAnchorRef.current;
    if (!anchorMessageId) return -1;
    return navigableMessages.findIndex(message => message.messageId === anchorMessageId);
  }, [keyboardSelectedMessageId, navigableMessages]);

  const selectPreviousMessage = useCallback((): void => {
    // Claims the shortcuts back from a pointer the user has stopped moving.
    messageInteractionModality.current = 'keyboard';
    const selectedIndex = findSelectedMessageIndex();
    selectMessageAtIndex(selectedIndex === -1 ? navigableMessages.length - 1 : selectedIndex - 1);
  }, [findSelectedMessageIndex, navigableMessages.length, selectMessageAtIndex]);

  const selectNextMessage = useCallback((): void => {
    messageInteractionModality.current = 'keyboard';
    const selectedIndex = findSelectedMessageIndex();
    // -1 means the anchored message is gone (deleted, or collapsed away), so
    // both directions fall back to the newest reply rather than going dead.
    selectMessageAtIndex(selectedIndex === -1 ? navigableMessages.length - 1 : selectedIndex + 1);
  }, [findSelectedMessageIndex, navigableMessages.length, selectMessageAtIndex]);

  // Registered under the 'thread' scope, not the catalog's 'channel': the panel
  // also mounts where no channel scope exists (ticket views, citation panels,
  // the preview dialog), and a 'channel'-scoped entry is filtered out there
  // entirely. Both lists can register the same shortcut safely — `when` is
  // evaluated before any tie-break, and only the focused list's predicate passes.
  useShortcutById('message.selectPrevious', selectPreviousMessage, {
    scope: 'thread',
    enabled: navigableMessages.length > 0,
    when: isMessageListNavigationEvent,
  });
  useShortcutById('message.selectNext', selectNextMessage, {
    scope: 'thread',
    // Down needs somewhere to start: a highlighted row, or a click anchor.
    enabled: navigableMessages.length > 0,
    when: event =>
      (keyboardSelectedMessageId !== null || navigationAnchorRef.current !== null) &&
      isMessageListNavigationEvent(event),
  });

  useEffect(() => {
    navigationAnchorRef.current = null;
    setKeyboardSelectedMessageId(null);
  }, [conversationId]);

  const handleMessageListClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>): void => {
      // Mobile taps belong to the actions drawer, and there is no keyboard to
      // hand the selection to.
      if (isMobile) return;
      if (!(event.target instanceof Element)) return;
      if (
        event.target.closest(
          'a, button, input, textarea, select, [contenteditable="true"], [role="button"], [role="menuitem"]',
        )
      ) {
        return;
      }
      // A click that ends a text drag must leave that text selected: moving
      // focus to the nav button would collapse it.
      const textSelection = window.getSelection();
      if (textSelection !== null && !textSelection.isCollapsed) return;

      const row = event.target.closest<HTMLElement>('[data-message-id]');
      const messageId = row?.getAttribute('data-message-id');
      if (
        messageId !== null &&
        messageId !== undefined &&
        navigableMessages.some(message => message.messageId === messageId)
      ) {
        navigationAnchorRef.current = messageId;
        // A highlight left over from earlier arrow navigation would now be
        // somewhere else entirely, so drop it.
        setKeyboardSelectedMessageId(null);
      }

      messageListFocusRef.current?.focus({ preventScroll: true });
    },
    [isMobile, navigableMessages],
  );

  const handleMessageListBlur = useCallback((): void => {
    setKeyboardSelectedMessageId(null);
  }, []);

  /** Shared by both render paths — the target that owns the arrow keys. */
  const messageNavigationFocusTarget = (
    <button
      ref={messageListFocusRef}
      type='button'
      className='sr-only'
      aria-label='Navigate thread messages with the up and down arrow keys'
      data-track-category='THREAD_PANEL'
      data-track-name='FOCUS_MESSAGE_NAVIGATION'
      onClick={selectPreviousMessage}
      onBlur={handleMessageListBlur}
    />
  );

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
      <div
        ref={hoverToolbarContainerRef}
        className='relative min-h-0 max-h-full bg-background isolate'
      >
        {/* ONE shared hover-actions toolbar for the thread (zero-render hover). */}
        <MessageHoverToolbar
          containerRef={hoverToolbarContainerRef}
          keyboardSelectedMessageId={keyboardSelectedMessageId}
        />
        {messageNavigationFocusTarget}
        <div
          data-component='ThreadList'
          ref={scrollContainerRef}
          onClickCapture={handleMessageListClick}
          className='h-full overflow-auto no-scrollbar pt-4'
          style={{ paddingBottom: ACTIVITY_BAR_PADDING }}
        >
          <div ref={scrollContentRef}>
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
    <div
      ref={hoverToolbarContainerRef}
      className='relative min-h-0 max-h-full bg-background isolate'
    >
      {/* ONE shared hover-actions toolbar for the thread (zero-render hover). */}
      <MessageHoverToolbar
        containerRef={hoverToolbarContainerRef}
        keyboardSelectedMessageId={keyboardSelectedMessageId}
      />
      {messageNavigationFocusTarget}
      <div
        data-component='ThreadList'
        ref={scrollContainerRef}
        onClickCapture={handleMessageListClick}
        className='h-full overflow-auto no-scrollbar pt-4'
        style={{ paddingBottom: ACTIVITY_BAR_PADDING }}
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
                    channelScopeType={channelScopeType}
                    allThreadAttachments={allThreadAttachments}
                    workflowNumber={workflowNumberMap?.get(threadMessage.messageId)}
                    {...(disableAskAI !== undefined && { disableAskAI })}
                    {...(conversation && { conversation })}
                    highlightMessageId={matchedMessageId ?? null}
                    inspectedTag={inspectedTag}
                  />
                  <PendingSendStatus messageId={threadMessage.messageId} className='pl-10' />
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
