import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQuery } from '../hooks/useQuery.js';
import { useZero } from '../hooks/useZero.js';
import { queries } from '../zero/queries.js';
import type {
  Conversation,
  ThreadConversation,
} from '../machines/queryCacheMachine.js';
import type {
  ChannelRef,
  ConversationRef,
  ThreadRef,
} from './conversationRef.js';
import { refKey } from './conversationRef.js';
import {
  getChannelSnapshot,
  getThreadSnapshot,
  primeChannelCache,
  primeThreadCache,
  subscribeMessages,
} from './messages.js';
import {
  dedupeAndSortConversations,
  mergeCachedConversations,
  mergeConversationsWithLatest,
  mergeServerAndPendingConversations,
  reconcileConversationWindow,
} from './channelMessageMerge.js';
import {
  buildPendingChannelConversation,
  buildPendingThreadMessage,
} from './pendingRows.js';
import { usePendingForChannel, usePendingForThread } from './usePending.js';

export type UseMessagesOptions = {
  channelPageSize?: number;
  channelLatestLimit?: number;
  /**
   * Opt-in: render the latest tail as a provisional first window while the
   * complete page resolves, instead of holding an empty list. Only applies to
   * unanchored opens; anchored opens always wait for their own window.
   * Off by default, so dashboard/electron keep complete-page behavior.
   */
  promoteLatestTailOnColdOpen?: boolean;
  enabled?: boolean;
  linkedConversationId?: string | null | undefined;
  linkedItemCreatedAt?: { createdAt: number } | null | undefined;
  linkedCutoffCreatedAt?: { createdAt: number } | null | undefined;
  lastViewedAt?: number | null | undefined;
  lastActivityAt?: number | null | undefined;
  conversationSeenCutoffAt?: number | null | undefined;
};

const DEFAULT_CHANNEL_PAGE_SIZE = 50;

type Anchor = { createdAt: number };

export type InViewAnchor = {
  direction: 'forward' | 'backward';
  conversationId: string;
  createdAt: number;
};

export type UseChannelMessagesResult = {
  messages: Conversation[];
  latestConversationsList: Conversation[];
  /** Serialized failure of the initial load, or null. Cleared on retry. */
  initialLoadError: string | null;
  /** Re-runs the initial load after `initialLoadError`. */
  retryInitialLoad: () => void;
  loadOlder: () => void;
  loadNewer: () => void;
  setInViewAnchor: (anchor: InViewAnchor | null) => void;
  setCutoffAnchor: (
    updater: Anchor | null | ((prev: Anchor | null) => Anchor | null),
  ) => void;
  newConversationsAnchor: Anchor | null;
  hasReachedChannelStart: boolean;
  isInitialLoadComplete: boolean;
};

export function serializeInitialLoadError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (Array.isArray(err) || (err !== null && typeof err === 'object')) {
    try {
      const json = JSON.stringify(err);
      if (json && json !== '[]' && json !== '{}') return json;
    } catch {
      /* fall through */
    }
  }
  const asString = String(err);
  return asString && asString !== '[]' ? asString : 'unknown_error';
}

function isSameConversationList(a: Conversation[], b: Conversation[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (item, index) => item.conversationId === b[index]?.conversationId && item === b[index],
  );
}

export function useMessages(
  ref: ChannelRef,
  opts?: UseMessagesOptions,
): UseChannelMessagesResult;
export function useMessages(
  ref: ThreadRef,
  opts?: UseMessagesOptions,
): ThreadConversation | null;
export function useMessages(
  ref: ConversationRef,
  opts?: UseMessagesOptions,
): UseChannelMessagesResult | ThreadConversation | null {
  if (ref.kind === 'channel') {
    return useChannelMessagesImpl(ref, opts);
  }
  return useThreadMessagesImpl(ref, opts);
}

function useChannelMessagesImpl(
  ref: ChannelRef,
  opts: UseMessagesOptions = {},
): UseChannelMessagesResult {
  const enabled = opts.enabled ?? true;
  const isMember = ref.isMember ?? true;
  const pageSize = opts.channelPageSize ?? DEFAULT_CHANNEL_PAGE_SIZE;
  const latestLimit = opts.channelLatestLimit ?? Math.max(1, Math.floor(pageSize / 2));
  const promoteLatestTailOnColdOpen = opts.promoteLatestTailOnColdOpen ?? false;
  const { channelId } = ref;
  const key = refKey(ref);
  const linkedConversationId = opts.linkedConversationId ?? null;
  const linkedItemCreatedAt = opts.linkedItemCreatedAt ?? null;
  const linkedCutoffCreatedAt = opts.linkedCutoffCreatedAt ?? null;
  const lastViewedAt = opts.lastViewedAt ?? null;
  const lastActivityAt = opts.lastActivityAt ?? null;
  const conversationSeenCutoffAt = opts.conversationSeenCutoffAt ?? null;

  const zero = useZero();

  const cachedConversations = useMemo(() => getChannelSnapshot(ref), [key]);
  const [conversations, setConversations] = useState<Conversation[]>(cachedConversations);
  const conversationsRef = useRef<Conversation[]>(cachedConversations);
  const setConversationsState = useCallback(
    (next: Conversation[] | ((prev: Conversation[]) => Conversation[])): void => {
      if (typeof next !== 'function') {
        conversationsRef.current = next;
        setConversations(next);
        if (enabled && channelId) primeChannelCache(ref, next);
        return;
      }
      setConversations(prev => {
        const resolved = next(prev);
        conversationsRef.current = resolved;
        if (enabled && channelId) primeChannelCache(ref, resolved);
        return resolved;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channelId, enabled, key],
  );

  const initialNewAnchor: Anchor | null = useMemo(() => {
    if (linkedItemCreatedAt) return linkedItemCreatedAt;
    if (
      lastViewedAt != null &&
      (lastActivityAt == null || lastViewedAt < lastActivityAt)
    ) {
      return { createdAt: lastViewedAt };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const initialOldAnchor: Anchor = useMemo(() => {
    if (linkedItemCreatedAt) return linkedItemCreatedAt;
    return {
      createdAt: lastViewedAt ?? lastActivityAt ?? Date.now(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const [newConversationsAnchor, setNewConversationsAnchor] = useState<Anchor | null>(
    initialNewAnchor,
  );
  const oldConversationsAnchorRef = useRef<Anchor>(initialOldAnchor);
  const [inViewAnchor, setInViewAnchor] = useState<InViewAnchor | null>(null);

  const [latestConversationsList, setLatestConversationsList] = useState<Conversation[]>([]);
  const latestConversationsListRef = useRef<Conversation[]>([]);
  // A cold open may temporarily render the latest tail. Remember that, so the
  // complete page extends the visible window instead of replacing it.
  const hasProvisionalWindowRef = useRef(false);

  const [isInitialLoadComplete, setIsInitialLoadComplete] = useState(false);
  const [initialLoadError, setInitialLoadError] = useState<string | null>(null);
  const [initialLoadAttempt, setInitialLoadAttempt] = useState(0);
  const isFetchingRef = useRef(false);
  const isFetchingOlderRef = useRef(false);
  const hasReachedChannelStartRef = useRef(false);
  const [hasReachedChannelStart, setHasReachedChannelStart] = useState(false);

  const shouldUseCutoffQuery =
    conversationSeenCutoffAt !== null && isMember && !linkedConversationId;
  // Latest-tail promotion is safe only for a genuinely recent, unanchored
  // open. Unread, activity, cutoff, and deep-link opens have a deliberate
  // position; promoting the tail there can hide the requested message.
  const hasNavigationAnchor =
    linkedConversationId !== null ||
    linkedItemCreatedAt !== null ||
    linkedCutoffCreatedAt !== null ||
    conversationSeenCutoffAt !== null ||
    lastViewedAt !== null ||
    lastActivityAt !== null;
  const allowProvisionalPromotion = promoteLatestTailOnColdOpen && !hasNavigationAnchor;

  const retryInitialLoad = useCallback((): void => {
    if (!enabled || !channelId || shouldUseCutoffQuery) return;
    setInitialLoadError(null);
    setInitialLoadAttempt(attempt => attempt + 1);
  }, [channelId, enabled, shouldUseCutoffQuery]);

  const activityCutoffCreatedAt = linkedCutoffCreatedAt?.createdAt ?? null;
  const channelSeenCutoffCreatedAt = !linkedConversationId
    ? conversationSeenCutoffAt ?? null
    : null;
  const initialCutoffCreatedAt = activityCutoffCreatedAt ?? channelSeenCutoffCreatedAt;
  const [cutoffAnchor, setCutoffAnchor] = useState<Anchor | null>(
    initialCutoffCreatedAt !== null ? { createdAt: initialCutoffCreatedAt } : null,
  );

  const [updatedConversations, updatedConversationsDetails] = useQuery(
    queries.channelConversationsPaginatedV3({
      channelId,
      isMember,
      start: inViewAnchor ? { createdAt: inViewAnchor.createdAt } : null,
      direction: inViewAnchor ? inViewAnchor.direction : 'forward',
      limit: pageSize,
    }),
    {
      enabled: enabled && !shouldUseCutoffQuery && inViewAnchor !== null,
    },
  );

  const [cutoffConversations, cutoffConversationsDetails] = useQuery(
    queries.channelConversationsPaginatedV3({
      channelId,
      isMember,
      start: cutoffAnchor,
      direction: 'backward',
      limit: pageSize,
    }),
    {
      enabled: enabled && shouldUseCutoffQuery && cutoffAnchor !== null,
    },
  );

  const [latestConversations, latestConversationsDetails] = useQuery(
    queries.channelLatestMultipleConversationsV3({
      channelId,
      isMember,
      limit: latestLimit,
    }),
    { enabled },
  );

  useEffect(() => {
    if (!enabled || !channelId) return;
    if (shouldUseCutoffQuery) return;
    // A resolution that lands after the channel changed (or after a retry
    // superseded this attempt) must not write into the new window.
    let cancelled = false;
    setInitialLoadError(null);

    Promise.all([
      zero.run(
        queries.channelConversationsPaginatedV3({
          channelId,
          isMember,
          start: oldConversationsAnchorRef.current,
          direction: 'forward',
          limit: pageSize,
        }),
        { type: 'complete' },
      ),
      newConversationsAnchor
        ? zero.run(
            queries.channelConversationsPaginatedV3({
              channelId,
              isMember,
              start: newConversationsAnchor,
              direction: 'backward',
              limit: Math.max(1, Math.floor(pageSize / 2)),
            }),
            { type: 'complete' },
          )
        : Promise.resolve<Conversation[] | null>(null),
    ])
      .then(([older, newerNullable]) => {
        if (cancelled) return;
        const newer = newerNullable ?? [];
        const fetched = dedupeAndSortConversations(older, newer);
        const hadProvisionalWindow = hasProvisionalWindowRef.current;
        const provisionalTail = latestConversationsListRef.current;
        const mergedWithCached = mergeCachedConversations(conversationsRef.current, fetched);
        const { merged, latestClear } = mergeConversationsWithLatest(
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
        } else if (hadProvisionalWindow && provisionalTail.length > 0) {
          // The provisional tail was visible while the initial window was in
          // flight. If the authoritative window is disjoint, expose the tail
          // as a queued range now that it is no longer rendered in the main
          // list; the intermediate history remains fetchable.
          setLatestConversationsList(provisionalTail);
          if (merged.length > 0) {
            setNewConversationsAnchor({ createdAt: merged[merged.length - 1]!.createdAt });
          }
        } else if (merged.length > 0) {
          setNewConversationsAnchor({ createdAt: merged[merged.length - 1]!.createdAt });
        }

        setConversationsState(merged);
        hasProvisionalWindowRef.current = false;
        setIsInitialLoadComplete(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Surfaced so callers can offer a retry; the list keeps whatever warm
        // rows it already has.
        setInitialLoadError(serializeInitialLoadError(err));
      });
    return (): void => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, initialLoadAttempt]);

  useEffect(() => {
    if (!enabled) return;
    if (!shouldUseCutoffQuery || cutoffConversationsDetails.type !== 'complete' || isInitialLoadComplete) {
      return;
    }

    const sortedCutoffConversations = [...cutoffConversations].sort(
      (a, b) => a.createdAt - b.createdAt,
    );
    const { merged, latestClear } = mergeConversationsWithLatest(
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
  }, [
    enabled,
    shouldUseCutoffQuery,
    cutoffConversations,
    cutoffConversationsDetails.type,
    isInitialLoadComplete,
    setConversationsState,
  ]);

  useEffect(() => {
    if (!enabled) return;
    if (!shouldUseCutoffQuery || cutoffConversationsDetails.type !== 'complete' || !isInitialLoadComplete) {
      return;
    }

    const sortedCutoffConversations = [...cutoffConversations].sort(
      (a, b) => a.createdAt - b.createdAt,
    );

    setConversationsState(prev => {
      const merged = reconcileConversationWindow(prev, sortedCutoffConversations);
      if (isSameConversationList(prev, merged)) return prev;
      return merged;
    });
  }, [
    enabled,
    shouldUseCutoffQuery,
    cutoffConversations,
    cutoffConversationsDetails.type,
    isInitialLoadComplete,
    setConversationsState,
  ]);

  const loadOlder = useCallback(() => {
    if (!enabled || !channelId) return;
    if (isFetchingOlderRef.current || hasReachedChannelStartRef.current) return;
    isFetchingOlderRef.current = true;
    zero
      .run(
        queries.channelConversationsPaginatedV3({
          channelId,
          isMember,
          start: oldConversationsAnchorRef.current,
          direction: 'forward',
          limit: pageSize,
        }),
        { type: 'complete' },
      )
      .then(older => {
        isFetchingOlderRef.current = false;
        if (older.length === 0) {
          hasReachedChannelStartRef.current = true;
          setHasReachedChannelStart(true);
          return;
        }
        setConversationsState(prev => {
          const newItems = older.filter(
            c => !prev.some(v => v.conversationId === c.conversationId),
          );
          if (newItems.length === 0) return prev;

          const fetched = dedupeAndSortConversations(older, prev);
          const { merged, latestClear } = mergeConversationsWithLatest(
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
  }, [channelId, enabled, isMember, pageSize, setConversationsState, zero]);

  const loadNewer = useCallback(() => {
    if (!enabled || !channelId) return;
    if (!newConversationsAnchor || isFetchingRef.current || !isInitialLoadComplete) return;
    isFetchingRef.current = true;
    zero
      .run(
        queries.channelConversationsPaginatedV3({
          channelId,
          isMember,
          start: newConversationsAnchor,
          direction: 'backward',
          limit: pageSize,
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

          const fetched = dedupeAndSortConversations(prev, newer);
          const { merged, latestClear } = mergeConversationsWithLatest(
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
  }, [channelId, enabled, isMember, isInitialLoadComplete, newConversationsAnchor, pageSize, setConversationsState, zero]);

  useEffect(() => {
    if (!enabled) return;
    if (shouldUseCutoffQuery) return;
    if (updatedConversationsDetails.type !== 'complete' || !isInitialLoadComplete) return;

    // Replace exactly the key range the emission covers, leaving rows outside
    // that window untouched. Zero re-emits this query on many upstream deltas
    // (e.g. an optimistic insert elsewhere in the channel) even when the window
    // itself is unchanged, and a complete-but-empty emission is not evidence
    // that the channel is empty — so it must never clear a warm window.
    // Comparing before setState also keeps `messagesWithPending` stable.
    setConversationsState(prev => {
      // A forward cursor query returns its anchor, so a missing anchor was
      // deleted. A backward query excludes it; its absence means nothing.
      const reconciled = reconcileConversationWindow(
        prev,
        updatedConversations,
        inViewAnchor?.direction === 'forward' ? inViewAnchor.conversationId : undefined,
      );
      return isSameConversationList(prev, reconciled) ? prev : reconciled;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    channelId,
    updatedConversations,
    updatedConversationsDetails.type,
    isInitialLoadComplete,
    shouldUseCutoffQuery,
    inViewAnchor?.conversationId,
  ]);

  useEffect(() => {
    if (!enabled) return;
    if (latestConversationsDetails.type !== 'complete') return;
    if (latestConversations.length === 0) {
      // Do not let a transient empty latest-tail emission erase a provisional
      // cold-open window. Once the authoritative initial load has completed,
      // an empty tail still clears the list so a final conversation deletion is
      // reflected in the UI.
      if (isInitialLoadComplete && !hasProvisionalWindowRef.current) {
        setConversationsState(prev => (prev.length > 0 ? [] : prev));
      }
      return;
    }
    const sortedLatest = [...latestConversations].sort((a, b) => a.createdAt - b.createdAt);

    // Read the window before setState: React may run the updater eagerly and
    // update `conversationsRef` before the side effects below are decided.
    const currentWindow = conversationsRef.current;
    const { latestClear: latestClearForSideEffects } = mergeConversationsWithLatest(
      currentWindow,
      sortedLatest,
      isInitialLoadComplete,
      allowProvisionalPromotion,
    );
    const isProvisionalPromotion =
      latestClearForSideEffects &&
      allowProvisionalPromotion &&
      !isInitialLoadComplete &&
      currentWindow.length === 0;

    setConversationsState(prev => {
      const { merged, latestClear } = mergeConversationsWithLatest(
        prev,
        sortedLatest,
        isInitialLoadComplete,
        allowProvisionalPromotion,
      );
      if (latestClear) {
        return isSameConversationList(prev, merged) ? prev : merged;
      }
      return prev;
    });

    if (isProvisionalPromotion) {
      // Keep the tail in the ref for the authoritative initial-load merge, but
      // do not show a duplicate "new conversations" queue while it is already
      // rendered provisionally.
      hasProvisionalWindowRef.current = true;
      latestConversationsListRef.current = sortedLatest;
      setLatestConversationsList([]);
    } else if (latestClearForSideEffects) {
      setLatestConversationsList([]);
      latestConversationsListRef.current = [];
      setNewConversationsAnchor(null);
    } else {
      setLatestConversationsList(sortedLatest);
      latestConversationsListRef.current = sortedLatest;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    channelId,
    latestConversations,
    latestConversationsDetails.type,
    isInitialLoadComplete,
    allowProvisionalPromotion,
  ]);

  const pendingForChannel = usePendingForChannel(channelId);
  const messagesWithPending = useMemo(() => {
    if (pendingForChannel.length === 0) return conversations;
    const pendingRows = [...pendingForChannel]
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(buildPendingChannelConversation);
    return mergeServerAndPendingConversations(conversations, pendingRows);
  }, [conversations, pendingForChannel]);

  return {
    messages: messagesWithPending,
    latestConversationsList,
    initialLoadError,
    retryInitialLoad,
    loadOlder,
    loadNewer,
    setInViewAnchor,
    setCutoffAnchor,
    newConversationsAnchor,
    hasReachedChannelStart,
    isInitialLoadComplete,
  };
}

function useThreadMessagesImpl(
  ref: ThreadRef,
  opts: UseMessagesOptions = {},
): ThreadConversation | null {
  const enabled = (opts.enabled ?? true) && Boolean(ref.conversationId);
  const key = refKey(ref);

  const [snapshot, setSnapshot] = useState<ThreadConversation | null>(() =>
    getThreadSnapshot(ref),
  );

  useEffect(() => {
    setSnapshot(getThreadSnapshot(ref));
    return subscribeMessages(ref, () => setSnapshot(getThreadSnapshot(ref)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const [live] = useQuery(
    queries.threadConversationV2({
      conversationId: ref.conversationId,
      channelId: ref.channelId,
      isMember: ref.isMember ?? true,
    }),
    { enabled },
  );

  useEffect(() => {
    if (live) primeThreadCache(ref, live);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, key]);

  const pendingForThread = usePendingForThread(ref.conversationId);
  const base = live ?? snapshot;
  return useMemo(() => {
    if (!base) return null;
    if (pendingForThread.length === 0) return base;
    const pendingByMessageId = new Map(
      pendingForThread.map(p => [p.messageId, p]),
    );
    const filtered = base.messages.filter(
      m => !pendingByMessageId.has(m.messageId),
    );
    const pendingRows = [...pendingForThread]
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(buildPendingThreadMessage);
    return {
      ...base,
      messages: [...filtered, ...pendingRows],
    } as ThreadConversation;
  }, [base, pendingForThread]);
}
