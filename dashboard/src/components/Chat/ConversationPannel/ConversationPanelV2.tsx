import { ReactElement, useCallback, useMemo, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useRouteContext } from '../../../hooks/useRouteContext';
import {
  useChannel,
  useGetChannelConversations,
  useGetChannelUserStatus,
} from '../../../hooks/useChannels';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { useDragAndDropAreaRef } from '../../../hooks/useDragAndDropAreaRef';
import { useConversationTabs } from './ConversationPannel.utils';
import { useChannelSubscription } from '../../../hooks/useChannelSubscription';
import { useScope, useShortcutById } from '../../../shortcuts';
import { ChannelVisibility } from '@xyne/shared';
import { standaloneNavigate } from '../../../utils/electronApp';
import { ConversationTabContext } from '../ConversationTabContext';
import ConversationHeader from '../ConversationHeader/ConversationHeader';
import DragAndDropOverlay from '../DragAndDropOverlay';
import LoadingAnimation from '../Loader/Loader';
import JoinChannel from '../JoinChannel/JoinChannel';
import { ChatInput } from '../ChatInput';
import FileListV2 from '../FileListV2';
import PinListV2 from '../PinListV2';
import { ThreadMessages } from '../ThreadPannel';
import KanbanBoardScreen from '../../../routes/KanbanBoardScreen';
import CanvasTab from '../../Canvas/CanvasTab';
import { useSelector } from '@xstate/react';
import { stateMachineActor } from '../../../machines/stateMachine';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { TicketDetails } from '../../Tickets/TicketDetails/TicketDetails';
import ChatListV3 from '../ChatList/ChatListV3';

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
      <PanelResizeHandle className='w-1 hover:bg-blue-50 active:bg-blue-100 transition-colors duration-200 cursor-col-resize flex items-center justify-center group'>
        <div id='panel-resize-divider' className='w-[1px] h-full bg-gray-200'></div>
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

const ConversationPanelV2 = ({
  channelId,
  previousChannelId,
}: {
  channelId: string;
  previousChannelId: string | null;
}): ReactElement => {
  const { baseRoute } = useRouteContext();
  const channel = useChannel(channelId);
  const channelParticipation = useGetChannelUserStatus(channelId);
  const cachedConversations = useGetChannelConversations(channelId);
  const { dragAndDropAreaRef, inputRef, isDragging } = useDragAndDropAreaRef(channelId);

  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Get dynamic tabs based on permissions and channel scope type
  const { availableTabs, getDefaultTab, isValidTab } = useConversationTabs(channel?.scopeType);

  const urlHashValue = location.hash.match(/origin=([^&#]+)/);

  const urlCreatedAtMatch = location.hash.match(/createdAt=([^&#]+)/);
  const urlConversationId = urlHashValue ? urlHashValue[1] : null;

  const tab = searchParams.get('tab') || getDefaultTab();
  const ticketId = searchParams.get('ticketId');
  const conversationId = searchParams.get('conversationId');

  const [initialMessageById] = useCachedQuery(
    queries.getConversationById({ conversationId: urlConversationId || '' }),
    { enabled: !!urlConversationId && !urlCreatedAtMatch },
  );

  const urlCreatedAt =
    urlCreatedAtMatch && urlCreatedAtMatch[1]
      ? parseInt(urlCreatedAtMatch[1], 10)
      : urlConversationId
        ? initialMessageById?.createdAt
        : null;

  // Skip mark as read functionality
  const skipMarkAsReadRef = useRef(false);
  const setSkipMarkAsRead = useCallback((skip: boolean) => {
    skipMarkAsReadRef.current = skip;
  }, []);

  useChannelSubscription(channelId, []);
  useScope('channel', !!channelId);
  useShortcutById('global.openCanvasTab', () => {
    handleTabChange('canvas');
  });

  // Check if channel is public and user is not a member
  const isUserMember = !!channelParticipation;
  const shouldShowJoinChannel = channel?.visibility === ChannelVisibility.PUBLIC && !isUserMember;

  // Safe tab setter with validation
  const handleTabChange = (tab: string, e?: React.MouseEvent): void => {
    if (isValidTab(tab)) {
      standaloneNavigate(navigate, `${baseRoute}/${channelId}?tab=${tab}`, { event: e });
    }
  };

  return (
    <ConversationTabContext.Provider
      value={{ setActiveTab: handleTabChange, setSkipMarkAsRead, skipMarkAsReadRef }}
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
              {urlConversationId && !urlCreatedAt ? (
                <div className='absolute inset-0 flex items-center justify-center bg-background z-50'>
                  <LoadingAnimation
                    source='ConversationPannelV2: getLinkedConversation'
                    url={location.pathname}
                    message='Messages are loading...'
                  />
                </div>
              ) : (
                <ChatListV3
                  {...(urlConversationId && { linkedConversationId: urlConversationId })}
                  {...(urlCreatedAt && { linkedItemCreatedAt: { createdAt: urlCreatedAt } })}
                  cachedConversations={cachedConversations}
                  channelId={channelId}
                  projectId={channel?.projectId}
                  channelScopeType={channel?.scopeType}
                  skipMarkAsReadRef={skipMarkAsReadRef}
                ></ChatListV3>
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
        </div>
      </div>
    </ConversationTabContext.Provider>
  );
};

export default ConversationPanelV2;
