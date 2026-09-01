import { ReactElement, useCallback, useEffect, useRef, useMemo } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useRouteContext } from '../../../hooks/useRouteContext';
import {
  useChannel,
  getChannelConversationsSnapshot,
  useGetChannelUserStatus,
} from '../../../hooks/useChannels';
import { useDragAndDropAreaRef } from '../../../hooks/useDragAndDropAreaRef';
import { useConversationTabs } from './ConversationPannel.utils';
import { useChannelSubscription } from '../../../hooks/useChannelSubscription';
import { useScope, useShortcutById } from '../../../shortcuts';
import { ChannelVisibility, ChannelScopeType } from '@xyne/shared';
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
import CanvasScreen from '../../Canvas/CanvasScreen';
import { Panel, ResizableGroup, Separator } from '../../ui/Resizable/Resizable';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { TicketDetails } from '../../Tickets/TicketDetails/TicketDetails';
import ChatListV4 from '../ChatList/ChatListV4';
import LinksTab from '../LinksTab/LinksTab';
import { Archive } from 'lucide-react';
import { useUser } from '../../../hooks/useUsers';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { isUserDeactivated } from '../../../utils/userDisplayName';
import { parseDMParticipantIds } from '../ChatDirectory/ChatDirectory.utils';
import { useEphemeralMessages } from '../../../hooks/useEphemeralMessages';

// Stable empty array — an inline `[]` here would be a new reference on every
// render, causing useChannelSubscription's effect to unsubscribe/resubscribe
// the websocket channel on each render (measured as constant subscribe churn).
const NO_CONVERSATION_IDS: string[] = [];

const ExpandedTicketView = ({
  ticketId,
  channelId,
  conversationId,
}: {
  ticketId: string;
  channelId: string;
  conversationId: string;
}): ReactElement => {
  return (
    <ResizableGroup orientation='horizontal'>
      <Panel minSize='60%'>
        <TicketDetails ticketId={ticketId} expandedView={true} />
      </Panel>
      <Separator className='w-1 hover:bg-sidebar-divider active:bg-sidebar-divider transition-colors duration-200 cursor-col-resize flex items-center justify-center group'>
        <div id='panel-resize-divider' className='w-[1px] h-full bg-border'></div>
      </Separator>
      <Panel minSize='40%'>
        <ThreadMessages
          channelId={channelId}
          conversationId={conversationId}
          underTicketView={true}
        />
      </Panel>
    </ResizableGroup>
  );
};

const DeactivatedDmArchiveBanner = (): ReactElement => {
  return (
    <div className='px-4 pt-4 pb-4 bg-background'>
      <div className='flex items-center justify-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground'>
        <Archive className='size-4 shrink-0' />
        <span>You are viewing the archives of a deactivated account</span>
      </div>
    </div>
  );
};

const ConversationPanelV2 = ({
  channelId,
  previousChannelId,
  linkedConversationIdOverride,
  linkedItemCreatedAtOverride,
  onClose,
  showHeader = true,
  hideComposer = false,
  skipMarkAsRead = false,
}: {
  channelId: string;
  previousChannelId: string | null;
  linkedConversationIdOverride?: string | null;
  linkedItemCreatedAtOverride?: number | null;
  onClose?: () => void;
  showHeader?: boolean;
  // When true, suppress the message composer / join / archive footer entirely.
  // Used by read-only surfaces such as the Unreads inbox.
  hideComposer?: boolean;
  skipMarkAsRead?: boolean;
}): ReactElement => {
  const { baseRoute } = useRouteContext();
  const channel = useChannel(channelId);
  const channelParticipation = useGetChannelUserStatus(channelId);
  const { dragAndDropAreaRef, inputRef, isDragging } = useDragAndDropAreaRef(channelId);

  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const skipInputAutoFocus = searchParams.get('nofocus') === '1';

  // Strip the `nofocus` param from the URL after each channel navigation so it
  // doesn't persist on subsequent interactions (composing, tab switches).
  // Runs on every channel change when the param is present — read the value
  // once at arrival so `skipInputAutoFocus` is already `true` for this render.
  useEffect(() => {
    if (searchParams.get('nofocus') !== '1') return;
    const next = new URLSearchParams(searchParams);
    next.delete('nofocus');
    setSearchParams(next, { replace: true });
  }, [channelId, searchParams, setSearchParams]);

  // Get dynamic tabs based on permissions and channel scope type
  const { availableTabs, getDefaultTab, isValidTab } = useConversationTabs(channel?.scopeType);

  const urlHashValue = location.hash.match(/origin=([^&#]+)/);

  const urlCreatedAtMatch = location.hash.match(/createdAt=([^&#]+)/);
  const urlConversationId = linkedConversationIdOverride ?? (urlHashValue ? urlHashValue[1] : null);
  const activityNavigationState = routerLocation.state as {
    linkedItemCreatedAt?: number;
    linkedCutoffCreatedAt?: number | null;
  } | null;
  const stateLinkedItemCreatedAt =
    typeof activityNavigationState?.linkedItemCreatedAt === 'number'
      ? activityNavigationState.linkedItemCreatedAt
      : null;
  const stateLinkedCutoffCreatedAt =
    typeof activityNavigationState?.linkedCutoffCreatedAt === 'number'
      ? activityNavigationState.linkedCutoffCreatedAt
      : null;

  const tab = searchParams.get('tab') || getDefaultTab();
  const ticketId = searchParams.get('ticketId');
  const conversationId = searchParams.get('conversationId');
  const canvasId = searchParams.get('canvasId');

  const participationStatus = useGetChannelUserStatus(channelId);
  const [initialMessageById] = useCachedQuery(
    queries.getConversationByIdWithChannel({
      conversationId: urlConversationId || '',
      channelId: channelId || '',
      isMember: !!participationStatus,
    }),
    { enabled: !!urlConversationId && !urlCreatedAtMatch && stateLinkedItemCreatedAt === null },
  );

  const hashLinkedItemCreatedAt =
    urlCreatedAtMatch && urlCreatedAtMatch[1] ? parseInt(urlCreatedAtMatch[1], 10) : null;
  const urlCreatedAt =
    linkedItemCreatedAtOverride ??
    hashLinkedItemCreatedAt ??
    stateLinkedItemCreatedAt ??
    (urlConversationId ? initialMessageById?.createdAt : null);

  // ONE-TIME windowed snapshot, not a subscription. ChatListV3 only reads
  // cachedConversations in its useState initializer (warm-start hydration),
  // but it also writes back into the cache — subscribing here closed a render
  // loop (every cache write → new ref → panel re-render → list re-render).
  // The snapshot is a ~100-item window: newest by default, centered on the
  // linked anchor for deep links. ChatListV3 mounts only after urlCreatedAt
  // has resolved for linked navigation (the loading gate below), so the
  // anchor is available at hydration time. Older/newer pages load through
  // the normal pagination path.
  const cachedConversations = useMemo(
    () => getChannelConversationsSnapshot(channelId, urlCreatedAt ?? undefined),
    [channelId, urlCreatedAt],
  );

  // Skip mark as read functionality
  const skipMarkAsReadRef = useRef(skipMarkAsRead || false);
  const setSkipMarkAsRead = useCallback((skip: boolean) => {
    skipMarkAsReadRef.current = skip;
  }, []);

  const ephemeralMessages = useEphemeralMessages(channelId);

  useChannelSubscription(channelId, NO_CONVERSATION_IDS);
  useScope('channel', !!channelId);
  useShortcutById('global.openCanvasTab', () => {
    handleTabChange('canvas');
  });

  // Check if channel is public and user is not a member
  const isUserMember = !!channelParticipation;
  const shouldShowJoinChannel =
    channel?.visibility === ChannelVisibility.PUBLIC && !isUserMember && !channel?.isArchived;

  const { userID: currentUserId } = useAuthContextValues();
  const dmPartnerId =
    channel?.scopeType === ChannelScopeType.DM
      ? parseDMParticipantIds(channel).find(id => id !== currentUserId)
      : undefined;
  const isDeactivatedDmArchive = isUserDeactivated(useUser(dmPartnerId ?? ''));

  // Safe tab setter with validation. Memoized because it feeds the context
  // value below — an unstable reference re-rendered every visible ChatBubble
  // (context consumers) on each panel render.
  const handleTabChange = useCallback(
    (tab: string, e?: React.MouseEvent): void => {
      if (isValidTab(tab)) {
        standaloneNavigate(navigate, `${baseRoute}/${channelId}?tab=${tab}`, { event: e });
      }
    },
    [isValidTab, navigate, baseRoute, channelId],
  );

  const conversationTabContextValue = useMemo(
    () => ({ setActiveTab: handleTabChange, setSkipMarkAsRead, skipMarkAsReadRef }),
    [handleTabChange, setSkipMarkAsRead],
  );

  return (
    <ConversationTabContext.Provider value={conversationTabContextValue}>
      <div key={`${channelId}-conversation-panel`} className='w-full relative h-full flex flex-col'>
        {showHeader && (
          <ConversationHeader
            channelId={channelId}
            previousChannelId={previousChannelId}
            channelTabs={availableTabs}
            activeTab={tab}
            setActiveTab={handleTabChange}
            {...(onClose && { onClose })}
          />
        )}
        <div
          className={`flex-1 flex flex-col overflow-hidden ${showHeader ? 'pt-16 [@media(min-width:500px)]:pt-0' : ''}`}
        >
          {tab === 'messages' && (
            <div
              ref={dragAndDropAreaRef}
              className='flex-1 flex flex-col overflow-hidden relative bg-background'
            >
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
                <ChatListV4
                  {...(urlConversationId && { linkedConversationId: urlConversationId })}
                  {...(urlCreatedAt && { linkedItemCreatedAt: { createdAt: urlCreatedAt } })}
                  {...(stateLinkedCutoffCreatedAt && {
                    linkedCutoffCreatedAt: { createdAt: stateLinkedCutoffCreatedAt },
                  })}
                  cachedConversations={cachedConversations}
                  channelId={channelId}
                  projectId={channel?.projectId}
                  channelScopeType={channel?.scopeType}
                  skipMarkAsReadRef={skipMarkAsReadRef}
                  ephemeralMessages={ephemeralMessages}
                ></ChatListV4>
              )}
              {hideComposer ? null : shouldShowJoinChannel ? (
                <JoinChannel channelId={channelId} channelTitle={channel?.name} />
              ) : isDeactivatedDmArchive ? (
                <DeactivatedDmArchiveBanner />
              ) : (
                <div className='pb-3 bg-background px-[var(--composer-px)] [--composer-px:0.75rem]'>
                  <ChatInput
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus={skipInputAutoFocus ? null : 'end'}
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
          {tab === 'canvas' &&
            (canvasId ? <CanvasScreen canvasId={canvasId} /> : <CanvasTab channelId={channelId} />)}
          {tab === 'links' && <LinksTab channelId={channelId} />}
        </div>
      </div>
    </ConversationTabContext.Provider>
  );
};

export default ConversationPanelV2;
