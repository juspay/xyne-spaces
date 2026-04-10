import { ChannelScopeType, MessageType } from '@xyne/shared';
import { Conversation } from '../../../machines/stateMachine';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGetChannelUserStatus, useVisibleChannel } from '../../../hooks/useChannels';
//eslint-disable-next-line local-rules/no-rocicorp-use-zero
import { useZero } from '@rocicorp/zero/react';
import { queries } from '../../../zero/queries';
import { useQuery } from '../../../hooks/useQuery';
import { ChatListItem } from '../ChatListItem/ChatListItem';
import { DatePill } from '../DatePill';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { findLastEditableMessage, isEventFromEmptyInput } from '../../../utils/chatUtils';
import { useShortcutById } from '../../../shortcuts';
import { useAuth } from '../../../hooks/useAuth';
import { useEditContext } from '../../../providers/EditProvider';
import { useCombinedMesseges } from './ChatListV2.utils';
import { usePlatform } from '../../../hooks/usePlatform';
import { formatDatePill } from '../../../utils/dateUtils';
import { standaloneNavigate } from '../../../utils/electronApp';
import { useNavigate, useParams } from 'react-router-dom';
import { useRouteContext } from '../../../hooks/useRouteContext';
import { ArrowDown } from 'lucide-react';
import { mutators } from '../../../zero/mutators';
import { queryCacheActor } from '../../../machines/queryCacheMachine';
import LoadingAnimation from '../Loader/Loader';
import { getDraft } from '../../../hooks/useDraft';
import { v4 as uuidv4 } from 'uuid';
import { getInitialMessageFromConversation } from '../../../utils/conversationMessageHelpers';

export type ChatListProps = {
  channelId: string;
  projectId?: string | undefined;
  cachedConversations: Conversation[];
  linkedItemCreatedAt?: Anchor;
  linkedConversationId?: string;
  channelScopeType?: ChannelScopeType | undefined;
  skipMarkAsReadRef: React.RefObject<boolean>;
};

type Anchor = {
  createdAt: number;
};

type UpdatedConveresationsAnchor = {
  direction: 'forward' | 'backward';
  conversationId: string;
  createdAt: number;
};

const PAGE_SIZE = 50;

function dedupeAndSort(a: Conversation[], b: Conversation[]): Conversation[] {
  const map = new Map<string, Conversation>();
  for (const c of a) map.set(c.conversationId, c);
  for (const c of b) map.set(c.conversationId, c); // b wins on conflict
  return Array.from(map.values()).sort((x, y) => x.createdAt - y.createdAt);
}

function mergeWithCached(
  cachedConversations: Conversation[],
  fetchedConversations: Conversation[],
): Conversation[] {
  if (fetchedConversations.length === 0) {
    return cachedConversations;
  }

  const sorted = [...cachedConversations].sort((a, b) => a.createdAt - b.createdAt);
  const sortedFetched = [...fetchedConversations].sort((a, b) => a.createdAt - b.createdAt);
  const fetchedConversationIds = new Set(sortedFetched.map(l => l.conversationId));
  const overlapIndex = sorted.findIndex(f => fetchedConversationIds.has(f.conversationId));

  if (overlapIndex !== -1) {
    // Find where the overlap occurs in fetched
    const overlapId = sorted[overlapIndex]!.conversationId;
    const fetchedOverlapIndex = sortedFetched.findIndex(f => f.conversationId === overlapId);

    const isFetchedNewer = fetchedOverlapIndex === 0;

    if (isFetchedNewer) {
      // Fetched has newer items, trim end of cached (keep items before overlap)
      const trimmed = sorted.slice(0, overlapIndex);
      return dedupeAndSort(trimmed, sortedFetched);
    }
    // Fetched has older items, trim start of cached (keep items after overlap)
    const trimmed = sorted.slice(overlapIndex + 1);
    return dedupeAndSort(sortedFetched, trimmed);
  }

  return sortedFetched;
}

function mergeWithLatest(
  fetchedConversations: Conversation[],
  latestList: Conversation[],
  isInitialLoadComplete: boolean,
): { merged: Conversation[]; latestClear: boolean } {
  if (latestList.length === 0) {
    return { merged: dedupeAndSort(fetchedConversations, []), latestClear: false };
  }

  // If fetched is empty but latest has items, use latest and clear it
  if (fetchedConversations.length === 0 && latestList.length > 0) {
    if (!isInitialLoadComplete) {
      return { merged: [], latestClear: false };
    }
    return { merged: dedupeAndSort(latestList, []), latestClear: true };
  }

  const sorted = [...fetchedConversations].sort((a, b) => a.createdAt - b.createdAt);
  const latestIds = new Set(latestList.map(l => l.conversationId));
  const overlapIndex = sorted.findIndex(f => latestIds.has(f.conversationId));

  if (overlapIndex !== -1) {
    const trimmed = sorted.slice(0, overlapIndex);
    return { merged: dedupeAndSort(trimmed, latestList), latestClear: true };
  }

  return { merged: dedupeAndSort(fetchedConversations, []), latestClear: false };
}

type CombinedMessage = ReturnType<typeof useCombinedMesseges>['combinedMessages'][number];

/** Returns the array index of the first unread conversation boundary, or -1. */
function computeNewConvIdx(
  messages: CombinedMessage[],
  lastViewedAt: number | null | undefined,
  userId: string | null | undefined,
): number {
  if (!lastViewedAt) return -1;
  return messages.findIndex(item => {
    if (item.type !== 'conversation') return false;
    if (item.createdAt.getTime() <= lastViewedAt) return false;
    if (item.data.createdBy === userId) return false;
    const initMsg = getInitialMessageFromConversation(item.data);
    if (initMsg?.senderId === userId) return false;
    if (initMsg?.msgType === MessageType.SYSTEM && item.data.ticketId === null) return false;
    return true;
  });
}

type VirtuosoIndex = { index: number | 'LAST'; align: 'start' | 'center' | 'end' };

const ChatListV3: React.FC<ChatListProps> = ({
  channelId,
  projectId,
  cachedConversations,
  linkedItemCreatedAt,
  linkedConversationId,
  channelScopeType,
  skipMarkAsReadRef,
}) => {
  const zero = useZero();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { baseRoute } = useRouteContext();
  const { editingMessageId, requestEdit } = useEditContext();
  const channelParticipation = useGetChannelUserStatus(channelId);
  const channel = useVisibleChannel(channelId);

  const [newConversationsAnchor, setNewConversationsAnchor] = useState<Anchor | null>(
    linkedItemCreatedAt ||
      (channelParticipation?.lastViewedAt &&
      (!channel?.channelStats?.lastActivityAt ||
        channelParticipation.lastViewedAt < channel?.channelStats?.lastActivityAt)
        ? { createdAt: channelParticipation?.lastViewedAt }
        : null),
  );
  const [oldConversationsAnchor, setOldestConversationsAnchor] = useState<Anchor>(
    linkedItemCreatedAt || {
      createdAt:
        channelParticipation?.lastViewedAt || channel?.channelStats?.lastActivityAt || Date.now(),
    },
  );
  const [inViewAnchor, setInViewAnchor] = useState<UpdatedConveresationsAnchor | null>(null);

  const [conversations, setConversations] = useState<Conversation[]>(cachedConversations);

  const [latestConversationsList, setLatestConversationsList] = useState<Conversation[]>([]);
  const latestConversationsListRef = useRef<Conversation[]>([]);
  const [firstItemIndex, setFirstItemIndex] = useState(100000);
  const [stickyDate, setStickyDate] = useState<string | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const rangeRef = useRef<{ startIndex: number; endIndex: number } | null>(null);
  const scrollStopTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Becomes true after the first rangeChanged fires, meaning Virtuoso's initial scroll
  // (from initialTopMostItemIndex) has settled. Prevents fetchOlderMessages from being
  // triggered by atTopStateChange during the initial mount/scroll race.
  const initialPositionSetRef = useRef(false);

  const lastAutoScrollKeyRef = useRef<string | undefined>(undefined);

  /** Tracks the new-message boundary: its array index and whether user has seen it. */
  type NewConversationBoundary = { index: number; seenConvId: string | null };
  const [newConversationBoundary, setNewConversationBoundary] =
    useState<NewConversationBoundary | null>(null);

  const [initialTopMostItemIndex, setInitialTopMostItemIndex] = useState<VirtuosoIndex | null>(
    !linkedItemCreatedAt && cachedConversations.length > 0 ? { index: 'LAST', align: 'end' } : null,
  );
  const initialLinkedIdRef = useRef(linkedConversationId);

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const isNearBottomRef = useRef(false);
  const dateObserverRef = useRef<IntersectionObserver | null>(null);
  const visibleDatesRef = useRef<Map<Element, { timestamp: number; rect: DOMRect }>>(new Map());
  const { isMobile } = usePlatform();
  const { combinedMessages, itemHeights } = useCombinedMesseges(
    conversations,
    isMobile,
    newConversationBoundary?.index ?? -1,
  );
  const lastConversationAutoScrollKey = useMemo(() => {
    const lastConversation = conversations[conversations.length - 1];
    if (!lastConversation) return '';
    return `${lastConversation.conversationId}:${lastConversation.initial_message_md ?? ''}`;
  }, [conversations]);

  const [isInitialLoadComplete, setIsInitialLoadComplete] = useState(false);
  const isFetchingRef = useRef(false);

  const [updatedConversations, updatedConversationsDetails] = useQuery(
    queries.channelConversationsPaginatedV3({
      channelId,
      start: inViewAnchor ? { createdAt: inViewAnchor.createdAt } : null,
      direction: inViewAnchor ? inViewAnchor.direction : 'forward',
      limit: PAGE_SIZE,
    }),
    {
      enabled: inViewAnchor !== null,
    },
  );

  const [latestConversations, latestConversationsDetails] = useQuery(
    queries.channelLatestMultipleConversationsV3({
      channelId,
      limit: PAGE_SIZE / 2,
    }),
  );

  useEffect(() => {
    Promise.all([
      zero.run(
        queries.channelConversationsPaginatedV3({
          channelId,
          start: oldConversationsAnchor,
          direction: 'forward',
          limit: PAGE_SIZE,
        }),
        { type: 'complete' },
      ),
      newConversationsAnchor &&
        zero.run(
          queries.channelConversationsPaginatedV3({
            channelId,
            start: newConversationsAnchor,
            direction: 'backward',
            limit: PAGE_SIZE / 2,
          }),
          { type: 'complete' },
        ),
    ])
      .then(([older, newerNullable]) => {
        const newer = newerNullable ?? [];
        const fetched = dedupeAndSort(older, newer);
        const mergedWithCached = mergeWithCached(conversations, fetched);
        // Read from ref to get the CURRENT latestConversationsList, not the
        // stale closure value (which is always [] since this effect has [] deps).
        const { merged, latestClear } = mergeWithLatest(
          mergedWithCached,
          latestConversationsListRef.current,
          true,
        );

        if (merged[0]) {
          setOldestConversationsAnchor({ createdAt: merged[0].createdAt });
        }

        if (latestClear) {
          setLatestConversationsList([]);
          latestConversationsListRef.current = [];
          setNewConversationsAnchor(null);
        } else if (merged.length > 0) {
          setNewConversationsAnchor({ createdAt: merged[merged.length - 1]!.createdAt });
        }

        // Calculate actual new items prepended (older than the previous oldest conversation)
        // This ensures firstItemIndex only shifts when truly new older items are added
        const prevOldestCreatedAt = conversations[0]?.createdAt;
        const actualNewPrepended = prevOldestCreatedAt
          ? older.filter(item => item.createdAt < prevOldestCreatedAt).length
          : older.length;

        setFirstItemIndex(prev => prev - actualNewPrepended);
        setConversations(merged);
        setIsInitialLoadComplete(true);
      })
      .catch(err => console.error('[V11] initial load error:', err));
  }, []);

  const fetchOlderMessages = useCallback(() => {
    if (!isInitialLoadComplete) return;
    zero
      .run(
        queries.channelConversationsPaginatedV3({
          channelId,
          start: oldConversationsAnchor,
          direction: 'forward',
          limit: PAGE_SIZE,
        }),
        { type: 'complete' },
      )
      .then(older => {
        const newItems = older.filter(
          c => !conversations.some(v => v.conversationId === c.conversationId),
        );
        if (newItems.length === 0) {
          return;
        }
        const fetched = dedupeAndSort(older, conversations);
        const { merged, latestClear } = mergeWithLatest(
          fetched,
          latestConversationsListRef.current,
          true,
        );
        if (latestClear) {
          setLatestConversationsList([]);
          latestConversationsListRef.current = [];
          setNewConversationsAnchor(null);
        }
        if (merged[0]) {
          setOldestConversationsAnchor({ createdAt: merged[0].createdAt });
        }

        setFirstItemIndex(prev => prev - newItems.length);
        setConversations(merged);
      })
      .catch(err => console.error('[V11] fetchOlderMessages error:', err));
  }, [
    channelId,
    oldConversationsAnchor,
    conversations,
    latestConversationsList,
    isInitialLoadComplete,
    zero,
  ]);

  const fetchNewerMessages = useCallback(() => {
    if (!newConversationsAnchor || isFetchingRef.current || !isInitialLoadComplete) return;

    isFetchingRef.current = true;
    zero
      .run(
        queries.channelConversationsPaginatedV3({
          channelId,
          start: newConversationsAnchor,
          direction: 'backward',
          limit: PAGE_SIZE,
        }),
        { type: 'complete' },
      )
      .then(newer => {
        const fetched = dedupeAndSort(conversations, newer);
        const { merged, latestClear } = mergeWithLatest(
          fetched,
          latestConversationsListRef.current,
          true,
        );

        if (latestClear) {
          setLatestConversationsList([]);
          latestConversationsListRef.current = [];
          setNewConversationsAnchor(null);
        } else if (newer.length > 0) {
          setNewConversationsAnchor({ createdAt: newer[newer.length - 1]!.createdAt });
        }

        setConversations(merged);
        isFetchingRef.current = false;
      })
      .catch(err => {
        console.error('[V11] fetchNewerMessages error:', err);
        isFetchingRef.current = false;
      });
  }, [
    channelId,
    newConversationsAnchor,
    conversations,
    latestConversationsList,
    isInitialLoadComplete,
    zero,
  ]);

  useEffect(() => {
    if (!channelParticipation?.lastViewedAt || !isInitialLoadComplete) {
      setNewConversationBoundary(null);
      return;
    }
    const idx = computeNewConvIdx(combinedMessages, channelParticipation?.lastViewedAt, user?.id);
    setNewConversationBoundary(prev => {
      if (idx === -1) {
        return null;
      }
      const boundaryConvId = combinedMessages[idx]?.data.conversationId;
      if (prev?.seenConvId && prev.seenConvId === boundaryConvId) {
        return { index: idx, seenConvId: prev.seenConvId };
      }
      if (prev !== null && prev.index === idx) return prev;
      return { index: idx, seenConvId: null };
    });
  }, [combinedMessages, isInitialLoadComplete, channelParticipation?.lastViewedAt, user?.id]);

  useEffect(() => {
    if (!isInitialLoadComplete || combinedMessages.length === 0) return;
    // Already computed — don't recompute
    if (initialTopMostItemIndex !== null) return;

    let computed: VirtuosoIndex = { index: 'LAST', align: 'end' };

    if (linkedConversationId) {
      const idx = combinedMessages.findIndex(m => m.data.conversationId === linkedConversationId);
      if (idx !== -1) {
        const isLast = idx === combinedMessages.length - 1;
        computed = {
          index: isLast ? firstItemIndex + idx : idx,
          align: isLast ? 'end' : 'center',
        };
      }
    }

    if (computed.index === 'LAST') {
      const newConvIdx = computeNewConvIdx(
        combinedMessages,
        channelParticipation?.lastViewedAt,
        user?.id,
      );
      if (newConvIdx !== -1) {
        const isLast = newConvIdx === combinedMessages.length - 1;
        computed = {
          index: isLast ? firstItemIndex + newConvIdx : newConvIdx,
          align: isLast ? 'end' : 'center',
        };
      }
    }

    setInitialTopMostItemIndex(computed);
    lastAutoScrollKeyRef.current = lastConversationAutoScrollKey || undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInitialLoadComplete, combinedMessages, lastConversationAutoScrollKey]);

  useEffect(() => {
    if (!linkedItemCreatedAt || !linkedConversationId || !isInitialLoadComplete) return;
    // Skip the very first linked id — already positioned by initialTopMostItemIndex
    if (linkedConversationId === initialLinkedIdRef.current) return;
    initialLinkedIdRef.current = linkedConversationId;

    const idx = combinedMessages.findIndex(
      item => item.data.conversationId === linkedConversationId,
    );
    if (idx !== -1) {
      const isLast = idx === combinedMessages.length - 1;
      virtuosoRef.current?.scrollIntoView({
        index: isLast ? firstItemIndex + idx : idx,
        align: isLast ? 'end' : 'center',
        behavior: 'smooth',
      });
    } else {
      setOldestConversationsAnchor(linkedItemCreatedAt);
      setNewConversationsAnchor(linkedItemCreatedAt);
    }
  }, [linkedConversationId, isInitialLoadComplete]);

  useEffect(() => {
    if (!isInitialLoadComplete) return;
    const last = conversations[conversations.length - 1];
    if (!last || lastConversationAutoScrollKey === lastAutoScrollKeyRef.current) return;
    const lastInitMsg = getInitialMessageFromConversation(last);
    const isOwnMessage = lastInitMsg?.senderId === user?.id;
    if (isNearBottomRef.current || isOwnMessage) {
      lastAutoScrollKeyRef.current = lastConversationAutoScrollKey;
      setTimeout(() => {
        virtuosoRef.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' });
      }, 80);
    }
  }, [conversations, isInitialLoadComplete, lastConversationAutoScrollKey, user?.id]);

  useEffect(() => {
    if (updatedConversationsDetails.type === 'complete' && isInitialLoadComplete) {
      const itemsToDelete: Conversation[] = [];
      let fromMessage = updatedConversations[0];
      let tillMessage = updatedConversations[updatedConversations.length - 1];
      if (fromMessage && tillMessage) {
        const tempMessage = { ...fromMessage };
        fromMessage = fromMessage.createdAt < tillMessage.createdAt ? fromMessage : tillMessage;
        tillMessage = tillMessage.createdAt > tempMessage.createdAt ? tillMessage : tempMessage;
        let flag = 0;
        for (const conv of conversations) {
          if (fromMessage?.conversationId === conv.conversationId) {
            flag = 1;
          }
          if (
            flag === 1 &&
            updatedConversations.find(v => v.conversationId === conv.conversationId) === undefined
          ) {
            itemsToDelete.push(conv);
          }
          if (tillMessage.conversationId === conv.conversationId) {
            flag = inViewAnchor === null ? 1 : 0;
          }
        }
      } else {
        if (updatedConversations.length === 0) {
          itemsToDelete.push(...conversations);
        }
      }
      const anchorConversation =
        inViewAnchor?.conversationId &&
        updatedConversations.find(v => v.conversationId === inViewAnchor.conversationId);
      if (inViewAnchor?.conversationId && !anchorConversation) {
        itemsToDelete.push(
          conversations.find(v => v.conversationId === inViewAnchor.conversationId)!,
        );
      }
      const updated = conversations
        .filter(conv => !itemsToDelete.some(v => v.conversationId === conv.conversationId))
        .map(conv => {
          const item = updatedConversations.find(v => v.conversationId === conv.conversationId);
          if (item) return item;
          return conv;
        });
      setConversations(updated);
    }
  }, [channelId, updatedConversations, isInitialLoadComplete]);

  useEffect(() => {
    if (latestConversationsDetails.type !== 'complete' || latestConversations.length === 0) return;
    const sortedLatest = [...latestConversations].sort((a, b) => a.createdAt - b.createdAt);
    const { merged, latestClear } = mergeWithLatest(
      conversations,
      sortedLatest,
      isInitialLoadComplete,
    );

    if (latestClear) {
      setConversations(merged);
      setLatestConversationsList([]);
      latestConversationsListRef.current = [];
      setNewConversationsAnchor(null);
    } else {
      setLatestConversationsList(sortedLatest);
      latestConversationsListRef.current = sortedLatest;
    }
  }, [channelId, latestConversations, latestConversationsDetails.type, isInitialLoadComplete]);

  // Save virtuoso state on unmount
  useEffect(() => {
    if (!channelId) return;

    return () => {
      // Mark as viewed
      if (skipMarkAsReadRef?.current) {
        skipMarkAsReadRef.current = false;
        return;
      }

      const draft = getDraft(channelId, null);

      const payload = {
        channelId,
        timestamp: Date.now(),
        draftMessageId: uuidv4(),
        draftMessage: draft || '',
      };

      void zero.mutate(mutators.channel.markChannelAsViewed(payload));
    };
  }, [channelId]);

  useEffect(() => {
    queryCacheActor.send({
      type: 'SET_CONVERSATIONS',
      channelId,
      conversations: conversations,
    });
  }, [conversations]);

  // When a thread is opened (conversationId appears in URL), scroll the parent message into view
  // after the panel resize settles, so it doesn't jump out of the user's viewport.
  const { conversationId: activeThreadConversationId } = useParams<{ conversationId?: string }>();
  const prevActiveThreadRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    // Only act when a thread is newly opened (not on close or same thread)
    if (
      !activeThreadConversationId ||
      activeThreadConversationId === prevActiveThreadRef.current ||
      !isInitialLoadComplete
    ) {
      prevActiveThreadRef.current = activeThreadConversationId;
      return;
    }
    prevActiveThreadRef.current = activeThreadConversationId;

    const idx = combinedMessages.findIndex(
      item => item.data.conversationId === activeThreadConversationId,
    );
    if (idx === -1) return;

    // Use a delay to let the PanelGroup resize animation settle before scrolling
    const timer = setTimeout(() => {
      virtuosoRef.current?.scrollIntoView({
        index: idx === combinedMessages.length - 1 ? firstItemIndex + idx : idx,
        align: 'center',
        behavior: 'auto',
      });
    }, 100);

    return () => clearTimeout(timer);
  }, [activeThreadConversationId, combinedMessages, firstItemIndex, isInitialLoadComplete]);

  const handleOpenThread = useCallback(
    (conversationId: string, e?: React.MouseEvent): void => {
      const conversation = conversations.find(c => c.conversationId === conversationId);

      const conversationMetadata = conversation?.metadata as { ticketId?: string } | null;
      const initMsg = conversation ? getInitialMessageFromConversation(conversation) : null;
      const messageMetadata = initMsg?.metadata as {
        ticketId?: string;
      } | null;
      const ticketId = conversationMetadata?.ticketId || messageMetadata?.ticketId;

      if (ticketId) {
        standaloneNavigate(
          navigate,
          `${baseRoute}/${channelId}/${conversationId}/${ticketId}?selectedTab=thread`,
          { event: e },
        );
      } else {
        standaloneNavigate(navigate, `${baseRoute}/${channelId}/${conversationId}`, { event: e });
      }
    },
    [channelId, conversations, navigate],
  );

  const isEventFromChannelInput = useCallback(
    (event: KeyboardEvent): boolean => isEventFromEmptyInput(event, channelId),
    [channelId],
  );

  const handleEditLastMessage = useCallback(() => {
    const result = findLastEditableMessage(conversations, user?.id, conv =>
      getInitialMessageFromConversation(conv),
    );
    if (!result) return;

    const { item: conversation, index } = result;
    const message = getInitialMessageFromConversation(conversation);
    if (!message) return;

    const scrollToConversation = (): void => {
      if (!virtuosoRef.current) return;
      const targetIndex = firstItemIndex + index;
      virtuosoRef.current.scrollToIndex({
        index: targetIndex,
        align: 'center',
        behavior: 'auto',
      });
    };

    if (editingMessageId === message.messageId) {
      scrollToConversation();
      return;
    }

    requestEdit(message.messageId, scrollToConversation);
  }, [conversations, user?.id, firstItemIndex, editingMessageId, requestEdit]);

  useShortcutById('composer.editLastMessage', handleEditLastMessage, {
    enabled: conversations.length > 0,
    when: isEventFromChannelInput,
  });

  // Track scroll position and load older/newer conversations
  const handleRangeChanged = useCallback(
    (range: { startIndex: number; endIndex: number }) => {
      if (combinedMessages.length === 0) return;

      initialPositionSetRef.current = true;
      const lastIndex = combinedMessages.length - 1 + firstItemIndex;
      isNearBottomRef.current = range.endIndex >= lastIndex - 5;
      rangeRef.current = range;

      if (isNearBottomRef.current) fetchNewerMessages();

      if (latestConversationsListRef.current.length === 0 && !isNearBottomRef.current)
        setShowScrollButton(true);
      else setShowScrollButton(false);

      setNewConversationBoundary(prev => {
        if (!prev || prev.seenConvId !== null) return prev; // already seen or no boundary
        const boundaryVirtualIdx = firstItemIndex + prev.index;
        const boundaryConvId = combinedMessages[prev.index]?.data.conversationId;
        // Mark as seen if boundary is at or above the viewport's bottom edge
        if (boundaryConvId && boundaryVirtualIdx <= range.endIndex) {
          return { index: prev.index, seenConvId: boundaryConvId };
        }
        return prev;
      });

      // Debounce: update inViewAnchor only after scroll stops for 1000ms
      if (scrollStopTimerRef.current !== undefined) {
        clearTimeout(scrollStopTimerRef.current);
      }
      scrollStopTimerRef.current = setTimeout(() => {
        scrollStopTimerRef.current = undefined;
        const index = range.endIndex - firstItemIndex;
        const itemIndex = Math.min(conversations.length - 1, index);
        const item = conversations[itemIndex];
        if (item) {
          const anchorArrayIdx = inViewAnchor
            ? conversations.findIndex(c => c.conversationId === inViewAnchor.conversationId)
            : -1;
          const anchorVirtualIdx = anchorArrayIdx !== -1 ? firstItemIndex + anchorArrayIdx : -1;
          if (
            inViewAnchor === null ||
            anchorVirtualIdx === -1 ||
            Math.abs(range.endIndex - anchorVirtualIdx) >= 20
          ) {
            setInViewAnchor({
              conversationId: item.conversationId,
              createdAt: item.createdAt,
              direction: 'forward',
            });
          }
        }
      }, 1000);
    },
    [
      combinedMessages,
      combinedMessages.length,
      firstItemIndex,
      fetchNewerMessages,
      conversations,
      inViewAnchor,
    ],
  );

  const handleLatestMessagesScroll = useCallback(() => {
    const latestConversation = latestConversationsList[latestConversationsList.length - 1];
    const oldLatestConversation = latestConversationsList[0];
    if (latestConversation && oldLatestConversation) {
      setConversations(latestConversationsList);
      setOldestConversationsAnchor(oldLatestConversation);
      setNewConversationsAnchor(null);
      setLatestConversationsList([]);
      latestConversationsListRef.current = [];
      if (virtuosoRef.current) {
        virtuosoRef.current.scrollToIndex({
          index: 'LAST',
          align: 'end',
          behavior: 'auto',
        });
      }
    }
  }, [latestConversationsList]);

  const handleNewMessagesScroll = useCallback(() => {
    if (!newConversationBoundary) return;
    const idx = newConversationBoundary.index;
    const isLast = idx === combinedMessages.length - 1;
    virtuosoRef.current?.scrollIntoView({
      index: isLast ? firstItemIndex + idx : idx,
      align: isLast ? 'end' : 'center',
      behavior: 'auto',
    });
  }, [newConversationBoundary, combinedMessages.length, firstItemIndex]);

  // Setup IntersectionObserver to track item positions for sticky date
  useEffect(() => {
    dateObserverRef.current = new IntersectionObserver(
      entries => {
        // Update visible items map
        entries.forEach(entry => {
          const timestampStr = entry.target.getAttribute('data-item-timestamp');
          if (timestampStr) {
            if (entry.isIntersecting) {
              visibleDatesRef.current.set(entry.target, {
                timestamp: Number(timestampStr),
                rect: entry.boundingClientRect,
              });
            } else {
              visibleDatesRef.current.delete(entry.target);
            }
          }
        });

        // Sort by timestamp (ascending = oldest first)
        const sorted = Array.from(visibleDatesRef.current.entries()).sort(
          (a, b) => a[1].timestamp - b[1].timestamp,
        );

        if (sorted.length === 0) return;

        // The oldest visible item's date becomes the sticky date
        const oldestItem = sorted[0];
        if (oldestItem?.[1]) {
          const newStickyDate = formatDatePill(oldestItem[1].timestamp);
          setStickyDate(newStickyDate);
        }
      },
      { threshold: 0, rootMargin: '0px' },
    );

    return () => {
      dateObserverRef.current?.disconnect();
      dateObserverRef.current = null;
      visibleDatesRef.current.clear();
    };
  }, []);

  // Ref callback to observe item elements
  const itemRef = useCallback((el: HTMLDivElement | null) => {
    if (el && dateObserverRef.current) {
      dateObserverRef.current.observe(el);
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    if (latestConversationsListRef.current.length > 0) {
      handleLatestMessagesScroll();
      return;
    }
    if (virtuosoRef.current) {
      virtuosoRef.current.scrollToIndex({
        index: 'LAST',
        align: 'end',
        behavior: 'auto',
      });
      setShowScrollButton(false);
    }
  }, [handleLatestMessagesScroll]);

  if (conversations.length === 0 && isInitialLoadComplete)
    return (
      <div className='text-center text-gray-500 flex-1 flex items-center justify-center'>
        <p className='text-gray-500'>No conversations in this channel yet</p>
      </div>
    );

  if (!initialTopMostItemIndex)
    return (
      <div
        className='absolute inset-0 flex items-center justify-center bg-white z-50'
        data-testid='chat-list-loading'
      >
        <LoadingAnimation
          message='Loading conversations...'
          source='ChatListV11: getChannelConversations'
          url={location.pathname}
        />
      </div>
    );

  return (
    <div
      data-component='ChatListV11'
      data-testid='chat-message-list'
      className='flex-1 relative no-scrollbar min-h-0'
    >
      {/* Sticky date pill overlay */}
      {stickyDate && (
        <div className='absolute top-0 left-0 right-0 z-10 flex justify-center pointer-events-none py-2'>
          <DatePill dateText={stickyDate} />
        </div>
      )}

      <Virtuoso
        ref={virtuosoRef}
        rangeChanged={handleRangeChanged}
        increaseViewportBy={1000}
        firstItemIndex={firstItemIndex}
        heightEstimates={itemHeights}
        followOutput={false}
        atTopThreshold={400}
        atTopStateChange={atTop => {
          if (atTop && isInitialLoadComplete && initialPositionSetRef.current) {
            fetchOlderMessages();
          }
        }}
        initialTopMostItemIndex={initialTopMostItemIndex}
        data={combinedMessages}
        minOverscanItemCount={20}
        computeItemKey={(_, item) => item.data.conversationId}
        itemContent={itemIndex => {
          // Convert virtual index to array index
          const arrayIndex = itemIndex - firstItemIndex;
          const item = combinedMessages[arrayIndex];

          if (!item) return null;

          const prevItem = arrayIndex > 0 ? combinedMessages[arrayIndex - 1] : null;
          const showDatePill =
            !prevItem || item.createdAt.toDateString() !== prevItem.createdAt.toDateString();

          const isNewMessageBoundary =
            newConversationBoundary !== null && arrayIndex === newConversationBoundary.index;

          return (
            <div data-item-timestamp={item.createdAt.getTime()} ref={itemRef}>
              {showDatePill && (
                <div>
                  <DatePill dateText={formatDatePill(item.createdAt)} />
                </div>
              )}
              {isNewMessageBoundary && (
                <div className='relative py-3'>
                  <div className='absolute left-0 right-0 top-1/2 h-px bg-red-500 z-0'></div>
                  <div className='relative z-5 flex items-center justify-center'>
                    <span className='text-xs text-red-500 bg-white px-2 font-medium'>
                      New Messages
                    </span>
                  </div>
                </div>
              )}
              <ChatListItem
                item={item}
                index={arrayIndex}
                chatListItems={combinedMessages}
                channelId={channelId}
                projectId={projectId}
                channelScopeType={channelScopeType}
                handleOpenThread={handleOpenThread}
              />
            </div>
          );
        }}
        style={{ height: '100%', zIndex: 0 }}
      />

      {/* New messages pill — hides once boundary enters viewport, stays hidden until new boundary */}
      {newConversationBoundary !== null && newConversationBoundary.seenConvId === null && (
        <button
          data-track-category='CHAT_LIST'
          data-track-name='CLICK_NEW_MESSAGES_PILL'
          onClick={handleNewMessagesScroll}
          className='cursor-pointer absolute top-6 left-1/2 -translate-x-1/2 bg-blue-900 text-white px-2 py-2 rounded-full flex items-center gap-1 shadow-lg z-50'
        >
          <ArrowDown className='w-3 h-3' />
          <span className='text-xs font-medium'>
            {`New messages (${combinedMessages.length - newConversationBoundary.index})`}
          </span>
        </button>
      )}

      {/* Latest messages floating pill */}
      {latestConversationsList.length > 0 && (
        <button
          data-track-category='CHAT_LIST'
          data-track-name='CLICK_LATEST_MESSAGES_PILL'
          onClick={() => handleLatestMessagesScroll()}
          className='cursor-pointer absolute bottom-6 left-1/2 -translate-x-1/2 bg-blue-900 text-white px-2 py-2 rounded-full flex items-center gap-1 shadow-lg z-50'
        >
          <ArrowDown className='w-3 h-3' />
          <span className='text-xs font-medium'>Latest messages</span>
        </button>
      )}

      {/* Scroll to bottom button */}
      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className='absolute bottom-6 right-6 bg-white border border-gray-300 rounded-full p-3 shadow-lg hover:shadow-xl transition-all duration-200 hover:bg-gray-50 z-50'
          aria-label='Scroll to bottom'
          data-track-category='CHAT_LIST'
          data-track-name='SCROLL_TO_BOTTOM'
        >
          <ArrowDown className='w-5 h-5 text-gray-700' />
        </button>
      )}
    </div>
  );
};

export default ChatListV3;
