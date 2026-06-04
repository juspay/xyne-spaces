import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { QueryResultType } from '@rocicorp/zero';
import { useCachedQuery } from './useCachedQuery';
import { useZero } from './useZero';
import { queries } from '../zero/queries';
import { useAllVisibleChannels } from './useChannels';

type DmStatsPageResult = QueryResultType<typeof queries.dmChannelsLatestMessagesPaginated>;

type DmChannel = NonNullable<DmStatsPageResult[number]['channel']> & {
  channelStats: { lastActivityAt: number; participantCount: number } | undefined;
};

type DmConversation = NonNullable<
  NonNullable<DmStatsPageResult[number]['channel']>['conversations']
>[number];

const PAGE_SIZE = 20;

// Virtuoso requires firstItemIndex to stay above 0 as items are prepended.
// This is headroom only — the actual value has no domain meaning.
const VIRTUOSO_PREPEND_HEADROOM = 100_000;

interface UseDmsPaginatedMessagesOptions {
  selectedChannelId?: string | undefined;
}

interface UseDmsPaginatedMessagesReturn {
  messagesMap: Map<string, DmConversation>;
  channels: DmChannel[];
  hasMore: boolean;
  hasMoreBefore: boolean;
  loadMore: () => void;
  /** Virtuoso firstItemIndex — increases by N each time N items are prepended. */
  firstItemIndex: number;
  /** Increments each time the selected channel moves to index 0. Use to trigger scroll-to-top. */
  selectedChannelMovedVersion: number;
  /**
   * When called with a channelId: scrolls to an existing channel or fetches and jumps to it.
   * When called without arguments: loads the previous page (newer channels) — equivalent to
   * the former loadMoreBefore, used by Virtuoso's startReached.
   */
  jumpToChannel: (
    channelId?: string,
  ) => Promise<
    { type: 'scroll'; index: number } | { type: 'loaded' } | { type: 'skipped' } | { type: 'error' }
  >;
}

const sortDesc = (rows: DmStatsPageResult): DmStatsPageResult =>
  [...rows].sort(
    (a, b) => b.lastActivityAt - a.lastActivityAt || b.channelId.localeCompare(a.channelId),
  );

export const useDmsPaginatedMessages = (
  options: UseDmsPaginatedMessagesOptions = {},
): UseDmsPaginatedMessagesReturn => {
  const { selectedChannelId } = options;
  const zero = useZero();

  // Keep a ref so jumpToChannel can read the current visible channels list
  // synchronously without a stale closure, without re-creating the callback.
  const visibleChannels = useAllVisibleChannels();
  const visibleChannelsRef = useRef(visibleChannels);
  visibleChannelsRef.current = visibleChannels;

  // ── Rows ─────────────────────────────────────────────────────────────────────
  // Ref mirrors state so async callbacks always read current value without stale closures.
  const [rows, setRows] = useState<DmStatsPageResult>([]);
  const rowsRef = useRef<DmStatsPageResult>([]);
  const commitRows = useCallback((next: DmStatsPageResult) => {
    rowsRef.current = next;
    setRows(next);
  }, []);

  // ── Pagination state ──────────────────────────────────────────────────────────
  const [hasMore, setHasMore] = useState(true);
  const [hasMoreBefore, setHasMoreBefore] = useState(false);
  const hasMoreBeforeRef = useRef(false);
  const commitHasMoreBefore = useCallback((next: boolean) => {
    hasMoreBeforeRef.current = next;
    setHasMoreBefore(next);
  }, []);

  const [firstItemIndex, setFirstItemIndex] = useState(0);
  const isFetchingRef = useRef(false);

  // ── Selected channel scroll tracking ─────────────────────────────────────────
  const [selectedChannelMovedVersion, setSelectedChannelMovedVersion] = useState(0);
  const prevSelectedIndexRef = useRef(-1);
  const prevSelectedActivityRef = useRef(-1);
  const selectedChannelIdRef = useRef(selectedChannelId);

  useEffect(() => {
    selectedChannelIdRef.current = selectedChannelId;
    prevSelectedIndexRef.current = -1;
    prevSelectedActivityRef.current = -1;
  }, [selectedChannelId]);

  // ── Page 1: always-live Zero subscription ─────────────────────────────────────
  const [page1] = useCachedQuery(
    queries.dmChannelsLatestMessagesPaginated({ limit: PAGE_SIZE, start: null }),
  );

  useEffect(() => {
    if (!page1) return;

    // Cursor mode: ignore page1 updates unless the selected channel has bubbled up into
    // page1 (e.g. user sent a message from a jump position), in which case close the gap
    // and fall through to the live merge below.
    if (hasMoreBeforeRef.current) {
      const selectedId = selectedChannelIdRef.current;
      const selectedInPage1 = selectedId !== null && page1.some(s => s.channelId === selectedId);
      if (!selectedInPage1) return;
      commitHasMoreBefore(false);
    }

    if (page1.length === 0) {
      commitRows([]);
      setHasMore(false);
      return;
    }

    // Merge: fresh page1 replaces the live portion; deeper-page rows are de-duplicated and kept.
    const page1Ids = new Set(page1.map(s => s.channelId));
    const deeperRows = rowsRef.current.filter(s => !page1Ids.has(s.channelId));
    const merged = sortDesc([...page1, ...deeperRows]);

    // Fire scroll-to-top when the selected channel reaches index 0 or gets a new message there.
    const selectedId = selectedChannelIdRef.current;
    if (selectedId) {
      const newIdx = merged.findIndex(s => s.channelId === selectedId);
      const newActivity = newIdx >= 0 ? merged[newIdx]!.lastActivityAt : -1;

      if (
        newIdx === 0 &&
        (prevSelectedIndexRef.current !== 0 || prevSelectedActivityRef.current !== newActivity)
      ) {
        setSelectedChannelMovedVersion(v => v + 1);
      }

      prevSelectedIndexRef.current = newIdx;
      prevSelectedActivityRef.current = newActivity;
    }

    commitRows(merged);
    setHasMore(page1.length === PAGE_SIZE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page1]);

  // ── Single fetch helper ────────────────────────────────────────────────────
  const fetchPage = useCallback(
    (
      start: { lastActivityAt: number; channelId: string } | null,
      direction?: 'forward' | 'backward',
    ) =>
      zero.run(queries.dmChannelsLatestMessagesPaginated({ limit: PAGE_SIZE, start, direction }), {
        type: 'complete',
      }),
    [zero],
  );

  // ── loadMore (forward — older channels) ──────────────────────────────────────
  const loadMore = useCallback(() => {
    if (isFetchingRef.current || !hasMore) return;

    const last = rowsRef.current.at(-1);
    if (!last) {
      setHasMore(false);
      return;
    }

    isFetchingRef.current = true;
    const cursor = { lastActivityAt: last.lastActivityAt, channelId: last.channelId };

    void (async () => {
      try {
        const page = await fetchPage(cursor, 'forward');

        if (!page || page.length === 0) {
          setHasMore(false);
          return;
        }

        const existingIds = new Set(rowsRef.current.map(s => s.channelId));
        const newRows = page.filter(s => !existingIds.has(s.channelId));

        if (newRows.length > 0) {
          // Cursor mode: preserve query order so the jump segment stays intact.
          // Live mode: sort so deeper rows slot in at the correct position.
          const next = hasMoreBeforeRef.current
            ? [...rowsRef.current, ...newRows]
            : sortDesc([...rowsRef.current, ...newRows]);
          commitRows(next);
        }

        setHasMore(page.length === PAGE_SIZE);
      } finally {
        isFetchingRef.current = false;
      }
    })();
  }, [hasMore, fetchPage, commitRows]);

  // ── jumpToChannel / loadMoreBefore (unified) ────────────────────────────────
  //
  // Called with a channelId → jump to that channel (scroll if loaded, fetch if not).
  // Called without arguments → load the previous page (newer channels, backward pagination).
  const jumpToChannel = useCallback(
    async (
      channelId?: string,
    ): Promise<
      | { type: 'scroll'; index: number }
      | { type: 'loaded' }
      | { type: 'skipped' }
      | { type: 'error' }
    > => {
      // ── No channelId: behave as loadMoreBefore ──────────────────────────────
      if (channelId === undefined) {
        if (isFetchingRef.current || !hasMoreBeforeRef.current) return { type: 'skipped' };

        const first = rowsRef.current[0];
        if (!first) {
          commitHasMoreBefore(false);
          return { type: 'skipped' };
        }

        isFetchingRef.current = true;
        const cursor = { lastActivityAt: first.lastActivityAt, channelId: first.channelId };

        try {
          // Backward query returns ASC; reverse to get DESC before prepending.
          const page = await fetchPage(cursor, 'backward');

          if (!page || page.length === 0) {
            commitHasMoreBefore(false);
            return { type: 'skipped' };
          }

          const existingIds = new Set(rowsRef.current.map(s => s.channelId));
          const newRows = [...page].reverse().filter(s => !existingIds.has(s.channelId));

          if (newRows.length > 0) {
            commitRows([...newRows, ...rowsRef.current]);
            // Shift firstItemIndex down so Virtuoso keeps the viewport anchored.
            setFirstItemIndex(prev => prev - newRows.length);
          }

          // Partial page means we've reached the top — gap is closed, live mode resumes.
          if (page.length < PAGE_SIZE) {
            commitHasMoreBefore(false);
          }

          return { type: 'loaded' };
        } finally {
          isFetchingRef.current = false;
        }
      }

      // ── channelId provided: jump to specific channel ────────────────────────
      const existingIndex = rowsRef.current.findIndex(s => s.channelId === channelId);
      if (existingIndex >= 0) return { type: 'scroll', index: existingIndex };

      if (isFetchingRef.current) return { type: 'error' };
      isFetchingRef.current = true;

      try {
        // Check visible channels cache first to avoid a network round-trip.
        // Fall back to a direct Zero query only if the channel isn't cached.
        const cachedStats = visibleChannelsRef.current.find(c => c.id === channelId);
        const lastActivityAt =
          cachedStats?.channelStats?.lastActivityAt ??
          (await zero.run(queries.channelStats({ channelId }), { type: 'complete' }))
            ?.lastActivityAt;

        if (!lastActivityAt) return { type: 'error' };

        const cursor = { lastActivityAt, channelId };
        const results = await fetchPage(cursor, 'forward');

        if (!results || results.length === 0) return { type: 'error' };

        commitRows(results);
        setHasMore(results.length === PAGE_SIZE);
        commitHasMoreBefore(true);
        setFirstItemIndex(VIRTUOSO_PREPEND_HEADROOM);

        return { type: 'loaded' };
      } finally {
        isFetchingRef.current = false;
      }
    },
    [fetchPage, commitRows, commitHasMoreBefore, zero],
  );

  // ── Derived values ────────────────────────────────────────────────────────────
  const visibleIds = useMemo(() => new Set(visibleChannels.map(c => c.id)), [visibleChannels]);
  const channels = useMemo<DmChannel[]>(
    () =>
      rows
        .filter(
          s =>
            s.channel &&
            ((s.channel.conversations?.length ?? 0) > 0 || visibleIds.has(s.channelId)),
        )
        .map(s => ({
          ...s.channel!,
          channelStats: { lastActivityAt: s.lastActivityAt, participantCount: s.participantCount },
        })),
    [rows, visibleIds],
  );

  const messagesMap = useMemo(() => {
    const map = new Map<string, DmConversation>();
    for (const { channelId, channel } of rows) {
      const first = channel?.conversations?.[0];
      if (first) map.set(channelId, first);
    }
    return map;
  }, [rows]);

  return {
    messagesMap,
    channels,
    hasMore,
    hasMoreBefore,
    loadMore,
    firstItemIndex,
    selectedChannelMovedVersion,
    jumpToChannel,
  };
};
