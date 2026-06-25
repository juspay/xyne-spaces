import { createBrowserRouter, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
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
import { BrowserTabsScreen } from './BrowserTabsScreen';
import { getLastActiveWorkspaceId } from '../machines/authMachine';
import AgentsScreen from './AgentsScreen/AgentScreen';
import { KnowledgeBaseV2Layout } from '../components/knowledgeBaseV2/KnowledgeBaseV2Layout';
import KnowledgeBaseV2Screen from '../components/knowledgeBaseV2/KnowledgeBaseV2Screen';
import { LegacyKbRedirect } from '../components/knowledgeBaseV2/LegacyKbRedirect';
import { MemoryScreen } from './MemoryScreen';
import { FileViewerLayout } from '../components/knowledgeBase/layout/FileViewerLayout';
import AnalyticsScreen from './AnalyticsScreen/AnalyticsScreen';
import ProjectsScreen from './ProjectsScreen/ProjectsScreen';
import UserGroupsScreen from './UserGroupsScreen/UserGroupsScreen';
import ProjectDetailScreen from './ProjectDetailScreen/ProjectDetailScreen';
import ReleaseDetailScreen from './ReleaseDetailScreen/ReleaseDetailScreen';

import KanbanBoardScreen from './KanbanBoardScreen/KanbanBoardScreen';
import MyTicketsScreen from './FilteredTicketsScreen/FilteredTicketsScreen.tsx';
import ProjectViewBuilder from './ProjectViewsScreen/ProjectViewBuilder';
import SupportScreen from './SupportScreen/SupportScreen.tsx';
import SaveRoute from '../components/SaveRoute/SaveRoute';
import CanvasScreen from '../components/Canvas/CanvasScreen';
import CanvasPanel from '../components/Canvas/CanvasPanel/CanvasPanel';
import CallPage from './CallScreen/CallPage';
import CanvasRedirectPage from './CanvasRedirect/CanvasRedirectPage';
import AppSidebar from '../components/AppSidebar/AppSidebar';
import { ReactElement, ReactNode, useRef, useEffect, useState } from 'react';
import ZeroProvider from '../providers/ZeroProvider';
import { EditProvider } from '../providers/EditProvider';
import { EditWarningModal } from '../components/Chat/EditWarningModal/EditWarningModal';
import { IncomingCallModal } from '../components/Call/CallModals/IncomingCallModal';
import { GlobalCallOverlay } from '../components/Call/CallOverlay/GlobalCallOverlay';
import { MobileCallHeader } from '../components/Call/MobileCallHeader/MobileCallHeader';
import { NotificationHandler } from '../components/NotificationHandler/NotificationHandler';
import { CallFromRecentsHandler } from '../components/CallFromRecentsHandler/CallFromRecentsHandler';
import { usePlatform } from '../hooks/usePlatform';
import { useIsInPanelWebview } from '../hooks/useIsInPanelWebview';
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
import { xyneAIActor, setXyneAIPanelRefs, globalXyneAIPanelRefs } from '../machines/xyneAIMachine';
import { browserPanelActor, setBrowserPanelRefs } from '../machines/browserPanelMachine';
import ActivityListView from '../components/Activity/ActivityListView/ActivityListView';
import ActivitySupportTicket from '../components/Activity/ActivitySupportTicket/ActivitySupportTicket';
import Search from '../components/Chat/Search/Search';
import SearchResults from '../components/Chat/SearchResults/SearchResults';
import ProjectsListView from './ProjectsScreen/ProjectsListView';
import BookmarksPanel from '../components/Chat/BookmarksPanel/BookmarksPanel';
import DraftsAndSentPage from '../pages/DraftsAndSentPage';
import UserThreads from '../components/Chat/UserThreads/UserThreads';
import { RecapPanel } from '../components/RecapPanel';
import { RouterErrorFallback } from '../components/ErrorBoundary';
import ChatRedirect from '../components/Chat/ChatRedirect/ChatRedirect';
import DirectoryRedirect from '../components/Chat/DirectoryRedirect/DirectoryRedirect';
import CallHistoryScreen from './CallHistoryScreen/CallHistoryScreen';
import CallDetailScreen from './CallDetailScreen/CallDetailScreen';
import RecordingsScreen from './RecordingsScreen/RecordingsScreen';
import RecordingDetailScreen from './RecordingDetailScreen/RecordingDetailScreen';
import { RecordingOverlay } from '../components/Recording/RecordingOverlay/RecordingOverlay';
import FormScreen from './FormScreen/FormScreen';
import ScheduledMessageScreen from './ScheduledMessageScreen/ScheduledMessageScreen';
import AppsScreen from './AppsScreen/AppsScreen';
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
import { KeyedComposeDmPanel } from '../components/Chat/AddDmForm/ComposeDmPanel';
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
import UnreadsInbox from '../components/Chat/UnreadsInbox/UnreadsInbox';
import DocsScreen from './DocsScreen/DocsScreen';
import { AIOnboardingOverlay } from '../components/AIOnboarding/AIOnboardingOverlay';
import XyneAISidebar from '../components/Chat/XyneAISidebar/XyneAISidebar';
import { BrowserPanel, BrowserPanelHandler } from '../components/BrowserPanel';
import { xyneAIStreamManager } from '../services/XyneAI';
import { AttachmentGalleryModal } from '../components/FileViewer/FileViewerModal';
import { AttachmentCitationPreview } from '../components/FileViewer/AttachmentCitationPreview';
import { ThreadCitationModal } from '../components/xyne-desk/ThreadCitationModal/ThreadCitationModal';
import { sharedChatRoutes } from './SharedChatRoutes';
import { ResourceAccessScreen } from './ResourceAccessScreen/ResourceAccessScreen';
import { ResourceProtectedRoute } from '../components/Auth/ResourceProtectedRoute';
import { WorkspaceManagementScreen } from './WorkspaceManagementScreen';
import OrganisationsScreen from './OrganisationsScreen/OrganisationsScreen';
import { AcceptInvitation } from './InvitationScreen/AcceptInvitation';
import NoOrganizationAccessScreen from './NoOrganizationAccessScreen/NoOrganizationAccessScreen';
import DashboardCreation from './DashboardCreation/DashboardCreation';
import QueryDashboardScreen from '../components/AnalyticsDashboard/QueryDashboardScreen';
import { DynamicDashboardPanel, DynamicDashboardScreen } from '../components/DynamicDashboard';
import Drawer from '../components/ui/Drawer';
import { reactNativeBridge, NativeOutboundMessageType } from '../utils/reactNativeBridge';
import RCADetailScreen from './RCAScreen/RCAScreen.tsx';
import RCAListScreen from './RCAScreen/RCAListScreen.tsx';
import { useAuth } from '../hooks/useAuth';
import { ShareRecordingHandler } from '../components/Chat/ShareRecordingHandler/ShareRecordingHandler';
import { GlobalUploadProgress } from '../components/knowledgeBase/upload/GlobalUploadProgress';
import JiraMigrationScreen from './JiraMigrationScreen/JiraMigrationScreen';
import WhatsAppBulkMigrationScreen from './WhatsAppBulkMigrationScreen/WhatsAppBulkMigrationScreen';
import { ErrorReportModal } from '../components/ErrorReportModal/ErrorReportModal';
import { getTicketsPath } from '../components/ErrorReportModal/ErrorReportModal.utils';
import { useCacConfig } from '../hooks/useCacConfig';
import { useScreenRecorder } from '../hooks/useScreenRecorder';
import type { ScreenSource } from '../types/electron';
import ConfluenceMigrationScreen from './ConfluenceMigrationScreen/ConfluenceMigrationScreen';
import AIScreen from './AIScreen/AIScreen';
import UserGuideScreen from './UserGuideScreen';
import AutomationsListScreen from './AutomationsScreen/AutomationsListScreen';
import AutomationBuilderScreen from './AutomationsScreen/AutomationBuilderScreen';
import AutomationRunsScreen from './AutomationsScreen/AutomationRunsScreen';
import AutomationRunDetailScreen from './AutomationsScreen/AutomationRunDetailScreen';
import AutomationApprovalsScreen from './AutomationsScreen/AutomationApprovalsScreen';
import TeamIntelligenceScreen from './TeamIntelligenceScreen/TeamIntelligenceScreen.tsx';
import TeamIntelligenceOrgScreen from './TeamIntelligenceScreen/TeamIntelligenceOrgScreen.tsx';
import TeamIntelligenceTeamScreen from './TeamIntelligenceScreen/TeamIntelligenceTeamScreen.tsx';
import TeamIntelligenceMemberScreen from './TeamIntelligenceScreen/TeamIntelligenceMemberScreen.tsx';

/** Auth-aware call route: authenticated users join via CallPage, others see external lobby  */
function CallRouteHandler(): ReactElement | null {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return null;
  if (isAuthenticated) {
    return (
      <ZeroProvider>
        <CallPage />
      </ZeroProvider>
    );
  }
  return <Navigate to='/auth' replace />;
}

/** Auto-triggers AI onboarding after the existing 6-step onboarding completes, or resumes on refresh */
const AIOnboardingTrigger = ({ isOnboarding }: { isOnboarding: boolean }): null => {
  const { startOnboarding } = useAIOnboarding();

  useEffect(() => {
    if (isOnboarding) return;
    if (isAIOnboardingCompleted()) {
      // Clean up stale active flag if onboarding was already completed
      if (isAIOnboardingActive()) {
        localStorage.removeItem('xyne-ai-onboarding-active');
      }
      return;
    }

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

/** Elevate Ask AI panel only during AI onboarding so it stacks above the overlay; otherwise leave z-index default (e.g. for @/# mention popovers). */
const XyneAISidebarZIndexShell = ({ children }: { children: ReactNode }): ReactElement => {
  const { state: aiOnboarding } = useAIOnboarding();
  return (
    <div className={aiOnboarding.isActive ? 'h-full relative z-[56]' : 'h-full relative'}>
      {children}
    </div>
  );
};

const XYNE_AI_PANEL_MIN_SIZE = 42;
const XYNE_AI_PANEL_DEFAULT_SIZE = 35;

const WorkspaceRedirect = (): ReactElement => {
  const email = localStorage.getItem('user_email');
  const workspaceId = email ? getLastActiveWorkspaceId(email) : null;
  if (workspaceId) {
    return <Navigate to={`/${workspaceId}`} replace />;
  }
  // No workspace in storage — send to auth
  return <Navigate to='/auth' replace />;
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
  const { user } = useAuth();
  const { config: errorReportCacConfig } = useCacConfig<{ channelId: string; boardId?: string }>({
    key: 'error_report_channel_config',
    fallbackConfig: { channelId: '' },
  });

  // Shortcuts help modal state
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);
  const [isErrorReportOpen, setIsErrorReportOpen] = useState(false);
  const [pendingRecording, setPendingRecording] = useState<File | null>(null);
  const [pendingRecordingFilePath, setPendingRecordingFilePath] = useState<string | null>(null);
  const [isXyneDebuggerOpen, setIsXyneDebuggerOpen] = useState(false);
  const [hasXyneAIStreaming, setHasXyneAIStreaming] = useState(() =>
    xyneAIStreamManager.hasStreamingSidebarStreams(),
  );

  const { recordingState, recordingSeconds, startRecording, stopRecording } = useScreenRecorder(
    (file: File, filePath: string) => {
      setPendingRecording(file);
      setPendingRecordingFilePath(filePath);
      setIsErrorReportOpen(true);
    },
  );
  useShortcutById('global.openShortcutsHelp', () => setIsShortcutsModalOpen(prev => !prev));
  useShortcutById(
    'global.composeMessage',
    () => void navigate('/chat/search?mode=dm', { replace: true }),
  );

  useEffect(() => {
    const syncStreaming = (): void => {
      setHasXyneAIStreaming(xyneAIStreamManager.hasStreamingSidebarStreams());
    };
    syncStreaming();
    return xyneAIStreamManager.subscribe(syncStreaming);
  }, []);

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

  useEffect(() => {
    if (isXyneDebuggerOpen) return;
    const rafId = window.requestAnimationFrame(() => {
      globalXyneAIPanelRefs.right.current?.resize(XYNE_AI_PANEL_DEFAULT_SIZE);
      globalXyneAIPanelRefs.left.current?.resize(100 - XYNE_AI_PANEL_DEFAULT_SIZE);
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [isXyneDebuggerOpen]);

  // Register global keyboard shortcuts
  useGlobalShortcuts({ leftPanelRef });

  const webviewState = useSelector(webviewActor, state => state.context.webviewState);
  // Select the boolean, not the whole snapshot — subscribing to the full
  // snapshot re-rendered the entire app shell on EVERY xyneAI actor event.
  const isXyneAIDrawerOpen = useSelector(xyneAIActor, state => state.matches('open'));
  const xyneAIChannelId = useSelector(xyneAIActor, state => state.context.channelId);
  const browserPanelState = useSelector(
    browserPanelActor,
    state => state.context.browserPanelState,
  );
  const xyneAICanvasInfo = useSelector(xyneAIActor, state => state.context.canvasInfo);
  const xyneAIThreadInfo = useSelector(xyneAIActor, state => state.context.threadInfo);
  const xyneAIStartFreshChat = useSelector(xyneAIActor, state => state.context.startFreshChat);
  const xyneAIKbCollectionId = useSelector(xyneAIActor, state => state.context.kbCollectionId);
  const xyneAIKbChannelId = useSelector(xyneAIActor, state => state.context.kbChannelId);
  const xyneAIKbDocId = useSelector(xyneAIActor, state => state.context.kbDocId);
  const xyneAIKbDocName = useSelector(xyneAIActor, state => state.context.kbDocName);
  const xyneAIKbOpenNonce = useSelector(xyneAIActor, state => state.context.kbOpenNonce);
  const { isMobile } = usePlatform();
  const isInPanelWebview = useIsInPanelWebview();

  // Get current location to check if we're on onboarding
  const location = useLocation();

  // Initialize activity tracking
  useActivityTracker(location.pathname);
  const isOnboarding = location.pathname.endsWith('/onboarding');
  // The /ai page is nested under /:workspaceId, so the full pathname looks
  // like "/<workspaceId>/ai" or "/<workspaceId>/ai/<sub>". Match that
  // structure rather than a leading "/ai" prefix (which never matches).
  const isOnAIPage = /^\/[^/]+\/ai(\/|$)/.test(location.pathname);

  useEffect(() => {
    if (!reactNativeBridge.isAvailable()) {
      return;
    }
    const path = `${location.pathname}${location.search}${location.hash}`;
    reactNativeBridge.notifyRouteReady(path);
  }, [location]);

  // Get call state for mobile header. Narrow selectors instead of the full
  // snapshot — the room actor churns on every participant/speaking event
  // during calls, and a full-snapshot subscription re-rendered the whole app
  // shell each time.
  const machineViewMode = useSelector(roomActor, state => state.context.viewMode);
  const participants = useSelector(roomActor, state => state.context.participants);
  const activeCalls = useSelector(roomActor, state => state.context.activeCalls);
  const externalId = useSelector(roomActor, state => state.context.externalId);

  // Compute mic state from LiveKit (not stored in context)
  const isMicEnabled = useSelector(roomActor, state =>
    state.context.isNativeMode
      ? (state.context.participants.find(p => p.isLocal)?.isMicrophoneEnabled ?? false)
      : (state.context.room?.localParticipant.isMicrophoneEnabled ?? false),
  );

  const isCallActive = useSelector(
    roomActor,
    state =>
      (typeof state.value === 'object' && state.value !== null && 'connected' in state.value) ||
      state.value === 'connecting',
  );
  const shouldShowMobileHeader =
    isMobile && isCallActive && machineViewMode === 'mini' && externalId && !isOnboarding;
  const globalTopBarProps = {
    onOpenErrorReport: (): void => setIsErrorReportOpen(true),
    ...(errorReportCacConfig.channelId
      ? {
          onViewMyTickets: (): void => {
            void navigate(
              getTicketsPath(
                errorReportCacConfig.channelId,
                errorReportCacConfig.boardId,
                user?.id,
              ),
            );
          },
        }
      : {}),
    isRecording: recordingState === 'recording',
    recordingSeconds,
    onStopRecording: stopRecording,
  };

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

  // The /ai page already hosts its own full-screen XyneAI experience, so the
  // global XyneAISidebar must never be open there. Close it on any pathname
  // change that lands inside /ai — this covers both opening it elsewhere and
  // then navigating in, and any code path that tries to open it while here.
  useEffect(() => {
    if (!isOnAIPage) return;
    if (xyneAIActor.getSnapshot().matches('open')) {
      xyneAIActor.send({ type: 'CLOSE' });
    }
  }, [isOnAIPage, isXyneAIDrawerOpen]);

  // Monitor for pathname changes to update XyneAI context when navigating
  useEffect(() => {
    if (isXyneAIDrawerOpen) {
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
  }, [location.pathname, isXyneAIDrawerOpen, xyneAIChannelId]);

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
        <ZeroFallbackProvider>
          <InitialStateLoader>
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
                {isInPanelWebview ? (
                  // Inside the browser-panel webview — render only the route
                  // content. No GlobalTopBar / AppSidebar / right panels /
                  // ChatDirectory; see useIsInPanelWebview and the doc there.
                  <main className='flex-1 h-screen'>
                    <EditWarningModal />
                    <Outlet />
                  </main>
                ) : isOnboarding ? (
                  // Onboarding screen - full width without sidebar
                  <main className={`flex-1 h-screen ${shouldShowMobileHeader ? 'pt-[60px]' : ''}`}>
                    <EditWarningModal />
                    <Outlet />
                  </main>
                ) : isXyneAIDrawerOpen && !isMobile && !isOnAIPage ? (
                  // XyneAI is open on desktop - show panel layout with XyneAI
                  <div className='flex flex-col h-screen'>
                    {!isMobile && <GlobalTopBar {...globalTopBarProps} />}
                    <PanelGroup
                      direction='horizontal'
                      className='flex-1 no-scrollbar min-[500px]:p-2 overflow-auto'
                      autoSaveId='app-root-xyneai'
                    >
                      <Panel ref={xyneAILeftPanelRef} defaultSize={65}>
                        <div className={`flex h-full ${shouldShowMobileHeader ? 'pt-[60px]' : ''}`}>
                          <AppSidebar />
                          <main className='flex-1 no-scrollbar overflow-auto'>
                            <EditWarningModal />
                            <Outlet />
                          </main>
                        </div>
                      </Panel>
                      <PanelResizeHandle className='w-1 hover:bg-sidebar-divider active:bg-sidebar-divider transition-colors duration-200 cursor-col-resize flex items-center justify-center group'>
                        <div className='w-0.5 h-8 bg-transparent group-hover:bg-sidebar-divider group-active:bg-sidebar-divider transition-colors duration-200 rounded-full'></div>
                      </PanelResizeHandle>
                      <Panel
                        ref={xyneAIRightPanelRef}
                        defaultSize={XYNE_AI_PANEL_DEFAULT_SIZE}
                        maxSize={isXyneDebuggerOpen ? 55 : 50}
                        minSize={isXyneDebuggerOpen ? XYNE_AI_PANEL_MIN_SIZE : 25}
                      >
                        <XyneAISidebarZIndexShell>
                          <XyneAISidebar
                            channelId={xyneAIChannelId}
                            threadInfo={xyneAIThreadInfo}
                            startFreshChat={xyneAIStartFreshChat}
                            canvasInfo={xyneAICanvasInfo}
                            kbCollectionId={xyneAIKbCollectionId ?? ''}
                            kbChannelId={xyneAIKbChannelId ?? ''}
                            kbDocId={xyneAIKbDocId ?? ''}
                            kbDocName={xyneAIKbDocName ?? ''}
                            kbOpenNonce={xyneAIKbOpenNonce}
                            onDebuggerOpenChange={setIsXyneDebuggerOpen}
                          />
                        </XyneAISidebarZIndexShell>
                      </Panel>
                    </PanelGroup>
                  </div>
                ) : browserPanelState === 'open' ||
                  webviewState === 'closed' ||
                  webviewState === 'idle' ? (
                  // Unified branch: browser panel open OR no side panel active.
                  // Keeping both cases in one branch prevents the <Outlet /> from
                  // remounting (and losing scroll position) when the browser panel
                  // opens or closes.
                  <div className='flex flex-col h-screen'>
                    {!isMobile && <GlobalTopBar {...globalTopBarProps} />}
                    <PanelGroup
                      direction='horizontal'
                      className='flex-1 no-scrollbar min-[500px]:p-2 overflow-auto'
                      autoSaveId='app-root-browser'
                    >
                      <Panel
                        id='app-root-left'
                        ref={browserPanelLeftRef}
                        defaultSize={
                          browserPanelState === 'open' && !location.pathname.endsWith('/browser')
                            ? 65
                            : 100
                        }
                      >
                        <div className={`flex h-full ${shouldShowMobileHeader ? 'pt-[60px]' : ''}`}>
                          <AppSidebar />
                          <main className='flex-1 no-scrollbar overflow-auto rounded-2xl'>
                            <EditWarningModal />
                            <Outlet />
                          </main>
                        </div>
                      </Panel>
                      {browserPanelState === 'open' && !location.pathname.endsWith('/browser') && (
                        <>
                          <PanelResizeHandle className='w-1 hover:bg-sidebar-divider active:bg-sidebar-divider transition-colors duration-200 cursor-col-resize flex items-center justify-center group'>
                            <div className='w-0.5 h-8 bg-transparent group-hover:bg-sidebar-divider group-active:bg-sidebar-divider transition-colors duration-200 rounded-full'></div>
                          </PanelResizeHandle>
                          <Panel ref={browserPanelRightRef} defaultSize={35} maxSize={50}>
                            <div className='h-full'>
                              <BrowserPanel />
                            </div>
                          </Panel>
                        </>
                      )}
                    </PanelGroup>
                  </div>
                ) : (
                  // WebView is open - show panel layout with WebView
                  <div className='flex flex-col h-screen'>
                    {!isMobile && <GlobalTopBar {...globalTopBarProps} />}
                    <PanelGroup
                      direction='horizontal'
                      className='flex-1 overflow-hidden'
                      autoSaveId='app-root'
                    >
                      <Panel ref={leftPanelRef} defaultSize={50}>
                        <div className={`flex h-full ${shouldShowMobileHeader ? 'pt-[60px]' : ''}`}>
                          <AppSidebar />
                          <main className='flex-1 no-scrollbar overflow-auto'>
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
                {/* Global overlays and IPC handlers — skipped in the panel
                    webview (we don't want nested CMDK, nested browser panel,
                    duplicated call UIs, etc. inside the embedded view).
                    AttachmentGalleryModal stays because it's triggered by
                    attachments inside the conversation itself. */}
                {!isInPanelWebview && (
                  <>
                    <IncomingCallModal />
                    <GlobalCallOverlay />
                    <RecordingOverlay />
                    <GlobalUploadProgress />
                    <NotificationHandler />
                    <CallFromRecentsHandler />
                    <BrowserPanelHandler />
                    <GlobalCommandMenu />
                    <ShortcutsHelpModal
                      isOpen={isShortcutsModalOpen}
                      onClose={() => setIsShortcutsModalOpen(false)}
                    />
                  </>
                )}
                <AttachmentGalleryModal />
                <ThreadCitationModal />
                <AttachmentCitationPreview />
                <ErrorReportModal
                  isOpen={isErrorReportOpen}
                  onClose={() => setIsErrorReportOpen(false)}
                  pendingRecording={pendingRecording}
                  pendingRecordingFilePath={pendingRecordingFilePath}
                  onSourceSelected={(source: ScreenSource, withMic: boolean) =>
                    void startRecording(source, withMic)
                  }
                  onSubmitSuccess={() => {
                    setPendingRecording(null);
                    setPendingRecordingFilePath(null);
                  }}
                  onDiscard={() => {
                    setPendingRecording(null);
                    setPendingRecordingFilePath(null);
                  }}
                />

                {!isXyneAIDrawerOpen && hasXyneAIStreaming && (
                  <div className='hidden' aria-hidden='true'>
                    <XyneAISidebar
                      channelId={xyneAIChannelId}
                      threadInfo={xyneAIThreadInfo}
                      startFreshChat={xyneAIStartFreshChat}
                      canvasInfo={xyneAICanvasInfo}
                      kbCollectionId={xyneAIKbCollectionId ?? ''}
                      kbChannelId={xyneAIKbChannelId ?? ''}
                      kbDocId={xyneAIKbDocId ?? ''}
                      kbDocName={xyneAIKbDocName ?? ''}
                      kbOpenNonce={xyneAIKbOpenNonce}
                      onDebuggerOpenChange={setIsXyneDebuggerOpen}
                      visible={false}
                    />
                  </div>
                )}
                {/* XyneAI Mobile Drawer */}
                {isMobile && !isInPanelWebview && !isOnAIPage && (
                  <Drawer
                    open={isXyneAIDrawerOpen}
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
                      kbCollectionId={xyneAIKbCollectionId ?? ''}
                      kbChannelId={xyneAIKbChannelId ?? ''}
                      kbDocId={xyneAIKbDocId ?? ''}
                      kbDocName={xyneAIKbDocName ?? ''}
                      kbOpenNonce={xyneAIKbOpenNonce}
                      onDebuggerOpenChange={setIsXyneDebuggerOpen}
                    />
                  </Drawer>
                )}
              </EditProvider>
            </AIOnboardingProvider>
          </InitialStateLoader>
        </ZeroFallbackProvider>
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
            index: true,
            element: <WorkspaceRedirect />,
          },
          {
            path: ':workspaceId',
            element: <AppRoot />,
            children: [
              {
                index: true,
                element: <HomeScreen />,
              },
              {
                path: 'ai',
                element: <AIScreen />,
              },
              {
                path: 'onboarding',
                element: <OnboardingScreen />,
              },
              {
                path: 'rca',
                element: <RCAListScreen />,
              },
              {
                path: 'rca/:rcaId',
                element: <RCADetailScreen />,
              },
              {
                path: 'chat',
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
                      // Unreads inbox (must come before :channelId)
                      {
                        path: 'unreads',
                        element: <UnreadsInbox />,
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
                                path: ':conversationId',
                                element: <ThreadMessages />,
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
                    children: [
                      { index: true, element: null },
                      { path: 'compose', element: <KeyedComposeDmPanel /> },
                      ...sharedChatRoutes,
                    ],
                  },
                  // Bookmarks (full screen with bookmarks list sidebar)
                  {
                    path: 'bookmarks',
                    element: <BookmarksPanel />,
                    children: [{ index: true, element: null }, ...sharedChatRoutes],
                  },
                  // Drafts & Sent combined page
                  {
                    path: 'drafts-sent',
                    element: <DraftsAndSentPage />,
                    children: [{ index: true, element: null }, ...sharedChatRoutes],
                  },
                  // Redirect old drafts route to new combined page
                  {
                    path: 'drafts',
                    element: <Navigate to='../drafts-sent?tab=drafts' replace />,
                    children: [{ index: true, element: null }, ...sharedChatRoutes],
                  },
                  // Redirect old sent route to new combined page
                  {
                    path: 'sent',
                    element: <Navigate to='../drafts-sent?tab=sent' replace />,
                    children: [{ index: true, element: null }, ...sharedChatRoutes],
                  },
                  // Redirect old scheduled route to new combined page
                  {
                    path: 'scheduled',
                    element: <Navigate to='../drafts-sent?tab=scheduled' replace />,
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
                    children: [
                      { index: true, element: null },
                      // Desk/Support tickets opened from the Activity list render
                      // here so the list stays mounted (instead of redirecting to
                      // the full /support inbox). Static `ticket` segment is matched
                      // ahead of the shared `:channelId` route.
                      { path: 'ticket/:channelId', element: <ActivitySupportTicket /> },
                      { path: 'ticket/:channelId/:ticketId', element: <ActivitySupportTicket /> },
                      ...sharedChatRoutes,
                    ],
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
                path: 'tickets',
                element: (
                  <ResourceProtectedRoute resourceName='WORKFLOWS'>
                    <TicketsScreen />
                  </ResourceProtectedRoute>
                ),
              },
              {
                path: 'search-results',
                element: <SearchResults />,
              },
              {
                path: 'product-insights',
                element: (
                  <ResourceProtectedRoute resourceName='PRODUCT-INSIGHTS'>
                    <ProductInsightsScreen />
                  </ResourceProtectedRoute>
                ),
              },
              {
                path: 'tickets/:ticketId/workflow/:workflowId',
                element: <WorkflowScreen />,
              },
              {
                path: 'tickets/:ticketId/workflow',
                element: <WorkflowScreen />,
              },
              {
                path: 'agents',
                element: (
                  <ResourceProtectedRoute resourceName='AGENTS'>
                    <AgentsScreen />
                  </ResourceProtectedRoute>
                ),
              },
              {
                path: 'knowledge-base',
                element: <KnowledgeBaseV2Layout />,
                children: [
                  {
                    index: true,
                    element: <KnowledgeBaseV2Screen />,
                  },
                  {
                    // The file viewer still reads projectId / channelId /
                    // collectionId / folderId from the URL.
                    path: ':projectId/:channelId/:collectionId/:folderId/:fileId',
                    element: <FileViewerLayout />,
                  },
                  // Back-compat shims: pre-port URLs (path-only nesting) get
                  // redirected to the new ?cl=&parent= layout so browser
                  // history entries don't 404 after the route change.
                  { path: ':projectId', element: <LegacyKbRedirect /> },
                  { path: ':projectId/:channelId', element: <LegacyKbRedirect /> },
                  {
                    path: ':projectId/:channelId/:collectionId',
                    element: <LegacyKbRedirect />,
                  },
                  {
                    path: ':projectId/:channelId/:collectionId/:folderId',
                    element: <LegacyKbRedirect />,
                  },
                ],
              },
              {
                path: 'memory',
                element: <MemoryScreen />,
              },
              {
                path: 'analytics',
                element: (
                  <ResourceProtectedRoute resourceName='ANALYTICS'>
                    <AnalyticsScreen />
                  </ResourceProtectedRoute>
                ),
              },
              {
                path: 'projects',
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
                    path: 'views',
                    element: <Navigate to='/projects' replace />,
                  },
                  {
                    path: 'views/new',
                    element: <ProjectViewBuilder />,
                  },
                  {
                    path: 'views/:viewId',
                    element: <ProjectViewBuilder />,
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
                path: 'team-intelligence',
                element: (
                  <ResourceProtectedRoute resourceName='TEAM-INTELLIGENCE-DASHBOARD'>
                    <TeamIntelligenceScreen />
                  </ResourceProtectedRoute>
                ),
                children: [
                  {
                    index: true,
                    element: <TeamIntelligenceOrgScreen />,
                  },
                  {
                    path: 'team/:teamId',
                    element: <TeamIntelligenceTeamScreen />,
                  },
                  {
                    path: 'member/:memberEmail',
                    element: <TeamIntelligenceMemberScreen />,
                  },
                ],
              },
              {
                path: 'user-groups',
                element: (
                  <ResourceProtectedRoute resourceName='USER-GROUPS'>
                    <UserGroupsScreen />
                  </ResourceProtectedRoute>
                ),
              },
              {
                path: 'listProjects',
                element: (
                  <ResourceProtectedRoute resourceName='LISTPROJECTS'>
                    <ProjectsListView />
                  </ResourceProtectedRoute>
                ),
              },
              {
                path: 'listProjects/:projectId',
                element: <ProjectDetailScreen />,
              },
              {
                path: 'listProjects/:projectId/releases/:releaseTicketId',
                element: <ReleaseDetailScreen />,
              },
              {
                path: 'calls',
                element: <CallHistoryScreen />,
                children: [
                  {
                    path: ':callId/detail',
                    element: <CallDetailScreen />,
                  },
                ],
              },
              {
                path: 'calls/:callId/:callType',
                element: <CallPage />,
              },
              {
                path: 'call/:callId',
                element: <CallRouteHandler />,
              },
              {
                path: 'recordings',
                element: <RecordingsScreen />,
              },
              {
                path: 'recordings/:recordingId',
                element: <RecordingDetailScreen />,
              },
              {
                path: 'user-groups/:userGroupId/assignment-config',
                element: (
                  <ResourceProtectedRoute resourceName='USER-GROUPS'>
                    <AssignmentConfigWrapper />
                  </ResourceProtectedRoute>
                ),
              },
              {
                path: 'analytics-dashboard',
                element: (
                  <ResourceProtectedRoute resourceName='ANALYTICS'>
                    <DashboardCreation />
                  </ResourceProtectedRoute>
                ),
              },
              {
                path: 'analytics-dashboard/:dashboardId',
                element: (
                  <ResourceProtectedRoute resourceName='ANALYTICS'>
                    <QueryDashboardScreen />
                  </ResourceProtectedRoute>
                ),
              },
              {
                path: 'dashboards',
                element: (
                  <ResourceProtectedRoute resourceName='ANALYTICS'>
                    <DynamicDashboardPanel />
                  </ResourceProtectedRoute>
                ),
                children: [
                  { index: true, element: null },
                  {
                    path: ':dashboardId',
                    element: <DynamicDashboardScreen />,
                  },
                ],
              },
              {
                path: 'support',
                element: (
                  <ResourceProtectedRoute resourceName='SUPPORT'>
                    <SaveRoute
                      keyword='support'
                      stripSearchParams={['settings', 'openSettings']}
                      preserveSearchParams={[
                        'emailConnected',
                        'emailError',
                        'channelEmailMailboxConnected',
                      ]}
                      redirectOnlyAt={/^\/[^/]+\/support\/?$/}
                    >
                      <SupportScreen />
                    </SaveRoute>
                  </ResourceProtectedRoute>
                ),
                children: [
                  {
                    path: ':channelId',
                    element: <Outlet />,
                    children: [
                      {
                        path: ':ticketId',
                        element: <Outlet />,
                      },
                    ],
                  },
                ],
              },
              {
                path: 'browser',
                element: <BrowserTabsScreen />,
              },
              {
                path: 'workspace-management',
                element: (
                  <ResourceProtectedRoute resourceName='WORKSPACE'>
                    <WorkspaceManagementScreen />
                  </ResourceProtectedRoute>
                ),
              },
              {
                path: 'organisations',
                element: (
                  <ResourceProtectedRoute resourceName='ORGANIZATIONS'>
                    <OrganisationsScreen />
                  </ResourceProtectedRoute>
                ),
              },
              {
                path: 'forms',
                element: (
                  <ResourceProtectedRoute resourceName='FORMS'>
                    <FormScreen />
                  </ResourceProtectedRoute>
                ),
              },
              {
                path: 'scheduled-messages',
                element: <ScheduledMessageScreen />,
              },
              {
                path: 'automations',
                element: <AutomationsListScreen />,
              },
              {
                path: 'automations/approvals',
                element: <AutomationApprovalsScreen />,
              },
              {
                path: 'automations/new',
                element: <AutomationBuilderScreen />,
              },
              {
                path: 'automations/:id',
                element: <AutomationBuilderScreen />,
              },
              {
                path: 'automations/:id/runs',
                element: <AutomationRunsScreen />,
              },
              {
                path: 'automations/:id/runs/:runId',
                element: <AutomationRunDetailScreen />,
              },
              {
                path: 'apps',
                element: <AppsScreen />,
              },
              {
                path: 'docs/*',
                element: <DocsScreen />,
              },
              {
                path: 'resource-access',
                element: (
                  <ResourceProtectedRoute resourceName='USERS'>
                    <ResourceAccessScreen />
                  </ResourceProtectedRoute>
                ),
              },
              {
                path: 'jira-migration',
                element: (
                  <ResourceProtectedRoute resourceName='TICKET-MIGRATION'>
                    <JiraMigrationScreen />
                  </ResourceProtectedRoute>
                ),
              },
              {
                path: 'migration/confluence',
                element: (
                  <ResourceProtectedRoute resourceName='CONFLUENCE-MIGRATION'>
                    <ConfluenceMigrationScreen />
                  </ResourceProtectedRoute>
                ),
              },
              {
                path: 'migration/whatsapp',
                element: (
                  <ResourceProtectedRoute resourceName='TICKET-MIGRATION'>
                    <WhatsAppBulkMigrationScreen />
                  </ResourceProtectedRoute>
                ),
              },
              {
                path: 'guide',
                element: <UserGuideScreen />,
              },
            ],
          },
        ],
      },

      {
        path: '/call/:callId',
        element: <CallRouteHandler />,
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
            <ZeroFallbackProvider>
              <InitialStateLoader>
                <EditProvider>
                  <div className='h-full bg-background'>
                    <Outlet />
                  </div>
                  <AttachmentGalleryModal />
                  <AttachmentCitationPreview />
                  <ThreadCitationModal />
                </EditProvider>
              </InitialStateLoader>
            </ZeroFallbackProvider>
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
        path: '/invite',
        element: <AcceptInvitation />,
      },
      {
        path: '/auth',
        element: <AuthScreen />,
      },
      {
        path: '/no-access',
        element: <NoOrganizationAccessScreen />,
      },
      {
        path: '/launch',
        element: <LaunchScreen />,
      },
    ],
  },
]);
