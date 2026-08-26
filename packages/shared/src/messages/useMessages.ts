import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQuery } from '../hooks/useQuery.js';
import { useInstrumentation, useZero } from '../hooks/useZero.js';
import { Event } from '../logger/events.js';
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
  getChannelSnapshotWithSource,
  getThreadSnapshot,
  getThreadSnapshotWithSource,
  primeChannelCache,
  primeThreadCache,
  subscribeMessages,
} from './messages.js';
import {
  dedupeAndSortConversations,
  mergeCachedConversations,
  mergeConversationsWithLatest,
  mergeServerAndPendingConversations,
  mergeServerAndPendingThreadMessages,
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
  // Opt-in: mobile uses the latest tail as a provisional first window.
  promoteLatestTailOnColdOpen?: boolean;
  enabled?: boolean;
  // Opt-in diagnostic only; does not change cache selection or query behavior.
  notificationTargetMessageId?: string | null | undefined;
  linkedConversationId?: string | null | undefined;
  linkedItemCreatedAt?: { createdAt: number } | null | undefined;
  linkedCutoffCreatedAt?: { createdAt: number } | null | undefined;
  lastViewedAt?: number | null | undefined;
  lastActivityAt?: number | null | undefined;
  conversationSeenCutoffAt?: number | null | undefined;
};

const DEFAULT_CHANNEL_PAGE_SIZE = 50;

const summarizeCachedMessages = (
  rows: readonly { createdAt: number }[],
): { messageCount: number; latestMessageCreatedAt: number | null } => {
  let latestMessageCreatedAt: number | null = null;
  for (const row of rows) {
    if (
      latestMessageCreatedAt === null ||
      row.createdAt > latestMessageCreatedAt
    ) {
      latestMessageCreatedAt = row.createdAt;
    }
  }
  return { messageCount: rows.length, latestMessageCreatedAt };
};

type Anchor = { createdAt: number };

export type InViewAnchor = {
  direction: 'forward' | 'backward';
  conversationId: string;
  createdAt: number;
};

export type UseChannelMessagesResult = {
  messages: Conversation[];
  latestConversationsList: Conversation[];
  initialLoadError: string | null;
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
  const notificationTargetMessageId = opts.notificationTargetMessageId ?? null;
  const linkedConversationId = opts.linkedConversationId ?? null;
  const linkedItemCreatedAt = opts.linkedItemCreatedAt ?? null;
  const linkedCutoffCreatedAt = opts.linkedCutoffCreatedAt ?? null;
  const lastViewedAt = opts.lastViewedAt ?? null;
  const lastActivityAt = opts.lastActivityAt ?? null;
  const conversationSeenCutoffAt = opts.conversationSeenCutoffAt ?? null;

  const zero = useZero();
  const { logger } = useInstrumentation();

  const cachedSnapshot = useMemo(
    () => getChannelSnapshotWithSource(ref),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, notificationTargetMessageId],
  );
  const cachedConversations = cachedSnapshot.value;
  const [conversations, setConversations] = useState<Conversation[]>(cachedConversations);
  const conversationsRef = useRef<Conversation[]>(cachedConversations);
  const loggedNotificationCacheKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || notificationTargetMessageId === null) return;
    const diagnosticKey = `${key}:${notificationTargetMessageId}`;
    if (loggedNotificationCacheKeyRef.current === diagnosticKey) return;
    loggedNotificationCacheKeyRef.current = diagnosticKey;

    const targetPresent = cachedSnapshot.value.some(
      conversation => conversation.initialMessageId === notificationTargetMessageId,
    );
    logger.info(Event.CHAT_NOTIFICATION_CACHE_READ, {
      cacheKind: 'channel',
      cacheId: channelId,
      cacheSource: cachedSnapshot.source,
      cacheStatus: targetPresent ? 'hit' : 'target_missing',
      ...summarizeCachedMessages(cachedSnapshot.value),
    });
  }, [
    cachedSnapshot,
    channelId,
    enabled,
    key,
    logger,
    notificationTargetMessageId,
  ]);
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
  const hasLinkedAnchor = linkedConversationId !== null || linkedItemCreatedAt !== null;
  const allowProvisionalPromotion = promoteLatestTailOnColdOpen && !hasLinkedAnchor;

  const activityCutoffCreatedAt = linkedCutoffCreatedAt?.createdAt ?? null;
  const channelSeenCutoffCreatedAt = !linkedConversationId
    ? conversationSeenCutoffAt ?? null
    : null;
  const initialCutoffCreatedAt = activityCutoffCreatedAt ?? channelSeenCutoffCreatedAt;
  const [cutoffAnchor, setCutoffAnchor] = useState<Anchor | null>(
    initialCutoffCreatedAt !== null ? { createdAt: initialCutoffCreatedAt } : null,
  );
  const retryInitialLoad = useCallback((): void => {
    if (!enabled || !channelId || shouldUseCutoffQuery) return;
    setInitialLoadError(null);
    setInitialLoadAttempt(attempt => attempt + 1);
  }, [channelId, enabled, shouldUseCutoffQuery]);

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
        const cachedWindow = conversationsRef.current;
        const mergedWithCached = hasProvisionalWindowRef.current
          ? dedupeAndSortConversations(cachedWindow, fetched)
          : mergeCachedConversations(cachedWindow, fetched);
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
        } else if (merged.length > 0) {
          setNewConversationsAnchor({ createdAt: merged[merged.length - 1]!.createdAt });
        }

        setConversationsState(merged);
        hasProvisionalWindowRef.current = false;
        setInitialLoadError(null);
        setIsInitialLoadComplete(true);
      })
      .catch(err => {
        if (cancelled) return;
        const serializedError = serializeInitialLoadError(err);
        setInitialLoadError(serializedError);
        console.error('[useMessages] initial channel load failed', serializedError);
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

    const itemsToDelete: Conversation[] = [];
    let fromMessage = updatedConversations[0];
    let tillMessage = updatedConversations[updatedConversations.length - 1];
    if (fromMessage && tillMessage) {
      const tempMessage = { ...fromMessage };
      fromMessage =
        fromMessage.createdAt < tillMessage.createdAt ? fromMessage : tillMessage;
      tillMessage =
        tillMessage.createdAt > tempMessage.createdAt ? tillMessage : tempMessage;
      let flag = 0;
      for (const conv of conversationsRef.current) {
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
    } else if (updatedConversations.length === 0) {
      itemsToDelete.push(...conversationsRef.current);
    }
    const anchorConversation =
      inViewAnchor?.conversationId &&
      updatedConversations.find(v => v.conversationId === inViewAnchor.conversationId);
    if (inViewAnchor?.conversationId && !anchorConversation) {
      const found = conversationsRef.current.find(
        v => v.conversationId === inViewAnchor.conversationId,
      );
      if (found) itemsToDelete.push(found);
    }
    const updated = conversationsRef.current
      .filter(conv => !itemsToDelete.some(v => v.conversationId === conv.conversationId))
      .map(conv => {
        const item = updatedConversations.find(v => v.conversationId === conv.conversationId);
        if (item) return item;
        return conv;
      });
    // Zero re-emits the paginated conversations query on many upstream deltas
    // (e.g. optimistic message inserts elsewhere in the channel) even when the
    // window itself is unchanged. Comparing before setState keeps `conversations`
    // reference stable so `messagesWithPending` doesn't churn.
    setConversationsState(prev =>
      isSameConversationList(prev, updated) ? prev : updated,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    channelId,
    updatedConversations,
    updatedConversationsDetails.type,
    isInitialLoadComplete,
    shouldUseCutoffQuery,
  ]);

  useEffect(() => {
    if (!enabled) return;
    if (latestConversationsDetails.type !== 'complete') return;
    if (latestConversations.length === 0) {
      if (!promoteLatestTailOnColdOpen && isInitialLoadComplete) {
        setConversationsState(prev => (prev.length > 0 ? [] : prev));
      }
      return;
    }
    const sortedLatest = [...latestConversations].sort((a, b) => a.createdAt - b.createdAt);

    const currentWindow = conversationsRef.current;
    const { merged, latestClear } = mergeConversationsWithLatest(
      currentWindow,
      sortedLatest,
      isInitialLoadComplete,
      allowProvisionalPromotion,
    );

    if (latestClear) {
      if (
        allowProvisionalPromotion &&
        !isInitialLoadComplete &&
        currentWindow.length === 0
      ) {
        hasProvisionalWindowRef.current = true;
      }
      if (!isSameConversationList(currentWindow, merged)) {
        setConversationsState(merged);
      }
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
    promoteLatestTailOnColdOpen,
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
  const notificationTargetMessageId = opts.notificationTargetMessageId ?? null;
  const { logger } = useInstrumentation();

  const cachedSnapshot = useMemo(
    () => getThreadSnapshotWithSource(ref),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, notificationTargetMessageId],
  );
  const [snapshot, setSnapshot] = useState<ThreadConversation | null>(cachedSnapshot.value);
  const loggedNotificationCacheKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || notificationTargetMessageId === null) return;
    const diagnosticKey = `${key}:${notificationTargetMessageId}`;
    if (loggedNotificationCacheKeyRef.current === diagnosticKey) return;
    loggedNotificationCacheKeyRef.current = diagnosticKey;

    const targetPresent =
      cachedSnapshot.value?.messages.some(
        message => message.messageId === notificationTargetMessageId,
      ) ?? false;
    logger.info(Event.CHAT_NOTIFICATION_CACHE_READ, {
      cacheKind: 'thread',
      cacheId: ref.conversationId,
      cacheSource: cachedSnapshot.source,
      cacheStatus: targetPresent ? 'hit' : 'target_missing',
      ...summarizeCachedMessages(cachedSnapshot.value?.messages ?? []),
    });
  }, [
    cachedSnapshot,
    enabled,
    key,
    logger,
    notificationTargetMessageId,
    ref.conversationId,
  ]);

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
    const pendingRows = [...pendingForThread]
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(buildPendingThreadMessage);
    return {
      ...base,
      messages: mergeServerAndPendingThreadMessages(base.messages, pendingRows),
    } as ThreadConversation;
  }, [base, pendingForThread]);
}
