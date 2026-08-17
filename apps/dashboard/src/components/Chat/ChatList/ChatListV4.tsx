import { ChannelScopeType, MessageType } from '@xyne/shared';
import { Conversation } from '../../../machines/stateMachine';
import { activitySkipMarkAsReadChannelRef } from '../../Activity/activitySkipMarkAsRead';
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  startTransition,
  useState,
} from 'react';
import { useChannelParticipation, useVisibleChannel } from '../../../hooks/useChannels';
import { useZero } from '../../../hooks/useZero';
import { queries } from '../../../zero/queries';
import { useQuery } from '../../../hooks/useQuery';
import { ChatListItem } from '../ChatListItem/ChatListItem';
import { DatePill } from '../DatePill';
import { useVirtualizer } from '@tanstack/react-virtual';
import { findLastEditableMessage, isEventFromEmptyInput } from '../../../utils/chatUtils';
import { useShortcutById } from '../../../shortcuts';
import { useAuth } from '../../../hooks/useAuth';
import { useEditContext } from '../../../providers/EditProvider';
import { useCombinedMesseges } from './ChatListV2.utils';
import { usePlatform } from '../../../hooks/usePlatform';
import { formatDatePill } from '../../../utils/dateUtils';
import { startOfDay } from 'date-fns';
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
import { withProfiler } from '../../../utils/withProfiler';
import { getInitialMessageFromConversation } from '../../../utils/conversationMessageHelpers';
import { usePendingForChannel, buildPendingChannelConversation } from '@xyne/shared/messages';
import { MessageHoverToolbar } from '../HoverActionsToolbar/MessageHoverToolbar';

export type ChatListProps = {
  channelId: string;
  projectId?: string | undefined;
  cachedConversations: Conversation[];
  linkedItemCreatedAt?: Anchor;
  linkedCutoffCreatedAt?: Anchor;
  linkedConversationId?: string | null;
  // True only for a date jump: a bare `#createdAt=<epoch>` hash with no linked
  // conversation. Distinguishes a user picking a date from the OTHER carriers of
  // linkedItemCreatedAt (Unreads-inbox `lastViewedAt` override, search anchors),
  // which must keep their original cutoff-windowing and landing behavior.
  isDateJump?: boolean;
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

// Monotonic per-jump nonce. Re-picking the SAME date navigates to the same
// `#createdAt=X` hash, which alone is not a new location — so the remount key
// wouldn't change and the list wouldn't re-land. Carrying this nonce in router
// state makes every jump a distinct location (new key), so the remount fires
// even for a repeat pick. Module-level so it survives the remount between two
// consecutive jumps (a per-mount counter would reset to the same value and
// collide; Date.now() can collide on a sub-millisecond double-click).
let jumpNavigationSeq = 0;

function dedupeAndSort(a: Conversation[], b: Conversation[]): Conversation[] {
  const map = new Map<string, Conversation>();
  for (const c of a) map.set(c.conversationId, c);
  for (const c of b) map.set(c.conversationId, c);
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
    const overlapId = sorted[overlapIndex]!.conversationId;
    const fetchedOverlapIndex = sortedFetched.findIndex(f => f.conversationId === overlapId);
    const isFetchedNewer = fetchedOverlapIndex === 0;

    if (isFetchedNewer) {
      const trimmed = sorted.slice(0, overlapIndex);
      return dedupeAndSort(trimmed, sortedFetched);
    }
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
const VISIBLE_CONVERSATION_EPSILON_PX = 1;

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
const ChatListV4: React.FC<ChatListProps> = ({
  channelId,
  projectId,
  cachedConversations,
  linkedItemCreatedAt,
  linkedCutoffCreatedAt,
  linkedConversationId,
  isDateJump = false,
  channelScopeType,
  skipMarkAsReadRef,
}) => {
  // Save scroll position when unmounting due to /browser fullscreen navigation.
  useEffect(() => {
    return () => {
      const pathname = window.location.pathname;
      const convId = topVisibleConvIdRef.current;
      if (pathname.endsWith('/browser') && !virtualizer.isAtEnd() && convId !== undefined) {
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
  const { editingMessageId, requestEdit } = useEditContext();
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
  const oldConversationsAnchorRef = useRef<Anchor>(
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
  const [stickyDate, setStickyDate] = useState<string | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isFirstItemScrolledOff, setIsFirstItemScrolledOff] = useState(false);

  const scrollStopTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  type NewConversationBoundary = { index: number; seenConvId: string | null };
  const [newConversationBoundary, setNewConversationBoundary] =
    useState<NewConversationBoundary | null>(null);

  const lifecycleRef = useRef<{
    hasSkippedInitialCutoffRange: boolean;
    initialPositionSet: boolean;
    initialLoadComplete: boolean;
    didInitialScrollAlign: 'none' | 'end' | 'center' | 'start';
    // True once the single deferred scroll correction (bottom → unread
    // boundary / deep link) has run. Prevents prepends from re-triggering it.
    didDeferredScrollCorrection: boolean;
  }>({
    hasSkippedInitialCutoffRange: false,
    initialPositionSet: false,
    initialLoadComplete: false,
    didInitialScrollAlign: 'none',
    didDeferredScrollCorrection: false,
  });
  const initialLinkedIdRef = useRef<string | null>(null);
  const lastAutoScrollKeyRef = useRef<string | undefined>(undefined);
  // True for a short settle window right after a date-jump 'start' landing.
  // While set, size changes of rows ABOVE the viewport top are compensated so the
  // landed target stays flush at the top as rows measure — otherwise it drifts
  // down, a sliver of the previous day shows, and the sticky pill reads that
  // previous day. Position-based (see shouldAdjustScrollPositionOnItemSizeChange).
  const jumpSettlingRef = useRef(false);
  const jumpSettleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The float date pill normally shows the date of the OLDEST visible message.
  // Right after a date jump the landing can leave a sliver of the previous day at
  // the top, so that computation reads the previous day. Since we KNOW the picked
  // day, force the float to it on landing and hold it until the user actually
  // scrolls (the IntersectionObserver honours this and skips its own write). This
  // guarantees the float matches the day jumped to regardless of scroll precision.
  const jumpForcedStickyRef = useRef<string | null>(null);

  // ── Scroll container ──────────────────────────────────────────────────────────
  const parentRef = useRef<HTMLDivElement>(null);
  const dateObserverRef = useRef<IntersectionObserver | null>(null);
  const visibleDatesRef = useRef<
    Map<Element, { timestamp: number; conversationId: string; rect: DOMRect }>
  >(new Map());
  const topVisibleConvIdRef = useRef<string | undefined>(undefined);
  const { isMobile } = usePlatform();

  // Merge durable pending sends (queued while offline, awaiting server
  // confirmation, or failed) into the render list. Any conversation whose
  // initial message is still pending is dropped first so Zero's optimistic row
  // and the pending row never collide on the same key; the pending rows carry
  // the newest timestamps, so appending sorts them to the tail.
  const pendingForChannel = usePendingForChannel(channelId);
  const conversationsWithPending = useMemo(() => {
    if (pendingForChannel.length === 0) return conversations;
    const pendingIds = new Set(pendingForChannel.map(p => p.messageId));
    const base = conversations.filter(
      c => !c.initialMessageId || !pendingIds.has(c.initialMessageId),
    );
    const pendingRows = pendingForChannel.map(
      p => buildPendingChannelConversation(p) as unknown as Conversation,
    );
    return [...base, ...pendingRows];
  }, [conversations, pendingForChannel]);

  const { combinedMessages, itemHeights } = useCombinedMesseges(
    conversationsWithPending,
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
  const isFetchingOlderRef = useRef(false);
  // Set true when Zero returns older.length=0 (no items exist before the anchor).
  // Prevents infinite fetch loops after reaching the true start of the channel.
  const hasReachedChannelStartRef = useRef(false);
  // Container for the shared hover toolbar overlay (Slack pattern): one
  // toolbar for the whole list, positioned over the hovered row.
  const hoverToolbarContainerRef = useRef<HTMLDivElement>(null);
  // A date jump must window around the picked day, so it takes the anchor-based
  // normal path — not the unread-cutoff path, which would window around the seen
  // cutoff instead. Keyed off isDateJump, NOT linkedItemCreatedAt: the latter is
  // also set by the Unreads inbox / search, which must keep the cutoff path.
  const shouldUseCutoffQuery =
    channelParticipation?.conversationSeenCutoffAt !== null &&
    isMember &&
    !linkedConversationId &&
    !isDateJump;

  // ── TanStack Virtualizer ──────────────────────────────────────────────────────
  // anchorTo: 'end' replaces Virtuoso's firstItemIndex trick and alignToBottom.
  // Prepends are scroll-stable natively as long as getItemKey returns stable conversationIds.
  const virtualizer = useVirtualizer({
    count: combinedMessages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: useCallback((i: number) => itemHeights[i] ?? 60, [itemHeights]),
    getItemKey: useCallback(
      (i: number) => combinedMessages[i]?.data.conversationId ?? i,
      [combinedMessages],
    ),
    overscan: 8,
    // Reserve space below the last item for the typing/agent activity bar that
    // overlays the bottom of the list (h-5 chip above the input, translated up).
    // paddingEnd is baked into getTotalSize(), so scrollToEnd()/isAtEnd() and the
    // anchorTo:'end' prepend adjustment all account for it — no per-frame cost,
    // it's a constant added to the sized container.
    paddingEnd: 28,
    anchorTo: 'end',
    followOnAppend: 'auto',
    scrollEndThreshold: 80,
    // directDomUpdates: positions are written directly to DOM nodes via TanStack,
    // bypassing React entirely. React only re-renders when the visible index range
    // changes (not on every scroll pixel or measurement).
    directDomUpdates: true,
    // React 19 changed flushSync semantics. The default true causes extra
    // synchronous layout/paint cycles during scroll events, producing jitter.
    useFlushSync: false,
  });

  // During initial load: auto-correct scroll position as items measure so the
  // viewport stays anchored (prevents flicker from estimate→measure drift).
  // After initial load: adjust when scrolling up, or when idle at bottom AND
  // the changed item is among the last few (prevents drift from async loads).
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => {
    if (!lifecycleRef.current.initialPositionSet) return false;
    // Date-jump settle window: keep the top-aligned target pinned by compensating
    // ONLY for rows that start above the current viewport top. Compensating for
    // rows below would shove the target around — so this is deliberately not a
    // blanket `return true`. Index-free, so it survives pagination/list changes.
    if (jumpSettlingRef.current) {
      const offset = instance.scrollOffset ?? 0;
      return item.start < offset;
    }
    if (!lifecycleRef.current.initialLoadComplete) {
      // Only keep the viewport pinned while we intentionally anchored to bottom.
      // This prevents "almost at bottom" drift on initial load as tall rows measure.
      return lifecycleRef.current.didInitialScrollAlign === 'end';
    }
    const isNearBottom = virtualizer.isAtEnd(80);
    const isLastFewItems = item.index >= instance.options.count - 5;
    return (isNearBottom && isLastFewItems) || virtualizer.scrollDirection === 'backward';
  };

  const virtualItems = virtualizer.getVirtualItems();
  const isConversationFullyVisible = useCallback(
    (conversationId: string, index: number): boolean => {
      if (!virtualizer.getVirtualItems().some(item => item.index === index)) return false;

      const scrollElement = parentRef.current;
      if (!scrollElement) return false;

      const conversationElement = document.getElementById(`conv-${conversationId}`);
      if (!conversationElement || !scrollElement.contains(conversationElement)) return false;

      const scrollRect = scrollElement.getBoundingClientRect();
      const conversationRect = conversationElement.getBoundingClientRect();

      return (
        conversationRect.top >= scrollRect.top - VISIBLE_CONVERSATION_EPSILON_PX &&
        conversationRect.bottom <= scrollRect.bottom + VISIBLE_CONVERSATION_EPSILON_PX
      );
    },
    [virtualizer],
  );

  // Clear the date-jump settle timer on unmount so it can't fire against a
  // torn-down instance (jumps remount the list, so this runs on every jump).
  useEffect(() => {
    return () => {
      if (jumpSettleTimerRef.current) clearTimeout(jumpSettleTimerRef.current);
    };
  }, []);

  // ── Queries ───────────────────────────────────────────────────────────────────
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

  const activityCutoffCreatedAt = linkedCutoffCreatedAt?.createdAt ?? null;
  const channelSeenCutoffCreatedAt = !linkedConversationId
    ? (channelParticipation?.conversationSeenCutoffAt ?? null)
    : null;
  const initialCutoffCreatedAt = activityCutoffCreatedAt ?? channelSeenCutoffCreatedAt;
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

  // Oldest conversation in the channel → the floor for the jump-to-date picker
  // (earlier days can't be selected). direction:'backward' + start:null returns
  // ascending order, so the first row is the channel's very first message.
  const [oldestConversation] = useQuery(
    queries.channelConversationsPaginatedV3({
      channelId,
      isMember,
      start: null,
      direction: 'backward',
      limit: 1,
    }),
  );
  const firstMessageDate =
    oldestConversation.length > 0
      ? startOfDay(new Date(oldestConversation[0]!.createdAt))
      : undefined;

  // ── Jump to date ──────────────────────────────────────────────────────────────
  // A jump is just "re-open the channel at the picked day". We push the target as
  // a bare `#createdAt=<epoch>` hash and let ConversationPanelV2 remount the list
  // (its key keys on this hash). The fresh mount then windows around the target
  // and lands on it before the first paint — the same flicker-free path a deep
  // link uses. No in-place window swap, no settling timer.
  //
  // The remount unmounts this instance, which would otherwise fire the
  // mark-as-read-on-unmount effect (marking the channel read at Date.now()). A
  // date jump is in-channel navigation, not leaving the channel, so it must not
  // touch read state — suppress that one unmount via the shared skip ref (the
  // handler resets it, so the eventual real leave still marks read).
  const handleJumpToDate = useCallback(
    (target: Date) => {
      const targetTs = startOfDay(target).getTime();
      if (skipMarkAsReadRef) skipMarkAsReadRef.current = true;
      // jumpNonce makes a repeat pick of the same date a distinct location so the
      // remount still fires (see jumpNavigationSeq).
      void navigate(
        { hash: `createdAt=${targetTs}` },
        { state: { jumpNonce: ++jumpNavigationSeq } },
      );
    },
    [navigate, skipMarkAsReadRef],
  );

  // ── Initial load (normal path) ────────────────────────────────────────────────
  useEffect(() => {
    if (shouldUseCutoffQuery) {
      return;
    }

    Promise.all([
      zero.run(
        queries.channelConversationsPaginatedV3({
          channelId,
          isMember,
          start: oldConversationsAnchorRef.current,
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
        const { merged, latestClear } = mergeWithLatest(
          mergedWithCached,
          latestConversationsListRef.current,
          true,
        );

        if (merged[0]) {
          oldConversationsAnchorRef.current = { createdAt: merged[0].createdAt };
        }

        if (latestClear) {
          setLatestConversationsList([]);
          latestConversationsListRef.current = [];
          setNewConversationsAnchor(null);
        } else if (merged.length > 0) {
          setNewConversationsAnchor({ createdAt: merged[merged.length - 1]!.createdAt });
        }

        // No firstItemIndex — anchorTo: 'end' handles prepend scroll stability natively.
        setConversationsState(merged);
        setIsInitialLoadComplete(true);
        lifecycleRef.current.initialLoadComplete = true;
      })
      .catch(() => {});
  }, []);

  // ── Initial load (cutoff path) ────────────────────────────────────────────────
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
    const { merged, latestClear } = mergeWithLatest(
      sortedCutoffConversations,
      latestConversationsListRef.current,
      true,
    );

    if (merged[0]) {
      oldConversationsAnchorRef.current = { createdAt: merged[0].createdAt };
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
    lifecycleRef.current.initialLoadComplete = true;
  }, [
    shouldUseCutoffQuery,
    cutoffConversations,
    cutoffConversationsDetails.type,
    isInitialLoadComplete,
  ]);

  // ── Subsequent cutoff window reconciliation ───────────────────────────────────
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

    setConversationsState(prev => {
      const merged = reconcileConversationWindow(
        prev,
        sortedCutoffConversations,
        cutoffAnchor?.createdAt,
      );
      if (isSameConversationList(prev, merged)) {
        return prev;
      }
      // No firstItemIndex to update — anchorTo: 'end' handles prepend scroll stability.
      return merged;
    });
  }, [
    shouldUseCutoffQuery,
    cutoffConversations,
    cutoffConversationsDetails.type,
    isInitialLoadComplete,
  ]);

  const fetchOlderMessages = useCallback(() => {
    // isFetchingOlder=true → suppressed (previous fetch in flight).
    if (isFetchingOlderRef.current || hasReachedChannelStartRef.current) return;
    isFetchingOlderRef.current = true;
    zero
      .run(
        queries.channelConversationsPaginatedV3({
          channelId,
          isMember,
          start: oldConversationsAnchorRef.current,
          direction: 'forward',
          limit: PAGE_SIZE,
        }),
        { type: 'complete' },
      )
      .then(older => {
        isFetchingOlderRef.current = false;
        if (older.length === 0) {
          // Zero returned nothing — true start of channel, stop retrying.
          hasReachedChannelStartRef.current = true;
          return;
        }
        setConversationsState(prev => {
          const newItems = older.filter(
            c => !prev.some(v => v.conversationId === c.conversationId),
          );
          // newItems=0 → items already loaded (cold cache) — no-op, retry on next scroll.
          if (newItems.length === 0) return prev;

          const fetched = dedupeAndSort(older, prev);
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
            oldConversationsAnchorRef.current = { createdAt: merged[0].createdAt };
          }
          return merged;
        });
      })
      .catch(() => {
        isFetchingOlderRef.current = false;
      });
  }, [channelId, isInitialLoadComplete, shouldUseCutoffQuery, zero]);

  const fetchNewerMessages = useCallback(() => {
    if (!newConversationsAnchor || isFetchingRef.current || !isInitialLoadComplete) return;
    isFetchingRef.current = true;
    zero
      .run(
        queries.channelConversationsPaginatedV3({
          channelId,
          isMember,
          start: newConversationsAnchor,
          direction: 'backward',
          limit: PAGE_SIZE,
        }),
        { type: 'complete' },
      )
      .then(newer => {
        isFetchingRef.current = false;

        setConversationsState(prev => {
          const newItems = newer.filter(
            c => !prev.some(v => v.conversationId === c.conversationId),
          );
          if (newItems.length === 0) return prev;

          const fetched = dedupeAndSort(prev, newer);
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

          return merged;
        });
      })
      .catch(() => {
        isFetchingRef.current = false;
      });
  }, [channelId, newConversationsAnchor, isInitialLoadComplete, zero]);

  // ── New message boundary ──────────────────────────────────────────────────────
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

  // ── Initial scroll ────────────────────────────────────────────────────────────
  // Fires as soon as there is data to render (cache or fresh fetch). Runs before
  // the first browser paint so the user never sees the wrong scroll position.
  // Priority: 0) pending date jump (land on the first message on/after the picked
  // day; cold-cache far jumps land at the tail then deferred-correct), 1) browser
  // panel restore, 2) deep link in cache, 3) unread boundary, 4) bottom (also
  // covers deep link NOT in cache — activity re-scroll corrects later).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (combinedMessages.length === 0) return;

    const hasDoneInitialScroll = lifecycleRef.current.didInitialScrollAlign !== 'none';
    const isDeferredUnreadScroll =
      hasDoneInitialScroll &&
      lifecycleRef.current.didInitialScrollAlign === 'end' &&
      !lifecycleRef.current.didDeferredScrollCorrection &&
      isInitialLoadComplete;

    if (hasDoneInitialScroll && !isDeferredUnreadScroll) {
      return;
    }

    // ── Compute all priority candidates upfront ──
    // p0 — a date jump wins over everything: land on the first message on or
    // after the picked day, before the first paint (fresh remount, no in-place
    // swap). A short settle window (jumpSettlingRef) then keeps the target pinned
    // at the top while rows measure, so the sticky date pill reads the target day
    // rather than a sliver of the previous day.
    // combinedMessages[i].createdAt is a Date. Gated on isDateJump so the Unreads
    // inbox / search anchors (also linkedItemCreatedAt) don't take this path.
    const jumpTs = isDateJump && linkedItemCreatedAt ? linkedItemCreatedAt.createdAt : null;

    const pathname = window.location.pathname;
    const p1SavedConvId = browserPanelActor
      .getSnapshot()
      .context.channelScrollPositions.get(channelId);
    const p1Idx =
      p1SavedConvId && !pathname.endsWith('/browser')
        ? combinedMessages.findIndex(m => m.data.conversationId === p1SavedConvId)
        : -1;

    const p2Idx = linkedConversationId
      ? combinedMessages.findIndex(m => m.data.conversationId === linkedConversationId)
      : -1;

    const p3Idx = computeNewConvIdx(combinedMessages, channelParticipation?.lastViewedAt, user?.id);

    // ── Select winner by priority order ──
    let doScroll: () => void;

    if (jumpTs !== null) {
      // With the cold-jump empty-cache gate in ConversationPanelV2, a date-jump
      // list only renders once its target window is loaded, so the target row is
      // present here — jumpIdx === -1 only when the target is newer than every
      // loaded message ("jump to today" before any message today) → land at tail.
      const jumpIdx = combinedMessages.findIndex(m => m.createdAt.getTime() >= jumpTs);
      const targetConvId =
        jumpIdx === -1 ? undefined : combinedMessages[jumpIdx]?.data.conversationId;
      doScroll = () => {
        if (jumpIdx === -1) {
          // Target is newer than the whole window (jumped to "today" in a quiet
          // channel) — the latest message is the closest match.
          lifecycleRef.current.didInitialScrollAlign = 'end';
          virtualizer.scrollToEnd({ behavior: 'auto' });
          return;
        }
        lifecycleRef.current.didInitialScrollAlign = 'start';
        // Force the float date to the picked day and hold it until the user
        // scrolls, so it's correct even if the landing leaves a sliver of the
        // previous day at the top (see jumpForcedStickyRef).
        const targetDateText = formatDatePill(combinedMessages[jumpIdx]!.createdAt);
        jumpForcedStickyRef.current = targetDateText;
        setStickyDate(targetDateText);
        // Open the settle window BEFORE scrolling so the first measurements of
        // the rows above the target are already compensated (keeps the target
        // flush at the top; see jumpSettlingRef).
        jumpSettlingRef.current = true;
        if (jumpSettleTimerRef.current) clearTimeout(jumpSettleTimerRef.current);
        jumpSettleTimerRef.current = setTimeout(() => {
          jumpSettlingRef.current = false;
        }, 400);
        virtualizer.scrollToIndex(jumpIdx, { align: 'start', behavior: 'auto' });

        // After the scroll settles (rAF, then again once late rows measure):
        // (1) pull the target's real DOM top flush to the container top so
        //     estimate drift can't leave a sliver of the previous day, and
        // (2) if the target genuinely CAN'T reach the top — jumped near the end
        //     of the list, so the container is already at max scroll and an
        //     earlier day still occupies the top (e.g. "jump to today" when
        //     today is already visible at the bottom) — correct the forced float
        //     to the day actually at the top edge, so it never mislabels the view.
        if (targetConvId) {
          const TOP_TOLERANCE_PX = 4;
          const settleFloat = (): void => {
            const container = parentRef.current;
            if (!container) return;
            const containerTop = container.getBoundingClientRect().top;

            const el = container.querySelector<HTMLElement>(
              `[data-conversation-id="${CSS.escape(targetConvId)}"]`,
            );
            if (el) {
              const delta = el.getBoundingClientRect().top - containerTop;
              // No-op when clamped at the end of the list (browser caps scrollTop).
              if (Math.abs(delta) > 0.5) container.scrollTop += delta;
            }

            const atMaxScroll =
              container.scrollTop >= container.scrollHeight - container.clientHeight - 1;
            const targetTop = el ? el.getBoundingClientRect().top - containerTop : 0;
            if (atMaxScroll && targetTop > TOP_TOLERANCE_PX) {
              const refLine = containerTop + TOP_TOLERANCE_PX;
              const rows = container.querySelectorAll<HTMLElement>('[data-item-timestamp]');
              for (const row of rows) {
                const r = row.getBoundingClientRect();
                if (r.top <= refLine && r.bottom > refLine) {
                  const ts = Number(row.getAttribute('data-item-timestamp'));
                  if (!Number.isNaN(ts)) {
                    const dateText = formatDatePill(ts);
                    jumpForcedStickyRef.current = dateText;
                    setStickyDate(dateText);
                  }
                  break;
                }
              }
            }
          };
          requestAnimationFrame(() => {
            settleFloat();
            window.setTimeout(settleFloat, 120);
          });
        }
      };
    } else if (p1Idx !== -1) {
      browserPanelActor.send({ type: 'CLEAR_SCROLL_POSITION', channelId });
      doScroll = () => {
        lifecycleRef.current.didInitialScrollAlign = 'end';
        virtualizer.scrollToIndex(p1Idx, { align: 'end', behavior: 'auto' });
      };
    } else if (p2Idx !== -1) {
      const isLast = p2Idx === combinedMessages.length - 1;
      const p2Align = isLast ? 'end' : 'center';
      initialLinkedIdRef.current = `${linkedConversationId}:${location.key}:${activityNavigationNonce}`;
      doScroll = () => {
        lifecycleRef.current.didInitialScrollAlign = p2Align;
        virtualizer.scrollToIndex(p2Idx, { align: p2Align, behavior: 'auto' });
      };
    } else if (p3Idx !== -1) {
      const p3Align = 'start';
      doScroll = () => {
        lifecycleRef.current.didInitialScrollAlign = p3Align;
        virtualizer.scrollToIndex(p3Idx, { align: p3Align, behavior: 'auto' });
      };
    } else {
      doScroll = () => {
        lifecycleRef.current.didInitialScrollAlign = 'end';
        virtualizer.scrollToEnd({ behavior: 'auto' });
      };
    }

    lifecycleRef.current.initialPositionSet = true;
    if (isDeferredUnreadScroll) {
      lifecycleRef.current.didDeferredScrollCorrection = true;
    }
    doScroll();

    // With directDomUpdates, item positions are written to DOM directly by TanStack
    // (not via React JSX), so the first doScroll() call is already pixel-accurate.
    // No double-rAF re-snap needed.
  }, [combinedMessages.length, isInitialLoadComplete]);

  // ── Activity re-scroll (subsequent navigations) ───────────────────────────────────
  useEffect(() => {
    if (!linkedItemCreatedAt || !linkedConversationId || !isInitialLoadComplete) return;
    const navigationKey = `${linkedConversationId}:${location.key}:${activityNavigationNonce}`;
    if (navigationKey === initialLinkedIdRef.current) return;
    initialLinkedIdRef.current = navigationKey;

    const idx = combinedMessages.findIndex(
      item => item.data.conversationId === linkedConversationId,
    );
    if (idx !== -1) {
      const isLast = idx === combinedMessages.length - 1;

      requestAnimationFrame(() => {
        const scrollToLinkedConversation = (): boolean => {
          if (isConversationFullyVisible(linkedConversationId, idx)) return false;
          virtualizer.scrollToIndex(idx, { align: isLast ? 'end' : 'center', behavior: 'auto' });
          return true;
        };
        if (scrollToLinkedConversation()) {
          window.setTimeout(scrollToLinkedConversation, 80);
        }
      });
    } else {
      if (linkedCutoffCreatedAt) {
        setCutoffAnchor(prev =>
          prev?.createdAt === linkedCutoffCreatedAt.createdAt ? prev : linkedCutoffCreatedAt,
        );
        return;
      }
      oldConversationsAnchorRef.current = linkedItemCreatedAt;
      setNewConversationsAnchor(linkedItemCreatedAt);
      window.setTimeout(() => {
        fetchNewerMessages();
        fetchOlderMessages();
      }, 0);
    }
  }, [
    linkedConversationId,
    activityNavigationNonce,
    isInitialLoadComplete,
    isConversationFullyVisible,
  ]);

  // ── Auto-scroll when the last conversation changes in-place (streaming,
  // edits, unfurls) — followOnAppend only fires on append, not on in-place
  // growth of the last item.
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

    if (virtualizer.isAtEnd(80) && latestConversationsListRef.current.length === 0) {
      window.setTimeout(() => {
        virtualizer.scrollToEnd();
      }, 80);
    }
  }, [channelId, conversations, isInitialLoadComplete, lastConversationAutoScrollKey, user?.id]);

  // ── Auto-scroll when the user sends a message ─────────────────────────────────
  // For own messages, we always scroll to bottom regardless of position, but ONLY when
  // the user actually pressed send in this session (not on page load).
  useEffect(() => {
    const handler = (e: Event): void => {
      if ((e as CustomEvent<{ channelId: string }>).detail?.channelId !== channelId) return;
      const latest = latestConversationsListRef.current;
      if (latest.length > 0) {
        const first = latest[0];
        if (first) {
          setConversationsState(latest);
          oldConversationsAnchorRef.current = first;
          setNewConversationsAnchor(null);
          setLatestConversationsList([]);
          latestConversationsListRef.current = [];
        }
      }
      setTimeout(() => {
        virtualizer.scrollToEnd({ behavior: 'auto' });
      }, 80);
    };
    // ChatInput dispatches 'xyne:chat-message-sent'
    window.addEventListener('xyne:chat-message-sent', handler);
    return () => window.removeEventListener('xyne:chat-message-sent', handler);
  }, [channelId, virtualizer]);

  // ── In-window mutation reconciliation ────────────────────────────────────────
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
          if (fromMessage?.conversationId === conv.conversationId) {
            flag = 1;
          }
          if (
            flag === 1 &&
            updatedConversations.find(v => v.conversationId === conv.conversationId) === undefined
          ) {
            itemsToDelete.push(conv);
          }
          if (tillMessage.conversationId === conv.conversationId) {
            flag = inViewAnchor === null ? 1 : 0;
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

  // ── Latest conversations (real-time tail) ─────────────────────────────────────
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

    // Use functional update so `prev` is always the latest committed conversations —
    // not the stale closure value. This prevents a race where the cutoff-reconciliation
    // effect (same React commit cycle) removes a deleted message via functional update,
    // and this direct `setConversations(merged)` call — computed from the stale closure —
    // overwrites it back (last direct write wins over any earlier functional update).
    setConversationsState(prev => {
      const { merged, latestClear } = mergeWithLatest(prev, sortedLatest, isInitialLoadComplete);

      if (latestClear) {
        // MERGED-INTO-MAIN: latest items overlapped with fetched window → merged directly.
        // If this fires while QUEUED items still exist, or immediately before a
        // handleLatestMessagesScroll flush, you get a double-scroll / bounce.
        // Side-effect state (pill queue + anchor) is scheduled outside the setter below.
        return isSameConversationList(prev, merged) ? prev : merged;
      }
      return prev; // no change to the main list
    });

    // Compute latestClear again (using the closure value of conversations) purely to
    // drive the pill-queue side effects. A slight staleness here is acceptable — these
    // are cosmetic UI states (the "Latest messages" pill and its anchor), not the main
    // conversation list, and they self-correct on the next subscription tick.
    const { latestClear: latestClearForSideEffects } = mergeWithLatest(
      conversations,
      sortedLatest,
      isInitialLoadComplete,
    );

    if (latestClearForSideEffects) {
      setLatestConversationsList([]);
      latestConversationsListRef.current = [];
      setNewConversationsAnchor(null);
    } else {
      setLatestConversationsList(sortedLatest);
      latestConversationsListRef.current = sortedLatest;
    }
  }, [channelId, latestConversations, latestConversationsDetails.type, isInitialLoadComplete]);

  // ── Mark as read on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    if (!channelId) return;

    return () => {
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

  // ── Persist conversations to query cache ──────────────────────────────────────
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

  // ── Thread opening scroll ──────────────────────────────────────────────────────
  const { conversationId: activeThreadConversationId } = useParams<{ conversationId?: string }>();
  const prevActiveThreadRef = useRef<string | undefined>(undefined);

  useEffect(() => {
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

    const timer = setTimeout(() => {
      requestAnimationFrame(() => {
        if (isConversationFullyVisible(activeThreadConversationId, idx)) return;
        virtualizer.scrollToIndex(idx, { align: 'center' });
      });
    }, 100);

    return () => clearTimeout(timer);
  }, [
    activeThreadConversationId,
    combinedMessages,
    isInitialLoadComplete,
    isConversationFullyVisible,
  ]);

  const handleOpenThread = useCallback(
    (conversationId: string, e?: React.MouseEvent): void => {
      const conversation = conversations.find(c => c.conversationId === conversationId);
      const conversationMetadata = conversation?.metadata as { ticketId?: string } | null;
      const initMsg = conversation ? getInitialMessageFromConversation(conversation) : null;
      const messageMetadata = initMsg?.metadata as { ticketId?: string } | null;
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
      virtualizer.scrollToIndex(index, { align: 'center' });
    };

    if (editingMessageId === message.messageId) {
      scrollToConversation();
      return;
    }
    requestEdit(message.messageId, scrollToConversation);
  }, [conversations, user?.id, editingMessageId, requestEdit, virtualizer]);

  useShortcutById('composer.editLastMessage', handleEditLastMessage, {
    enabled: conversations.length > 0,
    when: isEventFromChannelInput,
  });

  // ── onScroll (replaces Virtuoso rangeChanged + atTopStateChange + atBottomStateChange) ──
  const handleScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el || combinedMessages.length === 0) return;

    lifecycleRef.current.initialPositionSet = true;

    // Release the jump-forced float date on the user's first real scroll (the
    // programmatic settle snaps run while jumpSettlingRef is set, so they don't
    // count). After this the IntersectionObserver drives the float again.
    if (jumpForcedStickyRef.current !== null && !jumpSettlingRef.current) {
      jumpForcedStickyRef.current = null;
    }

    const distanceFromEnd = Math.max(el.scrollHeight - el.clientHeight - el.scrollTop, 0);
    // Near-bottom: within ~300px of end (DOM-based, avoids virtualizer scroll lag)
    const isNearBottom = distanceFromEnd <= 1000;

    // Cosmetic updates — non-urgent, deferred by React's scheduler so they don't
    // block more important scroll work. Both drive purely visual elements.
    startTransition(() => {
      setIsFirstItemScrolledOff(el.scrollTop > 0);
      setShowScrollButton(latestConversationsListRef.current.length === 0 && !isNearBottom);
    });

    if (isNearBottom && isInitialLoadComplete) fetchNewerMessages();

    // Mark new-message boundary as seen once it scrolls into view
    setNewConversationBoundary(prev => {
      if (!prev || prev.seenConvId !== null) return prev;
      const boundaryConvId = combinedMessages[prev.index]?.data.conversationId;
      const items = virtualizer.getVirtualItems();
      const lastVisibleIdx = items[items.length - 1]?.index ?? -1;
      if (boundaryConvId && prev.index <= lastVisibleIdx) {
        return { index: prev.index, seenConvId: boundaryConvId };
      }
      return prev;
    });

    // Trigger older messages when near top.
    // Pattern mirrors the official TanStack chat example: call on every scroll event
    // when near top (no edge guard). isFetchingOlderRef inside fetchOlderMessages
    // prevents concurrent fetches. isAtEnd() blocks the init-time false trigger
    // (scrollToEnd() puts us at the bottom → isAtEnd()=true → skip fetch).
    if (
      !virtualizer.isAtEnd(80) &&
      el.scrollTop < 3000 &&
      lifecycleRef.current.initialPositionSet &&
      isInitialLoadComplete
    ) {
      fetchOlderMessages();
    }

    // Debounce: update inViewAnchor / cutoffAnchor after scroll stops
    if (scrollStopTimerRef.current !== undefined) {
      clearTimeout(scrollStopTimerRef.current);
    }
    scrollStopTimerRef.current = setTimeout(() => {
      scrollStopTimerRef.current = undefined;
      const items = virtualizer.getVirtualItems();
      if (items.length === 0) return;

      if (shouldUseCutoffQuery) {
        if (!lifecycleRef.current.hasSkippedInitialCutoffRange) {
          lifecycleRef.current.hasSkippedInitialCutoffRange = true;
          return;
        }
        const topItem = items[0];
        if (topItem) {
          const conv = conversations[topItem.index];
          if (conv) {
            setCutoffAnchor(prev =>
              prev?.createdAt === conv.createdAt ? prev : { createdAt: conv.createdAt },
            );
          }
        }
        return;
      }

      const bottomItem = items[items.length - 1];
      if (bottomItem) {
        const conv = conversations[bottomItem.index];
        if (conv) {
          const anchorArrayIdx = inViewAnchor
            ? conversations.findIndex(c => c.conversationId === inViewAnchor.conversationId)
            : -1;
          if (
            inViewAnchor === null ||
            anchorArrayIdx === -1 ||
            Math.abs(bottomItem.index - anchorArrayIdx) >= 20
          ) {
            setInViewAnchor({
              conversationId: conv.conversationId,
              createdAt: conv.createdAt,
              direction: 'forward',
            });
          }
        }
      }
    }, 1000);
  }, [
    combinedMessages,
    fetchNewerMessages,
    fetchOlderMessages,
    conversations,
    shouldUseCutoffQuery,
    inViewAnchor,
    virtualizer,
  ]);

  const handleLatestMessagesScroll = useCallback(() => {
    // Only ever runs outside a date jump: the "Latest messages" pill is hidden
    // during a jump, and scrollToBottom handles the jump case before delegating
    // here. (Return-to-latest for a jump is scrollToBottom's isDateJump branch.)
    const latestConversation = latestConversationsList[latestConversationsList.length - 1];
    const oldLatestConversation = latestConversationsList[0];
    if (latestConversation && oldLatestConversation) {
      setConversationsState(latestConversationsList);
      oldConversationsAnchorRef.current = oldLatestConversation;
      setNewConversationsAnchor(null);
      setLatestConversationsList([]);
      latestConversationsListRef.current = [];
      virtualizer.scrollToEnd();
    }
  }, [latestConversationsList, virtualizer]);

  const handleNewMessagesScroll = useCallback(() => {
    if (!newConversationBoundary) return;
    const idx = newConversationBoundary.index;
    virtualizer.scrollToIndex(idx, { align: 'start' });
  }, [newConversationBoundary, virtualizer]);

  // ── IntersectionObserver for sticky date pill ──────────────────────────────────
  useEffect(() => {
    dateObserverRef.current = new IntersectionObserver(
      entries => {
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

        const sorted = Array.from(visibleDatesRef.current.entries()).sort(
          (a, b) => a[1].timestamp - b[1].timestamp,
        );
        if (sorted.length === 0) return;

        const oldestItem = sorted[0];
        // While a jump-forced date is held, don't let the oldest-visible
        // computation overwrite it (a previous-day sliver would win). Cleared on
        // the user's first scroll after the settle window (see handleScroll).
        if (oldestItem?.[1] && jumpForcedStickyRef.current === null) {
          setStickyDate(formatDatePill(oldestItem[1].timestamp));
        }

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

  const itemRef = useCallback((el: HTMLDivElement | null) => {
    if (el && dateObserverRef.current) {
      dateObserverRef.current.observe(el);
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    // If a date jump is active, the window is around a past day and doesn't hold
    // the live tail. Clear the `#createdAt` hash so the list remounts fresh at the
    // latest message (flicker-free mount path) instead of swapping in place. Skip
    // the mark-as-read this remount would trigger — same reasoning as the jump.
    if (isDateJump) {
      if (skipMarkAsReadRef) skipMarkAsReadRef.current = true;
      void navigate({ hash: '' });
      return;
    }
    if (latestConversationsListRef.current.length > 0) {
      handleLatestMessagesScroll();
      return;
    }
    virtualizer.scrollToEnd();
    setShowScrollButton(false);
  }, [handleLatestMessagesScroll, virtualizer, isDateJump, navigate, skipMarkAsReadRef]);

  // ── Empty / loading states ─────────────────────────────────────────────────────
  if (conversations.length === 0 && isInitialLoadComplete)
    return (
      <div className='text-center text-muted-foreground flex-1 flex items-center justify-center'>
        <p className='text-muted-foreground'>No conversations in this channel yet</p>
      </div>
    );

  if (!isInitialLoadComplete && cachedConversations.length === 0)
    return (
      <div
        className='absolute inset-0 flex items-center justify-center bg-background z-50'
        data-testid='chat-list-loading'
      >
        <LoadingAnimation
          message='Loading conversations...'
          source='ChatListV6: getChannelConversations'
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
      {/* Sticky date pill overlay */}
      {stickyDate && isFirstItemScrolledOff && (
        <div className='absolute top-0 left-0 right-0 z-10 pointer-events-none'>
          <div className='relative flex justify-center py-2'>
            <DatePill
              dateText={stickyDate}
              {...(!isMobile && { onJumpToDate: handleJumpToDate })}
              {...(firstMessageDate && { minDate: firstMessageDate })}
            />
          </div>
        </div>
      )}

      {/* Scroll container — replaces <Virtuoso> */}
      <div
        ref={parentRef}
        onScroll={handleScroll}
        style={{ height: '100%', overflow: 'auto', zIndex: 0, overflowAnchor: 'none' }}
        className='no-scrollbar'
        data-virtuoso-scroller='true'
      >
        {/* Flex wrapper: when content is shorter than the viewport, justify-content: flex-end
               pushes it to the bottom. For full/overflowing lists it has no effect. This is a
               pure CSS solution — no state, no TanStack paddingStart — so item deletion and
               addition never interfere with anchorTo:'end' scroll adjustments. */}
        <div
          style={{
            minHeight: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
          }}
        >
          <div
            ref={virtualizer.containerRef}
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              position: 'relative',
              width: '100%',
            }}
            data-testid='virtuoso-item-list'
          >
            {virtualItems.map(virtualItem => {
              const item = combinedMessages[virtualItem.index];
              if (!item) return null;

              const prevItem =
                virtualItem.index > 0 ? combinedMessages[virtualItem.index - 1] : null;
              const dateText = formatDatePill(item.createdAt);
              const showDatePill =
                !prevItem || item.createdAt.toDateString() !== prevItem.createdAt.toDateString();
              const shouldHideInlineDatePill =
                showDatePill &&
                dateText === stickyDate &&
                isFirstItemScrolledOff &&
                virtualItem.index > 0;
              const isNewMessageBoundary =
                newConversationBoundary !== null &&
                virtualItem.index === newConversationBoundary.index;

              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    // No transform here — directDomUpdates writes it directly to the DOM.
                  }}
                >
                  {/* Inner div for IntersectionObserver data attrs */}
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
                        <DatePill
                          dateText={dateText}
                          {...(!isMobile && { onJumpToDate: handleJumpToDate })}
                          {...(firstMessageDate && { minDate: firstMessageDate })}
                        />
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
                      index={virtualItem.index}
                      chatListItems={combinedMessages}
                      channelId={channelId}
                      projectId={projectId}
                      channelScopeType={channelScopeType}
                      handleOpenThread={handleOpenThread}
                      linkedConversationId={linkedConversationId ?? null}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <MessageHoverToolbar containerRef={hoverToolbarContainerRef} />

      {/* New messages pill */}
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

      {/* Latest messages floating pill — only in the live tail context (new
          messages arrived while reading). During a date jump the user
          deliberately navigated to the past, so the plain "go to bottom" arrow
          below is shown instead. */}
      {!isDateJump && latestConversationsList.length > 0 && (
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

      {/* Scroll to bottom button. During a date jump the loaded window is a past
          day disjoint from the tail (latestConversationsList populated), so show
          the arrow regardless of scroll position — clicking it clears the hash
          and remounts at the live latest (see scrollToBottom). */}
      {(showScrollButton || (isDateJump && latestConversationsList.length > 0)) && (
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

export default withProfiler(ChatListV4, 'ChatListV4');
