import { ReactElement, useEffect, useRef, useMemo, useCallback } from 'react';
import { queries } from '../../../zero/queries';
import { useZero } from '../../../hooks/useZero';
import {
  useChannel,
  useGetChannelUserStatus,
  useGetLatestConversation,
} from '../../../hooks/useChannels';
import { ChatInput } from '../ChatInput';
import JoinChannel from '../JoinChannel/JoinChannel';
import { ConversationTabContext } from '../ConversationTabContext';
import { ChannelVisibility, ChannelScopeType } from '@xyne/shared';
import { useChannelSubscription } from '../../../hooks/useChannelSubscription';
import ConversationHeader from '../ConversationHeader/ConversationHeader';
import { useDragAndDropAreaRef } from '../../../hooks/useDragAndDropAreaRef';
import DragAndDropOverlay from '../DragAndDropOverlay';
import CanvasTab from '../../Canvas/CanvasTab';
import LinksTab from '../LinksTab/LinksTab';
import { useConversationTabs } from './ConversationPannel.utils';
import KanbanBoardScreen from '../../../routes/KanbanBoardScreen';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { mixpanelService } from '../../../services/Analytics/mixpanelService';
import { EVENTS, EVENT_PROPERTIES } from '../../../services/Analytics/mixpanel.types';
import ChatListV2 from '../ChatList/ChatListV2';
import FileListV2 from '../FileListV2';
import PinListV2 from '../PinListV2';
import LoadingAnimation from '../Loader/Loader';
import { mutators } from '../../../zero/mutators';
import { useShortcutById, useScope } from '../../../shortcuts';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { TicketDetails } from '../../Tickets/TicketDetails/TicketDetails';
import ThreadMessages from '../ThreadPannel';
import { useRouteContext } from '../../../hooks/useRouteContext';
import { useCachedQuery } from '../../../hooks/useCachedQuery';

import { standaloneNavigate } from '../../../utils/electronApp';
import { useSelector } from '@xstate/react';
import { stateMachineActor } from '../../../machines/stateMachine';
import { getDraft } from '../../../hooks/useDraft';
import { v4 as uuidv4 } from 'uuid';

interface NavigationState {
  fromMyTickets?: boolean;
}

const ExpandedTicketView = ({
  ticketId,
  channelId,
  conversationId,
}: {
  ticketId: string;
  channelId: string;
  conversationId: string;
}): ReactElement => {
  const navigate = useNavigate();
  const { buildChannelRoute } = useRouteContext();
  const [ticket] = useCachedQuery(queries.ticketById({ ticketId }));
  const [allProjectTickets] = useCachedQuery(
    queries.ticketsByProject({ projectId: ticket?.projectId ?? '' }),
  );

  const filteredIds = useSelector(stateMachineActor, s => s.context.filteredTicketIds || []);

  // Filter tickets by current ticket's board and sort by createdAt desc
  const boardTickets = useMemo(() => {
    if (!ticket?.boardId || !allProjectTickets) return [];
    const baseBoardTickets = [...allProjectTickets]
      .filter(t => t.boardId === ticket.boardId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (filteredIds && filteredIds.length > 0) {
      return baseBoardTickets.filter(t => filteredIds.includes(t.id));
    }

    return baseBoardTickets;
  }, [allProjectTickets, ticket?.boardId, filteredIds]);

  // Navigation state
  const currentIndex = boardTickets.findIndex(t => t.id === ticketId);
  const totalCount = boardTickets.length;
  const canNavigatePrevious = currentIndex > 0;
  const canNavigateNext = currentIndex < totalCount - 1;

  const location = useLocation();
  const navState = location.state as NavigationState;

  const handleNavigatePrevious = (): void => {
    const prevTicket = boardTickets[currentIndex - 1];
    if (!prevTicket) return;
    void navigate(
      buildChannelRoute(prevTicket.channelId, {
        tab: 'tickets',
        ticketId: prevTicket.id,
        conversationId: prevTicket.conversationId,
      }),
      {
        state: navState,
      },
    );
  };

  const handleNavigateNext = (): void => {
    const nextTicket = boardTickets[currentIndex + 1];
    if (!nextTicket) return;
    void navigate(
      buildChannelRoute(nextTicket.channelId, {
        tab: 'tickets',
        ticketId: nextTicket.id,
        conversationId: nextTicket.conversationId,
      }),
      {
        state: navState,
      },
    );
  };

  return (
    <PanelGroup direction='horizontal'>
      <Panel minSize={60}>
        <TicketDetails
          ticketId={ticketId}
          expandedView={true}
          navigation={{
            currentIndex,
            totalCount,
            canNavigatePrevious,
            canNavigateNext,
          }}
          onNavigatePrevious={handleNavigatePrevious}
          onNavigateNext={handleNavigateNext}
        />
      </Panel>
      <PanelResizeHandle className='w-1 hover:bg-accent active:bg-muted transition-colors duration-200 cursor-col-resize flex items-center justify-center group'>
        <div id='panel-resize-divider' className='w-[1px] h-full bg-border'></div>
      </PanelResizeHandle>
      <Panel minSize={40}>
        <ThreadMessages
          channelId={channelId}
          conversationId={conversationId}
          underTicketView={true}
        />
      </Panel>
    </PanelGroup>
  );
};

const ConversationPannel = ({
  channelId,
  previousChannelId,
}: {
  channelId: string;
  previousChannelId: string | null;
}): ReactElement => {
  // const [chatMessages] = useQuery(channelConversations(context, channelId || ''), { ttl: '10m' });
  const location = useLocation();
  const { baseRoute } = useRouteContext();
  const urlHashValue = location.hash.match(/origin=([^&#]+)/);

  const latestConversationFromXState = useGetLatestConversation(channelId);
  const urlConversationId = urlHashValue ? urlHashValue[1] : null;
  const userChannelStatus = useGetChannelUserStatus(channelId);
  const lastViewedTimestamp = userChannelStatus?.lastViewedAt;
  const channel = useChannel(channelId || '');
  const [latestMessage, latestMessageDetails] = useCachedQuery(
    queries.channelLatestConversation({ channelId, isMember: !!userChannelStatus }),
  );

  const latestMessageRef = useRef(latestMessage);

  useEffect(() => {
    latestMessageRef.current = latestMessage;
  }, [latestMessage]);

  const participationStatus = useGetChannelUserStatus(channelId);
  const [initialMessageById] = useCachedQuery(
    queries.getConversationByIdWithChannel({
      conversationId: urlConversationId || '',
      channelId: channelId || '',
      isMember: !!participationStatus,
    }),
    { enabled: !!urlConversationId },
  );
  const [initialMessageByTimestamp] = useCachedQuery(
    queries.getConversationByTimestamp({
      channelId,
      timestamp: lastViewedTimestamp || 0,
      isMember: !!userChannelStatus,
    }),
    { enabled: !!lastViewedTimestamp && !urlConversationId },
  );
  // Determine which initial message to use
  const initialMessage = initialMessageById || initialMessageByTimestamp;
  const messageLoadStartTimeRef = useRef<number | null>(null);
  const zero = useZero();
  const { dragAndDropAreaRef, inputRef, isDragging } = useDragAndDropAreaRef(channelId);

  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Get dynamic tabs based on permissions and channel scope type
  const { availableTabs, getDefaultTab, isValidTab } = useConversationTabs(channel?.scopeType);

  const tab = searchParams.get('tab') || getDefaultTab();
  const ticketId = searchParams.get('ticketId');
  const conversationId = searchParams.get('conversationId');
  // Skip mark as read functionality
  const skipMarkAsReadRef = useRef(false);
  const setSkipMarkAsRead = useCallback((skip: boolean) => {
    skipMarkAsReadRef.current = skip;
  }, []);

  // Track if component has been mounted long enough to be considered "viewed"
  const hasBeenViewedRef = useRef(false);

  useEffect(() => {
    if (!channelId) return;

    // Mark as viewed after a short delay to avoid marking on quick navigation/remounts
    const viewedTimer = setTimeout(() => {
      hasBeenViewedRef.current = true;
    }, 500);

    return () => {
      clearTimeout(viewedTimer);

      if (skipMarkAsReadRef?.current) {
        skipMarkAsReadRef.current = false;
        return;
      }

      // Only mark as viewed if the component was actually viewed
      if (!hasBeenViewedRef.current) {
        return;
      }

      hasBeenViewedRef.current = false;

      const draft = getDraft(channelId, null);

      const payload = {
        channelId,
        ...(latestMessageRef.current?.conversationId && {
          conversationId: latestMessageRef.current.conversationId,
        }),
        timestamp: Date.now(),
        draftMessageId: uuidv4(),
        draftMessage: draft || '',
      };

      void zero.mutate(mutators.channel.markChannelAsViewed(payload));
    };
  }, [channelId]);

  // const conversationIds = useMemo(() => {
  //   if (!chatMessages) return [];
  //   return chatMessages.map(conv => conv.conversationId).filter(Boolean);
  // }, [chatMessages]);

  useChannelSubscription(channelId, []);

  const trackMessageLoadedPerformance = (startTime: number, messageType: string) => {
    const scopeType =
      channel?.scopeType && channel.scopeType !== ChannelScopeType.DEFAULT
        ? channel.scopeType
        : 'Channel';

    const timeTakenMs = Date.now() - startTime;

    mixpanelService.track(EVENTS.PERFORMANCE_METRIC, {
      type: messageType,
      timeTakenMs,
      // channelLength: chatMessages?.length || 0,
      scopeType,
      isInThread: false,
    });
  };

  // Track channel message loading performance
  useEffect(() => {
    if (latestMessageDetails.type === 'unknown') {
      messageLoadStartTimeRef.current = Date.now();
    } else if (latestMessageDetails.type === 'complete') {
      if (messageLoadStartTimeRef.current !== null) {
        trackMessageLoadedPerformance(
          messageLoadStartTimeRef.current,
          EVENT_PROPERTIES.PERFORMANCE_METRIC_TYPES.MESSAGES_LOADED,
        );
        messageLoadStartTimeRef.current = null;
      }
    } else if (latestMessageDetails.type === 'error') {
      if (messageLoadStartTimeRef.current !== null) {
        trackMessageLoadedPerformance(
          messageLoadStartTimeRef.current,
          EVENT_PROPERTIES.PERFORMANCE_METRIC_TYPES.MESSAGES_LOAD_FAILED,
        );
        messageLoadStartTimeRef.current = null;
      }
    } else {
      messageLoadStartTimeRef.current = null;
    }
  }, [latestMessageDetails.type, channel?.scopeType, channelId]);

  const channelParticipation = useGetChannelUserStatus(channelId);
  const isUserMember = !!channelParticipation;

  // Activate 'channel' scope when in a channel
  useScope('channel', !!channelId);

  // Keyboard shortcut for opening canvas tab in this channel
  useShortcutById('global.openCanvasTab', () => {
    handleTabChange('canvas');
  });

  // Check if channel is public and user is not a member
  const shouldShowJoinChannel =
    channel?.visibility === ChannelVisibility.PUBLIC && !isUserMember && !channel?.isArchived;

  // Safe tab setter with validation
  const handleTabChange = (tab: string, e?: React.MouseEvent): void => {
    if (isValidTab(tab)) {
      standaloneNavigate(navigate, `${baseRoute}/${channelId}?tab=${tab}`, { event: e });
    }
  };

  const effectiveLatestMessage = latestMessage || latestConversationFromXState;

  return (
    <ConversationTabContext.Provider
      value={{
        setActiveTab: handleTabChange,
        setSkipMarkAsRead,
        skipMarkAsReadRef,
      }}
    >
      <div key={`${channelId}-conversation-panel`} className='w-full relative h-full flex flex-col'>
        <ConversationHeader
          channelId={channelId}
          previousChannelId={previousChannelId}
          channelTabs={availableTabs}
          activeTab={tab}
          setActiveTab={handleTabChange}
        />
        <div className='flex-1 flex flex-col overflow-hidden pt-16 [@media(min-width:500px)]:pt-0'>
          {tab === 'messages' && (
            <div ref={dragAndDropAreaRef} className='flex-1 flex flex-col overflow-hidden relative'>
              <DragAndDropOverlay isVisible={isDragging} />
              {/* <ChatList
                channelId={channelId}
                messages={chatMessages}
                projectId={channel?.projectId}
                channelScopeType={channel?.scopeType}
              /> */}
              {effectiveLatestMessage ? (
                <ChatListV2
                  initialItem={{
                    conversationId: initialMessage
                      ? initialMessage.conversationId
                      : effectiveLatestMessage.conversationId,
                    createdAt: initialMessage
                      ? initialMessage.createdAt
                      : effectiveLatestMessage.createdAt,
                  }}
                  latestConversation={{
                    conversationId: effectiveLatestMessage.conversationId,
                    createdAt: effectiveLatestMessage.createdAt,
                  }}
                  lastViewedAt={lastViewedTimestamp ?? null}
                  channelId={channelId}
                  projectId={channel?.projectId}
                  channelScopeType={channel?.scopeType}
                ></ChatListV2>
              ) : latestMessageDetails.type === 'complete' ? (
                <div className='text-center text-muted-foreground flex-1 flex items-center justify-center'>
                  <p className='text-muted-foreground'>No conversations in this channel yet</p>
                </div>
              ) : (
                <div className='absolute inset-0 flex items-center justify-center bg-background z-50'>
                  <LoadingAnimation
                    source='ConversationPannel: channelLatestConversation'
                    url={location.pathname}
                    message='Messages are loading...'
                  />
                </div>
              )}
              {shouldShowJoinChannel ? (
                <JoinChannel channelId={channelId} channelTitle={channel?.name} />
              ) : (
                <div className='px-4 pt-4 pb-4 bg-background'>
                  <ChatInput
                    autoFocus='end' // eslint-disable-line jsx-a11y/no-autofocus
                    ref={inputRef}
                    channelId={channelId || ''}
                  />
                </div>
              )}
            </div>
          )}

          {tab === 'files' && <FileListV2 channelId={channelId} />}
          {tab === 'pins' && <PinListV2 channelId={channelId} />}
          {tab === 'tickets' &&
            (!!ticketId && !!conversationId ? (
              <ExpandedTicketView
                ticketId={ticketId}
                channelId={channelId}
                conversationId={conversationId}
              />
            ) : (
              <KanbanBoardScreen channelId={channelId} />
            ))}
          {tab === 'canvas' && <CanvasTab channelId={channelId} />}
          {tab === 'links' && <LinksTab channelId={channelId} />}
        </div>
      </div>
    </ConversationTabContext.Provider>
  );
};

export default ConversationPannel;
