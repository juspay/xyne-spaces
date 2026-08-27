import { ReactElement, useRef, useEffect } from 'react';
import useMeasure from '../../../hooks/useMeasure';
import { ResizableGroup, Panel, Separator } from '../../ui/Resizable/Resizable';
import {
  Navigate,
  Outlet,
  useNavigate,
  useParams,
  useLocation,
  useOutletContext,
  useSearchParams,
} from 'react-router-dom';
import ConversationPanelV2 from '../ConversationPannel/ConversationPanelV2';
import CanvasScreen from '../../Canvas/CanvasScreen';
import { ChannelSummary, ThreadSummary } from '../Summary';
import { ThreadMessages } from '../ThreadPannel';
import { useZero } from '../../../hooks/useZero';
import { ChannelScopeType, isDeskChannelType } from '@xyne/shared';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { mutators } from '../../../zero/mutators';
import {
  mixpanelService,
  EVENTS,
  EVENT_PROPERTIES,
} from '../../../services/Analytics/mixpanelService';
import { usePreviousChannelId } from '../../../hooks/usePreviousChannelId';
import { useChannel, useChannelParticipation } from '../../../hooks/useChannels';
import { setLastVisitedChannel } from '../../../hooks/useLastVisitedChannel';
import { useRouteContext } from '../../../hooks/useRouteContext';
import { usePlatform } from '../../../hooks/usePlatform';
import { useIsInPanelWebview } from '../../../hooks/useIsInPanelWebview';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import { CallExternalChatPanel } from '../../Call/CallExternalChatPanel/CallExternalChatPanel';

interface ChatScreenContext {
  shouldStackThread?: boolean;
}

const ChatView = (): ReactElement => {
  const chatViewContainerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { channelId, conversationId, workspaceId } = useParams<{
    channelId: string;
    conversationId?: string;
    workspaceId?: string;
  }>();
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
  const channelUserStatus = useChannelParticipation(channelId || '');
  const { baseRoute } = useRouteContext();
  const { isMobile } = usePlatform();
  const isInPanelWebview = useIsInPanelWebview();
  const { displayName: channelDisplayName } = useChannelDisplayName(
    channel ?? null,
    context.userID,
  );
  const bounds = useMeasure({ ref: chatViewContainerRef, observeResize: true });

  // When rendered inside the browser-panel webview, reflect the current
  // channel/DM name in `document.title`. The webview's host listens for
  // `page-title-updated` (see BrowserTabsScreen.tsx:196) and uses it as the
  // tab label. Scoped to the webview so the main Electron window's title
  // isn't touched.
  useEffect(() => {
    if (!isInPanelWebview) return;
    if (!channelDisplayName) return;
    const previous = document.title;
    document.title = channelDisplayName;
    return () => {
      document.title = previous;
    };
  }, [isInPanelWebview, channelDisplayName]);

  // Check for group panel from URL params
  const { groupId } = useParams<{ groupId?: string }>();
  const isGroupPanelOpen = !!groupId;

  // Track conversation-opened once per navigation (gated on the channelId change ref).
  useEffect(() => {
    if (prevChannelIdRef.current === channelId) return;
    prevChannelIdRef.current = channelId;

    if (!channel || !channelId) return;

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
  }, [channel, channelId, context.userID, zero]);

  // Reopen a closed DM: its status loads async (absent from the channel-status map), so key on channelUserStatus with a per-channel ref rather than the single-shot navigation ref.
  const reopenAttemptedForRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!channel || !channelId) return;

    const isDM =
      channel.scopeType === ChannelScopeType.DM || channel.scopeType === ChannelScopeType.GROUP_DM;
    if (!isDM) return;

    // Already handled this channel this visit.
    if (reopenAttemptedForRef.current === channelId) return;

    // Status not resolved yet (closed DMs load via a fallback query); this effect re-runs when it changes.
    if (channelUserStatus === undefined) return;

    reopenAttemptedForRef.current = channelId;

    if (channelUserStatus.isClosed) {
      zero.mutate(mutators.channel.reopenDm({ channelId, updatedAt: Date.now() }));
    }
  }, [channel, channelId, channelUserStatus, zero]);

  // Save the current channelId as the last visited channel.
  useEffect(() => {
    if (!channelId || !channel) return;
    if (baseRoute !== '/chat/dir') return;
    if (isDeskChannelType(channel.type)) return;
    setLastVisitedChannel(channelId, workspaceId ?? '');
  }, [channelId, channel, baseRoute]);

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

  const externalChatCallId = searchParams.get('external-call-chat');
  const isExternalChatActive = !!externalChatCallId;

  const isThreadActive = !!conversationId;
  const isFocusThread = isThreadActive && searchParams.get('focusThread') === '1';
  const isProfileActive = !!userId;
  const isThreadProfileActive = isThreadActive && isProfileActive;
  const showSecondaryPanel =
    isThreadActive ||
    isCanvasActive ||
    isProfileActive ||
    isChannelSummaryActive ||
    isGroupPanelOpen ||
    isExternalChatActive;

  // Stack when either narrow view OR parent says to stack (XyneAI > 700px with thread).
  // NOTE: shouldStack can now flip freely at any width without causing a remount of
  // ConversationPanelV2, because the restructured render below always places
  // ConversationPanelV2 in the same PanelGroup > Panel position regardless of
  // shouldStack. The flag only controls how the *secondary* panel is shown
  // (overlay vs side-by-side). Original 700 px threshold restored.
  const shouldStack = bounds.width < 700 || shouldStackThreadFromParent;

  // Percentages — bare numbers are read as pixels by react-resizable-panels.
  const defaultConversationPannelSize = '50%';
  const minConversationPannelSize = '25%';
  const defaultSecondaryPanelSize = '50%';
  const minSecondaryPanelSize = '40%';

  if (channelId === undefined) {
    void navigate('/chat', { replace: true });
  }

  if (isDeskChannelType(channel?.type) && channelId && workspaceId) {
    // Desk/email channels live in the support screen, not the chat view.
    // Preserve the conversation (and mail, if present) so SupportScreen's
    // deeplink resolver can land on the exact ticket + email instead of
    // dropping context at the channel root. conversationId may sit in the
    // route param (/chat/dir/:channelId/:conversationId) or in the
    // `#origin=` hash (/chat/dir/:channelId#origin=:conversationId).
    const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
    const deeplinkConversationId = conversationId || hashParams.get('origin') || undefined;
    const mailId = searchParams.get('mail');
    const params = new URLSearchParams();
    if (deeplinkConversationId) params.set('conversationId', deeplinkConversationId);
    if (mailId) params.set('mail', mailId);
    const qs = params.toString();
    return <Navigate to={`/${workspaceId}/support/${channelId}${qs ? `?${qs}` : ''}`} replace />;
  }

  // Check for the problematic URL pattern on mobile:
  // /chat/dir/${channelId}?tab=tickets&ticketId=${ticketId}&conversationId=${conversationId}
  // On mobile, render ThreadMessages directly instead of the normal ChatView
  const tab = searchParams.get('tab');
  const ticketId = searchParams.get('ticketId');
  const ticketConversationId = searchParams.get('conversationId');
  const isMobileTicketView =
    isMobile && tab === 'tickets' && ticketId && ticketConversationId && channelId;

  // Early return for mobile ticket view - render ThreadMessages directly
  if (isMobileTicketView) {
    // Navigate to add selectedTab=details to the URL
    const newSearchParams = new URLSearchParams(searchParams);
    if (!newSearchParams.has('selectedTab')) {
      newSearchParams.set('selectedTab', 'details');
      void navigate(`${location.pathname}?${newSearchParams.toString()}${location.hash}`, {
        replace: true,
      });
    }
    return (
      <ThreadMessages
        channelId={channelId}
        conversationId={ticketConversationId}
        ticketId={ticketId}
        showHeader={false}
      />
    );
  }

  if (isFocusThread && !isThreadProfileActive) {
    return (
      <div
        ref={chatViewContainerRef}
        data-component='ChatView'
        className={`w-full h-full overflow-hidden relative ${isInPanelWebview ? '' : 'rounded-2xl'}`}
      >
        <Outlet />
      </div>
    );
  }

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

  // Secondary panel content — defined once, reused for both overlay and
  // side-by-side layouts so there is no JSX duplication.
  const secondaryPanelContent = isExternalChatActive ? (
    <CallExternalChatPanel callExternalId={externalChatCallId} />
  ) : isCanvasActive ? (
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
  );

  return (
    <div
      ref={chatViewContainerRef}
      data-component='ChatView'
      className={`w-full h-full overflow-hidden relative ${isInPanelWebview ? '' : 'rounded-2xl'}`}
    >
      {isThreadSummaryActive && conversationId && channelId ? (
        // Thread Summary Mode — unchanged; ConversationPanelV2 is not rendered
        // here so no remount risk from shouldStack flips.
        shouldStack ? (
          <>
            <ThreadMessages channelId={channelId} conversationId={conversationId} />
            <div className='absolute inset-0 bg-background z-10 rounded-2xl animate-slide-in-from-right'>
              <ThreadSummary
                conversationId={conversationId}
                channelName={channel?.['name'] || 'thread'}
                {...(channel?.scopeType && { scopeType: channel.scopeType as string })}
                onClose={handleCloseThreadSummary}
              />
            </div>
          </>
        ) : (
          <ResizableGroup
            orientation='horizontal'
            className='h-full'
            autoSaveId={`${channelId}-thread-summary`}
          >
            <Panel
              id='chat-thread'
              defaultSize={defaultConversationPannelSize}
              minSize={minConversationPannelSize}
            >
              <div className='h-full animate-slide-in-from-right'>
                <ThreadMessages channelId={channelId} conversationId={conversationId} />
              </div>
            </Panel>
            <Separator className='w-[2px] transition-colors cursor-col-resize flex items-center justify-center group'>
              <div
                id='panel-resize-divider'
                className='w-[2px] h-full bg-border group-hover:bg-primary group-active:bg-primary'
              ></div>
            </Separator>
            <Panel
              id='chat-thread-summary'
              defaultSize={defaultSecondaryPanelSize}
              minSize={minSecondaryPanelSize}
            >
              <div className='h-full bg-muted animate-slide-in-from-right'>
                <ThreadSummary
                  conversationId={conversationId}
                  channelName={channel?.['name'] || 'thread'}
                  {...(channel?.scopeType && { scopeType: channel.scopeType as string })}
                  onClose={handleCloseThreadSummary}
                />
              </div>
            </Panel>
          </ResizableGroup>
        )
      ) : (
        // Normal mode (including channel summary) — ConversationPanelV2 is ALWAYS
        // inside the same PanelGroup > Panel regardless of shouldStack. The
        // shouldStack flag only controls whether the secondary panel (thread,
        // canvas, profile, etc.) appears as a side-by-side resizable panel or as
        // an absolute overlay that slides in from the right. This means shouldStack
        // can flip at any width (panel resize, browser panel open/close, window
        // resize) without ever remounting ConversationPanelV2 or ChatListV3.
        <>
          <ResizableGroup
            orientation='horizontal'
            className='h-full'
            autoSaveId={
              isChannelSummaryActive && channelId
                ? `${channelId}-channel-summary`
                : channelId || null
            }
            panelIds={[
              ...(isCanvasFullscreen ? [] : ['chat-conv-panel']),
              ...(showSecondaryPanel && !shouldStack && !shouldStackThreadFromParent
                ? ['chat-secondary-panel']
                : []),
            ]}
          >
            {/* Conversation Panel — stable position forever */}
            {!isCanvasFullscreen && (
              <Panel
                id='chat-conv-panel'
                defaultSize={
                  showSecondaryPanel && !shouldStack ? defaultConversationPannelSize : '100%'
                }
                minSize={minConversationPannelSize}
              >
                <div className='h-full'>
                  {isThreadProfileActive && isFocusThread && channelId && conversationId ? (
                    <ThreadMessages channelId={channelId} conversationId={conversationId} />
                  ) : shouldStackThreadFromParent && conversationId ? (
                    <Outlet />
                  ) : (
                    <ConversationPanelV2
                      channelId={channelId ?? ''}
                      previousChannelId={previousChannelId}
                    />
                  )}
                </div>
              </Panel>
            )}

            {/* Side-by-side secondary panel — only when wide enough */}
            {showSecondaryPanel && !shouldStack && !shouldStackThreadFromParent && (
              <>
                {!isCanvasFullscreen && (
                  <Separator className='w-[2px] transition-colors cursor-col-resize flex items-center justify-center group'>
                    <div
                      id='panel-resize-divider'
                      className='w-[2px] h-full bg-border group-hover:bg-primary group-active:bg-primary'
                    ></div>
                  </Separator>
                )}
                <Panel
                  id='chat-secondary-panel'
                  defaultSize={isCanvasFullscreen ? '100%' : defaultSecondaryPanelSize}
                  minSize={isCanvasFullscreen ? '100%' : minSecondaryPanelSize}
                >
                  <div className='h-full'>{secondaryPanelContent}</div>
                </Panel>
              </>
            )}
          </ResizableGroup>

          {/* Overlay secondary panel — slides over chat when viewport is narrow */}
          {showSecondaryPanel && shouldStack && !shouldStackThreadFromParent && (
            <div className='absolute inset-0 bg-background z-10 rounded-2xl animate-slide-in-from-right'>
              {secondaryPanelContent}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ChatView;
