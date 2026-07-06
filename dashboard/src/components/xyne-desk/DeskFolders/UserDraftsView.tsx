import { ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, X, FileText, Loader2 } from 'lucide-react';
import type { QueryResultType } from '@rocicorp/zero';
import { queries } from '../../../zero/queries';
import { useZero } from '../../../hooks/useZero';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { stripHtml } from '../EmailComposer/helpers';

/**
 * Per-desk "Drafts" view. Lists the user's own email drafts for a channel,
 * paginated the same way as the email list (TicketListView): the first page is
 * subscribed reactively, older pages are fetched imperatively on scroll via a
 * keyset cursor and accumulated client-side. Browser-local compose drafts (new
 * emails) are shown as a header section above the paginated list.
 */

const PAGE_SIZE = 20;

type DraftRow = NonNullable<QueryResultType<typeof queries.userEmailDrafts>[number]>;

interface DraftItem {
  draftId: string;
  updatedAt: number;
  ticketId: string;
  ticketXyneId: string;
  conversationId: string;
  title: string;
  snippet: string;
}

const toDraftItem = (d: DraftRow): DraftItem | null => {
  const ticket = d.ticket;
  // Reply drafts only: a row with no conversationId is a compose draft (handled elsewhere).
  if (!ticket || !d.conversationId) return null;
  return {
    draftId: d.id,
    updatedAt: d.updatedAt,
    ticketId: ticket.id,
    ticketXyneId: ticket.xyneId,
    conversationId: d.conversationId,
    title: ticket.title?.trim() || '(no subject)',
    snippet: d.draftContent
      ? stripHtml(d.draftContent).replace(/\s+/g, ' ').trim().slice(0, 140)
      : '',
  };
};

interface ComposeDraftRef {
  id: string;
  label: string;
}

interface UserDraftsViewProps {
  channelId: string;
  composeDrafts: ComposeDraftRef[];
  onReopenCompose: (id: string) => void;
  onDiscardCompose: (id: string) => void;
  onOpenTicket: (item: {
    channelId: string;
    ticketXyneId: string;
    ticketId: string;
    conversationId: string;
  }) => void;
  onClose: () => void;
}

export const UserDraftsView = ({
  channelId,
  composeDrafts,
  onReopenCompose,
  onDiscardCompose,
  onOpenTicket,
  onClose,
}: UserDraftsViewProps): ReactElement => {
  const zero = useZero();

  // First page: reactive, fixed window. Older pages: imperative keyset fetches.
  const [firstPage, firstPageDetails] = useCachedQuery(
    queries.userEmailDrafts({ channelId, limit: PAGE_SIZE, start: null }),
  );
  const [olderPages, setOlderPages] = useState<DraftRow[][]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const firstRows = useMemo<DraftRow[]>(
    () => (firstPage as DraftRow[] | undefined) ?? [],
    [firstPage],
  );

  // Cursor base for older pages = the oldest row in the reactive first window.
  // When it shifts (drafts created/edited into the top window), the accumulated
  // older pages are fetched from a stale boundary, so reset and refetch. Also
  // resets when the channel changes (new desk = new data).
  const boundary = firstRows[firstRows.length - 1];
  const boundaryKey = boundary ? `${boundary.updatedAt}:${boundary.id}` : '';
  useEffect(() => {
    setOlderPages([]);
    setHasMore(true);
  }, [channelId, boundaryKey]);

  const ticketDrafts = useMemo<DraftItem[]>(() => {
    const all = [...firstRows, ...olderPages.flat()];
    const seen = new Set<string>();
    const unique: DraftItem[] = [];
    for (const d of all) {
      if (seen.has(d.id)) continue;
      const item = toDraftItem(d);
      if (!item) continue;
      seen.add(d.id);
      unique.push(item);
    }
    unique.sort((a, b) => {
      if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
      return b.draftId.localeCompare(a.draftId);
    });
    return unique;
  }, [firstRows, olderPages]);

  const hasDrafts = ticketDrafts.length > 0;

  // Keep the latest paging state in a ref so loadMore can stay referentially
  // stable — the IntersectionObserver effect then only re-runs on `hasMore`,
  // not on every page append or loading-state flip.
  const stateRef = useRef({ hasMore, isLoadingMore, ticketDrafts });
  useEffect(() => {
    stateRef.current = { hasMore, isLoadingMore, ticketDrafts };
  });

  const loadMore = useCallback(async () => {
    const { hasMore, isLoadingMore, ticketDrafts } = stateRef.current;
    if (!hasMore || isLoadingMore) return;
    const last = ticketDrafts[ticketDrafts.length - 1];
    if (!last) return;
    setIsLoadingMore(true);
    try {
      const next = (await zero.run(
        queries.userEmailDrafts({
          channelId,
          limit: PAGE_SIZE,
          start: { id: last.draftId, updatedAt: last.updatedAt },
        }),
        { type: 'complete' },
      )) as DraftRow[];
      if (next.length === 0) {
        setHasMore(false);
      } else {
        setOlderPages(prev => [...prev, next]);
        if (next.length < PAGE_SIZE) setHasMore(false);
      }
    } finally {
      setIsLoadingMore(false);
    }
  }, [zero, channelId]);

  // Auto-load on scroll: observe a sentinel near the bottom of the list.
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || !hasDrafts) return;
    const observer = new IntersectionObserver(
      (entries): void => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { root: scrollRef.current, rootMargin: '200px' },
    );
    observer.observe(sentinel);
    return (): void => observer.disconnect();
  }, [hasMore, hasDrafts, loadMore]);

  const isEmpty = ticketDrafts.length === 0 && composeDrafts.length === 0;
  const initialLoading = firstPageDetails.type !== 'complete' && isEmpty;

  return (
    <div className='h-full flex flex-col bg-background'>
      <div className='flex-shrink-0 h-14 border-b border-border flex items-center justify-between px-4'>
        <div className='flex items-center gap-2 font-semibold'>
          <Pencil size={16} className='text-muted-foreground' />
          <span className='text-base'>Drafts</span>
        </div>
        <button
          onClick={onClose}
          className='p-1.5 rounded hover:bg-muted text-muted-foreground transition-colors'
          aria-label='Close user drafts view'
          title='Close'
          data-track-category='Support'
          data-track-name='CloseDeskUserDrafts'
        >
          <X size={16} />
        </button>
      </div>

      <div ref={scrollRef} className='flex-1 min-h-0 overflow-y-auto'>
        {initialLoading ? (
          <div className='h-full flex items-center justify-center text-muted-foreground'>
            <Loader2 size={18} className='animate-spin' />
          </div>
        ) : isEmpty ? (
          <div className='h-full flex flex-col items-center justify-center gap-2 text-center text-muted-foreground px-6'>
            <FileText size={26} className='text-muted-foreground/70' />
            <p className='text-sm font-medium text-foreground'>No drafts yet</p>
            <p className='text-xs text-muted-foreground max-w-sm'>
              Drafts you save while replying or composing in this desk will show up here.
            </p>
          </div>
        ) : (
          <div className='flex flex-col'>
            {composeDrafts.length > 0 && (
              <div className='px-4 py-2 border-b border-border/60'>
                <div className='text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1.5'>
                  New emails
                </div>
                <div className='flex flex-col gap-1'>
                  {composeDrafts.map(d => (
                    <div
                      key={d.id}
                      className='flex items-center gap-1 rounded-md hover:bg-muted/50 transition-colors group'
                    >
                      <button
                        type='button'
                        onClick={() => onReopenCompose(d.id)}
                        className='flex-1 min-w-0 text-left px-2 py-1.5 text-sm truncate'
                        title={`Reopen draft: ${d.label}`}
                        data-track-category='Support'
                        data-track-name='ReopenDraft'
                      >
                        {d.label}
                      </button>
                      <button
                        type='button'
                        onClick={() => onDiscardCompose(d.id)}
                        className='p-1 mr-1 rounded text-muted-foreground hover:text-destructive transition-colors shrink-0'
                        aria-label='Discard draft'
                        title='Discard draft'
                        data-track-category='Support'
                        data-track-name='DiscardDraft'
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {ticketDrafts.map(d => (
              <button
                key={d.draftId}
                type='button'
                onClick={() =>
                  onOpenTicket({
                    channelId,
                    ticketXyneId: d.ticketXyneId,
                    ticketId: d.ticketId,
                    conversationId: d.conversationId,
                  })
                }
                className='flex flex-col gap-0.5 px-4 py-2.5 border-b border-border/60 hover:bg-muted/50 transition-colors text-left'
                data-track-category='Support'
                data-track-name='OpenUserDraftTicket'
              >
                <div className='text-sm font-medium truncate'>{d.title}</div>
                {d.snippet && (
                  <div className='text-xs text-muted-foreground truncate'>{d.snippet}</div>
                )}
              </button>
            ))}

            {hasMore && hasDrafts && (
              <div
                ref={sentinelRef}
                className='flex items-center justify-center py-3 text-muted-foreground'
              >
                {isLoadingMore && <Loader2 size={14} className='animate-spin' />}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
