import { logger, Event as LogEvent } from '../../../utils/logger';
import { withProfiler } from '../../../utils/withProfiler';
import { ChannelScopeType, MessageType } from '@xyne/shared';
import { Conversation } from '../../../machines/stateMachine';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChannelParticipation, useVisibleChannel } from '../../../hooks/useChannels';
import { useZero } from '../../../hooks/useZero';
import { activitySkipMarkAsReadChannelRef } from '../../Activity/activitySkipMarkAsRead';
import { queries } from '../../../zero/queries';
import { useQuery } from '../../../hooks/useQuery';
import { ChatListItem } from '../ChatListItem/ChatListItem';
import { MessageHoverToolbar } from '../HoverActionsToolbar/MessageHoverToolbar';
import { DatePill } from '../DatePill';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { findLastEditableMessage, isEventFromEmptyInput } from '../../../utils/chatUtils';
import { useShortcutById } from '../../../shortcuts';
import { useAuth } from '../../../hooks/useAuth';
import { EditSurfaceScope, useMessageEdit } from '../../../providers/EditProvider';
import { useCombinedMesseges } from './ChatListV2.utils';
import { usePlatform } from '../../../hooks/usePlatform';
import { formatDatePill } from '../../../utils/dateUtils';
import { standaloneNavigate } from '../../../utils/electronApp';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useRouteContext } from '../../../hooks/useRouteContext';
import { ArrowDown } from 'lucide-react';
import { mutators } from '../../../zero/mutators';
import { queryCacheActor, flushQueryCachePersistence } from '../../../machines/queryCacheMachine';
import { browserPanelActor } from '../../../machines/browserPanelMachine';
import LoadingAnimation from '../Loader/Loader';
import { getDraft } from '../../../hooks/useDraft';
import { v4 as uuidv4 } from 'uuid';
import { getInitialMessageFromConversation } from '../../../utils/conversationMessageHelpers';

export type ChatListProps = {
  channelId: string;
  projectId?: string | undefined;
  cachedConversations: Conversation[];
  linkedItemCreatedAt?: Anchor;
  linkedCutoffCreatedAt?: Anchor;
  linkedConversationId?: string;
  channelScopeType?: ChannelScopeType | undefined;
  skipMarkAsReadRef: React.RefObject<boolean>;
};

type Anchor = {
  createdAt: number;
};

type UpdatedConveresationsAnchor = {
  direction: 'forward' | 'backward';
  conversationId: string;
  createdAt: number;
};

const PAGE_SIZE = 50;
const CHAT_MESSAGE_SENT_EVENT = 'xyne:chat-message-sent';
const MAX_LINKED_ANCHOR_FETCH_ATTEMPTS = 3;

function dedupeAndSort(a: Conversation[], b: Conversation[]): Conversation[] {
  const map = new Map<string, Conversation>();
  for (const c of a) map.set(c.conversationId, c);
  for (const c of b) map.set(c.conversationId, c); // b wins on conflict
  return Array.from(map.values()).sort((x, y) => x.createdAt - y.createdAt);
}

function mergeWithCached(
  cachedConversations: Conversation[],
  fetchedConversations: Conversation[],
): Conversation[] {
  if (fetchedConversations.length === 0) {
    return cachedConversations;
  }

  const sorted = [...cachedConversations].sort((a, b) => a.createdAt - b.createdAt);
  const sortedFetched = [...fetchedConversations].sort((a, b) => a.createdAt - b.createdAt);
  const fetchedConversationIds = new Set(sortedFetched.map(l => l.conversationId));
  const overlapIndex = sorted.findIndex(f => fetchedConversationIds.has(f.conversationId));

  if (overlapIndex !== -1) {
    // Find where the overlap occurs in fetched
    const overlapId = sorted[overlapIndex]!.conversationId;
    const fetchedOverlapIndex = sortedFetched.findIndex(f => f.conversationId === overlapId);

    const isFetchedNewer = fetchedOverlapIndex === 0;

    if (isFetchedNewer) {
      // Fetched has newer items, trim end of cached (keep items before overlap)
      const trimmed = sorted.slice(0, overlapIndex);
      return dedupeAndSort(trimmed, sortedFetched);
    }
    // Fetched has older items, trim start of cached (keep items after overlap)
    const trimmed = sorted.slice(overlapIndex + 1);
    return dedupeAndSort(sortedFetched, trimmed);
  }

  return sortedFetched;
}

function mergeWithLatest(
  fetchedConversations: Conversation[],
  latestList: Conversation[],
  isInitialLoadComplete: boolean,
): { merged: Conversation[]; latestClear: boolean } {
  if (latestList.length === 0) {
    return { merged: dedupeAndSort(fetchedConversations, []), latestClear: false };
  }

  // If fetched is empty but latest has items, use latest and clear it
  if (fetchedConversations.length === 0 && latestList.length > 0) {
    if (!isInitialLoadComplete) {
      return { merged: [], latestClear: false };
    }
    return { merged: dedupeAndSort(latestList, []), latestClear: true };
  }

  const sorted = [...fetchedConversations].sort((a, b) => a.createdAt - b.createdAt);
  const latestIds = new Set(latestList.map(l => l.conversationId));
  const overlapIndex = sorted.findIndex(f => latestIds.has(f.conversationId));

  if (overlapIndex !== -1) {
    const trimmed = sorted.slice(0, overlapIndex);
    return { merged: dedupeAndSort(trimmed, latestList), latestClear: true };
  }

  return { merged: dedupeAndSort(fetchedConversations, []), latestClear: false };
}

function isSameConversationList(a: Conversation[], b: Conversation[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (item, index) => item.conversationId === b[index]?.conversationId && item === b[index],
  );
}

function reconcileConversationWindow(
  current: Conversation[],
  incomingWindow: Conversation[],
  lowerBound?: number,
): Conversation[] {
  if (incomingWindow.length === 0) return current;

  const incoming = [...incomingWindow].sort((a, b) => a.createdAt - b.createdAt);
  const incomingById = new Map(incoming.map(item => [item.conversationId, item]));
  const fromMessage = incoming[0];
  const tillMessage = incoming[incoming.length - 1];
  const itemsToDelete = new Set<string>();

  if (fromMessage && tillMessage) {
    let insideWindow = false;
    for (const conv of current) {
      if (
        !insideWindow &&
        (lowerBound !== undefined
          ? conv.createdAt >= lowerBound && conv.createdAt <= tillMessage.createdAt
          : fromMessage.conversationId === conv.conversationId)
      ) {
        insideWindow = true;
      }

      if (insideWindow && !incomingById.has(conv.conversationId)) {
        itemsToDelete.add(conv.conversationId);
      }

      if (tillMessage.conversationId === conv.conversationId) {
        insideWindow = false;
      }
    }
  }

  const replaced = current
    .filter(conv => !itemsToDelete.has(conv.conversationId))
    .map(conv => incomingById.get(conv.conversationId) ?? conv);

  return dedupeAndSort(replaced, incoming);
}

type CombinedMessage = ReturnType<typeof useCombinedMesseges>['combinedMessages'][number];

/** Returns the array index of the first unread conversation boundary, or -1. */
function computeNewConvIdx(
  messages: CombinedMessage[],
  lastViewedAt: number | null | undefined,
  userId: string | null | undefined,
): number {
  if (!lastViewedAt) return -1;
  return messages.findIndex(item => {
    if (item.type !== 'conversation') return false;
    if (item.createdAt.getTime() <= lastViewedAt) return false;
    if (item.data.createdBy === userId) return false;
    const initMsg = getInitialMessageFromConversation(item.data);
    if (initMsg?.senderId === userId) return false;
    if (initMsg?.msgType === MessageType.SYSTEM && item.data.ticketId === null) return false;
    return true;
  });
}

type VirtuosoIndex = { index: number | 'LAST'; align: 'start' | 'center' | 'end' };

const ChatListV3: React.FC<ChatListProps> = ({
  channelId,
  projectId,
  cachedConversations,
  linkedItemCreatedAt,
  linkedCutoffCreatedAt,
  linkedConversationId,
  channelScopeType,
  skipMarkAsReadRef,
  // DEBUG: mount/unmount tracker injected below via useEffect
}) => {
  // Save scroll position when unmounting due to /browser fullscreen navigation.
  // window.location.pathname is already updated by React Router before cleanup runs.
  useEffect(() => {
    const handleCurrentUserMessageSent = (event: Event): void => {
      const { channelId: eventChannelId } = (event as CustomEvent<{ channelId: string }>).detail;
      if (eventChannelId !== channelId) return;

      setTimeout(() => {
        virtuosoRef.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' });
      }, 80);
    };

    window.addEventListener(CHAT_MESSAGE_SENT_EVENT, handleCurrentUserMessageSent);

    return () => {
      window.removeEventListener(CHAT_MESSAGE_SENT_EVENT, handleCurrentUserMessageSent);

      const pathname = window.location.pathname;
      const atBottom = isAtBottomRef.current;
      const convId = topVisibleConvIdRef.current;
      if (pathname.endsWith('/browser') && !atBottom && convId !== undefined) {
        browserPanelActor.send({ type: 'SAVE_SCROLL_POSITION', channelId, conversationId: convId });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  const zero = useZero();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const activityNavigationNonce =
    (location.state as { activityNavigationNonce?: number } | null)?.activityNavigationNonce ?? 0;
  const { baseRoute } = useRouteContext();
  const { isEditingMessage, requestEdit } = useMessageEdit();
  const channelParticipation = useChannelParticipation(channelId);
  const isMember = !!channelParticipation;
  const channel = useVisibleChannel(channelId);

  const [newConversationsAnchor, setNewConversationsAnchor] = useState<Anchor | null>(
    linkedItemCreatedAt ||
      (channelParticipation?.lastViewedAt &&
      (!channel?.channelStats?.lastActivityAt ||
        channelParticipation.lastViewedAt < channel?.channelStats?.lastActivityAt)
        ? { createdAt: channelParticipation?.lastViewedAt }
        : null),
  );
  const [oldConversationsAnchor, setOldestConversationsAnchor] = useState<Anchor>(
    linkedItemCreatedAt || {
      createdAt:
        channelParticipation?.lastViewedAt || channel?.channelStats?.lastActivityAt || Date.now(),
    },
  );
  const [inViewAnchor, setInViewAnchor] = useState<UpdatedConveresationsAnchor | null>(null);

  const [conversations, setConversations] = useState<Conversation[]>(cachedConversations);
  const conversationsRef = useRef<Conversation[]>(cachedConversations);
  // The cache snapshot we hydrated from — used to skip echoing identical
  // data back into the query cache at mount (would dirty the IndexedDB
  // persist key for no reason).
  const hydratedFromCacheRef = useRef<Conversation[]>(cachedConversations);
  const setConversationsState = useCallback(
    (next: Conversation[] | ((prev: Conversation[]) => Conversation[])): void => {
      if (typeof next !== 'function') {
        conversationsRef.current = next;
        setConversations(next);
        return;
      }

      setConversations(prev => {
        const resolved = next(prev);
        conversationsRef.current = resolved;
        return resolved;
      });
    },
    [],
  );

  const [latestConversationsList, setLatestConversationsList] = useState<Conversation[]>([]);
  const latestConversationsListRef = useRef<Conversation[]>([]);
  const [firstItemIndex, setFirstItemIndex] = useState(100000);
  const [stickyDate, setStickyDate] = useState<string | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isFirstItemScrolledOff, setIsFirstItemScrolledOff] = useState(false);

  const rangeRef = useRef<{ startIndex: number; endIndex: number } | null>(null);
  const scrollStopTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hasSkippedInitialCutoffRangeRef = useRef(false);
  // Becomes true after the first rangeChanged fires, meaning Virtuoso's initial scroll
  // (from initialTopMostItemIndex) has settled. Prevents fetchOlderMessages from being
  // triggered by atTopStateChange during the initial mount/scroll race.
  const initialPositionSetRef = useRef(false);
  const lastAutoScrollKeyRef = useRef<string | undefined>(undefined);

  /** Tracks the new-message boundary: its array index and whether user has seen it. */
  type NewConversationBoundary = { index: number; seenConvId: string | null };
  const [newConversationBoundary, setNewConversationBoundary] =
    useState<NewConversationBoundary | null>(null);

  const initialLinkedIdRef = useRef<string | null>(null);
  // Per-navigation retry counter for the linked-anchor fetch path. Keyed by
  // navigationKey so a fresh activity click resets the budget.
  const linkedAnchorFetchAttemptsRef = useRef<{ key: string; count: number }>({
    key: '',
    count: 0,
  });
  const [initialTopMostItemIndex, setInitialTopMostItemIndex] = useState<VirtuosoIndex | null>(
    () => {
      // Browser panel restore: check FIRST (takes priority over activity navigation).
      // Read synchronously from machine snapshot (Option B) — guaranteed to have latest state.
      // Guard: skip if currently on /browser — component may be mounting as background render.
      const pathname = window.location.pathname;
      const savedConvId = browserPanelActor
        .getSnapshot()
        .context.channelScrollPositions.get(channelId);

      if (savedConvId && !pathname.endsWith('/browser')) {
        browserPanelActor.send({ type: 'CLEAR_SCROLL_POSITION', channelId });
        const idx = cachedConversations.findIndex(c => c.conversationId === savedConvId);
        if (idx !== -1) {
          const isLast = idx === cachedConversations.length - 1;
          return {
            index: isLast ? firstItemIndex + idx : idx,
            align: isLast ? ('end' as const) : ('start' as const),
          };
        }
      }

      if (cachedConversations.length === 0) return null;

      if (linkedItemCreatedAt && linkedConversationId) {
        // Activity/deep link: skip loader if conversation exists in cache
        const idx = cachedConversations.findIndex(c => c.conversationId === linkedConversationId);
        if (idx !== -1) {
          const isLast = idx === cachedConversations.length - 1;
          const navigationKey = `${linkedConversationId}:${location.key}:${activityNavigationNonce}`;
          initialLinkedIdRef.current = navigationKey;
          return {
            index: isLast ? firstItemIndex + idx : idx,
            align: isLast ? ('end' as const) : ('start' as const),
          };
        }
        return null;
      }

      return { index: 'LAST' as const, align: 'end' as const };
    },
  );

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  // Container for the shared hover toolbar overlay (Slack pattern): one
  // toolbar for the whole list, positioned over the hovered row.
  const hoverToolbarContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(false);
  const dateObserverRef = useRef<IntersectionObserver | null>(null);
  const visibleDatesRef = useRef<
    Map<Element, { timestamp: number; conversationId: string; rect: DOMRect }>
  >(new Map());
  // Tracks the conversationId of the topmost visible item in the viewport.
  // Updated by IntersectionObserver on every scroll/resize — reliable for short and long lists.
  const topVisibleConvIdRef = useRef<string | undefined>(undefined);
  // Pixel-accurate bottom detection via Virtuoso's atBottomStateChange.
  const isAtBottomRef = useRef(true);
  const { isMobile } = usePlatform();
  const { combinedMessages, itemHeights } = useCombinedMesseges(
    conversations,
    isMobile,
    newConversationBoundary?.index ?? -1,
  );
  const lastConversationAutoScrollKey = useMemo(() => {
    const lastConversation = conversations[conversations.length - 1];
    if (!lastConversation) return '';
    return `${lastConversation.conversationId}:${lastConversation.initial_message_md ?? ''}`;
  }, [conversations]);

  const [isInitialLoadComplete, setIsInitialLoadComplete] = useState(false);
  const isFetchingRef = useRef(false);

  const activityCutoffCreatedAt = linkedCutoffCreatedAt?.createdAt ?? null;
  const channelSeenCutoffCreatedAt = !linkedConversationId
    ? (channelParticipation?.conversationSeenCutoffAt ?? null)
    : null;
  const initialCutoffCreatedAt = activityCutoffCreatedAt ?? channelSeenCutoffCreatedAt;
  const shouldUseCutoffQuery = initialCutoffCreatedAt !== null && isMember;

  const [updatedConversations, updatedConversationsDetails] = useQuery(
    queries.channelConversationsPaginatedV3({
      channelId,
      isMember,
      start: inViewAnchor ? { createdAt: inViewAnchor.createdAt } : null,
      direction: inViewAnchor ? inViewAnchor.direction : 'forward',
      limit: PAGE_SIZE,
    }),
    {
      enabled: !shouldUseCutoffQuery && inViewAnchor !== null,
    },
  );

  const [cutoffAnchor, setCutoffAnchor] = useState<Anchor | null>(
    initialCutoffCreatedAt !== null ? { createdAt: initialCutoffCreatedAt } : null,
  );

  const [cutoffConversations, cutoffConversationsDetails] = useQuery(
    queries.channelConversationsPaginatedV3({
      channelId,
      isMember,
      start: cutoffAnchor,
      direction: 'backward',
      limit: PAGE_SIZE,
    }),
    {
      enabled: shouldUseCutoffQuery && cutoffAnchor !== null,
    },
  );

  const [latestConversations, latestConversationsDetails] = useQuery(
    queries.channelLatestMultipleConversationsV3({
      channelId,
      isMember,
      limit: PAGE_SIZE / 2,
    }),
  );

  useEffect(() => {
    if (shouldUseCutoffQuery) {
      return;
    }

    Promise.all([
      zero.run(
        queries.channelConversationsPaginatedV3({
          channelId,
          isMember,
          start: oldConversationsAnchor,
          direction: 'forward',
          limit: PAGE_SIZE,
        }),
        { type: 'complete' },
      ),
      newConversationsAnchor &&
        zero.run(
          queries.channelConversationsPaginatedV3({
            channelId,
            isMember,
            start: newConversationsAnchor,
            direction: 'backward',
            limit: PAGE_SIZE / 2,
          }),
          { type: 'complete' },
        ),
    ])
      .then(([older, newerNullable]) => {
        const newer = newerNullable ?? [];
        const fetched = dedupeAndSort(older, newer);
        const mergedWithCached = mergeWithCached(conversations, fetched);
        // Read from ref to get the CURRENT latestConversationsList, not the
        // stale closure value (which is always [] since this effect has [] deps).
        const { merged, latestClear } = mergeWithLatest(
          mergedWithCached,
          latestConversationsListRef.current,
          true,
        );

        if (merged[0]) {
          setOldestConversationsAnchor({ createdAt: merged[0].createdAt });
        }

        if (latestClear) {
          setLatestConversationsList([]);
          latestConversationsListRef.current = [];
          setNewConversationsAnchor(null);
        } else if (merged.length > 0) {
          setNewConversationsAnchor({ createdAt: merged[merged.length - 1]!.createdAt });
        }

        // Calculate actual new items prepended (older than the previous oldest conversation)
        // This ensures firstItemIndex only shifts when truly new older items are added
        const prevOldestCreatedAt = conversations[0]?.createdAt;
        const actualNewPrepended = prevOldestCreatedAt
          ? older.filter(item => item.createdAt < prevOldestCreatedAt).length
          : older.length;

        setFirstItemIndex(prev => prev - actualNewPrepended);
        setConversationsState(merged);
        setIsInitialLoadComplete(true);
      })
      .catch(err =>
        logger.error(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('[V11] initial load error:'),
          error: err,
        }),
      );
  }, []);

  useEffect(() => {
    if (
      !shouldUseCutoffQuery ||
      cutoffConversationsDetails.type !== 'complete' ||
      isInitialLoadComplete
    ) {
      return;
    }

    const sortedCutoffConversations = [...cutoffConversations].sort(
      (a, b) => a.createdAt - b.createdAt,
    );
    const mergedWithCached = mergeWithCached(conversations, sortedCutoffConversations);
    const { merged, latestClear } = mergeWithLatest(
      mergedWithCached,
      latestConversationsListRef.current,
      true,
    );

    if (merged[0]) {
      setOldestConversationsAnchor({ createdAt: merged[0].createdAt });
    }

    if (latestClear) {
      setLatestConversationsList([]);
      latestConversationsListRef.current = [];
      setNewConversationsAnchor(null);
    } else if (merged.length > 0) {
      setNewConversationsAnchor({ createdAt: merged[merged.length - 1]!.createdAt });
    }

    setConversationsState(merged);
    setIsInitialLoadComplete(true);
  }, [
    shouldUseCutoffQuery,
    cutoffConversations,
    cutoffConversationsDetails.type,
    isInitialLoadComplete,
  ]);

  useEffect(() => {
    if (
      !shouldUseCutoffQuery ||
      cutoffConversationsDetails.type !== 'complete' ||
      !isInitialLoadComplete
    ) {
      return;
    }

    const sortedCutoffConversations = [...cutoffConversations].sort(
      (a, b) => a.createdAt - b.createdAt,
    );

    // Compute the reconciled list eagerly so we can update the ref synchronously.
    // This ensures any effect in the same React batch (e.g. latestConversations) that
    // reads conversationsRef.current gets the post-deletion value, not the stale one.
    const currentConvs = conversationsRef.current;
    const merged = reconcileConversationWindow(
      currentConvs,
      sortedCutoffConversations,
      cutoffAnchor?.createdAt,
    );
    if (!isSameConversationList(currentConvs, merged)) {
      const prevOldestCreatedAt = currentConvs[0]?.createdAt;
      const newPrependedCount = prevOldestCreatedAt
        ? sortedCutoffConversations.filter(item => item.createdAt < prevOldestCreatedAt).length
        : 0;

      if (newPrependedCount > 0) {
        setFirstItemIndex(index => index - newPrependedCount);
      }
      setConversationsState(merged);
    }
  }, [
    shouldUseCutoffQuery,
    cutoffConversations,
    cutoffConversationsDetails.type,
    isInitialLoadComplete,
  ]);

  const fetchOlderMessages = useCallback(
    (anchor = oldConversationsAnchor) => {
      if (!isInitialLoadComplete) return;
      zero
        .run(
          queries.channelConversationsPaginatedV3({
            channelId,
            isMember,
            start: anchor,
            direction: 'forward',
            limit: PAGE_SIZE,
          }),
          { type: 'complete' },
        )
        .then(older => {
          const currentConversations = conversationsRef.current;
          const newItems = older.filter(
            c => !currentConversations.some(v => v.conversationId === c.conversationId),
          );
          if (newItems.length === 0) {
            return;
          }
          const fetched = dedupeAndSort(older, currentConversations);
          const { merged, latestClear } = mergeWithLatest(
            fetched,
            latestConversationsListRef.current,
            true,
          );
          if (latestClear) {
            setLatestConversationsList([]);
            latestConversationsListRef.current = [];
            setNewConversationsAnchor(null);
          }
          if (merged[0]) {
            setOldestConversationsAnchor({ createdAt: merged[0].createdAt });
          }

          setFirstItemIndex(prev => prev - newItems.length);
          setConversationsState(merged);
        })
        .catch(err =>
          logger.error(LogEvent.FRONTEND_ERROR, {
            type: 'migrated_console_error',
            message: String('[V11] fetchOlderMessages error:'),
            error: err,
          }),
        );
    },
    [
      channelId,
      oldConversationsAnchor,
      latestConversationsList,
      isInitialLoadComplete,
      shouldUseCutoffQuery,
      zero,
    ],
  );

  const fetchNewerMessages = useCallback(
    (anchor = newConversationsAnchor) => {
      if (!anchor || isFetchingRef.current || !isInitialLoadComplete) return;
      isFetchingRef.current = true;
      zero
        .run(
          queries.channelConversationsPaginatedV3({
            channelId,
            isMember,
            start: anchor,
            direction: 'backward',
            limit: PAGE_SIZE,
          }),
          { type: 'complete' },
        )
        .then(newer => {
          const currentConversations = conversationsRef.current;
          const hasNewItems = newer.some(
            c => !currentConversations.some(v => v.conversationId === c.conversationId),
          );
          // No-op guard: if the fetched page contains nothing new and there is
          // no pending latest-list to merge, bail WITHOUT touching state.
          // Otherwise setConversationsState(merged) publishes a new array
          // reference for identical content, which re-triggers every effect
          // keyed on `conversations`/`combinedMessages` (notably the
          // linked-anchor effect below) and can spin into an infinite
          // fetch -> setState -> re-render -> fetch loop.
          if (!hasNewItems && latestConversationsListRef.current.length === 0) {
            isFetchingRef.current = false;
            return;
          }
          const fetched = dedupeAndSort(currentConversations, newer);
          const { merged, latestClear } = mergeWithLatest(
            fetched,
            latestConversationsListRef.current,
            true,
          );

          if (latestClear) {
            setLatestConversationsList([]);
            latestConversationsListRef.current = [];
            setNewConversationsAnchor(null);
          } else if (newer.length > 0) {
            setNewConversationsAnchor({ createdAt: newer[newer.length - 1]!.createdAt });
          }

          setConversationsState(merged);
          isFetchingRef.current = false;
        })
        .catch(err => {
          logger.error(LogEvent.FRONTEND_ERROR, {
            type: 'migrated_console_error',
            message: String('[V11] fetchNewerMessages error:'),
            error: err,
          });
          isFetchingRef.current = false;
        });
    },
    [
      channelId,
      newConversationsAnchor,
      latestConversationsList,
      isInitialLoadComplete,
      shouldUseCutoffQuery,
      zero,
    ],
  );

  useEffect(() => {
    if (!channelParticipation?.lastViewedAt || !isInitialLoadComplete) {
      setNewConversationBoundary(null);
      return;
    }
    const idx = computeNewConvIdx(combinedMessages, channelParticipation?.lastViewedAt, user?.id);
    setNewConversationBoundary(prev => {
      if (idx === -1) {
        return null;
      }
      const boundaryConvId = combinedMessages[idx]?.data.conversationId;
      if (prev?.seenConvId && prev.seenConvId === boundaryConvId) {
        return { index: idx, seenConvId: prev.seenConvId };
      }
      if (prev !== null && prev.index === idx) return prev;
      return { index: idx, seenConvId: null };
    });
  }, [combinedMessages, isInitialLoadComplete, channelParticipation?.lastViewedAt, user?.id]);

  useEffect(() => {
    if (!isInitialLoadComplete || combinedMessages.length === 0) return;
    // Already computed — don't recompute
    if (initialTopMostItemIndex !== null) return;

    let computed: VirtuosoIndex = { index: 'LAST', align: 'end' };

    if (linkedConversationId) {
      const idx = combinedMessages.findIndex(m => m.data.conversationId === linkedConversationId);
      if (idx !== -1) {
        const isLast = idx === combinedMessages.length - 1;
        computed = {
          index: isLast ? firstItemIndex + idx : idx,
          align: isLast ? 'end' : 'start',
        };
        const navigationKey = `${linkedConversationId}:${location.key}:${activityNavigationNonce}`;
        initialLinkedIdRef.current = navigationKey;
      }
    }

    if (computed.index === 'LAST' && !linkedConversationId) {
      const newConvIdx = computeNewConvIdx(
        combinedMessages,
        channelParticipation?.lastViewedAt,
        user?.id,
      );
      if (newConvIdx !== -1) {
        const isLast = newConvIdx === combinedMessages.length - 1;
        computed = {
          index: isLast ? firstItemIndex + newConvIdx : newConvIdx,
          align: isLast ? 'end' : 'center',
        };
      }
    }

    setInitialTopMostItemIndex(computed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInitialLoadComplete, combinedMessages]);

  useEffect(() => {
    if (!linkedItemCreatedAt || !linkedConversationId || !isInitialLoadComplete) return;
    const navigationKey = `${linkedConversationId}:${location.key}:${activityNavigationNonce}`;
    if (navigationKey === initialLinkedIdRef.current) return;

    const idx = combinedMessages.findIndex(
      item => item.data.conversationId === linkedConversationId,
    );
    if (idx !== -1) {
      const isLast = idx === combinedMessages.length - 1;
      const scrollIndex = isLast ? firstItemIndex + idx : idx;
      initialLinkedIdRef.current = navigationKey;
      // align to the actual rendered node after Virtuoso re-measures row heights.
      requestAnimationFrame(() => {
        hasSkippedInitialCutoffRangeRef.current = false;
        const scrollToLinkedConversation = (): void => {
          virtuosoRef.current?.scrollIntoView({
            index: scrollIndex,
            align: isLast ? 'end' : 'start',
            behavior: 'smooth',
          });
        };

        scrollToLinkedConversation();
        window.setTimeout(scrollToLinkedConversation, 80);
      });
    } else {
      if (linkedCutoffCreatedAt) {
        setCutoffAnchor(prev =>
          prev?.createdAt === linkedCutoffCreatedAt.createdAt ? prev : linkedCutoffCreatedAt,
        );
        return;
      }
      // Cap retries: if the linked conversation never shows up in the pages
      // fetched around its createdAt (deleted conversation, or one excluded
      // from the channel feed), stop re-fetching. Without this cap, every
      // fetch that touches `conversations` re-runs this effect (it depends on
      // combinedMessages) with idx still -1, producing a non-converging
      // fetch loop that pegs CPU and grows memory until force-quit.
      if (linkedAnchorFetchAttemptsRef.current.key !== navigationKey) {
        linkedAnchorFetchAttemptsRef.current = { key: navigationKey, count: 0 };
      }
      if (linkedAnchorFetchAttemptsRef.current.count >= MAX_LINKED_ANCHOR_FETCH_ATTEMPTS) {
        return;
      }
      linkedAnchorFetchAttemptsRef.current.count += 1;
      setOldestConversationsAnchor(linkedItemCreatedAt);
      setNewConversationsAnchor(linkedItemCreatedAt);
      fetchNewerMessages(linkedItemCreatedAt);
      fetchOlderMessages(linkedItemCreatedAt);
    }
  }, [linkedConversationId, activityNavigationNonce, isInitialLoadComplete, combinedMessages]);

  useEffect(() => {
    if (!isInitialLoadComplete) return;
    const lastConversation = conversations[conversations.length - 1];
    if (!lastConversation) return;

    if (lastAutoScrollKeyRef.current === undefined) {
      lastAutoScrollKeyRef.current = lastConversationAutoScrollKey;
      return;
    }

    if (lastConversationAutoScrollKey === lastAutoScrollKeyRef.current) return;
    lastAutoScrollKeyRef.current = lastConversationAutoScrollKey;

    if (isNearBottomRef.current && latestConversationsListRef.current.length === 0) {
      window.setTimeout(() => {
        virtuosoRef.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' });
      }, 80);
    }
  }, [channelId, conversations, isInitialLoadComplete, lastConversationAutoScrollKey, user?.id]);

  useEffect(() => {
    if (shouldUseCutoffQuery) return;

    if (updatedConversationsDetails.type === 'complete' && isInitialLoadComplete) {
      const itemsToDelete: Conversation[] = [];
      let fromMessage = updatedConversations[0];
      let tillMessage = updatedConversations[updatedConversations.length - 1];
      if (fromMessage && tillMessage) {
        const tempMessage = { ...fromMessage };
        fromMessage = fromMessage.createdAt < tillMessage.createdAt ? fromMessage : tillMessage;
        tillMessage = tillMessage.createdAt > tempMessage.createdAt ? tillMessage : tempMessage;
        let flag = 0;
        for (const conv of conversations) {
          if (flag === 0 && conv.createdAt >= fromMessage.createdAt) {
            flag = 1;
          }
          if (
            flag === 1 &&
            updatedConversations.find(v => v.conversationId === conv.conversationId) === undefined
          ) {
            itemsToDelete.push(conv);
          }
          if (conv.createdAt > (inViewAnchor?.createdAt ?? tillMessage.createdAt)) {
            flag = 0;
          }
        }
      } else {
        if (updatedConversations.length === 0) {
          itemsToDelete.push(...conversations);
        }
      }
      const anchorConversation =
        inViewAnchor?.conversationId &&
        updatedConversations.find(v => v.conversationId === inViewAnchor.conversationId);
      if (inViewAnchor?.conversationId && !anchorConversation) {
        itemsToDelete.push(
          conversations.find(v => v.conversationId === inViewAnchor.conversationId)!,
        );
      }
      const updated = conversations
        .filter(conv => !itemsToDelete.some(v => v.conversationId === conv.conversationId))
        .map(conv => {
          const item = updatedConversations.find(v => v.conversationId === conv.conversationId);
          if (item) return item;
          return conv;
        });
      setConversationsState(updated);
    }
  }, [channelId, updatedConversations, isInitialLoadComplete, shouldUseCutoffQuery]);

  useEffect(() => {
    if (latestConversationsDetails.type !== 'complete') return;
    if (latestConversations.length === 0) {
      // All conversations were deleted (e.g. deleting the only message in a DM).
      if (isInitialLoadComplete) {
        setConversations(prev => (prev.length > 0 ? [] : prev));
      }
      return;
    }
    const sortedLatest = [...latestConversations].sort((a, b) => a.createdAt - b.createdAt);
    const currentConversations = conversationsRef.current;
    const { merged, latestClear } = mergeWithLatest(
      currentConversations,
      sortedLatest,
      isInitialLoadComplete,
    );

    if (latestClear) {
      setConversationsState(merged);
      setLatestConversationsList([]);
      latestConversationsListRef.current = [];
      setNewConversationsAnchor(null);
    } else {
      setLatestConversationsList(sortedLatest);
      latestConversationsListRef.current = sortedLatest;
    }
  }, [channelId, latestConversations, latestConversationsDetails.type, isInitialLoadComplete]);

  // Save virtuoso state on unmount
  useEffect(() => {
    if (!channelId) return;

    return () => {
      // Mark as viewed
      if (skipMarkAsReadRef?.current || activitySkipMarkAsReadChannelRef.current) {
        skipMarkAsReadRef.current = false;
        activitySkipMarkAsReadChannelRef.current = false;
        return;
      }

      const draft = getDraft(channelId, null);

      const payload = {
        channelId,
        timestamp: Date.now(),
        draftMessageId: uuidv4(),
        draftMessage: draft || '',
      };

      void zero.mutate(mutators.channel.markChannelAsViewed(payload));
    };
  }, [channelId]);

  useEffect(() => {
    if (!channelId) return;

    const flushToCache = (): void => {
      const latest = conversationsRef.current;
      if (latest === hydratedFromCacheRef.current || latest.length === 0) return;
      hydratedFromCacheRef.current = latest;
      queryCacheActor.send({
        type: 'SET_CONVERSATIONS',
        channelId,
        conversations: latest,
      });
    };

    const handlePageHide = (): void => {
      flushToCache();
      flushQueryCachePersistence();
    };

    // Tab switch / app background / OS killing a background tab all pass
    // through `hidden` first — flushing here bounds data loss for the cases
    // where pagehide never fires (crash, force-kill). Deduped via
    // hydratedFromCacheRef, so repeated hides with no new data are no-ops.
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') handlePageHide();
    };

    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      flushToCache();
    };
  }, [channelId]);

  // When a thread is opened (conversationId appears in URL), scroll the parent message into view
  // after the panel resize settles, so it doesn't jump out of the user's viewport.
  const { conversationId: activeThreadConversationId } = useParams<{ conversationId?: string }>();
  const prevActiveThreadRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    // Only act when a thread is newly opened (not on close or same thread)
    if (
      !activeThreadConversationId ||
      activeThreadConversationId === prevActiveThreadRef.current ||
      !isInitialLoadComplete
    ) {
      prevActiveThreadRef.current = activeThreadConversationId;
      return;
    }
    prevActiveThreadRef.current = activeThreadConversationId;

    const idx = combinedMessages.findIndex(
      item => item.data.conversationId === activeThreadConversationId,
    );
    if (idx === -1) return;

    // Use a delay to let the PanelGroup resize animation settle before scrolling
    const timer = setTimeout(() => {
      virtuosoRef.current?.scrollIntoView({
        index: idx === combinedMessages.length - 1 ? firstItemIndex + idx : idx,
        align: 'start',
        behavior: 'auto',
      });
    }, 100);

    return () => clearTimeout(timer);
  }, [activeThreadConversationId, combinedMessages, firstItemIndex, isInitialLoadComplete]);

  const handleOpenThread = useCallback(
    (conversationId: string, e?: React.MouseEvent): void => {
      const conversation = conversations.find(c => c.conversationId === conversationId);

      const conversationMetadata = conversation?.metadata as { ticketId?: string } | null;
      const initMsg = conversation ? getInitialMessageFromConversation(conversation) : null;
      const messageMetadata = initMsg?.metadata as {
        ticketId?: string;
      } | null;
      const ticketId = conversationMetadata?.ticketId || messageMetadata?.ticketId;

      if (ticketId) {
        standaloneNavigate(
          navigate,
          `${baseRoute}/${channelId}/${conversationId}/${ticketId}?selectedTab=thread`,
          { event: e },
        );
      } else {
        standaloneNavigate(navigate, `${baseRoute}/${channelId}/${conversationId}`, { event: e });
      }
    },
    [channelId, conversations, navigate],
  );

  const isEventFromChannelInput = useCallback(
    (event: KeyboardEvent): boolean => isEventFromEmptyInput(event, channelId),
    [channelId],
  );

  const handleEditLastMessage = useCallback(() => {
    const result = findLastEditableMessage(conversations, user?.id, conv =>
      getInitialMessageFromConversation(conv),
    );
    if (!result) return;

    const { item: conversation, index } = result;
    const message = getInitialMessageFromConversation(conversation);
    if (!message) return;

    const scrollToConversation = (): void => {
      if (!virtuosoRef.current) return;
      const targetIndex = firstItemIndex + index;
      virtuosoRef.current.scrollToIndex({
        index: targetIndex,
        align: 'center',
        behavior: 'auto',
      });
    };

    if (isEditingMessage(message.messageId)) {
      scrollToConversation();
      return;
    }

    requestEdit(message.messageId, scrollToConversation);
  }, [conversations, user?.id, firstItemIndex, isEditingMessage, requestEdit]);

  useShortcutById('composer.editLastMessage', handleEditLastMessage, {
    enabled: conversations.length > 0,
    when: isEventFromChannelInput,
  });

  // Track scroll position and load older/newer conversations
  const handleRangeChanged = useCallback(
    (range: { startIndex: number; endIndex: number }) => {
      if (combinedMessages.length === 0) return;

      initialPositionSetRef.current = true;
      const lastIndex = combinedMessages.length - 1 + firstItemIndex;
      isNearBottomRef.current = range.endIndex >= lastIndex - 5;
      rangeRef.current = range;

      // Track whether the first item has scrolled above the visible viewport
      setIsFirstItemScrolledOff(range.startIndex > firstItemIndex);

      if (isNearBottomRef.current) fetchNewerMessages();

      if (latestConversationsListRef.current.length === 0 && !isNearBottomRef.current)
        setShowScrollButton(true);
      else setShowScrollButton(false);

      setNewConversationBoundary(prev => {
        if (!prev || prev.seenConvId !== null) return prev; // already seen or no boundary
        const boundaryVirtualIdx = firstItemIndex + prev.index;
        const boundaryConvId = combinedMessages[prev.index]?.data.conversationId;
        // Mark as seen if boundary is at or above the viewport's bottom edge
        if (boundaryConvId && boundaryVirtualIdx <= range.endIndex) {
          return { index: prev.index, seenConvId: boundaryConvId };
        }
        return prev;
      });

      // Debounce: update inViewAnchor only after scroll stops for 1000ms
      if (scrollStopTimerRef.current !== undefined) {
        clearTimeout(scrollStopTimerRef.current);
      }
      scrollStopTimerRef.current = setTimeout(() => {
        scrollStopTimerRef.current = undefined;
        if (shouldUseCutoffQuery) {
          if (!hasSkippedInitialCutoffRangeRef.current) {
            hasSkippedInitialCutoffRangeRef.current = true;
            return;
          }

          const index = range.startIndex - firstItemIndex;
          const itemIndex = Math.min(conversations.length - 1, Math.max(0, index));
          const item = conversations[itemIndex];
          if (item) {
            setCutoffAnchor(prev =>
              prev?.createdAt === item.createdAt ? prev : { createdAt: item.createdAt },
            );
          }
          return;
        }

        const index = range.endIndex - firstItemIndex;
        const itemIndex = Math.min(conversations.length - 1, index);
        const item = conversations[itemIndex];
        if (item) {
          const anchorArrayIdx = inViewAnchor
            ? conversations.findIndex(c => c.conversationId === inViewAnchor.conversationId)
            : -1;
          const anchorVirtualIdx = anchorArrayIdx !== -1 ? firstItemIndex + anchorArrayIdx : -1;
          if (
            inViewAnchor === null ||
            anchorVirtualIdx === -1 ||
            Math.abs(range.endIndex - anchorVirtualIdx) >= 20
          ) {
            setInViewAnchor({
              conversationId: item.conversationId,
              createdAt: item.createdAt,
              direction: 'forward',
            });
          }
        }
      }, 1000);
    },
    [
      combinedMessages,
      combinedMessages.length,
      firstItemIndex,
      fetchNewerMessages,
      conversations,
      shouldUseCutoffQuery,
      inViewAnchor,
    ],
  );

  const handleLatestMessagesScroll = useCallback(() => {
    const latestConversation = latestConversationsList[latestConversationsList.length - 1];
    const oldLatestConversation = latestConversationsList[0];
    if (latestConversation && oldLatestConversation) {
      setConversationsState(latestConversationsList);
      setOldestConversationsAnchor(oldLatestConversation);
      setNewConversationsAnchor(null);
      setLatestConversationsList([]);
      latestConversationsListRef.current = [];
      if (virtuosoRef.current) {
        virtuosoRef.current.scrollToIndex({
          index: 'LAST',
          align: 'end',
          behavior: 'auto',
        });
      }
    }
  }, [latestConversationsList]);

  const handleNewMessagesScroll = useCallback(() => {
    if (!newConversationBoundary) return;
    const idx = newConversationBoundary.index;
    const isLast = idx === combinedMessages.length - 1;
    virtuosoRef.current?.scrollIntoView({
      index: isLast ? firstItemIndex + idx : idx,
      align: isLast ? 'end' : 'center',
      behavior: 'auto',
    });
  }, [newConversationBoundary, combinedMessages.length, firstItemIndex]);

  // Setup IntersectionObserver to track item positions for sticky date
  useEffect(() => {
    dateObserverRef.current = new IntersectionObserver(
      entries => {
        // Update visible items map
        entries.forEach(entry => {
          const timestampStr = entry.target.getAttribute('data-item-timestamp');
          const conversationId = entry.target.getAttribute('data-conversation-id');
          if (timestampStr && conversationId) {
            if (entry.isIntersecting) {
              visibleDatesRef.current.set(entry.target, {
                timestamp: Number(timestampStr),
                conversationId,
                rect: entry.boundingClientRect,
              });
            } else {
              visibleDatesRef.current.delete(entry.target);
            }
          }
        });

        // Sort by timestamp (ascending = oldest first)
        const sorted = Array.from(visibleDatesRef.current.entries()).sort(
          (a, b) => a[1].timestamp - b[1].timestamp,
        );

        if (sorted.length === 0) return;

        // The oldest visible item's date becomes the sticky date
        const oldestItem = sorted[0];
        if (oldestItem?.[1]) {
          const newStickyDate = formatDatePill(oldestItem[1].timestamp);
          setStickyDate(newStickyDate);
        }

        // Track topmost visible conversation for browser panel scroll restore.
        // Use the item with the smallest non-negative rect.top (closest to top of viewport).
        const topmostItem = Array.from(visibleDatesRef.current.values())
          .filter(d => d.rect.top >= 0)
          .sort((a, b) => a.rect.top - b.rect.top)[0];
        if (topmostItem) {
          topVisibleConvIdRef.current = topmostItem.conversationId;
        }
      },
      { threshold: 0, rootMargin: '0px' },
    );

    return () => {
      dateObserverRef.current?.disconnect();
      dateObserverRef.current = null;
      visibleDatesRef.current.clear();
    };
  }, []);

  // Observe row; cleanup (React 19) unobserves + drops it from visibleDatesRef.
  // Without this, recycled-while-intersecting rows leak on every switch.
  const itemRef = useCallback((el: HTMLDivElement | null) => {
    if (!el || !dateObserverRef.current) return;
    dateObserverRef.current.observe(el);
    return () => {
      dateObserverRef.current?.unobserve(el);
      visibleDatesRef.current.delete(el);
    };
  }, []);

  const scrollToBottom = useCallback(() => {
    if (latestConversationsListRef.current.length > 0) {
      handleLatestMessagesScroll();
      return;
    }
    if (virtuosoRef.current) {
      virtuosoRef.current.scrollToIndex({
        index: 'LAST',
        align: 'end',
        behavior: 'auto',
      });
      setShowScrollButton(false);
    }
  }, [handleLatestMessagesScroll]);

  if (conversations.length === 0 && isInitialLoadComplete)
    return (
      <div className='text-center text-muted-foreground flex-1 flex items-center justify-center'>
        <p className='text-muted-foreground'>No conversations in this channel yet</p>
      </div>
    );

  if (!initialTopMostItemIndex)
    return (
      <div
        className='absolute inset-0 flex items-center justify-center bg-background z-50'
        data-testid='chat-list-loading'
      >
        <LoadingAnimation
          message='Loading conversations...'
          source='ChatListV11: getChannelConversations'
          url={location.pathname}
        />
      </div>
    );

  return (
    <div
      ref={hoverToolbarContainerRef}
      data-component='ChatListV11'
      data-testid='chat-message-list'
      className='flex-1 relative no-scrollbar min-h-0'
    >
      {/* Sticky date pill overlay — only shown when the first message has scrolled off-screen */}
      {stickyDate && isFirstItemScrolledOff && (
        <div className='absolute top-0 left-0 right-0 z-10 pointer-events-none'>
          <div className='relative flex justify-center py-2'>
            <DatePill dateText={stickyDate} />
          </div>
        </div>
      )}

      <Virtuoso
        ref={virtuosoRef}
        rangeChanged={handleRangeChanged}
        atBottomStateChange={atBottom => {
          isAtBottomRef.current = atBottom;
        }}
        increaseViewportBy={1000}
        firstItemIndex={firstItemIndex}
        heightEstimates={itemHeights}
        followOutput={false}
        alignToBottom={true}
        atTopThreshold={400}
        atTopStateChange={atTop => {
          if (atTop && isInitialLoadComplete && initialPositionSetRef.current) {
            fetchOlderMessages();
          }
        }}
        initialTopMostItemIndex={initialTopMostItemIndex}
        data={combinedMessages}
        minOverscanItemCount={20}
        computeItemKey={(_, item) => item.data.conversationId}
        itemContent={itemIndex => {
          // Convert virtual index to array index
          const arrayIndex = itemIndex - firstItemIndex;
          const item = combinedMessages[arrayIndex];

          if (!item) return null;

          const prevItem = arrayIndex > 0 ? combinedMessages[arrayIndex - 1] : null;
          const dateText = formatDatePill(item.createdAt);
          const showDatePill =
            !prevItem || item.createdAt.toDateString() !== prevItem.createdAt.toDateString();
          const shouldHideInlineDatePill =
            showDatePill && dateText === stickyDate && isFirstItemScrolledOff && arrayIndex > 0;

          const isNewMessageBoundary =
            newConversationBoundary !== null && arrayIndex === newConversationBoundary.index;

          return (
            <div
              data-item-timestamp={item.createdAt.getTime()}
              data-conversation-id={item.data.conversationId}
              ref={itemRef}
            >
              {showDatePill && (
                <div
                  className={shouldHideInlineDatePill ? 'invisible' : 'block'}
                  aria-hidden={shouldHideInlineDatePill}
                >
                  <DatePill dateText={dateText} />
                </div>
              )}
              {isNewMessageBoundary && (
                <div className='relative py-3'>
                  <div className='absolute left-0 right-0 top-1/2 h-px bg-destructive z-0'></div>
                  <div className='relative z-5 flex items-center justify-center'>
                    <span className='text-xs text-destructive bg-background px-2 font-medium'>
                      New Messages
                    </span>
                  </div>
                </div>
              )}
              <ChatListItem
                item={item}
                index={arrayIndex}
                chatListItems={combinedMessages}
                channelId={channelId}
                projectId={projectId}
                channelScopeType={channelScopeType}
                handleOpenThread={handleOpenThread}
                {...(linkedConversationId && { linkedConversationId })}
              />
            </div>
          );
        }}
        style={{ height: '100%', zIndex: 0 }}
      />

      {/* ONE shared hover-actions toolbar for the entire list. Driven by a
          delegated pointerover listener — hovering rows causes zero bubble
          re-renders (see hoveredMessageRef / messageHoverActionsRegistry). */}
      <MessageHoverToolbar containerRef={hoverToolbarContainerRef} />

      {/* New messages pill — hides once boundary enters viewport, stays hidden until new boundary */}
      {newConversationBoundary !== null && newConversationBoundary.seenConvId === null && (
        <button
          data-track-category='CHAT_LIST'
          data-track-name='CLICK_NEW_MESSAGES_PILL'
          onClick={handleNewMessagesScroll}
          className='cursor-pointer absolute top-6 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-2 py-2 rounded-full flex items-center gap-1 shadow-lg z-50'
        >
          <ArrowDown className='w-3 h-3' />
          <span className='text-xs font-medium'>
            {`New messages (${combinedMessages.length - newConversationBoundary.index})`}
          </span>
        </button>
      )}

      {/* Latest messages floating pill */}
      {latestConversationsList.length > 0 && (
        <button
          data-track-category='CHAT_LIST'
          data-track-name='CLICK_LATEST_MESSAGES_PILL'
          onClick={() => handleLatestMessagesScroll()}
          className='cursor-pointer absolute bottom-6 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-2 py-2 rounded-full flex items-center gap-1 shadow-lg z-50'
        >
          <ArrowDown className='w-3 h-3' />
          <span className='text-xs font-medium'>Latest messages</span>
        </button>
      )}

      {/* Scroll to bottom button */}
      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className='absolute bottom-6 right-6 bg-background border border-border rounded-full p-3 shadow-lg hover:shadow-xl transition-all duration-200 hover:bg-accent z-50'
          aria-label='Scroll to bottom'
          data-track-category='CHAT_LIST'
          data-track-name='SCROLL_TO_BOTTOM'
        >
          <ArrowDown className='w-5 h-5 text-foreground' />
        </button>
      )}
    </div>
  );
};

const ChatListV3WithEditSurface: React.FC<ChatListProps> = props => (
  <EditSurfaceScope>
    <ChatListV3 {...props} />
  </EditSurfaceScope>
);

export default withProfiler(ChatListV3WithEditSurface, 'ChatListV3');
