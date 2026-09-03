import {
  ReactElement,
  useState,
  useEffect,
  useCallback,
  useMemo,
  memo,
  forwardRef,
  useRef,
} from 'react';
import { MessageCircle, Hash, Loader2 } from 'lucide-react';
import { Virtuoso, Components } from 'react-virtuoso';
import { useAuthContext } from '../../../providers/AuthProvider';
import ThreadMessages from '../ThreadPannel';
import { useChannel } from '../../../hooks/useChannels';
import { ChannelScopeType, ChannelVisibility } from '@xyne/shared';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import ChatLock from '../../icons/ChatLock';
import { useNavigate, useParams, Outlet } from 'react-router-dom';
import { usePlatform } from '../../../hooks/usePlatform';
import {
  conversationService,
  ThreadListEntry,
  ThreadListSort,
} from '../../../services/Chat/conversationService';
import { useUnreadThreadConversationIds } from '../../../hooks/useUnreadThreadsCount';
import { TwinDraftIndicator } from '../TwinReplyDraft/TwinDraftIndicator';
import { Button } from '../../ui/Button/Button';

const PAGE_SIZE = 10;
const THREAD_LIST_SORT_STORAGE_PREFIX = 'xyne:user-threads-sort';

interface ThreadListSortSelection {
  userId: string;
  sortMode: ThreadListSort;
}

const threadListSortStorageKey = (userId: string): string =>
  `${THREAD_LIST_SORT_STORAGE_PREFIX}:${userId}`;

const readStoredThreadListSort = (userId: string | undefined): ThreadListSort => {
  if (!userId || typeof window === 'undefined') return 'sections';

  try {
    const storedSortMode = window.localStorage.getItem(threadListSortStorageKey(userId));
    return storedSortMode === 'sections' || storedSortMode === 'recent'
      ? storedSortMode
      : 'sections';
  } catch {
    return 'sections';
  }
};

const persistThreadListSort = (userId: string, sortMode: ThreadListSort): void => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(threadListSortStorageKey(userId), sortMode);
  } catch {
    // localStorage unavailable/full — keep the selection for this session.
  }
};

// Optimize ThreadRow with memo to prevent unnecessary re-renders of existing rows
// during scrolling or when new data loads at the bottom.
const ThreadRow = memo(
  ({
    channelId,
    conversationId,
    userId,
  }: {
    channelId: string;
    conversationId: string;
    userId: string;
  }): ReactElement => {
    const channel = useChannel(channelId);
    const navigate = useNavigate();
    const { displayName, avatarUserId } = useChannelDisplayName(channel, userId);
    const isPrivate = channel?.visibility === ChannelVisibility.PRIVATE;
    const isDM = channel?.scopeType === ChannelScopeType.DM;

    const getIcon = (): ReactElement => {
      if (isDM && avatarUserId) {
        return <div className='w-2.5 h-2.5 rounded-full border-2 border-border' />;
      }
      return isPrivate ? <ChatLock color='hsl(var(--foreground))' /> : <Hash size={16} />;
    };

    return (
      <div className='flex flex-col gap-2'>
        <div className='flex flex-col gap-1'>
          <div className='flex items-center gap-2'>
            <span className='opacity-70'>{getIcon()}</span>
            <button
              onClick={() =>
                void navigate(`/chat/dir/${channelId}/${conversationId}#origin=${conversationId}`)
              }
              className='text-base font-semibold text-foreground hover:underline'
              data-track-category='USER_THREADS'
              data-track-name='OPEN_USER_THREAD'
              data-track-metadata={JSON.stringify({ channelId, conversationId })}
            >
              {displayName}
            </button>
            <TwinDraftIndicator conversationId={conversationId} />
          </div>
        </div>
        <div className='border border-border rounded-xl overflow-hidden bg-card shadow-sm'>
          <div className='bg-card'>
            <ThreadMessages
              channelId={channelId}
              conversationId={conversationId}
              showHeader={false}
              previewCardMode
            />
          </div>
        </div>
      </div>
    );
  },
);

ThreadRow.displayName = 'ThreadRow';

// Define static components OUTSIDE the main component.
// Ensures their reference never changes, preventing full DOM tear-downs.
const ListContainer: Components['List'] = forwardRef(({ children, ...props }, ref) => (
  <div {...props} ref={ref} className='mx-auto flex w-full flex-col gap-10 px-4 py-6'>
    {children}
  </div>
));
ListContainer.displayName = 'ListContainer';

type ThreadListRenderItem =
  | { kind: 'thread'; thread: ThreadListEntry }
  | { kind: 'divider'; id: 'read-divider' };

const ReadDivider = memo(
  (): ReactElement => (
    <div className='flex items-center gap-3 py-2' role='separator'>
      <div className='h-px flex-1 bg-border' />
      <span className='text-sm font-medium text-muted-foreground'>You&apos;re up-to-date</span>
      <div className='h-px flex-1 bg-border' />
    </div>
  ),
);
ReadDivider.displayName = 'ReadDivider';

const UserThreads = (): ReactElement => {
  const { user } = useAuthContext();
  const navigate = useNavigate();
  const params = useParams<{ channelId?: string; conversationId?: string }>();
  const { isMobile } = usePlatform();
  const showThreadPanel = !!params.conversationId;
  const unreadThreadConversationIds = useUnreadThreadConversationIds();

  const handleCloseThreadPanel = useCallback((): void => {
    void navigate('/chat/dir/threads');
  }, [navigate]);

  const [allConversations, setAllConversations] = useState<ThreadListEntry[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const userId = user?.id;
  const persistedSortMode = useMemo(() => readStoredThreadListSort(userId), [userId]);
  const [sortSelection, setSortSelection] = useState<ThreadListSortSelection | null>(null);
  const sortMode =
    sortSelection && sortSelection.userId === userId ? sortSelection.sortMode : persistedSortMode;
  const hasConversations = allConversations.length > 0;
  const seenConversationIdsRef = useRef(new Set<string>());
  const nextCursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef(true);
  const isLoadingRef = useRef(false);
  const generationRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);

  const handleSortModeChange = useCallback(
    (nextSortMode: ThreadListSort): void => {
      if (!userId) return;

      setSortSelection({ userId, sortMode: nextSortMode });
      persistThreadListSort(userId, nextSortMode);
    },
    [userId],
  );

  const loadNextUniquePage = useCallback(
    async (startCursor: string | null, generation: number, initialLoad: boolean): Promise<void> => {
      if (!user?.id || isLoadingRef.current || !hasMoreRef.current) return;

      isLoadingRef.current = true;
      setLoadError(null);
      if (initialLoad) {
        setIsInitialLoading(true);
      } else {
        setIsLoadingMore(true);
      }

      const abortController = new AbortController();
      requestAbortRef.current = abortController;
      const cursorsVisitedDuringLoad = new Set<string>();
      let pageCursor = startCursor;

      try {
        do {
          const cursorKey = pageCursor ?? '__first_page__';
          if (cursorsVisitedDuringLoad.has(cursorKey)) {
            hasMoreRef.current = false;
            setLoadError('Thread pagination stopped because the server repeated a cursor.');
            return;
          }
          cursorsVisitedDuringLoad.add(cursorKey);

          const page = await conversationService.getUserThreads(
            pageCursor,
            PAGE_SIZE,
            abortController.signal,
            sortMode,
          );
          if (generationRef.current !== generation || abortController.signal.aborted) return;

          const uniqueThreads = page.threads.filter((thread): boolean => {
            if (seenConversationIdsRef.current.has(thread.conversationId)) return false;
            seenConversationIdsRef.current.add(thread.conversationId);
            return true;
          });

          if (uniqueThreads.length > 0) {
            setAllConversations(previous => [...previous, ...uniqueThreads]);
          }

          const canContinue =
            page.hasMore && page.nextCursor !== null && page.nextCursor !== pageCursor;
          nextCursorRef.current = canContinue ? page.nextCursor : null;
          hasMoreRef.current = canContinue;

          // A page may contain only rows already loaded because their live sort fields changed.
          // Walk through such pages until we append something or reach the end.
          if (uniqueThreads.length > 0 || !canContinue) return;
          pageCursor = page.nextCursor;
        } while (pageCursor !== null);
      } catch {
        if (!abortController.signal.aborted && generationRef.current === generation) {
          setLoadError('Unable to load threads. Please try again.');
        }
      } finally {
        if (generationRef.current === generation) {
          isLoadingRef.current = false;
          setIsInitialLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    [user?.id, sortMode],
  );

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    requestAbortRef.current?.abort();
    seenConversationIdsRef.current = new Set();
    nextCursorRef.current = null;
    hasMoreRef.current = true;
    isLoadingRef.current = false;
    setAllConversations([]);
    setLoadError(null);

    if (!user?.id) {
      setIsInitialLoading(false);
      return;
    }

    void loadNextUniquePage(null, generation, true);
    return (): void => requestAbortRef.current?.abort();
  }, [loadNextUniquePage, user?.id]);

  const loadMore = useCallback((): void => {
    if (!hasMoreRef.current || isLoadingRef.current) return;
    void loadNextUniquePage(nextCursorRef.current, generationRef.current, false);
  }, [loadNextUniquePage]);

  const retryLoad = useCallback((): void => {
    if (isLoadingRef.current) return;
    hasMoreRef.current = true;
    void loadNextUniquePage(nextCursorRef.current, generationRef.current, !hasConversations);
  }, [hasConversations, loadNextUniquePage]);

  const renderItems = useMemo<ThreadListRenderItem[]>(() => {
    const items: ThreadListRenderItem[] = [];
    let addedReadDivider = false;
    const hasUnreadAtLoadThread = allConversations.some(
      thread => thread.sectionAtLoad === 'unread',
    );
    const hasReadAtLoadThreadTurnedUnread = allConversations.some(
      thread =>
        thread.sectionAtLoad === 'read' && unreadThreadConversationIds.has(thread.conversationId),
    );
    const shouldShowDivider =
      sortMode === 'sections' && hasUnreadAtLoadThread && !hasReadAtLoadThreadTurnedUnread;

    for (const thread of allConversations) {
      if (thread.sectionAtLoad === 'read' && shouldShowDivider && !addedReadDivider) {
        items.push({ kind: 'divider', id: 'read-divider' });
        addedReadDivider = true;
      }
      items.push({ kind: 'thread', thread });
    }

    return items;
  }, [allConversations, unreadThreadConversationIds, sortMode]);

  // Memoize the itemContent callback
  const itemContent = useCallback(
    (_index: number, item: ThreadListRenderItem) =>
      item.kind === 'divider' ? (
        <ReadDivider />
      ) : (
        <ThreadRow
          channelId={item.thread.channelId}
          conversationId={item.thread.conversationId}
          userId={user?.id ?? ''}
        />
      ),
    [user?.id],
  );

  // Memoize components that depend on local state (like Footer uses hasMore)
  const VirtuosoComponents = useMemo(
    () => ({
      List: ListContainer,
      Footer: (): ReactElement => (
        <div className='flex min-h-10 justify-center py-4'>
          {isLoadingMore && <Loader2 className='animate-spin text-muted-foreground' />}
          {loadError && hasConversations && (
            <Button
              variant='link'
              className='text-sm text-primary hover:underline'
              onClick={retryLoad}
              trackId='retry_thread_list_page'
              data-track-category='USER_THREADS'
              data-track-name='RETRY_THREAD_LIST_PAGE'
            >
              Try loading more again
            </Button>
          )}
        </div>
      ),
    }),
    [hasConversations, isLoadingMore, loadError, retryLoad],
  );

  return (
    <div className='flex h-full w-full bg-background pt-14 [@media(min-width:500px)]:pt-0'>
      <div
        className={`flex flex-col bg-background ${
          showThreadPanel ? (isMobile ? 'hidden' : 'w-1/2 border-r border-border') : 'w-full'
        }`}
      >
        <div className='relative z-30 shrink-0 px-6 py-4 border-b border-border/50 bg-background flex items-center justify-between'>
          <div className='flex items-center gap-2 text-foreground'>
            <MessageCircle className='w-5 h-5 text-primary' />
            <h1 className='text-lg font-semibold tracking-tight'>Threads</h1>
          </div>
          <div className='inline-flex items-center rounded-md border border-border p-0.5 text-sm'>
            <button
              type='button'
              onClick={(): void => handleSortModeChange('sections')}
              className={`rounded px-2.5 py-1 transition-colors ${
                sortMode === 'sections'
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              aria-pressed={sortMode === 'sections'}
              data-track-category='USER_THREADS'
              data-track-name='SORT_UNREAD_FIRST'
            >
              Unread first
            </button>
            <button
              type='button'
              onClick={(): void => handleSortModeChange('recent')}
              className={`rounded px-2.5 py-1 transition-colors ${
                sortMode === 'recent'
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              aria-pressed={sortMode === 'recent'}
              data-track-category='USER_THREADS'
              data-track-name='SORT_MOST_RECENT'
            >
              Most recent
            </button>
          </div>
        </div>
        <div className='flex-1'>
          {isInitialLoading && !hasConversations ? (
            <div className='flex h-full items-center justify-center'>
              <Loader2 className='animate-spin text-muted-foreground' />
            </div>
          ) : loadError && !hasConversations ? (
            <div className='flex h-full flex-col items-center justify-center gap-3 p-8 text-center'>
              <p className='text-muted-foreground'>{loadError}</p>
              <Button
                variant='link'
                className='text-sm text-primary hover:underline'
                onClick={retryLoad}
                trackId='retry_thread_list'
                data-track-category='USER_THREADS'
                data-track-name='RETRY_THREAD_LIST'
              >
                Try again
              </Button>
            </div>
          ) : !hasConversations ? (
            <div className='flex flex-col items-center justify-center h-full p-8 text-center'>
              <MessageCircle className='text-muted-foreground mb-4' size={64} />
              <p className='text-muted-foreground text-xl font-semibold mb-2'>No threads yet</p>
            </div>
          ) : (
            <Virtuoso
              style={{ height: '100%' }}
              data={renderItems}
              endReached={loadMore}
              increaseViewportBy={200}
              itemContent={itemContent}
              components={VirtuosoComponents}
              //Provide a unique key to help React recycle DOM nodes
              computeItemKey={(_index, item) =>
                item.kind === 'divider' ? item.id : item.thread.conversationId
              }
            />
          )}
        </div>
      </div>

      {showThreadPanel && (
        <div className={`${isMobile ? 'w-full' : 'w-1/2'} h-full flex flex-col bg-background`}>
          <Outlet context={{ onClose: handleCloseThreadPanel }} />
        </div>
      )}
    </div>
  );
};

export default UserThreads;
