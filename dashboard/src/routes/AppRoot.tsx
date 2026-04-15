import { createBrowserRouter, Outlet, useLocation, useNavigate } from 'react-router-dom';
import SplashScreen from './SplashScreen/SplashScreen';
import ProtectedRoute from '../components/Auth/ProtectedRoute';
import { useActivityTracker } from '../hooks/useActivityTracker';
import HomeScreen from './HomeScreen';
import AuthScreen from './AuthScreen/AuthScreen';
import OnboardingScreen from './OnboardingScreen/OnboardingScreen';
import ChatScreen from './ChatScreen/ChatScreen';
import ThreadMessages from '../components/Chat/ThreadPannel';
import TicketsScreen from './TicketsScreen/TicketScreen';
import TicketView from '../components/Tickets/TicketView/TicketView';
import WorkflowScreen from './WorkflowScreen/WorkflowScreen';
import VSCodeWorkspaceScreen from './VSCodeWorkspaceScreen/VSCodeWorkspaceScreen';
import { BrowserTabsScreen } from './BrowserTabsScreen';
import AgentsScreen from './AgentsScreen/AgentScreen';
import KnowledgeBaseScreen from './KnowledgeBaseScreen/KnowledgeBase';
import { MemoryScreen } from './MemoryScreen';
import AnalyticsScreen from './AnalyticsScreen/AnalyticsScreen';
import ProjectsScreen from './ProjectsScreen/ProjectsScreen';
import UserGroupsScreen from './UserGroupsScreen/UserGroupsScreen';
import ProjectDetailScreen from './ProjectDetailScreen/ProjectDetailScreen';
import KanbanBoardScreen from './KanbanBoardScreen/KanbanBoardScreen';
import MyTicketsScreen from './FilteredTicketsScreen/FilteredTicketsScreen.tsx';
import SupportScreen from './SupportScreen/SupportScreen.tsx';
import CanvasScreen from '../components/Canvas/CanvasScreen';
import CanvasPanel from '../components/Canvas/CanvasPanel/CanvasPanel';
import CallPage from './CallScreen/CallPage';
import CanvasRedirectPage from './CanvasRedirect/CanvasRedirectPage';
import AppSidebar from '../components/AppSidebar/AppSidebar';
import { ReactElement, useRef, useEffect, useState } from 'react';
import ZeroProvider from '../providers/ZeroProvider';
import { EditProvider } from '../providers/EditProvider';
import { EditWarningModal } from '../components/Chat/EditWarningModal/EditWarningModal';
import { IncomingCallModal } from '../components/Call/CallModals/IncomingCallModal';
import { GlobalCallOverlay } from '../components/Call/CallOverlay/GlobalCallOverlay';
import { MobileCallHeader } from '../components/Call/MobileCallHeader/MobileCallHeader';
import { NotificationHandler } from '../components/NotificationHandler/NotificationHandler';
import { CallFromRecentsHandler } from '../components/CallFromRecentsHandler/CallFromRecentsHandler';
import { usePlatform } from '../hooks/usePlatform';
import { roomActor } from '../machines/roomMachine';
import ChatView from '../components/Chat/ChatView/ChatView';
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
  ImperativePanelHandle,
} from 'react-resizable-panels';
import WebView from '../components/WebView/WebView';
import { useSelector } from '@xstate/react';
import { webviewActor, setPanelRefs } from '../machines/webviewMachine';
import { xyneAIActor, setXyneAIPanelRefs } from '../machines/xyneAIMachine';
import { browserPanelActor, setBrowserPanelRefs } from '../machines/browserPanelMachine';
import ActivityListView from '../components/Activity/ActivityListView/ActivityListView';
import Search from '../components/Chat/Search/Search';
import ProjectsListView from './ProjectsScreen/ProjectsListView';
import BookmarksPanel from '../components/Chat/BookmarksPanel/BookmarksPanel';
import UserThreads from '../components/Chat/UserThreads/UserThreads';
import { RecapPanel } from '../components/RecapPanel';
import { RouterErrorFallback } from '../components/ErrorBoundary';
import ChatRedirect from '../components/Chat/ChatRedirect/ChatRedirect';
import DirectoryRedirect from '../components/Chat/DirectoryRedirect/DirectoryRedirect';
import CallHistoryScreen from './CallHistoryScreen/CallHistoryScreen';
import RecordingsScreen from './RecordingsScreen/RecordingsScreen';
import RecordingDetailScreen from './RecordingDetailScreen/RecordingDetailScreen';
import { RecordingOverlay } from '../components/Recording/RecordingOverlay/RecordingOverlay';
import FormScreen from './FormScreen/FormScreen';
import ScheduledMessageScreen from './ScheduledMessageScreen/ScheduledMessageScreen';
import InitialStateLoader from '../providers/InitialStateLoader';
import { ZeroFallbackProvider } from '../contexts/ZeroFallbackContext';
import { InstrumentationProvider, type Instrumentation } from '@xyne/shared/hooks';
import { logger } from '../utils/logger';
import {
  zeroQueryLatency,
  zeroQueryOperations,
  zeroMutationLatency,
  zeroMutationOperations,
  zeroRunLatency,
  zeroRunOperations,
  safeRecordMetric,
} from '../services/otel';

const dashboardInstrumentation: Instrumentation = {
  logger,
  metrics: {
    recordLatency: (name: string, durationMs: number, attributes?: Record<string, string>) => {
      safeRecordMetric(() => {
        if (name === 'zero.query.latency') {
          zeroQueryLatency.record(durationMs, attributes);
        } else if (name === 'zero.mutation.latency') {
          zeroMutationLatency.record(durationMs, attributes);
        } else if (name === 'zero.run.latency') {
          zeroRunLatency.record(durationMs, attributes);
        }
      });
    },
    incrementCounter: (name: string, attributes?: Record<string, string>) => {
      safeRecordMetric(() => {
        if (name === 'zero.query.operations') {
          zeroQueryOperations.add(1, attributes);
        } else if (name === 'zero.mutation.operations') {
          zeroMutationOperations.add(1, attributes);
        } else if (name === 'zero.run.operations') {
          zeroRunOperations.add(1, attributes);
        }
      });
    },
  },
};
import { useSwipeBack } from '../hooks/useSwipeBack';
import DmsPage from '../components/Chat/DirectMessages/DmsPage';
import ProfileSidebar from '../components/ProfileSidebar/ProfileSidebar';
import UserGroupSidePanel from '../components/UserGroup/UserGroupSidePanel/UserGroupSidePanel';
import GlobalTopBar from '../components/GlobalTopBar/GlobalTopBar';
import GlobalCommandMenu from '../components/GlobalCommandMenu/GlobalCommandMenu';
import ProductInsightsScreen from './ProductInsightsScreen/ProductInsightsScreen';
import LaunchScreen from './LaunchScreen/LaunchScreen';
import { AssignmentConfigWrapper } from '../components/UserGroup/AssignmentConfigScreen';
import { ShortcutsHelpModal } from '../components/ShortcutsHelpModal/ShortcutsHelpModal';
import { useShortcutById } from '../shortcuts';
import { useGlobalShortcuts } from '../hooks/useGlobalShortcuts';
import {
  AIOnboardingProvider,
  useAIOnboarding,
  isAIOnboardingCompleted,
  isAIOnboardingPending,
  clearAIOnboardingPending,
  isAIOnboardingActive,
} from '../contexts/AIOnboardingContext';
import DocsScreen from './DocsScreen/DocsScreen';
import { AIOnboardingOverlay } from '../components/AIOnboarding/AIOnboardingOverlay';
import XyneAISidebar from '../components/Chat/XyneAISidebar/XyneAISidebar';
import { BrowserPanel, BrowserPanelHandler } from '../components/BrowserPanel';
import { AttachmentGalleryModal } from '../components/FileViewer/FileViewerModal';
import { sharedChatRoutes } from './SharedChatRoutes';
import { ResourceAccessScreen } from './ResourceAccessScreen/ResourceAccessScreen';
import { ResourceProtectedRoute } from '../components/Auth/ResourceProtectedRoute';
import DashboardCreation from './DashboardCreation/DashboardCreation';
import QueryBuilderScreen from './QueryBuilderScreen/QueryBuilderScreen.tsx';
import Drawer from '../components/ui/Drawer';
import { reactNativeBridge, NativeOutboundMessageType } from '../utils/reactNativeBridge';
import RCADetailScreen from './RCAScreen/RCAScreen.tsx';
import RCAListScreen from './RCAScreen/RCAListScreen.tsx';
import { ShareRecordingHandler } from '../components/Chat/ShareRecordingHandler/ShareRecordingHandler';
import JiraMigrationScreen from './JiraMigrationScreen/JiraMigrationScreen';

/** Auto-triggers AI onboarding after the existing 6-step onboarding completes, or resumes on refresh */
const AIOnboardingTrigger = ({ isOnboarding }: { isOnboarding: boolean }): null => {
  const { startOnboarding } = useAIOnboarding();

  useEffect(() => {
    if (isOnboarding) return;
    if (isAIOnboardingCompleted()) return;

    // First-time trigger: pending flag set by OnboardingScreen on completion
    if (isAIOnboardingPending()) {
      clearAIOnboardingPending();
      startOnboarding('auto', true);
      return;
    }

    // Resume after refresh: load existing conversation, don't start fresh
    if (isAIOnboardingActive()) {
      startOnboarding('auto', false);
    }
  }, [isOnboarding, startOnboarding]);

  return null;
};

const AppRoot = (): ReactElement => {
  // Create panel refs for WebView
  const leftPanelRef = useRef<ImperativePanelHandle>(null);
  const rightPanelRef = useRef<ImperativePanelHandle>(null);

  // Create panel refs for XyneAI
  const xyneAILeftPanelRef = useRef<ImperativePanelHandle>(null);
  const xyneAIRightPanelRef = useRef<ImperativePanelHandle>(null);

  const browserPanelLeftRef = useRef<ImperativePanelHandle>(null);
  const browserPanelRightRef = useRef<ImperativePanelHandle>(null);

  const navigate = useNavigate();

  // Shortcuts help modal state
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);
  useShortcutById('global.openShortcutsHelp', () => setIsShortcutsModalOpen(prev => !prev));
  useShortcutById(
    'global.composeMessage',
    () => void navigate('/chat/search?mode=dm', { replace: true }),
  );

  // Set panel refs when component mounts
  useEffect(() => {
    setPanelRefs({
      left: leftPanelRef,
      right: rightPanelRef,
    });
    setXyneAIPanelRefs({
      left: xyneAILeftPanelRef,
      right: xyneAIRightPanelRef,
    });
    setBrowserPanelRefs({
      left: browserPanelLeftRef,
      right: browserPanelRightRef,
    });
  }, []);

  // Register global keyboard shortcuts
  useGlobalShortcuts({ leftPanelRef });

  const webviewState = useSelector(webviewActor, state => state.context.webviewState);
  const xyneAIState = useSelector(xyneAIActor, state => state);
  const xyneAIChannelId = useSelector(xyneAIActor, state => state.context.channelId);
  const browserPanelState = useSelector(
    browserPanelActor,
    state => state.context.browserPanelState,
  );
  const xyneAICanvasInfo = useSelector(xyneAIActor, state => state.context.canvasInfo);
  const xyneAIThreadInfo = useSelector(xyneAIActor, state => state.context.threadInfo);
  const xyneAIStartFreshChat = useSelector(xyneAIActor, state => state.context.startFreshChat);
  const { isMobile } = usePlatform();

  // Get current location to check if we're on onboarding or vscode
  const location = useLocation();

  // Initialize activity tracking
  useActivityTracker(location.pathname);
  const isOnboarding = location.pathname === '/onboarding';
  const isOnVSCode = location.pathname === '/vscode';

  useEffect(() => {
    if (!reactNativeBridge.isAvailable()) {
      return;
    }
    const path = `${location.pathname}${location.search}${location.hash}`;
    reactNativeBridge.notifyRouteReady(path);
  }, [location]);

  // Get call state for mobile header using snapshot
  const callSnapshot = useSelector(roomActor, state => state);
  const {
    viewMode: machineViewMode,
    participants,
    activeCalls,
    externalId,
    room,
    isNativeMode,
  } = callSnapshot.context;
  const machineState = callSnapshot.value;

  // Compute mic state from LiveKit (not stored in context)
  const isMicEnabled = isNativeMode
    ? (participants.find(p => p.isLocal)?.isMicrophoneEnabled ?? false)
    : (room?.localParticipant.isMicrophoneEnabled ?? false);

  const isCallActive =
    (typeof machineState === 'object' && 'connected' in machineState) ||
    machineState === 'connecting';
  const shouldShowMobileHeader =
    isMobile && isCallActive && machineViewMode === 'mini' && externalId && !isOnboarding;

  // Enable swipe back gesture on mobile
  useSwipeBack();

  const prevPathnameRef = useRef(location.pathname);
  useEffect(() => {
    const prev = prevPathnameRef.current;
    prevPathnameRef.current = location.pathname;

    if (
      browserPanelState === 'open' &&
      prev.startsWith('/chat') &&
      !location.pathname.startsWith('/chat')
    ) {
      browserPanelActor.send({ type: 'CLOSE' });
    }
  }, [location.pathname, browserPanelState]);

  // Monitor for pathname changes to update XyneAI context when navigating
  useEffect(() => {
    if (xyneAIState.matches('open')) {
      const pathParts = location.pathname.split('/').filter(Boolean);

      // Check for chat route and extract channelId
      const chatIndex = pathParts.indexOf('chat');
      let channelId: string | null = null;

      if (chatIndex !== -1) {
        // Handle different route patterns:
        // /chat/dir/{channelId} -> channelId is at chatIndex + 2
        // /chat/dm/{channelId} -> channelId is at chatIndex + 2
        // /chat/bookmarks/{channelId} -> channelId is at chatIndex + 2
        // /chat/activity/{channelId} -> channelId is at chatIndex + 2
        const nextSegment = pathParts[chatIndex + 1];

        if (
          nextSegment === 'dir' ||
          nextSegment === 'dm' ||
          nextSegment === 'bookmarks' ||
          nextSegment === 'activity'
        ) {
          // channelId is the segment after the context (dir/dm/bookmarks/activity)
          channelId = pathParts[chatIndex + 2] || null;
        } else if (nextSegment && nextSegment !== 'canvas' && nextSegment !== 'search') {
          // For backward compatibility or other routes, treat next segment as channelId
          channelId = nextSegment;
        }
      }

      // Update channel if we're in a chat route and the channelId changed
      if (channelId && xyneAIChannelId !== channelId) {
        xyneAIActor.send({ type: 'SET_CHANNEL', channelId });
      }

      // Note: We don't close XyneAI when leaving chat - it stays open globally
      // Users can manually close it with the X button
    }
  }, [location.pathname, xyneAIState, xyneAIChannelId]);

  useEffect(() => {
    if (!reactNativeBridge.isAvailable()) {
      return;
    }

    const unsubscribe = reactNativeBridge.on('CLOSE_DRAWER', () => {
      // Don't allow closing during AI onboarding
      if (isAIOnboardingActive()) return;

      const snapshot = xyneAIActor.getSnapshot();
      if (snapshot.matches('open')) {
        xyneAIActor.send({ type: 'CLOSE' });
      }
    });

    return unsubscribe;
  }, []);

  const isXyneAIDrawerOpen = xyneAIState.matches('open');

  useEffect(() => {
    if (!reactNativeBridge.isAvailable()) {
      return;
    }

    const messageType = isXyneAIDrawerOpen
      ? NativeOutboundMessageType.DRAWER_OPENED
      : NativeOutboundMessageType.DRAWER_CLOSED;

    reactNativeBridge.send(messageType);
  }, [isXyneAIDrawerOpen]);

  return (
    <InstrumentationProvider value={dashboardInstrumentation}>
      <ZeroProvider>
        <InitialStateLoader>
          <ZeroFallbackProvider>
            <ShareRecordingHandler />
            <AIOnboardingProvider>
              <AIOnboardingTrigger isOnboarding={isOnboarding} />
              <AIOnboardingOverlay />
              <EditProvider>
                {shouldShowMobileHeader && externalId && (
                  <MobileCallHeader
                    participants={participants}
                    activeCalls={activeCalls}
                    externalId={externalId}
                    isMicEnabled={isMicEnabled}
                    onToggleMic={() => roomActor.send({ type: 'TOGGLE_MIC' })}
                    onDisconnect={() => roomActor.send({ type: 'DISCONNECT' })}
                    onExpand={() => roomActor.send({ type: 'TOGGLE_VIEW' })}
                  />
                )}
                {isOnboarding ? (
                  // Onboarding screen - full width without sidebar
                  <main className={`flex-1 h-screen ${shouldShowMobileHeader ? 'pt-[60px]' : ''}`}>
                    <EditWarningModal />
                    <Outlet />
                  </main>
                ) : xyneAIState.matches('open') && !isMobile ? (
                  // XyneAI is open on desktop - show panel layout with XyneAI
                  <div className='flex flex-col h-screen'>
                    {!isMobile && <GlobalTopBar />}
                    <PanelGroup
                      direction='horizontal'
                      className='flex-1 no-scrollbar min-[500px]:p-2 overflow-auto'
                      autoSaveId='app-root-xyneai'
                    >
                      <Panel ref={xyneAILeftPanelRef} defaultSize={65}>
                        <div className={`flex h-full ${shouldShowMobileHeader ? 'pt-[60px]' : ''}`}>
                          <AppSidebar />
                          {/* VSCode panel - always mounted, visibility controlled by route */}
                          <div
                            className={`flex-1 no-scrollbar overflow-auto ${isOnVSCode ? '' : 'hidden'}`}
                          >
                            <VSCodeWorkspaceScreen />
                          </div>
                          {/* Regular content - hidden when on VSCode route */}
                          <main
                            className={`flex-1 no-scrollbar overflow-auto ${isOnVSCode ? 'hidden' : ''}`}
                          >
                            <EditWarningModal />
                            <Outlet />
                          </main>
                        </div>
                      </Panel>
                      <PanelResizeHandle className='w-1 hover:bg-sidebar-divider active:bg-sidebar-divider transition-colors duration-200 cursor-col-resize flex items-center justify-center group'>
                        <div className='w-0.5 h-8 bg-transparent group-hover:bg-sidebar-divider group-active:bg-sidebar-divider transition-colors duration-200 rounded-full'></div>
                      </PanelResizeHandle>
                      <Panel ref={xyneAIRightPanelRef} defaultSize={35} maxSize={50}>
                        <div className='max-w-[830px] h-full relative'>
                          <XyneAISidebar
                            channelId={xyneAIChannelId}
                            threadInfo={xyneAIThreadInfo}
                            startFreshChat={xyneAIStartFreshChat}
                            canvasInfo={xyneAICanvasInfo}
                          />
                        </div>
                      </Panel>
                    </PanelGroup>
                  </div>
                ) : browserPanelState === 'open' ? (
                  // Browser Panel is open - show panel layout with Browser
                  <div className='flex flex-col h-screen'>
                    {!isMobile && <GlobalTopBar />}
                    <PanelGroup
                      direction='horizontal'
                      className='flex-1 no-scrollbar min-[500px]:p-2 overflow-auto'
                      autoSaveId='app-root-browser'
                    >
                      <Panel ref={browserPanelLeftRef} defaultSize={65}>
                        <div className={`flex h-full ${shouldShowMobileHeader ? 'pt-[60px]' : ''}`}>
                          <AppSidebar />
                          {/* VSCode panel - always mounted, visibility controlled by route */}
                          <div
                            className={`flex-1 no-scrollbar overflow-auto ${isOnVSCode ? '' : 'hidden'}`}
                          >
                            <VSCodeWorkspaceScreen />
                          </div>
                          {/* Regular content - hidden when on VSCode route */}
                          <main
                            className={`flex-1 no-scrollbar overflow-auto ${isOnVSCode ? 'hidden' : ''}`}
                          >
                            <EditWarningModal />
                            <Outlet />
                          </main>
                        </div>
                      </Panel>
                      <PanelResizeHandle className='w-1 hover:bg-sidebar-divider active:bg-sidebar-divider transition-colors duration-200 cursor-col-resize flex items-center justify-center group'>
                        <div className='w-0.5 h-8 bg-transparent group-hover:bg-sidebar-divider group-active:bg-sidebar-divider transition-colors duration-200 rounded-full'></div>
                      </PanelResizeHandle>
                      <Panel ref={browserPanelRightRef} defaultSize={35} maxSize={50}>
                        <div className='h-full'>
                          <BrowserPanel />
                        </div>
                      </Panel>
                    </PanelGroup>
                  </div>
                ) : webviewState === 'closed' || webviewState === 'idle' ? (
                  // When both closed or idle, only show the left panel without resize handle or right panel
                  <div className='flex flex-col h-screen'>
                    {!isMobile && <GlobalTopBar />}
                    <div
                      className={`flex flex-1 overflow-hidden ${shouldShowMobileHeader ? 'pt-[60px]' : ''}`}
                    >
                      <AppSidebar />
                      {/* VSCode panel - always mounted, visibility controlled by route */}
                      <div
                        className={`flex-1 no-scrollbar min-[500px]:p-2 overflow-auto ${isOnVSCode ? '' : 'hidden'}`}
                      >
                        <VSCodeWorkspaceScreen />
                      </div>
                      {/* Regular content - hidden when on VSCode route */}
                      <main
                        className={`flex-1 no-scrollbar min-[500px]:p-2 overflow-auto ${isOnVSCode ? 'hidden' : ''}`}
                      >
                        <EditWarningModal />
                        <Outlet />
                      </main>
                    </div>
                  </div>
                ) : (
                  // WebView is open - show panel layout with WebView
                  <div className='flex flex-col h-screen'>
                    {!isMobile && <GlobalTopBar />}
                    <PanelGroup
                      direction='horizontal'
                      className='flex-1 overflow-hidden'
                      autoSaveId='app-root'
                    >
                      <Panel ref={leftPanelRef} defaultSize={50}>
                        <div className={`flex h-full ${shouldShowMobileHeader ? 'pt-[60px]' : ''}`}>
                          <AppSidebar />
                          {/* VSCode panel - always mounted, visibility controlled by route */}
                          <div
                            className={`flex-1 no-scrollbar overflow-auto ${isOnVSCode ? '' : 'hidden'}`}
                          >
                            <VSCodeWorkspaceScreen />
                          </div>
                          {/* Regular content - hidden when on VSCode route */}
                          <main
                            className={`flex-1 no-scrollbar overflow-auto ${isOnVSCode ? 'hidden' : ''}`}
                          >
                            <EditWarningModal />
                            <Outlet />
                          </main>
                        </div>
                      </Panel>
                      <PanelResizeHandle className='w-2 hover:bg-sidebar-divider active:bg-sidebar-divider transition-colors duration-200 cursor-col-resize flex items-center justify-center group'>
                        <div className='w-0.5 h-8 bg-transparent group-hover:bg-sidebar-divider group-active:bg-sidebar-divider transition-colors duration-200 rounded-full'></div>
                      </PanelResizeHandle>
                      <Panel ref={rightPanelRef} defaultSize={50}>
                        <WebView />
                      </Panel>
                    </PanelGroup>
                  </div>
                )}
                <IncomingCallModal />
                <GlobalCallOverlay />
                <RecordingOverlay />
                <NotificationHandler />
                <CallFromRecentsHandler />
                <BrowserPanelHandler />
                <AttachmentGalleryModal />
                <GlobalCommandMenu />
                <ShortcutsHelpModal
                  isOpen={isShortcutsModalOpen}
                  onClose={() => setIsShortcutsModalOpen(false)}
                />
                {/* XyneAI Mobile Drawer */}
                {isMobile && (
                  <Drawer
                    open={xyneAIState.matches('open')}
                    onOpenChange={open => {
                      // Don't allow closing during AI onboarding
                      if (!open && isAIOnboardingActive()) return;
                      xyneAIActor.send({ type: open ? 'OPEN' : 'CLOSE' });
                    }}
                    title='Xyne AI'
                    description='Ask questions about your channel'
                  >
                    <XyneAISidebar
                      channelId={xyneAIChannelId}
                      threadInfo={xyneAIThreadInfo}
                      startFreshChat={xyneAIStartFreshChat}
                      canvasInfo={xyneAICanvasInfo}
                    />
                  </Drawer>
                )}
              </EditProvider>
            </AIOnboardingProvider>
          </ZeroFallbackProvider>
        </InitialStateLoader>
      </ZeroProvider>
    </InstrumentationProvider>
  );
};

export const router = createBrowserRouter([
  {
    element: <SplashScreen />,
    errorElement: <RouterErrorFallback />,
    children: [
      {
        path: '/',
        element: <ProtectedRoute />,
        children: [
          {
            path: '/',
            element: <AppRoot />,
            children: [
              {
                path: '/',
                element: <HomeScreen />,
              },
              {
                path: '/onboarding',
                element: <OnboardingScreen />,
              },
              {
                path: '/rca',
                element: <RCAListScreen />,
              },
              {
                path: '/rca/:rcaId',
                element: <RCADetailScreen />,
              },
              {
                path: '/chat',
                element: <ChatScreen />,
                children: [
                  // Directory routes (nested under dir)
                  {
                    path: 'dir',
                    children: [
                      {
                        index: true,
                        element: <ChatRedirect />,
                      },
                      // Canvas from directory (must come before :channelId)
                      {
                        path: 'canvas',
                        element: <CanvasScreen />,
                      },
                      {
                        path: 'canvas/:canvasId',
                        element: <CanvasScreen />,
                      },
                      // Threads (must come before :channelId)
                      {
                        path: 'threads',
                        element: <UserThreads />,
                      },
                      // Recap (must come before :channelId)
                      {
                        path: 'recap',
                        children: [
                          {
                            index: true,
                            element: <RecapPanel />,
                          },
                          {
                            path: ':channelId',
                            element: <RecapPanel />,
                            children: [
                              {
                                index: true,
                                element: <ChatView />,
                              },
                            ],
                          },
                        ],
                      },
                      // My Tickets (must come before :channelId)
                      {
                        path: 'my-tickets',
                        element: <MyTicketsScreen />,
                      },
                      // Channel routes (must come after specific routes)
                      {
                        path: ':channelId',
                        element: <ChatView />,
                        children: [
                          {
                            index: true,
                            element: (
                              <div className='flex items-center justify-center h-full text-muted-foreground'>
                                Select a conversation to view messages
                              </div>
                            ),
                          },
                          {
                            path: 'group/:groupId',
                            element: <UserGroupSidePanel />,
                          },
                          {
                            path: ':conversationId',
                            element: <ThreadMessages />,
                          },
                          {
                            path: ':conversationId/:ticketId',
                            element: <ThreadMessages />,
                          },
                          {
                            path: 'profile/:userId',
                            element: <ProfileSidebar />,
                          },
                          {
                            path: 'tickets/:ticketId',
                            element: <TicketView />,
                          },
                          {
                            path: 'canvas',
                            element: <CanvasScreen />,
                          },
                          {
                            path: 'canvas/:canvasId',
                            element: <CanvasScreen />,
                          },
                        ],
                      },
                    ],
                  },
                  // DM routes (full screen with DM list sidebar)
                  {
                    path: 'dm',
                    element: <DmsPage />,
                    children: [{ index: true, element: null }, ...sharedChatRoutes],
                  },
                  // Bookmarks (full screen with bookmarks list sidebar)
                  {
                    path: 'bookmarks',
                    element: <BookmarksPanel />,
                    children: [{ index: true, element: null }, ...sharedChatRoutes],
                  },
                  // Canvas (full screen with 2-panel layout on desktop)
                  {
                    path: 'canvas',
                    element: <CanvasPanel />,
                    children: [
                      {
                        index: true,
                        element: null,
                      },
                      {
                        path: ':canvasId',
                        element: <CanvasScreen />,
                      },
                    ],
                  },
                  // Activity (full screen with activity list sidebar)
                  {
                    path: 'activity',
                    element: <ActivityListView />,
                    children: [{ index: true, element: null }, ...sharedChatRoutes],
                  },
                  // Search (full screen)
                  {
                    path: 'search',
                    element: <Search />,
                  },
                  // Catch-all redirect for old routes: /chat/:channelId/* -> /chat/dir/:channelId/*
                  {
                    path: '*',
                    element: <DirectoryRedirect />,
                  },
                ],
              },
              {
                path: '/tickets',
                element: (
                  <ResourceProtectedRoute resourceName='TICKETS'>
                    <TicketsScreen />
                  </ResourceProtectedRoute>
                ),
              },
              {
                path: '/product-insights',
                element: (
                  <ResourceProtectedRoute resourceName='PRODUCT-INSIGHTS'>
                    <ProductInsightsScreen />
                  </ResourceProtectedRoute>
                ),
              },
              {
                path: '/tickets/:ticketId/workflow/:workflowId',
                element: <WorkflowScreen />,
              },
              {
                path: '/tickets/:ticketId/workflow',
                element: <WorkflowScreen />,
              },
              {
                path: '/agents',
                element: (
                  <ResourceProtectedRoute resourceName='AGENTS'>
                    <AgentsScreen />
                  </ResourceProtectedRoute>
                ),
              },
              {
                path: '/knowledge-base',
                element: (
                  <ResourceProtectedRoute resourceName='KNOWLEDGE-BASE'>
                    <KnowledgeBaseScreen />
                  </ResourceProtectedRoute>
                ),
              },
              {
                path: '/memory',
                element: <MemoryScreen />,
              },
              {
                path: '/analytics',
                element: (
                  <ResourceProtectedRoute resourceName='ANALYTICS'>
                    <AnalyticsScreen />
                  </ResourceProtectedRoute>
                ),
              },
              {
                path: '/projects',
                element: (
                  <ResourceProtectedRoute resourceName='PROJECTS'>
                    <ProjectsScreen />
                  </ResourceProtectedRoute>
                ),
                children: [
                  {
                    index: true,
                    element: <MyTicketsScreen />,
                  },
                  {
                    path: ':projectId',
                    element: <KanbanBoardScreen />,
                  },
                  {
                    path: ':projectId/:boardId',
                    element: <KanbanBoardScreen />,
                  },
                  {
                    path: ':projectId/:boardId/:ticketId',
                    element: <TicketView />,
                  },
                ],
              },
              {
                path: '/user-groups',
                element: (
                  <ResourceProtectedRoute resourceName='USER-GROUPS'>
                    <UserGroupsScreen />
                  </ResourceProtectedRoute>
                ),
              },
              {
                path: '/listProjects',
                element: (
                  <ResourceProtectedRoute resourceName='LISTPROJECTS'>
                    <ProjectsListView />
                  </ResourceProtectedRoute>
                ),
              },
              {
                path: '/listProjects/:projectId',
                element: <ProjectDetailScreen />,
              },
              {
                path: '/calls',
                element: <CallHistoryScreen />,
              },
              {
                path: '/call/:callId',
                element: <CallPage />,
              },
              {
                path: '/calls/:callId/:callType',
                element: <CallPage />,
              },
              {
                path: '/recordings',
                element: <RecordingsScreen />,
              },
              {
                path: '/recordings/:recordingId',
                element: <RecordingDetailScreen />,
              },
              {
                path: '/user-groups/:userGroupId/assignment-config',
                element: (
                  <ResourceProtectedRoute resourceName='USER-GROUPS'>
                    <AssignmentConfigWrapper />
                  </ResourceProtectedRoute>
                ),
              },
              {
                path: '/analytics-dashboard',
                element: (
                  <ResourceProtectedRoute resourceName='ANALYTICS'>
                    <DashboardCreation />
                  </ResourceProtectedRoute>
                ),
              },
              {
                path: '/analytics-dashboard/:dashboardId',
                element: (
                  <ResourceProtectedRoute resourceName='ANALYTICS'>
                    <QueryBuilderScreen />
                  </ResourceProtectedRoute>
                ),
              },
              {
                path: '/support',
                element: (
                  <ResourceProtectedRoute resourceName='SUPPORT'>
                    <SupportScreen />
                  </ResourceProtectedRoute>
                ),
                children: [
                  {
                    path: ':ticketId',
                    element: <Outlet />,
                  },
                ],
              },
              {
                path: '/vscode',
                element: <VSCodeWorkspaceScreen />,
              },
              {
                path: '/browser',
                element: <BrowserTabsScreen />,
              },
              {
                path: '/forms',
                element: (
                  <ResourceProtectedRoute resourceName='FORMS'>
                    <FormScreen />
                  </ResourceProtectedRoute>
                ),
              },
              {
                path: '/scheduled-messages',
                element: <ScheduledMessageScreen />,
              },
              {
                path: '/docs/*',
                element: <DocsScreen />,
              },
              {
                path: '/resource-access',
                element: (
                  <ResourceProtectedRoute resourceName='USERS'>
                    <ResourceAccessScreen />
                  </ResourceProtectedRoute>
                ),
              },
              {
                path: '/jira-migration',
                element: (
                  <ResourceProtectedRoute resourceName='TICKET-MIGRATION'>
                    <JiraMigrationScreen />
                  </ResourceProtectedRoute>
                ),
              },
            ],
          },
        ],
      },

      {
        path: '/call/:callId',
        element: (
          <ZeroProvider>
            <CallPage />
          </ZeroProvider>
        ),
      },
      {
        path: '/redirected',
        element: (
          <ZeroProvider>
            <CanvasRedirectPage />
          </ZeroProvider>
        ),
      },
      {
        path: '/calls/:callId/:callType',
        element: (
          <ZeroProvider>
            <CallPage />
          </ZeroProvider>
        ),
      },
      {
        path: '/newWindow/chat/dir',
        element: (
          <ZeroProvider>
            <InitialStateLoader>
              <EditProvider>
                <div className='h-full bg-background'>
                  <Outlet />
                </div>
                <AttachmentGalleryModal />
              </EditProvider>
            </InitialStateLoader>
          </ZeroProvider>
        ),
        children: [
          {
            path: ':channelId',
            element: <ChatView />,
          },
          {
            path: ':channelId/:conversationId',
            element: <ThreadMessages />,
          },
          {
            path: ':channelId/:conversationId/:ticketId',
            element: <ThreadMessages />,
          },
        ],
      },
      {
        path: '/auth',
        element: <AuthScreen />,
      },
      {
        path: '/launch',
        element: <LaunchScreen />,
      },
    ],
  },
]);
