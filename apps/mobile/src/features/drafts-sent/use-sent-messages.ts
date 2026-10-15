import { useCallback, useEffect, useRef, useState } from 'react';

import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { useZero } from '@/src/hooks/useZero';
import { queries } from '@/src/zero/queries';

import { SENT_PAGE_SIZE, type SentMessageRow } from './drafts-sent-utils';

export type SentMessagesModel = {
  rows: SentMessageRow[];
  loadMore: () => Promise<void>;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
};

type SentCursor = { messageId: string; createdAt: number };

const mergeSent = (existing: SentMessageRow[], incoming: SentMessageRow[]): SentMessageRow[] => {
  const map = new Map<string, SentMessageRow>();
  for (const row of existing) map.set(row.messageId, row);
  for (const row of incoming) map.set(row.messageId, row);
  return Array.from(map.values()).sort((a, b) => {
    const created = b.createdAt - a.createdAt;
    if (created !== 0) return created;
    return b.messageId.localeCompare(a.messageId);
  });
};

const oldestCursor = (rows: readonly SentMessageRow[]): SentCursor | null => {
  const last = rows[rows.length - 1];
  if (!last) return null;
  return { messageId: last.messageId, createdAt: last.createdAt };
};

const cursorKey = (cursor: SentCursor): string =>
  JSON.stringify({ messageId: cursor.messageId, createdAt: cursor.createdAt });

export function useSentMessages(enabled: boolean): SentMessagesModel {
  const zero = useZero();
  const [rows, setRows] = useState<SentMessageRow[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const rowsRef = useRef<SentMessageRow[]>([]);
  const nextCursorRef = useRef<SentCursor | null>(null);
  const pendingCursorKeyRef = useRef<string | null>(null);
  const firstPageSettledRef = useRef(false);
  const isLoadingMoreRef = useRef(false);
  // Once loadMore advances past page 1, live first-page emissions must not
  // regress nextCursor/hasMore — that re-crawls already-loaded pages.
  const hasPaginatedRef = useRef(false);

  const [liveRows, liveDetails] = useCachedQuery(
    queries.userSentMessagesPaginated({ limit: SENT_PAGE_SIZE, start: null }),
    { enabled },
  );

  useEffect(() => {
    if (!enabled || isLoadingMoreRef.current || !liveRows) return;
    if (liveDetails.type !== 'complete') return;

    const page = liveRows as SentMessageRow[];
    const next = mergeSent(rowsRef.current, page);
    rowsRef.current = next;
    setRows(next);
    firstPageSettledRef.current = true;
    setIsLoading(false);

    if (hasPaginatedRef.current) return;

    const more = page.length >= SENT_PAGE_SIZE;
    const cursor = more ? oldestCursor(next) : null;
    nextCursorRef.current = cursor;
    setHasMore(more && cursor !== null);
  }, [enabled, liveDetails, liveRows]);

  const loadMore = useCallback(async (): Promise<void> => {
    const cursor = nextCursorRef.current;
    if (!enabled || !hasMore || !cursor || isLoadingMoreRef.current) return;

    const requestKey = cursorKey(cursor);
    if (pendingCursorKeyRef.current === requestKey) return;
    pendingCursorKeyRef.current = requestKey;

    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    try {
      const result = (await zero.run(
        queries.userSentMessagesPaginated({
          limit: SENT_PAGE_SIZE,
          start: cursor,
        }),
        { type: 'complete' },
      )) as SentMessageRow[];

      if (result.length === 0) {
        setHasMore(false);
        nextCursorRef.current = null;
        return;
      }

      hasPaginatedRef.current = true;
      const next = mergeSent(rowsRef.current, result);
      rowsRef.current = next;
      setRows(next);

      const more = result.length >= SENT_PAGE_SIZE;
      const nextCursor = more ? oldestCursor(next) : null;
      nextCursorRef.current = nextCursor;
      setHasMore(more && nextCursor !== null);
    } catch (error) {
      console.warn('[useSentMessages] loadMore failed', error);
      pendingCursorKeyRef.current = null;
    } finally {
      isLoadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [enabled, hasMore, zero]);

  return {
    rows,
    loadMore,
    hasMore,
    isLoading: enabled && isLoading && !firstPageSettledRef.current,
    isLoadingMore,
  };
}
