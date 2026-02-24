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
import { useNavigate } from 'react-router-dom';

const PAGE_SIZE = 10;

type Cursor = { lastActivityAt: number; id: string };

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
        return <div className='w-2.5 h-2.5 rounded-full border-2 border-gray-400' />;
      }
      return isPrivate ? <ChatLock color={'#1D1E1F'} /> : <Hash size={16} />;
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
              className='text-base font-semibold text-gray-900 hover:underline'
              data-track-category='USER_THREADS'
              data-track-name='OPEN_USER_THREAD'
              data-track-metadata={JSON.stringify({ channelId, conversationId })}
            >
              {displayName}
            </button>
          </div>
        </div>
        <div className='border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm'>
          <div className='bg-white'>
            <ThreadMessages
              channelId={channelId}
              conversationId={conversationId}
              showHeader={false}
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
  const [allConversations, setAllConversations] = useState<
    QueryResultType<typeof queries.userConversationsPaginated>
  >([]);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const [currentBatch] = useQuery(
    queries.userConversationsPaginated({
      userId: user?.id || '',
      limit: PAGE_SIZE,
      start: cursor,
    }),
    { enabled: !!user?.id },
  );

  useEffect(() => {
    if (currentBatch && currentBatch.length > 0) {
      setAllConversations(prev => {
        const existingIds = new Set(prev.map(p => p.conversationId));
        const uniqueNewItems = currentBatch.filter(p => !existingIds.has(p.conversationId));
        return [...prev, ...uniqueNewItems];
      });

      if (currentBatch.length < PAGE_SIZE) {
        setHasMore(false);
      }
    } else if (currentBatch && currentBatch.length === 0 && cursor !== null) {
      setHasMore(false);
    }
  }, [currentBatch, cursor]);

  const loadMore = useCallback(() => {
    if (!hasMore || allConversations.length === 0) return;

    const lastItem = allConversations[allConversations.length - 1]!;
    setCursor({
      lastActivityAt: lastItem.lastActivityAt,
      id: lastItem.conversationId,
    });
  }, [hasMore, allConversations]);

  // Memoize the itemContent callback
  const itemContent = useCallback(
    (_index: number, c: QueryResultType<typeof queries.userConversationsPaginated>[number]) => (
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
          {hasMore && <Loader2 className='animate-spin text-gray-400' />}
        </div>
      ),
    }),
    [hasMore],
  );

  return (
    <div className='flex-1 pt-8 h-full flex flex-col bg-slate-50'>
      <div className='flex-1'>
        {allConversations.length === 0 ? (
          <div className='flex flex-col items-center justify-center h-full p-8 text-center'>
            <MessageCircle className='text-gray-300 mb-4' size={64} />
            <p className='text-gray-500 text-xl font-semibold mb-2'>No threads yet</p>
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
  );
};

export default UserThreads;
