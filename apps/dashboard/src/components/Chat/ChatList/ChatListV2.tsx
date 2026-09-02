import { useQuery } from '../../../hooks/useQuery';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { queries } from '../../../zero/queries';
import { useAuth } from '../../../hooks/useAuth';
import { useRouteContext } from '../../../hooks/useRouteContext';
import { useCombinedMesseges } from './ChatListV2.utils';
import { usePlatform } from '../../../hooks/usePlatform';
import { GroupedVirtuoso, GroupedVirtuosoHandle } from 'react-virtuoso';
import { DatePill } from '../DatePill';
import { formatDatePill } from '../../../utils/dateUtils';
import { ChatListItem } from '../ChatListItem/ChatListItem';
import { MessageHoverToolbar } from '../HoverActionsToolbar/MessageHoverToolbar';
import { useNavigate, useLocation } from 'react-router-dom';
import LoadingAnimation from '../Loader/Loader';
import { ChannelScopeType, MessageType } from '@xyne/shared';
import { Conversation } from '../../../machines/stateMachine';
import { ArrowDown } from 'lucide-react';
import { useGetChannelConversations, useGetChannelUserStatus } from '../../../hooks/useChannels';
import { EditSurfaceScope, useMessageEdit } from '../../../providers/EditProvider';
import { useShortcutById } from '../../../shortcuts';
import { findLastEditableMessage, isEventFromEmptyInput } from '../../../utils/chatUtils';
import { standaloneNavigate } from '../../../utils/electronApp';
import { queryCacheActor } from '../../../machines/queryCacheMachine';
import { getInitialMessageFromConversation } from '../../../utils/conversationMessageHelpers';

export type ChatListProps = {
  channelId: string;
  projectId?: string | undefined;
  initialItem: Anchor;
  latestConversation: Anchor;
  lastViewedAt?: number | null;
  channelScopeType?: ChannelScopeType | undefined;
  skipScrollResetRef?: React.MutableRefObject<boolean> | null;
};

type Anchor = {
  conversationId: string;
  createdAt: number;
};

const PAGE_SIZE = 50;

const ChatListV2: React.FC<ChatListProps> = ({
  channelId,
  projectId,
  initialItem,
  latestConversation,
  lastViewedAt,
  channelScopeType,
  skipScrollResetRef,
}): React.ReactElement => {
  const navigate = useNavigate();
  const location = useLocation();
  const { baseRoute } = useRouteContext();
  const { isMobile } = usePlatform();
  const [newestConversation, setNewestConversations] = useState<Anchor>(initialItem);
  const [currentNewestConversation, setCurrentNewestConversationId] = useState<Anchor>(initialItem);
  const [oldestConversation, setOldestConversation] = useState<Anchor>(initialItem);
  const [firstItemIndex, setFirstItemIndex] = useState(100000);
  const virtuosoRef = useRef<GroupedVirtuosoHandle>(null);
  // Container for the shared hover toolbar overlay (one toolbar per list).
  const hoverToolbarContainerRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const { isEditingMessage, requestEdit } = useMessageEdit();
  const particpantionStatus = useGetChannelUserStatus(channelId);
  const [oldConversations, oldConversationsDetails] = useQuery(
    queries.channelConversationsPaginatedV3({
      channelId,
      limit: PAGE_SIZE,
      start: oldestConversation ? { createdAt: oldestConversation.createdAt } : null,
      direction: 'forward', // (get NEWER messages)
      isMember: !!particpantionStatus,
    }),
  );

  // Reset pagination anchors when initialItem changes and load messages around it
  useEffect(() => {
    // Skip scroll reset if flag is set (e.g., when marking as unread)
    if (skipScrollResetRef?.current) {
      skipScrollResetRef.current = false;
      return;
    }
    setScrollState({ isAtPosition: false });
    setNewestConversations(initialItem);
    setOldestConversation(initialItem);
    setCurrentNewestConversationId(initialItem);
  }, [initialItem.conversationId]);

  const [inViewAnchor, setInviewAnchor] = useState<Anchor | null>(initialItem);
  const [updatedConveresations, updatedConveresationsDetails] = useQuery(
    queries.channelConversationsPaginatedV3({
      channelId,
      limit: PAGE_SIZE,
      start: inViewAnchor ? { createdAt: inViewAnchor.createdAt } : null,
      direction: 'forward',
      isMember: !!particpantionStatus,
    }),
  );
  const [newConversations, newConversationsDetails] = useQuery(
    queries.channelConversationsPaginatedV3({
      channelId,
      limit: 0,
      start: newestConversation ? { createdAt: newestConversation.createdAt } : null,
      direction: 'backward',
      isMember: !!particpantionStatus,
    }),
  );

  const rangeRef = useRef<{ startIndex: number; endIndex: number } | null>(null);
  const [isScrolling, setScrolling] = useState(false);

  const conversations: Conversation[] = useGetChannelConversations(channelId);

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

    if (isEditingMessage(message.messageId)) {
      scrollToConversation();
      return;
    }

    requestEdit(message.messageId, scrollToConversation);
  }, [conversations, user?.id, firstItemIndex, isEditingMessage, requestEdit]);

  useShortcutById('composer.editLastMessage', handleEditLastMessage, {
    enabled: conversations.length > 0,
    when: isEventFromChannelInput,
  });

  const [scrollState, setScrollState] = useState({
    isAtPosition: false, // tracks if we're at the position specified by alignAt
  });

  const isNearBottomRef = useRef(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [hasShownNewMessagesIndicator, setHasShownNewMessagesIndicator] = useState(false);

  useEffect(() => {
    let timeOutCanceller = undefined;
    if (!isScrolling && rangeRef.current !== null) {
      timeOutCanceller = setTimeout(() => {
        if (rangeRef.current === null) return;
        const index = rangeRef.current?.endIndex - firstItemIndex;
        const itemIndex = Math.min(conversations.length - 1, index + 20);
        if (itemIndex === conversations.length - 1) {
          setInviewAnchor(null);
          return;
        }
        const item = conversations[itemIndex];
        if (item) {
          setInviewAnchor({
            conversationId: item.conversationId,
            createdAt: item.createdAt,
          });
        }
      }, 1000);
    }

    return () => {
      if (timeOutCanceller !== undefined) {
        clearTimeout(timeOutCanceller);
      }
    };
  }, [isScrolling]);

  useEffect(() => {
    if (newConversationsDetails.type === 'complete') {
      const currentConversations =
        queryCacheActor.getSnapshot().context.channelConversations[channelId] ?? [];
      const newConversationList = newConversations.reverse();
      const updatedConversations = currentConversations.map((c: Conversation) => {
        const exists = newConversations.find(
          (v: Conversation) => v.conversationId === c.conversationId,
        );
        return exists || c;
      });
      const itemsToAdd = newConversationList.filter(
        (c: Conversation) =>
          !updatedConversations.some((v: Conversation) => v.conversationId === c.conversationId),
      );
      const newConversationsAfterAppend = [...updatedConversations, ...itemsToAdd];
      queryCacheActor.send({
        type: 'SET_CONVERSATIONS',
        channelId,
        conversations: newConversationsAfterAppend.sort((a, b) => a.createdAt - b.createdAt),
      });
    }
    if (oldConversationsDetails.type === 'complete') {
      const currentConversations =
        queryCacheActor.getSnapshot().context.channelConversations[channelId] ?? [];
      const itemsToAdd = oldConversations.filter(
        c => !currentConversations.some(v => v.conversationId === c.conversationId),
      );
      const updatedConversations = currentConversations.map(c => {
        const exists = oldConversations.find(v => v.conversationId === c.conversationId);
        return exists || c;
      });
      const filteredItemsToAdd = oldConversations.filter(
        c => !updatedConversations.some(v => v.conversationId === c.conversationId),
      );
      const newConversationsAfterAppend = [...filteredItemsToAdd, ...updatedConversations];
      queryCacheActor.send({
        type: 'SET_CONVERSATIONS',
        channelId,
        conversations: newConversationsAfterAppend.sort((a, b) => a.createdAt - b.createdAt),
      });
      if (itemsToAdd.length > 0 && combinedMessages.length > 0) {
        setFirstItemIndex(prevIndex => prevIndex - itemsToAdd.length);
      }
    }
  }, [
    newConversations,
    newConversationsDetails.type,
    oldConversations,
    oldConversationsDetails.type,
    channelId,
  ]);

  useEffect(() => {
    if (updatedConveresationsDetails.type === 'complete') {
      const currentConversations =
        queryCacheActor.getSnapshot().context.channelConversations[channelId] ?? [];
      const itemsToDelete: Conversation[] = [];
      // set the oldest message in till message and set the fromMessage to the newset message in side the updatedMessage and use createdAt for it
      let fromMessage = updatedConveresations[0];
      let tillMessage = updatedConveresations[updatedConveresations.length - 1];
      if (fromMessage && tillMessage) {
        const tempMessage = { ...fromMessage };
        fromMessage = fromMessage.createdAt < tillMessage.createdAt ? fromMessage : tillMessage;
        tillMessage = tillMessage.createdAt > tempMessage.createdAt ? tillMessage : tempMessage;
        let flag = 0;
        for (const conv of currentConversations) {
          if (fromMessage?.conversationId === conv.conversationId) {
            flag = 1;
          }
          if (
            flag === 1 &&
            updatedConveresations.find(v => v.conversationId === conv.conversationId) === undefined
          ) {
            itemsToDelete.push(conv);
          }
          if (tillMessage.conversationId === conv.conversationId) {
            flag = inViewAnchor === null ? 1 : 0;
          }
        }
      } else {
        if (updatedConveresations.length === 0) {
          itemsToDelete.push(...currentConversations);
        }
      }

      const updated = currentConversations
        .filter(conv => !itemsToDelete.some(v => v.conversationId === conv.conversationId))
        .map(conv => {
          const item = updatedConveresations.find(v => v.conversationId === conv.conversationId);
          if (item) return item;
          return conv;
        });
      queryCacheActor.send({
        type: 'SET_CONVERSATIONS',
        channelId,
        conversations: updated,
      });
    }
  }, [updatedConveresations, channelId]);

  const lastConversationAutoScrollKey = useMemo(() => {
    const lastConversation = conversations[conversations.length - 1];
    if (!lastConversation) return '';
    return `${lastConversation.conversationId}:${lastConversation.initial_message_md ?? ''}`;
  }, [conversations]);

  useEffect(() => {
    if (!scrollState.isAtPosition) return;

    const currentLastConversation = conversations[conversations.length - 1];
    const lastConvInitMsg = currentLastConversation
      ? getInitialMessageFromConversation(currentLastConversation)
      : null;
    const isLastMessegeMine = lastConvInitMsg ? lastConvInitMsg.senderId === user?.id : false;
    if (isNearBottomRef.current || isLastMessegeMine) {
      setTimeout(() => {
        if (virtuosoRef.current) {
          virtuosoRef.current.scrollToIndex({
            index: 'LAST',
            align: 'end',
            behavior: 'auto',
          });
        }
      }, 100);
    }
  }, [currentNewestConversation.conversationId, lastConversationAutoScrollKey]);

  useEffect(() => {
    const latesMessageExists = conversations.find(
      v => v.conversationId === latestConversation.conversationId,
    );
    if (latesMessageExists && conversations.length > 0) {
      const latestMessageFromConversation = conversations[conversations.length - 1];
      if (latestMessageFromConversation) {
        setCurrentNewestConversationId(prev => {
          if (
            prev.conversationId === latestMessageFromConversation.conversationId &&
            prev.createdAt === latestMessageFromConversation.createdAt
          ) {
            return prev; // same values — bail out and avoid re-render loop
          }
          return {
            conversationId: latestMessageFromConversation.conversationId,
            createdAt: latestMessageFromConversation.createdAt,
          };
        });
      }
    }
    if (conversations.length < PAGE_SIZE) {
      setInviewAnchor(null);
    }
  }, [conversations]);

  const { dateGroups, groupCounts, combinedMessages } = useCombinedMesseges(
    conversations,
    isMobile,
  );

  // Reset indicator state when channelId changes
  useEffect(() => {
    setHasShownNewMessagesIndicator(false);
  }, [channelId]);

  // Determine if we should show the "New Messages" indicator
  // Compare lastViewedAt with latestConversation.createdAt (latest message time)
  useEffect(() => {
    if (hasShownNewMessagesIndicator || !lastViewedAt) return;

    // If latest message time is newer than lastViewedAt, show the indicator once
    if (latestConversation.createdAt > lastViewedAt) {
      setHasShownNewMessagesIndicator(true);
    }
  }, [latestConversation.createdAt, lastViewedAt, hasShownNewMessagesIndicator]);

  // Find the index of the first message created after lastViewedAt (for positioning the indicator)
  // Only consider messages from other users, not the current user
  // Exclude all system messages except ticket creation messages
  const lastViewedConversationIndex = useMemo(() => {
    if (!hasShownNewMessagesIndicator || !lastViewedAt) {
      return -1;
    }

    return combinedMessages.findIndex(item => {
      if (item.type !== 'conversation') return false;
      if (item.createdAt.getTime() <= lastViewedAt) return false;
      if (item.data.createdBy === user?.id) return false;
      const initMsg = getInitialMessageFromConversation(item.data);
      if (initMsg?.senderId === user?.id) return false;

      // For system messages, only show indicator for ticket creation messages
      if (initMsg?.msgType === MessageType.SYSTEM) {
        const isTicketMessage = item.data.ticketId !== null;
        if (!isTicketMessage) return false;
      }

      return true;
    });
  }, [combinedMessages, lastViewedAt, hasShownNewMessagesIndicator, user?.id]);

  // Scroll to initialItem on mount dsf sd
  useEffect(() => {
    if (combinedMessages.length === 0 || scrollState.isAtPosition) return;

    const initialItemIndex = combinedMessages.findIndex(
      item => item.data.conversationId === initialItem.conversationId,
    );

    if (initialItemIndex !== -1 && virtuosoRef.current) {
      const virtualIndex = firstItemIndex + initialItemIndex;

      virtuosoRef.current.scrollIntoView({
        index:
          initialItem.conversationId === latestConversation.conversationId
            ? virtualIndex
            : initialItemIndex,
        align: initialItem.conversationId === latestConversation.conversationId ? 'end' : 'center',
        behavior: 'auto',
        done() {
          setScrollState({ isAtPosition: true });
        },
      });
    }
  }, [combinedMessages.length, scrollState, initialItem.conversationId, firstItemIndex]);

  // Track scroll position and load older conversations when near top
  const handleRangeChanged = useCallback(
    (range: { startIndex: number; endIndex: number }) => {
      if (combinedMessages.length === 0) return;

      const totalItems = combinedMessages.length;
      const lastIndex = totalItems - 1 + firstItemIndex;

      // Track if near bottom (within ~3 items ≈ 300px assuming ~100px per item)
      isNearBottomRef.current = range.endIndex >= lastIndex - 3;
      rangeRef.current = range;

      // Show scroll button if not near bottom and there are new messages
      // Compare lastViewedAt with latestConversation.createdAt (latest message time)
      const hasNewMessages =
        lastViewedAt !== null &&
        lastViewedAt !== undefined &&
        latestConversation.createdAt > lastViewedAt;
      setShowScrollButton(!isNearBottomRef.current && hasNewMessages);
    },
    [
      combinedMessages,
      combinedMessages.length,
      scrollState.isAtPosition,
      firstItemIndex,
      oldConversationsDetails.type,
      conversations,
      oldestConversation.conversationId,
      lastViewedAt,
      latestConversation.createdAt,
    ],
  );

  const handleTopReached = useCallback(() => {
    // Load older conversations when scrolling near the top (within 10 items)
    if (oldConversationsDetails.type === 'complete') {
      const firstConversation = conversations[0];
      if (firstConversation && scrollState.isAtPosition) {
        setOldestConversation({
          conversationId: firstConversation.conversationId,
          createdAt: firstConversation.createdAt,
        });
      }
    }
  }, [oldConversationsDetails.type, conversations, scrollState.isAtPosition]);

  const handleOpenThread = useCallback(
    (conversationId: string, e?: React.MouseEvent): void => {
      const conversation = conversations.find(c => c.conversationId === conversationId);

      const conversationMetadata = conversation?.metadata as { ticketId?: string } | null;
      const convInitMsg = conversation ? getInitialMessageFromConversation(conversation) : null;
      const messageMetadata = convInitMsg?.metadata as {
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

  const scrollToBottom = useCallback(() => {
    if (virtuosoRef.current) {
      virtuosoRef.current.scrollToIndex({
        index: 'LAST',
        align: 'end',
        behavior: 'smooth',
      });
      setShowScrollButton(false);
    }
  }, []);

  if (
    conversations.length === 0 ||
    !conversations.map(c => c.conversationId).includes(initialItem.conversationId)
  ) {
    return (
      <div
        className='absolute inset-0 flex items-center justify-center bg-background z-50'
        data-testid='chat-list-loading'
      >
        <LoadingAnimation
          message='Loading conversations...'
          source='ChatListV2: useGetChannelConversations'
          url={location.pathname}
        />
      </div>
    );
  }

  return (
    <div
      ref={hoverToolbarContainerRef}
      data-component='ChatListV2'
      data-testid='chat-message-list'
      className='flex-1 relative no-scrollbar min-h-0'
    >
      <GroupedVirtuoso
        ref={virtuosoRef}
        groupCounts={groupCounts}
        rangeChanged={handleRangeChanged}
        atTopStateChange={atTop => {
          if (atTop) {
            handleTopReached();
          }
        }}
        increaseViewportBy={200}
        firstItemIndex={firstItemIndex}
        defaultItemHeight={100}
        isScrolling={setScrolling}
        minOverscanItemCount={10}
        alignToBottom={true}
        data-testid='virtuoso-item-list'
        groupContent={groupIndex => {
          const dateString = dateGroups[groupIndex];
          if (!dateString) return null;

          return (
            <div data-index={groupIndex}>
              <DatePill dateText={formatDatePill(new Date(dateString))} />
            </div>
          );
        }}
        itemContent={itemIndex => {
          // Convert virtual index to array index
          const arrayIndex = itemIndex - firstItemIndex;
          const item = combinedMessages[arrayIndex];

          if (!item) return null;

          // Show red line indicator above the first new message (conversation after last viewed)
          const isNewMessageBoundary =
            lastViewedConversationIndex !== -1 && arrayIndex === lastViewedConversationIndex;

          return (
            <div key={item.data.conversationId}>
              {isNewMessageBoundary && (
                <div className='relative py-3'>
                  <div className='absolute left-0 right-0 top-1/2 h-px bg-destructive z-0'></div>
                  <div className='relative z-5 flex items-center justify-center'>
                    <span className='text-xs text-destructive bg-background px-2 font-medium'>
                      New Messages
                    </span>
                  </div>
                </div>
              )}
              <ChatListItem
                key={item.data.conversationId}
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

      {/* ONE shared hover-actions toolbar for the entire list (zero-render hover). */}
      <MessageHoverToolbar containerRef={hoverToolbarContainerRef} />

      {/* Scroll to bottom button */}
      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className='absolute bottom-6 right-6 bg-background border border-border rounded-full p-3 shadow-lg hover:shadow-xl transition-all duration-200 hover:bg-accent z-50'
          aria-label='Scroll to bottom'
          data-track-category='CHAT_LIST'
          data-track-name='SCROLL_TO_BOTTOM'
          data-track-metadata={JSON.stringify({
            channelId,
            currentLatestConversationId: latestConversation.conversationId,
          })}
        >
          <ArrowDown className='w-5 h-5 text-foreground' />
        </button>
      )}
    </div>
  );
};

const ChatListV2WithEditSurface: React.FC<ChatListProps> = props => (
  <EditSurfaceScope>
    <ChatListV2 {...props} />
  </EditSurfaceScope>
);

export default ChatListV2WithEditSurface;
