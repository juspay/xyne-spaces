import { ReactElement, useRef, useEffect } from 'react';
import useMeasure from '../../../hooks/useMeasure';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import {
  Outlet,
  useNavigate,
  useParams,
  useLocation,
  useOutletContext,
  useSearchParams,
} from 'react-router-dom';
import ConversationPannel from '../ConversationPannel/ConversationPannel';
import CanvasScreen from '../../Canvas/CanvasScreen';
import { ChannelSummary, ThreadSummary } from '../Summary';
import { ThreadMessages } from '../ThreadPannel';
import { useZero } from '../../../hooks/useZero';
import { ChannelScopeType } from '@xyne/shared';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { mutators } from '../../../zero/mutators';
import {
  mixpanelService,
  EVENTS,
  EVENT_PROPERTIES,
} from '../../../services/Analytics/mixpanelService';
import { usePreviousChannelId } from '../../../hooks/usePreviousChannelId';
import { useChannel, useGetChannelUserStatus } from '../../../hooks/useChannels';
import { setLastVisitedChannel } from '../../../hooks/useLastVisitedChannel';
import { useRouteContext } from '../../../hooks/useRouteContext';

interface ChatScreenContext {
  shouldStackThread?: boolean;
}

const ChatView = (): ReactElement => {
  const chatViewContainerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { channelId, conversationId } = useParams<{ channelId: string; conversationId?: string }>();
  const { userId } = useParams<{ userId?: string }>();
  const context = useAuthContextValues();
  const zero = useZero();
  const [searchParams] = useSearchParams();

  // Canvas fullscreen state from URL params
  const isCanvasFullscreen = searchParams.get('canvasFullscreen') === 'true';

  // Get stacking context from ChatScreen
  const outletContext = useOutletContext<ChatScreenContext>();
  const shouldStackThreadFromParent = outletContext?.shouldStackThread || false;

  // Track previous channelId to detect navigation changes
  const prevChannelIdRef = useRef<string | undefined>(undefined);

  // Track previous channelId for navigation back on leave
  const previousChannelId = usePreviousChannelId(channelId);

  // Query channel data to check if it's a DM and if user's participation is closed
  const channel = useChannel(channelId || '');
  const channelUserStatus = useGetChannelUserStatus(channelId || '');
  const { baseRoute } = useRouteContext();

  // Reopen DM if user navigates to a closed DM (only on navigation, not on data updates)
  useEffect(() => {
    // Only run when channelId changes (navigation), not on data updates
    if (prevChannelIdRef.current === channelId) return;
    prevChannelIdRef.current = channelId;

    if (!channel || !channelId) return;

    const isDM =
      channel.scopeType === ChannelScopeType.DM || channel.scopeType === ChannelScopeType.GROUP_DM;

    // Track conversation opened (no sensitive data - only conversation type)
    const conversationType =
      channel.scopeType === ChannelScopeType.DM
        ? EVENT_PROPERTIES.CONVERSATION_TYPES.DM
        : channel.scopeType === ChannelScopeType.GROUP_DM
          ? EVENT_PROPERTIES.CONVERSATION_TYPES.GROUP_DM
          : EVENT_PROPERTIES.CONVERSATION_TYPES.CHANNEL;

    mixpanelService.track(EVENTS.CONVERSATION_OPENED, {
      type: conversationType,
    });

    if (!isDM) return;

    // If user's participation is closed, reopen it
    if (channelUserStatus?.isClosed) {
      zero.mutate(mutators.channel.reopenDm({ channelId }));
    }
  }, [channel, channelId, context.userID, zero]);

  // Save the current channelId as the last visited channel
  useEffect(() => {
    if (channelId) {
      setLastVisitedChannel(channelId);
    }
  }, [channelId]);

  // Check for canvas in hash with validation
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const canvasIdMatch = location.hash.match(/#canvas=([a-zA-Z0-9-]+)/);
  const potentialCanvasId = canvasIdMatch ? canvasIdMatch[1] : undefined;

  // Validate that the ID is a valid UUID before using it (defense-in-depth)
  const canvasId =
    potentialCanvasId && UUID_REGEX.test(potentialCanvasId) ? potentialCanvasId : undefined;
  const isCanvasActive = !!canvasId;

  // Check for channel summary in hash and extract date params
  const isChannelSummaryActive = location.hash.startsWith('#channel-summary');

  // Check for thread summary mode - when active, thread shows in left panel, summary in right
  const isThreadSummaryActive = location.hash.startsWith('#thread-summary');

  // Parse date params from hash (format: #channel-summary?dateFrom=...&dateTo=...)
  const channelSummaryParams = ((): {
    dateFrom: string | undefined;
    dateTo: string | undefined;
  } => {
    if (!isChannelSummaryActive) return { dateFrom: undefined, dateTo: undefined };
    const hashParts = location.hash.split('?');
    if (hashParts.length < 2) return { dateFrom: undefined, dateTo: undefined };
    const params = new URLSearchParams(hashParts[1]);
    return {
      dateFrom: params.get('dateFrom') || undefined,
      dateTo: params.get('dateTo') || undefined,
    };
  })();

  const isThreadActive = !!conversationId;
  const isProfileActive = !!userId;
  const showSecondaryPanel =
    isThreadActive || isCanvasActive || isProfileActive || isChannelSummaryActive;

  // Handler to close channel summary
  const handleCloseChannelSummary = (): void => {
    void navigate(`${baseRoute}/${channelId}`);
  };

  // Handler to close thread summary - removes hash and goes back to normal view
  const handleCloseThreadSummary = (): void => {
    void navigate(`${baseRoute}/${channelId}/${conversationId}`);
  };

  // Handler to toggle canvas fullscreen mode
  const toggleCanvasFullscreen = (): void => {
    const newSearchParams = new URLSearchParams(searchParams);
    if (isCanvasFullscreen) {
      newSearchParams.delete('canvasFullscreen');
    } else {
      newSearchParams.set('canvasFullscreen', 'true');
    }
    const searchString = newSearchParams.toString();
    const newUrl = `${location.pathname}${searchString ? `?${searchString}` : ''}${location.hash}`;
    void navigate(newUrl, { replace: true });
  };

  const bounds = useMeasure({ ref: chatViewContainerRef, observeResize: true });
  // Stack when either narrow view OR parent says to stack (XyneAI > 700px with thread)
  const shouldStack = bounds.width < 700 || shouldStackThreadFromParent;

  const defaultConversationPannelSize = 50;
  const minConversationPannelSize = 25;
  const defaultSecondaryPanelSize = 50;
  const minSecondaryPanelSize = 40;

  if (channelId === undefined) {
    void navigate('/chat', { replace: true });
  }

  return (
    <div
      ref={chatViewContainerRef}
      data-component='ChatView'
      className='w-full h-full rounded-lg overflow-hidden relative'
    >
      {shouldStack ? (
        <>
          {/* Mobile/stacked layout */}
          {isThreadSummaryActive && conversationId && channelId ? (
            // Thread Summary Mode: Show thread in main view, summary overlays with slide animation
            <>
              <ThreadMessages channelId={channelId} conversationId={conversationId} />
              <div className='absolute inset-0 bg-white z-10 rounded-lg animate-slide-in-from-right'>
                <ThreadSummary
                  conversationId={conversationId}
                  channelName={channel?.['name'] || 'thread'}
                  {...(channel?.scopeType && { scopeType: channel.scopeType as string })}
                  onClose={handleCloseThreadSummary}
                />
              </div>
            </>
          ) : (
            // Normal Mode with stacking support
            <>
              {/* Show thread when parent says to stack, otherwise show channel */}
              {shouldStackThreadFromParent && conversationId ? (
                <Outlet />
              ) : (
                <ConversationPannel
                  channelId={channelId ?? ''}
                  previousChannelId={previousChannelId}
                />
              )}
              {showSecondaryPanel && !shouldStackThreadFromParent && (
                <div className='absolute inset-0 bg-white z-10 rounded-lg animate-slide-in-from-right'>
                  {isCanvasActive ? (
                    <CanvasScreen
                      canvasId={canvasId}
                      isFullscreen={isCanvasFullscreen}
                      onToggleFullscreen={toggleCanvasFullscreen}
                    />
                  ) : isChannelSummaryActive ? (
                    <ChannelSummary
                      channelId={channelId ?? ''}
                      channelName={channel?.['name'] || 'channel'}
                      {...(channel?.scopeType && { scopeType: channel.scopeType as string })}
                      dateFrom={channelSummaryParams.dateFrom}
                      dateTo={channelSummaryParams.dateTo}
                      onClose={handleCloseChannelSummary}
                    />
                  ) : (
                    <Outlet />
                  )}
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <>
          {/* Desktop layout with resizable panels */}
          {isThreadSummaryActive && conversationId && channelId ? (
            // Thread Summary Mode: Thread in left panel, Summary in right panel
            <PanelGroup
              direction='horizontal'
              className='h-full'
              autoSaveId={`${channelId}-thread-summary`}
            >
              <Panel
                defaultSize={defaultConversationPannelSize}
                minSize={minConversationPannelSize}
              >
                <div className='h-full animate-slide-in-from-right'>
                  <ThreadMessages channelId={channelId} conversationId={conversationId} />
                </div>
              </Panel>
              <Panel defaultSize={defaultSecondaryPanelSize} minSize={minSecondaryPanelSize}>
                <div className='h-full bg-gray-50 animate-slide-in-from-right'>
                  <ThreadSummary
                    conversationId={conversationId}
                    channelName={channel?.['name'] || 'thread'}
                    {...(channel?.scopeType && { scopeType: channel.scopeType as string })}
                    onClose={handleCloseThreadSummary}
                  />
                </div>
              </Panel>
            </PanelGroup>
          ) : isChannelSummaryActive && channelId ? (
            <PanelGroup
              direction='horizontal'
              className='h-full'
              autoSaveId={`${channelId}-channel-summary`}
            >
              <Panel
                defaultSize={defaultConversationPannelSize}
                minSize={minConversationPannelSize}
              >
                <ConversationPannel channelId={channelId} previousChannelId={previousChannelId} />
              </Panel>
              <Panel defaultSize={defaultSecondaryPanelSize} minSize={minSecondaryPanelSize}>
                <div className='h-full bg-gray-50 animate-slide-in-from-right'>
                  <ChannelSummary
                    channelId={channelId}
                    channelName={channel?.['name'] || 'channel'}
                    {...(channel?.scopeType && { scopeType: channel.scopeType as string })}
                    dateFrom={channelSummaryParams.dateFrom}
                    dateTo={channelSummaryParams.dateTo}
                    onClose={handleCloseChannelSummary}
                  />
                </div>
              </Panel>
            </PanelGroup>
          ) : (
            // Normal Mode: Handle stacking when parent context indicates (XyneAI > 700px with thread)
            <PanelGroup direction='horizontal' className='h-full' autoSaveId={channelId || null}>
              {/* Conversation Panel - hidden when canvas is fullscreen */}
              {!isCanvasFullscreen && (
                <Panel
                  defaultSize={showSecondaryPanel ? defaultConversationPannelSize : 100}
                  minSize={minConversationPannelSize}
                >
                  <div className='h-full'>
                    {/* When parent says to stack (XyneAI > 700px with thread), show thread here */}
                    {shouldStackThreadFromParent && conversationId ? (
                      <Outlet />
                    ) : (
                      <ConversationPannel
                        channelId={channelId ?? ''}
                        previousChannelId={previousChannelId}
                      />
                    )}
                  </div>
                </Panel>
              )}

              {/* Only show secondary panel if not stacking */}
              {showSecondaryPanel && !shouldStackThreadFromParent && (
                <>
                  {/* Resize handle - hidden when fullscreen */}
                  {!isCanvasFullscreen && (
                    <PanelResizeHandle className='w-1 hover:bg-blue-50 active:bg-blue-100 transition-colors duration-200 cursor-col-resize flex items-center justify-center group'>
                      <div id='panel-resize-divider' className='w-[1px] h-full bg-gray-200'></div>
                    </PanelResizeHandle>
                  )}
                  <Panel
                    defaultSize={isCanvasFullscreen ? 100 : defaultSecondaryPanelSize}
                    minSize={isCanvasFullscreen ? 100 : minSecondaryPanelSize}
                  >
                    <div className='h-full'>
                      {isCanvasActive ? (
                        <CanvasScreen
                          canvasId={canvasId}
                          isFullscreen={isCanvasFullscreen}
                          onToggleFullscreen={toggleCanvasFullscreen}
                        />
                      ) : isChannelSummaryActive ? (
                        <ChannelSummary
                          channelId={channelId ?? ''}
                          channelName={channel?.['name'] || 'channel'}
                          {...(channel?.scopeType && { scopeType: channel.scopeType as string })}
                          dateFrom={channelSummaryParams.dateFrom}
                          dateTo={channelSummaryParams.dateTo}
                          onClose={handleCloseChannelSummary}
                        />
                      ) : (
                        <Outlet />
                      )}
                    </div>
                  </Panel>
                </>
              )}
            </PanelGroup>
          )}
        </>
      )}
    </div>
  );
};

export default ChatView;
