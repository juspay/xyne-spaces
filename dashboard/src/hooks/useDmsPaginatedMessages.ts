import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { QueryResultType } from '@rocicorp/zero';
import { useCachedQuery } from './useCachedQuery';
import { useZero } from './useZero';
import { queries } from '../zero/queries';
import { Conversation } from '../machines/stateMachine';

type DmStatsPageResult = QueryResultType<typeof queries.dmChannelsLatestMessagesPaginated>;
type DmStatsRow = DmStatsPageResult[number];

// The channel shape exposed to consumers — channel data with channelStats attached
type DmChannel = NonNullable<DmStatsRow['channel']> & {
  channelStats: { lastActivityAt: number; participantCount: number } | undefined;
};

const PAGE_SIZE = 20;

interface UseDmsPaginatedMessagesOptions {
  selectedChannelId?: string | undefined;
}

interface UseDmsPaginatedMessagesReturn {
  messagesMap: Map<string, Conversation>;
  channels: DmChannel[];
  hasMore: boolean;
  loadMore: () => void;
  onVisibleRangeChanged: (startIndex: number) => void;
  isLoading: boolean;
  /** Increments each time the selected channel moves to the top (index 0). Use to trigger scroll-to-top. */
  selectedChannelMovedVersion: number;
}

/**
 * Hook for paginated DM channel list with cursor-based pagination.
 *
 * Design:
 * - Page 1 (cursor=null) is ALWAYS the live Zero subscription (useCachedQuery). It reactively
 *   updates whenever any channel gets new activity.
 * - Deeper pages (2, 3, ...) are fetched on demand via `zero.run()` — a one-shot imperative
 *   fetch with NO subscription. Deeper-page channels are frozen snapshots and will NOT produce
 *   reactive re-renders or keep open Zero subscriptions.
 * - Cursor-based pagination: each page uses the `{ lastActivityAt, channelId }` of the last
 *   item in the current list as the cursor for the next page fetch.
 * - When page 1 reactively updates, we replace the page-1 portion of accumulatedStats with
 *   fresh data. Deeper-page channels are retained but de-duplicated (a channel that moved up
 *   into page 1 is removed from the deeper-page snapshot automatically).
 * - When user scrolls back to top, all deeper-page snapshots are discarded. Page 2 will be
 *   re-fetched fresh the next time the user scrolls to the bottom.
 * - The selected channel scrolls to top when it receives a message (selectedChannelMovedVersion).
 */
export const useDmsPaginatedMessages = (
  options: UseDmsPaginatedMessagesOptions = {},
): UseDmsPaginatedMessagesReturn => {
  const { selectedChannelId } = options;
  const zero = useZero();

  // ========== STATE ==========

  // Accumulated stats: page 1 (live) + deeper pages (frozen snapshots), sorted by lastActivityAt desc
  const [accumulatedStats, setAccumulatedStats] = useState<DmStatsPageResult>([]);
  // Synchronous mirror for effects/callbacks (avoids stale closure reads)
  const accumulatedStatsRef = useRef<DmStatsPageResult>([]);

  const [hasMore, setHasMore] = useState(true);

  // Guard: prevents concurrent loadMore calls
  const isFetchingRef = useRef(false);

  // Track selected channel movement for scroll-to-top
  const [selectedChannelMovedVersion, setSelectedChannelMovedVersion] = useState(0);
  const prevSelectedIndexRef = useRef<number>(-1);
  const prevSelectedActivityRef = useRef<number>(-1);

  const selectedChannelIdRef = useRef(selectedChannelId);
  if (selectedChannelIdRef.current !== selectedChannelId) {
    selectedChannelIdRef.current = selectedChannelId;
    prevSelectedIndexRef.current = -1;
    prevSelectedActivityRef.current = -1;
  }

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // PAGE 1: Always-live Zero subscription. Reactively updates when any DM channel changes.
  const [page1, page1Details] = useCachedQuery(
    queries.dmChannelsLatestMessagesPaginated({ limit: PAGE_SIZE, start: null }),
  );

  // Always-current ref for page1 — used inside debounced callbacks to avoid stale closures
  const page1Ref = useRef(page1);
  page1Ref.current = page1;

  // Fingerprint to detect content changes even if the page1 array reference is stable
  const page1Fingerprint = useMemo(() => {
    if (!page1 || page1.length === 0) return '';
    return page1.map(r => `${r.channelId}:${r.lastActivityAt}`).join('|');
  }, [page1]);

  /**
   * Effect: Handle page 1 reactive updates.
   *
   * Page 1 is always live. When it updates (e.g. channels move due to new messages),
   * we replace the page-1 portion of accumulatedStats with the fresh page-1 data.
   * Deeper-page channels are kept as-is but de-duplicated (if a channel moved up
   * into page 1, the stale deeper-page copy is removed automatically).
   */
  useEffect(() => {
    if (!page1) return;

    if (page1.length === 0) {
      accumulatedStatsRef.current = [];
      setAccumulatedStats([]);
      setHasMore(false);
      return;
    }

    const page1Map = new Map(page1.map(s => [s.channelId, s]));

    // Keep deeper-page channels not already in the fresh page 1 (de-duplicate only)
    const deeperPageStats = accumulatedStatsRef.current.filter(s => !page1Map.has(s.channelId));

    // Merge: fresh page 1 + retained deeper-page snapshots, sorted
    const newAccumulated = [...page1, ...deeperPageStats].sort(
      (a, b) => b.lastActivityAt - a.lastActivityAt || b.channelId.localeCompare(a.channelId),
    );

    // Detect selected channel movement and fire scroll-to-top signal
    const currentSelectedId = selectedChannelIdRef.current;
    if (currentSelectedId) {
      const newIdx = newAccumulated.findIndex(s => s.channelId === currentSelectedId);
      const newActivity = newIdx >= 0 ? newAccumulated[newIdx]!.lastActivityAt : -1;
      const prevIdx = prevSelectedIndexRef.current;
      const prevActivity = prevSelectedActivityRef.current;

      prevSelectedIndexRef.current = newIdx;
      prevSelectedActivityRef.current = newActivity;

      // Trigger scroll-to-top when:
      // 1. Selected channel moved to index 0 from elsewhere, OR
      // 2. It was already at 0 and its lastActivityAt changed (new message received)
      if (newIdx === 0 && (prevIdx !== 0 || newActivity !== prevActivity)) {
        setSelectedChannelMovedVersion(v => v + 1);
      }
    }

    accumulatedStatsRef.current = newAccumulated;
    setAccumulatedStats(newAccumulated);
    setHasMore(page1.length === PAGE_SIZE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page1, page1Fingerprint]);
  /**
   * loadMore: Fetches the next page using cursor-based pagination via `zero.run()`.
   *
   * The cursor `{ lastActivityAt, channelId }` is taken from the last item in the
   * current accumulated list and passed as `start` to the same paginated query.
   * zero.run() is a one-shot imperative fetch — it creates NO subscription.
   */
  const loadMore = useCallback(() => {
    if (isFetchingRef.current || !hasMore) return;

    const last = accumulatedStatsRef.current[accumulatedStatsRef.current.length - 1];
    if (!last) {
      setHasMore(false);
      return;
    }

    // Cursor points to the last item — the query will return items after this point
    const cursor = { lastActivityAt: last.lastActivityAt, channelId: last.channelId };
    isFetchingRef.current = true;

    void (async () => {
      try {
        const deeperPage = await zero.run(
          queries.dmChannelsLatestMessagesPaginated({ limit: PAGE_SIZE, start: cursor }),
          { type: 'complete' },
        );

        if (!deeperPage || deeperPage.length === 0) {
          setHasMore(false);
          return;
        }

        // De-duplicate: page 1 reactive update may have already pulled some channels up
        const existingIds = new Set(accumulatedStatsRef.current.map(s => s.channelId));
        const newRows = deeperPage.filter(s => !existingIds.has(s.channelId));

        if (newRows.length > 0) {
          const newAccumulated = [...accumulatedStatsRef.current, ...newRows].sort(
            (a, b) => b.lastActivityAt - a.lastActivityAt || b.channelId.localeCompare(a.channelId),
          );
          accumulatedStatsRef.current = newAccumulated;
          setAccumulatedStats(newAccumulated);
        }

        // If we got a full page there may be more; otherwise we've reached the end
        setHasMore(deeperPage.length === PAGE_SIZE);
      } finally {
        isFetchingRef.current = false;
      }
    })();
  }, [hasMore, zero]);

  /**
   * onVisibleRangeChanged: Called by Virtuoso when the visible range changes.
   *
   * When the user scrolls back to the top (startIndex <= 2), we discard all
   * deeper-page snapshots and reset to only live page-1 data.
   * The next time the user scrolls to the bottom, page 2 will be re-fetched fresh.
   *
   * Uses page1Ref so the debounce always sees the latest page1 snapshot (no stale closure).
   */
  const onVisibleRangeChanged = useCallback((startIndex: number) => {
    if (startIndex > 2) return;
    if (accumulatedStatsRef.current.length <= PAGE_SIZE) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;

      // Read page1 via ref — always the latest value, no stale closure
      const currentPage1 = page1Ref.current;
      if (!currentPage1 || currentPage1.length === 0) return;

      // Prune to only page-1 channels (the live slice)
      const page1Ids = new Set(currentPage1.map(s => s.channelId));
      const pruned = accumulatedStatsRef.current.filter(s => page1Ids.has(s.channelId));

      if (pruned.length < accumulatedStatsRef.current.length) {
        accumulatedStatsRef.current = pruned;
        setAccumulatedStats(pruned);
        setHasMore(true);
        isFetchingRef.current = false;
      }
    }, 150);
  }, []); // no deps — reads everything via refs

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);
  const isLoading = page1Details.type !== 'complete' && accumulatedStats.length === 0;

  const channels = useMemo<DmChannel[]>(() => {
    return accumulatedStats
      .filter(s => s.channel !== null)
      .map(s => ({
        ...s.channel!,
        channelStats: {
          lastActivityAt: s.lastActivityAt,
          participantCount: s.participantCount,
        },
      }));
  }, [accumulatedStats]);

  const messagesMap = useMemo(() => {
    const map = new Map<string, Conversation>();
    for (const stat of accumulatedStats) {
      const channel = stat.channel;
      if (!channel) continue;
      const conversations = channel.conversations;
      if (conversations && conversations.length > 0) {
        map.set(stat.channelId, conversations[0] as Conversation);
      }
    }
    return map;
  }, [accumulatedStats]);

  return {
    messagesMap,
    channels,
    hasMore,
    loadMore,
    onVisibleRangeChanged,
    isLoading,
    selectedChannelMovedVersion,
  };
};
