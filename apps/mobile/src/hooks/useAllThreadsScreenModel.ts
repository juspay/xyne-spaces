import { useCallback, useEffect, useRef, useState } from 'react';
import { queries } from '@xyne/shared/zero/queries';
import { useZero } from '@/src/hooks/useZero';
import {
  readThreadsSnapshot,
  persistThreadsSnapshot,
  type ConversationParticipantRow,
  type ThreadCursor,
} from '@/src/utils/threadsSnapshotCache';
import { useCachedQuery } from './useCachedQuery';

const PAGE_SIZE = 20;

export type ThreadsScreenModel = {
  rows: ConversationParticipantRow[];
  loadMore: () => Promise<void>;
  hasMore: boolean;
  isLoading: boolean;
};

function mergeRows(
  existing: ConversationParticipantRow[],
  incoming: ConversationParticipantRow[],
): ConversationParticipantRow[] {
  const map = new Map<string, ConversationParticipantRow>();
  for (const row of existing) map.set(row.id, row);
  for (const row of incoming) {
    const prev = map.get(row.id);
    if (!prev || (row.lastReplyAt ?? 0) >= (prev.lastReplyAt ?? 0)) {
      map.set(row.id, row);
    }
  }
  return Array.from(map.values()).sort((a, b) => (b.lastReplyAt ?? 0) - (a.lastReplyAt ?? 0));
}

export function useAllThreadsScreenModel(userId: string): ThreadsScreenModel {
  const zero = useZero();

  const [rows, setRows] = useState<ConversationParticipantRow[]>(() => {
    const s = readThreadsSnapshot(userId);
    return s?.rows ?? [];
  });

  const [nextCursor, setNextCursor] = useState<ThreadCursor | null>(() => {
    const s = readThreadsSnapshot(userId);
    return s?.nextCursor ?? null;
  });

  const [hasMore, setHasMore] = useState<boolean>(() => {
    const s = readThreadsSnapshot(userId);
    return s ? s.hasMore : true;
  });

  // Show loading spinner only on cold start (no snapshot on-device)
  const [isLoading, setIsLoading] = useState(() => {
    const s = readThreadsSnapshot(userId);
    return !s || s.rows.length === 0;
  });

  // Tracks whether Zero's first page has settled at least once.
  // Prevents the live query from overwriting cursor/hasMore while user is paginating.
  const firstPageSettledRef = useRef(rows.length > 0);
  const isLoadingMoreRef = useRef(false);

  // Live first-page Zero subscription.
  const [liveRows, liveDetails] = useCachedQuery(
    queries.userConversationsPaginatedV2({ userId, limit: PAGE_SIZE, start: null }),
    { enabled: !!userId },
  );

  useEffect(() => {
    // While loadMore is in flight, only merge — don't touch cursor or hasMore.
    if (isLoadingMoreRef.current) return;
    if (!liveRows) return;

    // Zero's useQuery returns [] with type 'unknown' before the server sync
    // completes. Treating that as "no data" would prematurely clear isLoading
    // and flash "No threads yet". Only settle once Zero confirms type='complete'.
    if (liveDetails.type !== 'complete') return;

    if (liveRows.length === 0) {
      if (!firstPageSettledRef.current) {
        firstPageSettledRef.current = true;
        setIsLoading(false);
        setHasMore(false);
      }
      return;
    }

    const casted = liveRows as unknown as ConversationParticipantRow[];
    setRows(prev => mergeRows(prev, casted));

    if (!firstPageSettledRef.current) {
      firstPageSettledRef.current = true;
      setIsLoading(false);

      const last = casted[casted.length - 1]!;
      const cursor: ThreadCursor | null =
        liveRows.length >= PAGE_SIZE && last.lastReplyAt != null
          ? { lastReplyAt: last.lastReplyAt, id: last.id }
          : null;

      setNextCursor(cursor);
      setHasMore(liveRows.length >= PAGE_SIZE);
      persistThreadsSnapshot(userId, casted, cursor, liveRows.length >= PAGE_SIZE);
    }
  }, [liveRows, liveDetails, userId]);

  const loadMore = useCallback(async () => {
    if (!hasMore || !nextCursor || !userId || isLoadingMoreRef.current) return;

    isLoadingMoreRef.current = true;
    try {
      const result = (await zero.run(
        queries.userConversationsPaginatedV2({
          userId,
          limit: PAGE_SIZE,
          start: nextCursor,
        }),
      )) as unknown as ConversationParticipantRow[];

      if (result.length === 0) {
        setHasMore(false);
        setNextCursor(null);
        return;
      }

      const last = result[result.length - 1]!;
      const newCursor: ThreadCursor | null =
        result.length >= PAGE_SIZE && last.lastReplyAt != null
          ? { lastReplyAt: last.lastReplyAt, id: last.id }
          : null;
      const moreAvailable = result.length >= PAGE_SIZE;

      setRows(prev => {
        const merged = mergeRows(prev, result);
        persistThreadsSnapshot(userId, merged, newCursor, moreAvailable);
        return merged;
      });
      setNextCursor(newCursor);
      setHasMore(moreAvailable);
    } catch (error) {
      console.warn('[useThreadsScreenModel] loadMore failed', error);
    } finally {
      isLoadingMoreRef.current = false;
    }
  }, [hasMore, nextCursor, userId, zero]);

  return { rows, loadMore, hasMore, isLoading };
}
