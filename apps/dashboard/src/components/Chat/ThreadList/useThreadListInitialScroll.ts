import { useEffect, useMemo, useRef, type MutableRefObject, type RefObject } from 'react';
import type { Location } from 'react-router-dom';
import { queries } from '../../../zero/queries';
import type { QueryResultType } from '@rocicorp/zero';
import { extractOriginFromHash, extractMessageIdFromHash } from '../ChatList/ChatListUtils';

export type ThreadScrollIntent =
  | { type: 'hash'; messageId: string }
  | { type: 'firstUnread'; index: number }
  | { type: 'saved'; position: number }
  | { type: 'bottom' }
  | { type: 'noop' }
  | { type: 'wait' };

export function deriveThreadScrollIntent(params: {
  hash: string;
  conversationId: string;
  enableCollapsing: boolean;
  isTrackingHydrated: boolean;
  firstUnreadIndex: number | null;
  savedScrollPosition: number | null;
  initialScrollOffset: number | undefined;
  matchedMessageId?: string | null;
}): ThreadScrollIntent {
  const {
    hash,
    conversationId,
    enableCollapsing,
    isTrackingHydrated,
    firstUnreadIndex,
    savedScrollPosition,
    initialScrollOffset,
    matchedMessageId,
  } = params;

  // When a specific matched message is provided (e.g. from search results sidebar),
  // scroll directly to it instead of relying on the URL hash.
  if (matchedMessageId) {
    return { type: 'hash', messageId: matchedMessageId };
  }

  if (enableCollapsing && typeof initialScrollOffset !== 'number' && !hash) {
    return { type: 'noop' };
  }

  const originConversationId = extractOriginFromHash(hash);
  const targetMessageId = extractMessageIdFromHash(hash);

  if (originConversationId === conversationId && targetMessageId) {
    if (enableCollapsing) {
      return { type: 'noop' };
    }
    return { type: 'hash', messageId: targetMessageId };
  }

  // Do not commit fallback intent until thread tracking state is loaded.
  // Without this, first render chooses initialScrollOffset (often 0) and locks there.
  if (!isTrackingHydrated) {
    return { type: 'wait' };
  }

  if (!enableCollapsing && firstUnreadIndex !== null) {
    return { type: 'firstUnread', index: firstUnreadIndex };
  }

  if (!enableCollapsing && savedScrollPosition !== null) {
    return { type: 'saved', position: savedScrollPosition };
  }

  if (typeof initialScrollOffset === 'number') {
    return { type: 'saved', position: initialScrollOffset };
  }

  return { type: 'bottom' };
}

function isScrollReady(
  intent: ThreadScrollIntent,
  threadMessages: QueryResultType<typeof queries.conversationMessagesV2>,
  conversationId: string,
  isMessagesLoaded: boolean,
): boolean {
  if (threadMessages.length === 0) {
    return false;
  }
  if (!threadMessages.every(m => m.conversationId === conversationId)) {
    return false;
  }

  switch (intent.type) {
    case 'wait':
      return false;
    case 'noop':
      return true;
    case 'hash':
      return threadMessages.some(m => m.messageId === intent.messageId) && isMessagesLoaded;
    case 'firstUnread':
      return !!threadMessages[intent.index];
    default:
      return true;
  }
}

export type UseThreadListInitialScrollArgs = {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  conversationId: string;
  location: Location;
  threadMessages: QueryResultType<typeof queries.conversationMessagesV2>;
  enableCollapsing: boolean;
  firstUnreadIndex: number | null;
  savedScrollPosition: number | null;
  initialScrollOffset: number | undefined;
  isMessagesLoaded: boolean;
  isTrackingHydrated: boolean;
  hasAppliedInitialScrollRef: MutableRefObject<boolean>;
  setIsNearBottom: (value: boolean) => void;
  matchedMessageId?: string | null;
};

export function useThreadListInitialScroll({
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
  matchedMessageId,
}: UseThreadListInitialScrollArgs): void {
  const scrollIntent = useMemo(
    () =>
      deriveThreadScrollIntent({
        hash: location.hash,
        conversationId,
        enableCollapsing,
        isTrackingHydrated,
        firstUnreadIndex,
        savedScrollPosition,
        initialScrollOffset,
        matchedMessageId: matchedMessageId ?? null,
      }),
    [
      conversationId,
      enableCollapsing,
      firstUnreadIndex,
      initialScrollOffset,
      isTrackingHydrated,
      location.hash,
      savedScrollPosition,
      isMessagesLoaded,
      matchedMessageId,
    ],
  );

  const scrollReady = useMemo(
    () => isScrollReady(scrollIntent, threadMessages, conversationId, isMessagesLoaded),
    [conversationId, scrollIntent, threadMessages, isMessagesLoaded],
  );

  const threadMessagesRef = useRef(threadMessages);
  threadMessagesRef.current = threadMessages;

  useEffect(() => {
    if (!scrollReady || hasAppliedInitialScrollRef.current) {
      return;
    }

    if (scrollIntent.type === 'noop') {
      hasAppliedInitialScrollRef.current = true;
      return;
    }

    const run = (): void => {
      if (hasAppliedInitialScrollRef.current) {
        return;
      }
      const container = scrollContainerRef.current;
      if (!container) {
        return;
      }

      const messages = threadMessagesRef.current;
      if (messages.length === 0 || !messages.every(m => m.conversationId === conversationId)) {
        return;
      }

      switch (scrollIntent.type) {
        case 'hash': {
          if (!messages.some(m => m.messageId === scrollIntent.messageId)) {
            return;
          }
          const el = container.querySelector(
            `[id="thread-message-${conversationId}-${scrollIntent.messageId}"]`,
          );
          if (!el) {
            return;
          }
          el.scrollIntoView({ behavior: 'auto', block: 'start' });
          break;
        }
        case 'firstUnread': {
          const msg = messages[scrollIntent.index];
          if (!msg) {
            return;
          }
          const el = container.querySelector(
            `[id="thread-message-${conversationId}-${msg.messageId}"]`,
          );
          if (!el) {
            return;
          }
          el.scrollIntoView({ behavior: 'auto', block: 'start' });
          break;
        }
        case 'saved':
          container.scrollTop = scrollIntent.position;
          break;
        case 'bottom':
          container.scrollTop = container.scrollHeight - container.clientHeight;
          setIsNearBottom(true);
          break;
        default:
          return;
      }

      hasAppliedInitialScrollRef.current = true;
    };

    const needsDomNode = scrollIntent.type === 'hash' || scrollIntent.type === 'firstUnread';

    requestAnimationFrame(() => {
      run();
      if (!hasAppliedInitialScrollRef.current && needsDomNode) {
        run();
      }
    });
  }, [
    conversationId,
    hasAppliedInitialScrollRef,
    location.key,
    scrollContainerRef,
    scrollIntent,
    scrollReady,
    setIsNearBottom,
    threadMessages,
  ]);
}
