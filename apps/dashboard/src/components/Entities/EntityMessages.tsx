import { JSX, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { MessageType } from '@xyne/shared';
import { apiInstance } from '../../services/clients/apiClient';
import { SearchResultMessageCard } from '../Chat/SearchResults/SearchResultMessageCard';
import { SearchResultsContext } from '../Chat/SearchResults/SearchResultsContext';
import EntityRemarksDialog from './EntityRemarksDialog';
import { cn } from '../../utils/classNames';
import type { VespaSearchGroup, VespaSearchResponse } from '../../types/search';
import {
  entitiesApi,
  type EntityFeedback,
  type EntityListItem,
  type EntityVerdict,
} from '../../api/entitiesApi';

/**
 * What the side panel should show, mirroring SearchResults' own panel state.
 *
 * The distinction matters: a conversation WITH replies opens as a thread, while a
 * standalone message opens its channel context instead. SearchResultMessageCard
 * already branches on replyCount and calls a different context callback for each,
 * so collapsing both into one panel kind makes a lone message render as a thread.
 */
export type SelectedPanel =
  | { kind: 'thread'; channelId: string; conversationId: string; matchedMessageId: string | null }
  | {
      kind: 'channel';
      channelId: string;
      conversationId: string;
      conversationCreatedAt?: number;
      matchedMessageId: string | null;
    };

interface EntityMessagesProps {
  entity: EntityListItem;
  onSelectPanel: (panel: SelectedPanel) => void;
}

/** Threads per page. Grouped responses are paged by slicing the group prefix. */
const PAGE_SIZE = 20;

/**
 * Does this message literally name the entity?
 *
 * Matched against the entity's ALIAS list from the registry, not its canonical
 * name: aliases are exactly the spellings that resolve to this entity, including
 * the fuzzy ones a substring test would miss ("zakpay" resolves to "Zaakpay" but
 * shares no prefix).
 */
const namesEntity = (text: string, entity: EntityListItem): boolean => {
  const needles = [...new Set([entity.canonicalName, ...entity.aliases])].filter(n => n.length > 1);
  const lower = text.toLowerCase();
  return needles.some(n => lower.includes(n.toLowerCase()));
};

/**
 * The threads an entity was extracted from.
 *
 * Calls `/api/vespaSearch` directly rather than through `searchService.vespaSearch`
 * for one reason: that helper flattens grouped responses and drops rows with
 * `relevanceScore > 0`. A filter-only query is unranked and every hit scores 0, so
 * it would discard the entire result set. Going direct also keeps the request
 * visible as-is in the network tab.
 *
 * Rows are `SearchResultMessageCard`, the same card the full search screen uses.
 * It reads its click handlers off `SearchResultsContext`, so providing
 * `onSelectThread` here is all the wiring the side panel needs.
 *
 * Paged by `offset`: Vespa's top-level offset paginates hits rather than grouping
 * buckets, so the backend fetches the group prefix and slices the requested page —
 * the same mechanism Desk mail uses (vespaSearch/index.ts:921).
 */
export const EntityMessages = ({ entity, onSelectPanel }: EntityMessagesProps): JSX.Element => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ['entity-threads', entity.id],
      queryFn: async ({ pageParam }) => {
        const res = await apiInstance.get<VespaSearchResponse>('/vespaSearch', {
          params: {
            q: '',
            filterOnly: true,
            apps: 'chat',
            type: 'messages',
            entityId: entity.id,
            groupBy: 'threadId',
            offset: pageParam,
            limit: PAGE_SIZE,
          },
        });
        if (!res.data.success) throw new Error(res.data.error || 'Search failed');
        return res.data.data;
      },
      initialPageParam: 0,
      // totalCount on a grouped response counts MESSAGES, not groups, so it cannot
      // say when threads run out. A short page is the end-of-results signal.
      getNextPageParam: (lastPage, allPages) => {
        const groups = lastPage.groups?.length ?? 0;
        if (groups < PAGE_SIZE) return undefined;
        return allPages.reduce((n, p) => n + (p.groups?.length ?? 0), 0);
      },
    });

  const totalMessages = data?.pages?.[0]?.totalCount ?? 0;

  // One card per thread, showing its ROOT message. Rendering every message would
  // mount a ChatBubble per row, and ChatBubble fetches channel shortcuts per
  // instance (ChatBubble.tsx:198) — one HTTP request each.
  const rows = useMemo(
    () =>
      (data?.pages.flatMap(p => p.groups ?? []) ?? [])
        .map((group: VespaSearchGroup) => {
          const root = group.results.find(r => r.searchContext?.isRootMessage) ?? group.results[0];
          if (!root?.searchContext?.channelId) return null;
          // Anchor on a message that actually names the entity, so the panel opens
          // scrolled to the mention rather than the top of the thread.
          const naming = group.results.find(r => namesEntity(r.context ?? '', entity));
          return {
            conversationId: group.groupValue,
            root,
            // The card renders `displayMessageId ?? matchedMessageId`, so these must
            // be passed separately: the ROOT is what the card should show, while the
            // matched message is only where the side panel scrolls to. Passing the
            // matched id alone makes the card render a mid-thread reply.
            displayMessageId: root.searchContext.messageId ?? null,
            matchedMessageId:
              naming?.searchContext?.messageId ?? root.searchContext.messageId ?? null,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null),
    [data, entity],
  );

  // Latest paging state, read inside the observer callback. Kept in a ref so the
  // observer is created ONCE: depending on isFetchingNextPage would tear it down and
  // re-observe after every page, and re-observing an already-visible sentinel fires
  // immediately — which turns one click into a burst of requests.
  const pagingRef = useRef({ hasNextPage, isFetchingNextPage, fetchNextPage });
  pagingRef.current = { hasNextPage, isFetchingNextPage, fetchNextPage };

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root) return;

    const observer = new IntersectionObserver(
      entries => {
        if (!entries[0]?.isIntersecting) return;
        const {
          hasNextPage: more,
          isFetchingNextPage: busy,
          fetchNextPage: next,
        } = pagingRef.current;
        if (more && !busy) void next();
      },
      { root, threshold: 0.1 },
    );

    observer.observe(sentinel);
    return (): void => observer.disconnect();
  }, []);

  const queryClient = useQueryClient();
  /** The message a rejection is being written for; null when the dialog is closed. */
  const [rejecting, setRejecting] = useState<{ messageId: string; text: string } | null>(null);

  // One fetch per entity rather than per card: the client only needs to look
  // feedback up by messageId, and an entity's review set is small.
  const { data: feedbackData } = useQuery({
    queryKey: ['entity-feedback', entity.id],
    queryFn: () => entitiesApi.listFeedback(entity.id),
  });

  const feedback = useMemo(() => feedbackData?.feedback ?? [], [feedbackData]);
  const currentUserId = feedbackData?.currentUserId ?? '';

  /**
   * messageId → every reviewer's verdict on it, with the viewer's own separated out.
   * Reviewers each get their own row, so a message can carry disagreement; the card
   * shows your verdict and counts the rest.
   */
  const feedbackByMessage = useMemo(() => {
    const map = new Map<string, { mine?: EntityFeedback; approved: number; rejected: number }>();
    for (const row of feedback) {
      const bucket = map.get(row.messageId) ?? { approved: 0, rejected: 0 };
      if (row.verdict === 'APPROVED') bucket.approved++;
      else bucket.rejected++;
      if (row.createdBy === currentUserId) bucket.mine = row;
      map.set(row.messageId, bucket);
    }
    return map;
  }, [feedback, currentUserId]);

  const feedbackMutation = useMutation({
    mutationFn: ({
      messageId,
      verdict,
      remarks,
    }: {
      messageId: string;
      verdict: EntityVerdict;
      remarks?: string;
    }) => entitiesApi.setFeedback(entity.id, messageId, verdict, remarks),
    onSuccess: result => {
      toast.success(
        result.verdict === 'APPROVED'
          ? `Approved “${entity.canonicalName}” on this message`
          : `Rejected “${entity.canonicalName}” on this message`,
      );
      setRejecting(null);
      void queryClient.invalidateQueries({ queryKey: ['entity-feedback', entity.id] });
    },
    onError: (error: unknown) => {
      const message =
        error && typeof error === 'object' && 'response' in error
          ? ((error as { response?: { data?: { error?: string } } }).response?.data?.error ??
            'Failed to save feedback')
          : 'Failed to save feedback';
      toast.error(message);
    },
  });

  const contextValue = useMemo(
    () => ({
      // Conversations WITH replies — open the thread panel.
      onSelectThread: (thread: {
        channelId: string;
        conversationId: string;
        matchedMessageId?: string | null;
      }): void =>
        onSelectPanel({
          kind: 'thread',
          channelId: thread.channelId,
          conversationId: thread.conversationId,
          matchedMessageId: thread.matchedMessageId ?? null,
        }),
      // Standalone messages (replyCount 0) — open channel context, not a thread.
      onSelectChannelContext: (
        channelId: string,
        conversationId: string,
        conversationCreatedAt?: number,
        matchedMessageId?: string | null,
      ): void =>
        onSelectPanel({
          kind: 'channel',
          channelId,
          conversationId,
          ...(conversationCreatedAt !== undefined ? { conversationCreatedAt } : {}),
          matchedMessageId: matchedMessageId ?? null,
        }),
    }),
    [onSelectPanel],
  );

  return (
    <div className='flex flex-col h-full min-h-0 overflow-hidden'>
      {/* Spec: padding 16px 20px 14px, name 17px/600 with tight tracking. */}
      <div className='px-5 pt-4 pb-3.5 border-b border-border shrink-0'>
        <h2 className='text-[17px] font-semibold tracking-[-0.01em]'>{entity.canonicalName}</h2>
        {/*
          Threads and messages are different units — `rows.length` counts groups,
          while a grouped response's totalCount counts the messages inside them. The
          earlier "N of M messages" implied N was a subset of M and looked stuck at
          the end of the list, so label each count for what it is.
        */}
        <p className='text-xs text-muted-foreground mt-0.5'>
          {entity.type}
          {rows.length > 0 &&
            ` · ${rows.length}${hasNextPage ? '+' : ''} thread${rows.length === 1 ? '' : 's'}`}
          {totalMessages > 0 && ` · ${totalMessages} message${totalMessages === 1 ? '' : 's'}`}
          {/* Distinct messages, not feedback rows: reviewers each get their own row,
              so counting rows overstates as soon as two people review one message. */}
          {feedbackByMessage.size > 0 && ` · ${feedbackByMessage.size} reviewed`}
        </p>
      </div>

      {/*
        The card keeps its own box; only its "Open in home" button
        (SearchResultMessageCard:305) is hidden — a search-screen affordance that is
        redundant here, since clicking the card already opens the conversation in the
        side panel. Scoped so no other screen is affected.
      */}
      <style>{`
        .entity-results [aria-label="Open in home"] { display: none; }
        /*
          Card metrics from the design spec: 84px floor, 8px radius, #e7e5e4 border.
          In the spec the timestamp and the ✓/✕ share one right-hand grid column
          (space-between, so time on top and buttons at the bottom). The shared card
          owns its own layout, so the buttons are positioned into that same corner
          instead — padding-bottom reserves the strip they occupy.

          These live on the CARD, not the wrapper: the wrapper must hug the card
          exactly, or a short card leaves dead space and the buttons fall outside it.
        */
        .entity-results [data-track-name="OPEN_SEARCH_MESSAGE"] {
          min-height: 84px;
          /*
            Only a hairline of breathing room, NOT a reserved strip. In the spec the
            buttons occupy a grid column beside the content and cost no height at
            all; padding here to clear them just makes every card taller than the
            reference. With this small, the 84px floor is what governs a short card
            — which is exactly the spec's number.
          */
          padding-bottom: 6px;
          border-radius: 8px;
        }
      `}</style>

      {/*
        Block layout with space-y, NOT `flex flex-col`: as flex children the cards
        pick up the default `flex-shrink: 1` and get squashed to fit the container,
        clipping their message text mid-line.
      */}
      <div
        ref={scrollRef}
        // Spec: padding 14px 20px 32px, 10px between cards.
        className='entity-results flex-1 min-h-0 overflow-y-auto px-5 pt-3.5 pb-8 space-y-2.5'
      >
        {isLoading && <p className='text-xs text-muted-foreground p-4'>Loading threads…</p>}

        {isError && (
          <p className='text-xs text-destructive p-4'>Could not load messages for this entity.</p>
        )}

        {!isLoading && !isError && rows.length === 0 && (
          <p className='text-xs text-muted-foreground p-4'>
            No messages you have access to carry this entity.
          </p>
        )}

        <SearchResultsContext.Provider value={contextValue}>
          {rows.map(row => {
            // Feedback is keyed on the message the card renders — its thread root.
            const reviewedId = row.displayMessageId ?? row.matchedMessageId;
            const bucket = reviewedId ? feedbackByMessage.get(reviewedId) : undefined;
            const existing = bucket?.mine;
            // Verdicts from other reviewers on this same message.
            const othersApproved =
              (bucket?.approved ?? 0) - (existing?.verdict === 'APPROVED' ? 1 : 0);
            const othersRejected =
              (bucket?.rejected ?? 0) - (existing?.verdict === 'REJECTED' ? 1 : 0);
            const others = othersApproved + othersRejected;
            const messageText = row.root.context ?? '';

            return (
              // `relative group/verdict` wraps the shared card so the approve/reject
              // controls can be overlaid on hover without the card needing new props.
              // `data-prevent-thread` stops a click on them bubbling into the card's
              // own handler and opening the side panel.
              // Fixed height so the list scans as a uniform grid rather than a ragged
              // stack — message length varies from one line to a paragraph. The card
              // itself is untouched; the wrapper clips it.
              // Wrapper hugs the card exactly — no height of its own. Give it one and
              // a short card leaves dead space beneath, dropping the absolutely
              // positioned buttons below outside the card's border.
              <div key={row.conversationId} className='relative'>
                <SearchResultMessageCard
                  channelId={row.root.searchContext!.channelId!}
                  conversationId={row.conversationId}
                  matchedMessageId={row.matchedMessageId}
                  {...(row.displayMessageId ? { displayMessageId: row.displayMessageId } : {})}
                  searchSnippet={row.root.context ?? ''}
                  searchThread={{
                    isRootMessage: row.root.searchContext?.isRootMessage ?? true,
                    replyCount: row.root.searchContext?.replyCount ?? 0,
                    senderId: row.root.searchContext?.senderId ?? '',
                    msgType: (row.root.searchContext?.msgType as MessageType) ?? MessageType.USER,
                    createdAt: row.root.searchContext?.createdAtTimestamp ?? 0,
                    ...(row.root.searchContext?.threadSenders
                      ? { threadSenders: row.root.searchContext.threadSenders }
                      : {}),
                    ...(row.root.searchContext?.attachmentIds
                      ? { attachmentIds: row.root.searchContext.attachmentIds }
                      : {}),
                  }}
                />

                {/*
                Bottom-right of the card, level with the replies indicator on the
                left — the row the card leaves empty on that side. Always visible,
                because the colour IS the verdict: hiding them until hover would hide
                the state along with the control. `data-prevent-thread` stops a click
                here from also opening the side panel.
              */}
                <div
                  data-prevent-thread
                  title={
                    existing?.verdict === 'REJECTED' && existing.remarks
                      ? existing.remarks
                      : others > 0
                        ? `${othersApproved} approved, ${othersRejected} rejected by others`
                        : undefined
                  }
                  className='absolute bottom-3 right-4 z-20 flex items-center gap-[5px]'
                >
                  <button
                    type='button'
                    title='Correct on this message'
                    aria-label='Approve this entity on this message'
                    aria-pressed={existing?.verdict === 'APPROVED'}
                    disabled={feedbackMutation.isPending || !reviewedId}
                    onClick={event => {
                      event.stopPropagation();
                      if (reviewedId) {
                        feedbackMutation.mutate({ messageId: reviewedId, verdict: 'APPROVED' });
                      }
                    }}
                    data-track-category='Entities'
                    data-track-name='ApproveEntityOnMessage'
                    // Exact palette from the design spec. Dark-mode fallbacks use the
                    // theme tokens, since the spec is light-only.
                    className={cn(
                      'flex size-6 items-center justify-center rounded-[5px] border transition-colors disabled:opacity-50',
                      existing?.verdict === 'APPROVED'
                        ? 'border-[#9fd4ba] bg-[#eefaf3] text-[#16794c] dark:border-green-600/60 dark:bg-green-600/15 dark:text-green-500'
                        : 'border-[#e4e4e7] bg-white text-[#a1a1aa] hover:border-[#16794c] hover:text-[#16794c] dark:border-border dark:bg-background dark:text-muted-foreground',
                    )}
                  >
                    <Check size={13} strokeWidth={2} />
                  </button>
                  <button
                    type='button'
                    title='Wrong on this message'
                    aria-label='Reject this entity on this message'
                    aria-pressed={existing?.verdict === 'REJECTED'}
                    disabled={feedbackMutation.isPending || !reviewedId}
                    onClick={event => {
                      event.stopPropagation();
                      if (reviewedId) setRejecting({ messageId: reviewedId, text: messageText });
                    }}
                    data-track-category='Entities'
                    data-track-name='RejectEntityOnMessage'
                    className={cn(
                      'flex size-6 items-center justify-center rounded-[5px] border transition-colors disabled:opacity-50',
                      existing?.verdict === 'REJECTED'
                        ? 'border-[#eeb4ae] bg-[#fdf1f0] text-[#b42318] dark:border-destructive/60 dark:bg-destructive/15 dark:text-destructive'
                        : 'border-[#e4e4e7] bg-white text-[#a1a1aa] hover:border-[#b42318] hover:text-[#b42318] dark:border-border dark:bg-background dark:text-muted-foreground',
                    )}
                  >
                    <X size={13} strokeWidth={2} />
                  </button>
                </div>
              </div>
            );
          })}
        </SearchResultsContext.Provider>

        {/* Always mounted: the observer is created once on mount, so a sentinel
            that unmounts with hasNextPage would leave nothing to observe. */}
        <div ref={sentinelRef} className='h-1' aria-hidden='true' />

        {isFetchingNextPage && (
          <div className='flex items-center justify-center gap-2 p-3 text-xs text-muted-foreground'>
            <Loader2 className='size-3.5 animate-spin' />
            Loading more threads…
          </div>
        )}
      </div>

      {rejecting && (
        <EntityRemarksDialog
          open
          onOpenChange={next => !next && setRejecting(null)}
          entity={entity}
          messageText={rejecting.text}
          saving={feedbackMutation.isPending}
          onConfirm={remarks =>
            feedbackMutation.mutate({
              messageId: rejecting.messageId,
              verdict: 'REJECTED',
              remarks,
            })
          }
        />
      )}
    </div>
  );
};

export default EntityMessages;
