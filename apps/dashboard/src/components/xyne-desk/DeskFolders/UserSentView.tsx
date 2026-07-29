import { ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Send, X, Loader2 } from 'lucide-react';
import type { QueryResultType } from '@rocicorp/zero';
import { queries } from '../../../zero/queries';
import { useZero } from '../../../hooks/useZero';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { stripHtml } from '../EmailComposer/helpers';
import { cn } from '../../../utils/classNames';

type SentScope = 'mine' | 'channel';

/**
 * Per-desk "Sent" view. Lists outbound emails for a channel (REPLY / REPLY_ALL /
 * COMPOSE), paginated the same way as the Drafts view (UserDraftsView): the first
 * page is subscribed reactively, older pages are fetched imperatively on scroll
 * via a keyset cursor on (createdAt, id) and accumulated client-side.
 *
 * Rows are collapsed by conversation (Gmail-style): a thread with several sent
 * replies shows once, as its most recent send. Because the raw query returns one
 * row per email, the keyset cursor is taken from the oldest raw email loaded — NOT
 * the last visible (collapsed) row — otherwise paging would stall on a thread that
 * already has a row instead of advancing through its older replies. This is the
 * one place Sent deliberately diverges from UserDraftsView (drafts don't collapse).
 */

const PAGE_SIZE = 20;

type SentRow = NonNullable<QueryResultType<typeof queries.userEmailsSent>[number]>;

interface SentItem {
  emailId: string;
  createdAt: number;
  ticketId: string;
  ticketXyneId: string;
  conversationId: string;
  title: string;
  snippet: string;
}

const toSentItem = (e: SentRow): SentItem | null => {
  const ticket = e.ticket;
  if (!ticket) return null;
  const recipients = Array.isArray(e.to) ? e.to : [];
  const bodySnippet = e.body ? stripHtml(e.body).replace(/\s+/g, ' ').trim().slice(0, 140) : '';
  return {
    emailId: e.id,
    createdAt: e.createdAt,
    ticketId: ticket.id,
    ticketXyneId: ticket.xyneId,
    conversationId: e.conversationId,
    title: e.subject?.trim() || ticket.title?.trim() || '(no subject)',
    snippet: recipients.length > 0 ? `To: ${recipients.join(', ')}` : bodySnippet,
  };
};

interface UserSentViewProps {
  channelId: string;
  onOpenTicket: (item: {
    channelId: string;
    ticketXyneId: string;
    ticketId: string;
    conversationId: string;
  }) => void;
  onClose: () => void;
}

export const UserSentView = ({
  channelId,
  onOpenTicket,
  onClose,
}: UserSentViewProps): ReactElement => {
  const zero = useZero();

  // 'mine' = only my sends; 'channel' = everyone's sends in this desk.
  const [scope, setScope] = useState<SentScope>('mine');

  // First page: reactive, fixed window. Older pages: imperative keyset fetches.
  const [firstPage, firstPageDetails] = useCachedQuery(
    queries.userEmailsSent({ channelId, limit: PAGE_SIZE, start: null, scope }),
  );
  const [olderPages, setOlderPages] = useState<SentRow[][]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const firstRows = useMemo<SentRow[]>(
    () => (firstPage as SentRow[] | undefined) ?? [],
    [firstPage],
  );

  // Cursor base for older pages = the oldest row in the reactive first window.
  // When it shifts (new sends land in the top window), the accumulated older
  // pages were fetched from a stale boundary, so reset and refetch. Also resets
  // when the channel changes (new desk = new data).
  const boundary = firstRows[firstRows.length - 1];
  const boundaryKey = boundary ? `${boundary.createdAt}:${boundary.id}` : '';
  useEffect(() => {
    setOlderPages([]);
    setHasMore(true);
  }, [channelId, scope, boundaryKey]);

  // Collapse by conversation (Gmail-style): keep only the most recent sent email
  // per conversation, so a thread with multiple replies appears as a single row.
  const sentItems = useMemo<SentItem[]>(() => {
    const all = [...firstRows, ...olderPages.flat()];
    const latestByConversation = new Map<string, SentRow>();
    for (const e of all) {
      const current = latestByConversation.get(e.conversationId);
      if (
        !current ||
        e.createdAt > current.createdAt ||
        (e.createdAt === current.createdAt && e.id > current.id)
      ) {
        latestByConversation.set(e.conversationId, e);
      }
    }
    const unique: SentItem[] = [];
    for (const e of latestByConversation.values()) {
      const item = toSentItem(e);
      if (item) unique.push(item);
    }
    unique.sort((a, b) => {
      if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
      return b.emailId.localeCompare(a.emailId);
    });
    return unique;
  }, [firstRows, olderPages]);

  // Keyset cursor base for older pages: the oldest RAW email loaded so far.
  // Because rows collapse by conversation, the last *visible* row is a thread's
  // latest send and can be far newer than the oldest email we've paged past;
  // cursoring off it would re-request the same window forever. The oldest raw row
  // makes every fetch (inclusive:false) strictly advance, guaranteeing termination.
  const oldestRaw = useMemo<SentRow | null>(() => {
    let oldest: SentRow | null = null;
    for (const e of [...firstRows, ...olderPages.flat()]) {
      if (
        !oldest ||
        e.createdAt < oldest.createdAt ||
        (e.createdAt === oldest.createdAt && e.id < oldest.id)
      ) {
        oldest = e;
      }
    }
    return oldest;
  }, [firstRows, olderPages]);

  // Keep the latest paging state in a ref so loadMore can stay referentially
  // stable — the IntersectionObserver effect then only re-runs on `hasMore`.
  const stateRef = useRef({ hasMore, isLoadingMore, oldestRaw });
  useEffect(() => {
    stateRef.current = { hasMore, isLoadingMore, oldestRaw };
  });

  const loadMore = useCallback(async () => {
    const { hasMore, isLoadingMore, oldestRaw } = stateRef.current;
    if (!hasMore || isLoadingMore || !oldestRaw) return;
    setIsLoadingMore(true);
    try {
      const next = (await zero.run(
        queries.userEmailsSent({
          channelId,
          limit: PAGE_SIZE,
          start: { id: oldestRaw.id, createdAt: oldestRaw.createdAt },
          scope,
        }),
        { type: 'complete' },
      )) as SentRow[];
      if (next.length === 0) {
        setHasMore(false);
      } else {
        setOlderPages(prev => [...prev, next]);
        if (next.length < PAGE_SIZE) setHasMore(false);
      }
    } finally {
      setIsLoadingMore(false);
    }
  }, [zero, channelId, scope]);

  // Auto-load on scroll: observe a sentinel near the bottom of the list.
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries): void => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { root: scrollRef.current, rootMargin: '200px' },
    );
    observer.observe(sentinel);
    return (): void => observer.disconnect();
  }, [hasMore, loadMore]);

  const isEmpty = sentItems.length === 0;
  const initialLoading = firstPageDetails.type !== 'complete' && isEmpty;

  return (
    <div className='h-full flex flex-col bg-background'>
      <div className='flex-shrink-0 h-14 border-b border-border flex items-center justify-between px-4'>
        <div className='flex items-center gap-2 font-semibold'>
          <Send size={16} className='text-muted-foreground' />
          <span className='text-base'>Sent</span>
        </div>
        <div className='flex items-center gap-2'>
          <div
            className='flex items-center rounded-md border border-border p-0.5 text-xs'
            role='tablist'
            aria-label='Sent scope'
          >
            {(['mine', 'channel'] as const).map(s => (
              <button
                key={s}
                type='button'
                role='tab'
                aria-selected={scope === s}
                onClick={() => setScope(s)}
                className={cn(
                  'px-2 py-1 rounded transition-colors',
                  scope === s
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                data-track-category='Support'
                data-track-name={s === 'mine' ? 'DeskSentScopeMine' : 'DeskSentScopeChannel'}
              >
                {s === 'mine' ? 'Me' : 'All'}
              </button>
            ))}
          </div>
          <button
            onClick={onClose}
            className='p-1.5 rounded hover:bg-muted text-muted-foreground transition-colors'
            aria-label='Close user sent view'
            title='Close'
            data-track-category='Support'
            data-track-name='CloseDeskUserSent'
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className='flex-1 min-h-0 overflow-y-auto'>
        {initialLoading ? (
          <div className='h-full flex items-center justify-center text-muted-foreground'>
            <Loader2 size={18} className='animate-spin' />
          </div>
        ) : isEmpty ? (
          <div className='h-full flex flex-col items-center justify-center gap-2 text-center text-muted-foreground px-6'>
            <Send size={26} className='text-muted-foreground/70' />
            <p className='text-sm font-medium text-foreground'>No sent emails yet</p>
            <p className='text-xs text-muted-foreground max-w-sm'>
              {scope === 'mine'
                ? 'Emails you send by replying or composing in this desk will show up here.'
                : 'Emails sent by anyone in this desk will show up here.'}
            </p>
          </div>
        ) : (
          <div className='flex flex-col'>
            {sentItems.map(e => (
              <button
                key={e.emailId}
                type='button'
                onClick={() =>
                  onOpenTicket({
                    channelId,
                    ticketXyneId: e.ticketXyneId,
                    ticketId: e.ticketId,
                    conversationId: e.conversationId,
                  })
                }
                className='flex flex-col gap-0.5 px-4 py-2.5 border-b border-border/60 hover:bg-muted/50 transition-colors text-left'
                data-track-category='Support'
                data-track-name='OpenUserSentTicket'
              >
                <div className='text-sm font-medium truncate'>{e.title}</div>
                {e.snippet && (
                  <div className='text-xs text-muted-foreground truncate'>{e.snippet}</div>
                )}
              </button>
            ))}

            {hasMore && sentItems.length > 0 && (
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

UserSentView.displayName = 'UserSentView';
