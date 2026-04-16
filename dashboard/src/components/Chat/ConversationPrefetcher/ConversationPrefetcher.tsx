import { useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useSelector } from '@xstate/react';
import { useZero } from '../../../hooks/useZero';
import { queries } from '../../../zero/queries';
import { stateMachineActor, Conversation } from '../../../machines/stateMachine';
import { queryCacheActor } from '../../../machines/queryCacheMachine';
import { useAllVisibleChannels, useGetChannelUserStatus } from '../../../hooks/useChannels';
import { Event, logger } from '../../../utils/logger';

const PAGE_SIZE = 50;
const MAX_QUEUE_SIZE = 5;

type ChannelWithUnread = {
  channelId: string;
  lastActivityAt: number;
  lastViewedAt: number | null;
  unreadCount: number;
};

type PrefetchState = {
  status: 'idle' | 'processing' | 'complete';
  currentChannelId: string | null;
  queue: ChannelWithUnread[];
  processed: Set<string>;
};

/**
 * Deduplicates and sorts conversations by createdAt
 */
function dedupeAndSort(a: Conversation[], b: Conversation[]): Conversation[] {
  const map = new Map<string, Conversation>();
  for (const c of a) map.set(c.conversationId, c);
  for (const c of b) map.set(c.conversationId, c); // b wins on conflict
  return Array.from(map.values()).sort((x, y) => x.createdAt - y.createdAt);
}

/**
 * ConversationPrefetcher
 *
 * A headless component that prefetches conversations for channels with unread counts.
 * - Prioritizes channels by lastActivityAt (most recent first)
 * - Maintains a queue of max 5 channels
 * - Fetches both older (forward) and newer (backward) conversations
 * - Stores results in queryCacheMachine for ChatListV6 to use
 * - Excludes the currently viewed channel from the queue
 */
const ConversationPrefetcher = (): null => {
  const { channelId: currentChannelId } = useParams<{ channelId: string }>();
  const zero = useZero();

  // Get all user channel statuses and channels
  const userChannelStatuses = useSelector(
    stateMachineActor,
    state => state.context.userChannelStatuses,
  );

  const allChannels = useAllVisibleChannels();
  const userChannelStatus = useGetChannelUserStatus(currentChannelId || '');

  // Track prefetch state
  const stateRef = useRef<PrefetchState>({
    status: 'idle',
    currentChannelId: null,
    queue: [],
    processed: new Set(),
  });

  // Check if component is mounted to prevent state updates after unmount
  const isMountedRef = useRef(true);

  /**
   * Fetch conversations for a channel in both directions
   */
  const fetchConversationsForChannel = useCallback(
    async (channel: ChannelWithUnread): Promise<void> => {
      const { channelId, lastViewedAt } = channel;

      // Use lastViewedAt as anchor, or fallback to current time
      const anchor = lastViewedAt || Date.now();

      try {
        // Fetch older conversations (forward from anchor - going back in time)
        await zero.preload(
          queries.channelConversationsPaginatedV3({
            channelId,
            start: { createdAt: anchor },
            direction: 'forward',
            limit: PAGE_SIZE,
            isMember: !!userChannelStatus,
          }),
        ).complete;

        // Fetch newer conversations (backward from anchor - going forward in time)
        await zero.preload(
          queries.channelConversationsPaginatedV3({
            channelId,
            start: { createdAt: anchor },
            direction: 'backward',
            limit: PAGE_SIZE,
            isMember: !!userChannelStatus,
          }),
        ).complete;

        // Merge and dedupe
        // const merged = dedupeAndSort(olderConversations, newerConversations);

        // console.log(
        //   `[ConversationPrefetcher] Fetched ${merged.length} conversations for channel ${channelId}`,
        //   { older: olderConversations.length, newer: newerConversations.length },
        // );

        // return merged;
      } catch (error) {
        logger.error(Event.CONVERSATION_PREFERCH_ERROR, {
          error,
          message: `Error fetching conversations for channel ${channelId}:`,
        });
        // console.error(
        //   `[ConversationPrefetcher] Error fetching conversations for channel ${channelId}:`,
        //   error,
        // );
        return;
      }
    },
    [zero],
  );

  /**
   * Store conversations in the query cache
   */
  const storeConversations = useCallback((channelId: string, conversations: Conversation[]) => {
    if (conversations.length === 0) return;

    // Get existing cached conversations for this channel
    const currentCache =
      queryCacheActor.getSnapshot().context.channelConversations[channelId] || [];

    // Merge with new conversations
    const merged = dedupeAndSort(currentCache, conversations);

    // Store in cache
    queryCacheActor.send({
      type: 'SET_CONVERSATIONS',
      channelId,
      conversations: merged,
    });

    // console.log(
    //   `[ConversationPrefetcher] Stored ${merged.length} conversations for channel ${channelId}`,
    // );
  }, []);

  /**
   * Process the next channel in the queue
   */
  const processNextChannel = useCallback(async () => {
    if (!isMountedRef.current) return;

    const state = stateRef.current;

    // If we're already processing, don't start another
    if (state.status === 'processing') return;

    // If queue is empty, we're done
    if (state.queue.length === 0) {
      stateRef.current = { ...state, status: 'complete' };
      // console.log('[ConversationPrefetcher] All channels processed');
      return;
    }

    // Get the next channel from the queue
    const nextChannel = state.queue[0];
    const remainingQueue = state.queue.slice(1);

    // Safety check - should not happen since we check queue.length above
    if (!nextChannel) {
      stateRef.current = { ...state, status: 'complete' };
      return;
    }

    // Skip if already processed
    if (state.processed.has(nextChannel.channelId)) {
      stateRef.current = { ...state, queue: remainingQueue };
      void processNextChannel();
      return;
    }

    // Mark as processing
    stateRef.current = {
      ...state,
      status: 'processing',
      currentChannelId: nextChannel.channelId,
      queue: remainingQueue,
    };

    // console.log(
    //   `[ConversationPrefetcher] Processing channel ${nextChannel.channelId} (${remainingQueue.length} remaining in queue)`,
    // );

    // Fetch conversations
    await fetchConversationsForChannel(nextChannel);

    // Store in cache if still mounted
    if (isMountedRef.current) {
      // storeConversations(nextChannel.channelId, conversations);

      // Mark as processed
      stateRef.current.processed.add(nextChannel.channelId);

      // Reset status to idle to allow processing next channel
      stateRef.current = {
        ...stateRef.current,
        status: 'idle',
        currentChannelId: null,
      };

      // Process next channel
      void processNextChannel();
    }
  }, [fetchConversationsForChannel, storeConversations]);

  /**
   * Helper to build a channel item from status and channel data
   */
  const buildChannelItem = (
    status: { channelId: string; lastViewedAt: number | null; unreadCount?: number },
    channel: { id: string; lastActivityAt: number | null },
  ): ChannelWithUnread => ({
    channelId: status.channelId,
    lastActivityAt: channel.lastActivityAt || 0,
    lastViewedAt: status.lastViewedAt,
    unreadCount: status.unreadCount || 0,
  });

  /**
   * Initialize the prefetch queue on mount
   */
  useEffect(() => {
    isMountedRef.current = true;

    // Build list of channels with unread counts (priority)
    const channelsWithUnread: ChannelWithUnread[] = [];
    // Build list of channels without unread (fallback)
    const channelsWithoutUnread: ChannelWithUnread[] = [];

    for (const status of userChannelStatuses) {
      // Skip the current channel
      if (status.channelId === currentChannelId) continue;

      // Find the channel to get lastActivityAt
      const channel = allChannels.find(c => c.id === status.channelId);
      if (!channel) continue;

      const channelItem = buildChannelItem(status, {
        id: channel.id,
        lastActivityAt: channel.channelStats?.lastActivityAt || 0,
      });

      if (status.unreadCount && status.unreadCount > 0) {
        channelsWithUnread.push(channelItem);
      } else {
        channelsWithoutUnread.push(channelItem);
      }
    }

    // Sort both lists by lastActivityAt (most recent first)
    channelsWithUnread.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
    channelsWithoutUnread.sort((a, b) => b.lastActivityAt - a.lastActivityAt);

    // Take channels with unread first
    const initialQueue = channelsWithUnread.slice(0, MAX_QUEUE_SIZE);

    // If queue has space, fill with channels without unread
    if (initialQueue.length < MAX_QUEUE_SIZE) {
      const needed = MAX_QUEUE_SIZE - initialQueue.length;
      const fallbackChannels = channelsWithoutUnread.slice(0, needed);
      initialQueue.push(...fallbackChannels);
    }

    // console.log(
    //   `[ConversationPrefetcher] Initialized with ${initialQueue.length} channels in queue`,
    //   {
    //     totalWithUnread: channelsWithUnread.length,
    //     totalWithoutUnread: channelsWithoutUnread.length,
    //   },
    // );

    stateRef.current = {
      ...stateRef.current,
      queue: initialQueue,
    };

    // Start processing
    void processNextChannel();

    return () => {
      isMountedRef.current = false;
    };
  }, [userChannelStatuses, allChannels, currentChannelId, processNextChannel]);

  /**
   * Watch for queue updates and add new channels when space is available
   */
  useEffect(() => {
    // Build list of channels with unread (priority)
    const channelsWithUnread: ChannelWithUnread[] = [];
    // Build list of channels without unread (fallback)
    const channelsWithoutUnread: ChannelWithUnread[] = [];

    for (const status of userChannelStatuses) {
      // Skip the current channel
      if (status.channelId === currentChannelId) continue;
      // Skip already processed channels
      if (stateRef.current.processed.has(status.channelId)) continue;

      const channel = allChannels.find(c => c.id === status.channelId);
      if (!channel) continue;

      const channelItem = buildChannelItem(status, {
        id: channel.id,
        lastActivityAt: channel.channelStats?.lastActivityAt || 0,
      });

      if (status.unreadCount && status.unreadCount > 0) {
        channelsWithUnread.push(channelItem);
      } else {
        channelsWithoutUnread.push(channelItem);
      }
    }

    // Sort both lists by lastActivityAt (most recent first)
    channelsWithUnread.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
    channelsWithoutUnread.sort((a, b) => b.lastActivityAt - a.lastActivityAt);

    // Check if we need to refill the queue
    const currentQueueLength = stateRef.current.queue.length;
    const isProcessing = stateRef.current.status === 'processing';

    if (currentQueueLength < MAX_QUEUE_SIZE && !isProcessing) {
      // Combine priority (unread) and fallback channels, excluding those already in queue or processed
      const availableChannels: ChannelWithUnread[] = [];

      // Add unread channels first
      for (const c of channelsWithUnread) {
        if (
          !stateRef.current.queue.some(q => q.channelId === c.channelId) &&
          !stateRef.current.processed.has(c.channelId)
        ) {
          availableChannels.push(c);
        }
      }

      // Then add channels without unread as fallback
      for (const c of channelsWithoutUnread) {
        if (
          !stateRef.current.queue.some(q => q.channelId === c.channelId) &&
          !stateRef.current.processed.has(c.channelId)
        ) {
          availableChannels.push(c);
        }
      }

      // Add channels to fill the queue
      const needed = MAX_QUEUE_SIZE - currentQueueLength;
      const toAdd = availableChannels.slice(0, needed);

      if (toAdd.length > 0) {
        stateRef.current = {
          ...stateRef.current,
          queue: [...stateRef.current.queue, ...toAdd],
        };

        // console.log(`[ConversationPrefetcher] Added ${toAdd.length} channels to queue`);

        // Start processing if idle
        if (stateRef.current.status === 'idle') {
          void processNextChannel();
        }
      }
    }
  }, [userChannelStatuses, allChannels, currentChannelId, processNextChannel]);

  return null;
};

export default ConversationPrefetcher;
