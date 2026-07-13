import { ReactElement, useState, useEffect, useCallback, useMemo, memo, forwardRef } from 'react';
import { useQuery } from '../../../hooks/useQuery';
import { MessageCircle, Hash, Loader2 } from 'lucide-react';
import { Virtuoso, Components } from 'react-virtuoso';
import { queries } from '../../../zero/queries';
import { useAuthContext } from '../../../providers/AuthProvider';
import ThreadMessages from '../ThreadPannel';
import { useChannel } from '../../../hooks/useChannels';
import { ChannelScopeType, ChannelVisibility } from '@xyne/shared';
import { QueryResultType } from '@rocicorp/zero';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import ChatLock from '../../icons/ChatLock';
import { useNavigate, useParams, Outlet } from 'react-router-dom';
import { usePlatform } from '../../../hooks/usePlatform';

const PAGE_SIZE = 10;

type Cursor = { lastReplyAt: number; id: string };

// Optimize ThreadRow with memo to prevent unnecessary re-renders of existing rows
// during scrolling or when new data loads at the bottom.
const ThreadRow = memo(
  ({
    channelId,
    conversationId,
    userId,
    conversationParticipant,
  }: {
    channelId: string;
    conversationId: string;
    userId: string;
    conversationParticipant?: { lastReadAt?: number | null } | undefined;
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
      <div className='flex flex-col gap-2 mb-10'>
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
          </div>
        </div>
        <div className='border border-border rounded-xl overflow-hidden bg-card shadow-sm'>
          <div className='bg-card'>
            <ThreadMessages
              channelId={channelId}
              conversationId={conversationId}
              showHeader={false}
              previewCardMode
              {...(conversationParticipant ? { conversationParticipant } : {})}
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
  <div {...props} ref={ref} className='mx-auto w-full space-y-8 px-4 py-6'>
    {children}
  </div>
));
ListContainer.displayName = 'ListContainer';

const UserThreads = (): ReactElement => {
  const { user } = useAuthContext();
  const navigate = useNavigate();
  const params = useParams<{ channelId?: string; conversationId?: string }>();
  const { isMobile } = usePlatform();
  const showThreadPanel = !!params.conversationId;

  const handleCloseThreadPanel = useCallback((): void => {
    void navigate('/chat/dir/threads');
  }, [navigate]);

  const [allConversations, setAllConversations] = useState<
    QueryResultType<typeof queries.userConversationsPaginatedV2>
  >([]);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const [currentBatch, details] = useQuery(
    queries.userConversationsPaginatedV2({
      userId: user?.id || '',
      limit: PAGE_SIZE,
      start: cursor,
    }),
    { enabled: !!user?.id },
  );

  useEffect(() => {
    if (details.type !== 'complete') return;

    if (currentBatch && currentBatch.length > 0) {
      setAllConversations(prev => {
        // Merge: use a Map keyed by conversationId so latest data always wins
        const merged = new Map(prev.map(p => [p.conversationId, p]));
        currentBatch.forEach(p => merged.set(p.conversationId, p));
        // Always re-sort to match the database query order (lastReplyAt desc, id desc)
        return Array.from(merged.values()).sort((a, b) => {
          const aTime = new Date(a.lastReplyAt ?? 0).getTime();
          const bTime = new Date(b.lastReplyAt ?? 0).getTime();
          if (bTime !== aTime) return bTime - aTime;
          return b.id.localeCompare(a.id);
        });
      });

      if (currentBatch.length < PAGE_SIZE) {
        setHasMore(false);
      }
    } else if (currentBatch && currentBatch.length === 0 && cursor !== null) {
      setHasMore(false);
    }
  }, [currentBatch, cursor, details.type]);

  const loadMore = useCallback(() => {
    if (!hasMore || allConversations.length === 0) return;

    const lastItem = allConversations[allConversations.length - 1]!;
    setCursor(
      lastItem.lastReplyAt
        ? {
            lastReplyAt: lastItem.lastReplyAt,
            id: lastItem.id,
          }
        : null,
    );
  }, [hasMore, allConversations]);

  // Memoize the itemContent callback
  const itemContent = useCallback(
    (_index: number, c: QueryResultType<typeof queries.userConversationsPaginatedV2>[number]) => (
      <ThreadRow
        channelId={c.channelId ?? ''}
        conversationId={c.conversationId}
        userId={user?.id ?? ''}
      />
    ),
    [user?.id],
  );

  // Memoize components that depend on local state (like Footer uses hasMore)
  const VirtuosoComponents = useMemo(
    () => ({
      List: ListContainer,
      Footer: () => (
        <div className='flex justify-center py-4 h-10'>
          {hasMore && <Loader2 className='animate-spin text-muted-foreground' />}
        </div>
      ),
    }),
    [hasMore],
  );

  return (
    <div className='flex h-full w-full bg-background'>
      <div
        className={`pt-8 h-full flex flex-col bg-background ${
          showThreadPanel ? (isMobile ? 'hidden' : 'w-1/2 border-r border-border') : 'w-full'
        }`}
      >
        <div className='flex-1'>
          {allConversations.length === 0 ? (
            <div className='flex flex-col items-center justify-center h-full p-8 text-center'>
              <MessageCircle className='text-muted-foreground mb-4' size={64} />
              <p className='text-muted-foreground text-xl font-semibold mb-2'>No threads yet</p>
            </div>
          ) : (
            <Virtuoso
              style={{ height: '100%' }}
              data={allConversations}
              endReached={loadMore}
              increaseViewportBy={200}
              itemContent={itemContent}
              components={VirtuosoComponents}
              //Provide a unique key to help React recycle DOM nodes
              computeItemKey={(_index, item) => item.conversationId}
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
