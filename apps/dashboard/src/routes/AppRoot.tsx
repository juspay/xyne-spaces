import { createBrowserRouter, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import SplashScreen from './SplashScreen/SplashScreen';
import ProtectedRoute from '../components/Auth/ProtectedRoute';
import { useActivityTracker } from '../hooks/useActivityTracker';
import HomeScreen from './HomeScreen';
import SlackMigration from '../pages/SlackMigration';
import AuthScreen from './AuthScreen/AuthScreen';
import CommunityWorkspaceSelectionRoute from './AuthScreen/CommunityWorkspaceSelectionRoute';
import WorkspaceSelectionScreen from './WorkspaceSelectionScreen';
import QuestionnaireScreen from './QuestionnaireScreen/QuestionnaireScreen';
import IntentPlaygroundScreen from './IntentPlaygroundScreen';
import ChatScreen from './ChatScreen/ChatScreen';
import ThreadMessages from '../components/Chat/ThreadPannel';
import TicketView from '../components/Tickets/TicketView/TicketView';
import { BrowserTabsScreen } from './BrowserTabsScreen';
import { getLastActiveWorkspaceId } from '../machines/authMachine';
import AgentsScreen from './AgentsScreen/AgentScreen';
import ClawAgentsScreen from './ClawAgentsScreen';
import AgentsTab from './ClawAgentsScreen/tabs/AgentsTab';
import McpTab from './ClawAgentsScreen/tabs/McpTab';
import SkillsTab from './ClawAgentsScreen/tabs/SkillsTab';
import ClawAgentDetailScreen from './ClawAgentsScreen/ClawAgentDetailScreen';
import ClawAgentCreateScreen from './ClawAgentsScreen/ClawAgentCreateScreen';
import ClawMcpDetailScreen from './ClawAgentsScreen/ClawMcpDetailScreen';
import ClawSkillDetailScreen from './ClawAgentsScreen/ClawSkillDetailScreen';
import ClawSkillCreateScreen from './ClawAgentsScreen/ClawSkillCreateScreen';
import ClawSettingsScreen from './ClawAgentsScreen/ClawSettingsScreen';
import ClawMetricsScreen from './ClawAgentsScreen/ClawMetricsScreen';
import { RequireClawAdmin } from './AIScreen/screens/RequireClawAdmin';
import { RequireOrgManager } from './AIScreen/screens/RequireOrgManager';
import SubagentsTab from './ClawAgentsScreen/tabs/SubagentsTab';
import ClawSubagentDetailScreen from './ClawAgentsScreen/ClawSubagentDetailScreen';
import ClawSubagentCreateScreen from './ClawAgentsScreen/ClawSubagentCreateScreen';
import ClawOrganizationScreen from './ClawAgentsScreen/ClawOrganizationScreen';
import ClawDigitalTwinScreen from './ClawAgentsScreen/ClawDigitalTwinScreen';
import ClawDigitalTwinMetricsScreen from './ClawAgentsScreen/ClawDigitalTwinMetricsScreen';
import DigitalTwinMemoriesTab from './ClawAgentsScreen/tabs/DigitalTwinMemoriesTab';
import DigitalTwinHotTab from './ClawAgentsScreen/tabs/DigitalTwinHotTab';
import DigitalTwinProposalsTab from './ClawAgentsScreen/tabs/DigitalTwinProposalsTab';
import DigitalTwinRecallTab from './ClawAgentsScreen/tabs/DigitalTwinRecallTab';
import DigitalTwinGraphTab from './ClawAgentsScreen/tabs/DigitalTwinGraphTab';
import DigitalTwinSettingsTab from './ClawAgentsScreen/tabs/DigitalTwinSettingsTab';
import { KnowledgeBaseV2Layout } from '../components/knowledgeBaseV2/KnowledgeBaseV2Layout';
import KnowledgeBaseV2Screen from '../components/knowledgeBaseV2/KnowledgeBaseV2Screen';
import { LegacyKbRedirect } from '../components/knowledgeBaseV2/LegacyKbRedirect';
import { MemoryScreen } from './MemoryScreen';
import { EntitiesScreen } from './EntitiesScreen';
import { FileViewerLayout } from '../components/knowledgeBase/layout/FileViewerLayout';
import AnalyticsScreen from './AnalyticsScreen/AnalyticsScreen';
import ProjectsScreen from './ProjectsScreen/ProjectsScreen';
import UserGroupsScreen from './UserGroupsScreen/UserGroupsScreen';
import ProjectDetailScreen from './ProjectDetailScreen/ProjectDetailScreen';
import SdlcScreen from './SdlcScreen/SdlcScreen';
import { SdlcDebuggerPanel } from './SdlcScreen/SdlcDebuggerPanel';
import SdlcWindow from './SdlcScreen/SdlcWindow';
import { APP_BASE_PATH, isSdlcSurface } from '../config';
import SdlcFrameHost from './SdlcScreen/SdlcFrameHost';
import SdlcFrameViewport from './SdlcScreen/SdlcFrameViewport';
import { SdlcFrameProvider } from './SdlcScreen/SdlcFrameContext';
import { useSdlcFrameBridge } from './SdlcScreen/useSdlcFrameBridge';
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
import { ClawOverlay } from '../components/Claw/ClawOverlay';
import AppSidebar from '../components/AppSidebar/AppSidebar';
import { ReactElement, ReactNode, useRef, useEffect, useState } from 'react';
import ZeroProvider from '../providers/ZeroProvider';
import { EditProvider } from '../providers/EditProvider';
import { EditWarningModal } from '../components/Chat/EditWarningModal/EditWarningModal';
import { IncomingCallModal } from '../components/Call/CallModals/IncomingCallModal';
import { IncomingCallDevHarness } from '../components/Call/IncomingCall/IncomingCallCard.dev';
import { GlobalCallOverlay } from '../components/Call/CallOverlay/GlobalCallOverlay';
import { MobileCallHeader } from '../components/Call/MobileCallHeader/MobileCallHeader';
import { NotificationHandler } from '../components/NotificationHandler/NotificationHandler';
import { ElectronBadgeSync } from '../components/ElectronBadgeSync/ElectronBadgeSync';
import { ElectronUpdateNudge } from '../components/ElectronUpdateNudge/ElectronUpdateNudge';
import { SosAlertBanner } from '../components/SosAlert/SosAlertBanner';
import { SlashCommandArtifactBanner } from '../components/Chat/SlashCommandArtifactBanner';
import { SlashCommandArtifactSideEffectProvider } from '../components/Chat/SlashCommandArtifactSideEffects';
import { CallFromRecentsHandler } from '../components/CallFromRecentsHandler/CallFromRecentsHandler';
import { CloudAgentFloatingHost } from '../components/xyne-desk/CloudAgentDock/CloudAgentDock';
import { usePlatform } from '../hooks/usePlatform';
import { useIsInPanelWebview } from '../hooks/useIsInPanelWebview';
import { roomActor } from '../machines/roomMachine';
import ChatView from '../components/Chat/ChatView/ChatView';
import {
  ResizableGroup,
  Panel,
  Separator,
  type PanelImperativeHandle,
} from '../components/ui/Resizable/Resizable';
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
import ReleaseManagerView from './ProjectsScreen/ReleaseManagerView';
import BookmarksPanel from '../components/Chat/BookmarksPanel/BookmarksPanel';
import DraftsAndSentPage from '../pages/DraftsAndSentPage';
import UserThreads from '../components/Chat/UserThreads/UserThreads';
import { RecapPanel } from '../components/RecapPanel';
import { RadarPanel } from '../components/RadarPanel';
import { RouterErrorFallback } from '../components/ErrorBoundary';
import NotFoundScreen from './NotFoundScreen/NotFoundScreen';
import ChatRedirect from '../components/Chat/ChatRedirect/ChatRedirect';
import DirectoryRedirect from '../components/Chat/DirectoryRedirect/DirectoryRedirect';
import CallHistoryScreen from './CallHistoryScreen/CallHistoryScreen';
import CallDetailScreen from './CallDetailScreen/CallDetailScreen';
import RecordingsRoute from './RecordingsRoute/RecordingsRoute';
import RecordingDetailRoute from './RecordingDetailRoute/RecordingDetailRoute';
import { RecordingOverlay } from '../components/Recording/RecordingOverlay/RecordingOverlay';
import { useRecordingVersion } from '../hooks/useRecordingVersion';
import { stopRecordingForTeardown } from '../hooks/useRecordingStore';
import { isElectronApp } from '../utils/electronApp';
import {
  confirmRecordingInterrupt,
  isRecordingInterruptible,
} from '../components/Recording/RecordingInterruptGuard/RecordingInterruptGuard';
import { NoteTakerOverlayHost } from './RecordingsV2Screen/components/NoteTakerOverlayHost';
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
import GlobalCommandMenu from '../components/GlobalCommandMenu/GlobalCommandMenu';
import ProductInsightsScreen from './ProductInsightsScreen/ProductInsightsScreen';
import TicketReportsScreen from './TicketReportsScreen/TicketReportsScreen';
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
import { AIOnboardingOverlay } from '../components/AIOnboarding/AIOnboardingOverlay';
import XyneAISidebar from '../components/Chat/XyneAISidebar/XyneAISidebar';
import { BrowserPanel, BrowserPanelHandler } from '../components/BrowserPanel';
import { xyneAIStreamManager } from '../services/XyneAI';
import { useExternalDebuggerStore } from '../store/useExternalDebuggerStore';
import { AttachmentGalleryModal } from '../components/FileViewer/FileViewerModal';
import { CreateTicketWindow } from '../components/Tickets/CreateTicketModal/CreateTicketWindow';
import { AttachmentCitationPreview } from '../components/FileViewer/AttachmentCitationPreview';
import { ThreadCitationModal } from '../components/xyne-desk/ThreadCitationModal/ThreadCitationModal';
import { TranscriptCitationModal } from '../components/Chat/TranscriptCitationModal';
import { sharedChatRoutes } from './SharedChatRoutes';
import { ResourceAccessScreen } from './ResourceAccessScreen/ResourceAccessScreen';
import { RoleManagementScreen } from './RoleManagementScreen';
import { TagReviewView } from '../components/tags/TagReview/TagReviewView';
import { ResourceProtectedRoute } from '../components/Auth/ResourceProtectedRoute';
import { GuestBlockedRoute } from '../components/Auth/GuestBlockedRoute';
import { ToolbarProtectedRoute } from '../components/Auth/ToolbarProtectedRoute';
import { WorkspaceManagementScreen } from './WorkspaceManagementScreen';
import OrganisationsScreen from './OrganisationsScreen/OrganisationsScreen';
import { AcceptInvitation } from './InvitationScreen/AcceptInvitation';
import NoOrganizationAccessScreen from './NoOrganizationAccessScreen/NoOrganizationAccessScreen';
import SystemPalette from './SystemPalette/SystemPalette';
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
import { useScreenRecorder } from '../hooks/useScreenRecorder';
import type { ScreenSource } from '../types/electron';
import ConfluenceMigrationScreen from './ConfluenceMigrationScreen/ConfluenceMigrationScreen';
import AIScreen from './AIScreen/AIScreen';
import AILibraryScreen from './AIScreen/screens/AILibraryScreen';
import AIAdminScreen from './AIScreen/screens/AIAdminScreen';
import AIAgentCreateScreen from './AIScreen/screens/AIAgentCreateScreen';
import AISubagentCreateScreen from './AIScreen/screens/AISubagentCreateScreen';
import AISkillCreateScreen from './AIScreen/screens/AISkillCreateScreen';
import AIAgentDetailScreen from './AIScreen/screens/AIAgentDetailScreen';
import ArtifactAppScreen from './AIScreen/library/apps/ArtifactAppScreen';
import AISubagentDetailScreen from './AIScreen/screens/AISubagentDetailScreen';
import AISubagentEditScreen from './AIScreen/screens/AISubagentEditScreen';
import AISkillDetailScreen from './AIScreen/screens/AISkillDetailScreen';
import AIMcpDetailScreen from './AIScreen/screens/AIMcpDetailScreen';
import AIAgentEditScreen from './AIScreen/screens/AIAgentEditScreen';
import AIKnowledgeScreen from './AIScreen/screens/AIKnowledgeScreen';
import AIOrganizationScreen from './AIScreen/screens/AIOrganizationScreen';
import AIDigitalTwinScreen from './AIScreen/screens/AIDigitalTwinScreen';
import AISectionLayout from './AIScreen/AISectionLayout';
import { EncryptionBootstrapProvider } from '../providers/EncryptionBootstrapProvider';
import { EncryptionInit } from '../components/EncryptionInit';
import UserGuideScreen from './UserGuideScreen';
import AIDailyBriefScreen from './AIScreen/AIDailyBriefScreen';
import AutomationsScreen from './AutomationsScreen/AutomationsScreen';
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
  const { recordingVersion } = useRecordingVersion();
  // Create panel refs for WebView
  const leftPanelRef = useRef<PanelImperativeHandle>(null);
  const rightPanelRef = useRef<PanelImperativeHandle>(null);

  // Create panel refs for XyneAI
  const xyneAIRightPanelRef = useRef<PanelImperativeHandle>(null);

  const browserPanelLeftRef = useRef<PanelImperativeHandle>(null);
  const browserPanelRightRef = useRef<PanelImperativeHandle>(null);

  const navigate = useNavigate();

  // Shortcuts help modal state
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);
  const [isErrorReportOpen, setIsErrorReportOpen] = useState(false);
  const [pendingRecording, setPendingRecording] = useState<File | null>(null);
  const [pendingRecordingFilePath, setPendingRecordingFilePath] = useState<string | null>(null);
  const [isXyneDebuggerOpen, setIsXyneDebuggerOpen] = useState(false);
  const [hasXyneAIStreaming, setHasXyneAIStreaming] = useState(() =>
    xyneAIStreamManager.hasStreamingSidebarStreams(),
  );

  const { startRecording } = useScreenRecorder((file: File, filePath: string) => {
    setPendingRecording(file);
    setPendingRecordingFilePath(filePath);
    setIsErrorReportOpen(true);
  });

  // Do not stop an active recording merely because the document becomes hidden:
  // that also happens when a user locks their screen or switches apps. Browsers
  // do not expose a reliable lid-close event, so retain only the actual page
  // unload safeguard below.
  useEffect(() => {
    const handlePageHide = (): void => stopRecordingForTeardown();
    window.addEventListener('pagehide', handlePageHide);
    return (): void => {
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, []);

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (isElectronApp()) return;
      if (!isRecordingInterruptible()) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return (): void => {
      window.removeEventListener('beforeunload', warnBeforeUnload);
    };
  }, []);

  useEffect(() => {
    const interceptReload = (event: KeyboardEvent): void => {
      if (isElectronApp()) return;
      const isReloadCombo = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'r';
      if (!isReloadCombo && event.key !== 'F5') return;
      if (!isRecordingInterruptible()) return;
      event.preventDefault();
      void confirmRecordingInterrupt('reload').then(proceed => {
        if (proceed) window.location.reload();
      });
    };
    window.addEventListener('keydown', interceptReload, true);
    return (): void => {
      window.removeEventListener('keydown', interceptReload, true);
    };
  }, []);
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
      left: browserPanelLeftRef,
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
      const right = globalXyneAIPanelRefs.right.current;
      if (!right) return;
      right.resize(`${XYNE_AI_PANEL_DEFAULT_SIZE}%`);
      globalXyneAIPanelRefs.left.current?.resize(`${100 - XYNE_AI_PANEL_DEFAULT_SIZE}%`);
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
  const xyneAIInitialContextSelections = useSelector(
    xyneAIActor,
    state => state.context.initialContextSelections,
  );
  const xyneAIContextOpenNonce = useSelector(xyneAIActor, state => state.context.contextOpenNonce);
  const xyneAIKbCollectionId = useSelector(xyneAIActor, state => state.context.kbCollectionId);
  const xyneAIKbChannelId = useSelector(xyneAIActor, state => state.context.kbChannelId);
  const xyneAIKbDocId = useSelector(xyneAIActor, state => state.context.kbDocId);
  const xyneAIKbDocName = useSelector(xyneAIActor, state => state.context.kbDocName);
  const xyneAIKbFolderId = useSelector(xyneAIActor, state => state.context.kbFolderId);
  const xyneAIKbFolderName = useSelector(xyneAIActor, state => state.context.kbFolderName);
  const xyneAIKbOpenNonce = useSelector(xyneAIActor, state => state.context.kbOpenNonce);
  const xyneAIResearchContext = useSelector(xyneAIActor, state => state.context.researchContext);
  const xyneAIInitialQuery = useSelector(xyneAIActor, state => state.context.initialQuery);
  const xyneAIAutoSendNonce = useSelector(xyneAIActor, state => state.context.autoSendNonce);
  const isSdlcDebuggerOpen = useExternalDebuggerStore(state => state.target !== null);
  const { isMobile } = usePlatform();
  // No-op outside the SDLC bundle's framed instance.
  useSdlcFrameBridge();

  // The SDLC bundle wants the same chromeless layout as the browser panel.
  const isInPanelWebview = useIsInPanelWebview() || isSdlcSurface;

  // Get current location to check if we're on onboarding
  const location = useLocation();
  const sdlcChannelId = location.pathname.match(/\/sdlc\/([^/]+)/)?.[1] ?? null;
  // On an SDLC route the iframe lane renders its own Ask AI panel, so the host
  // must not also render one (that would double it).
  const isSdlcRoute = /\/sdlc(\/|$)/.test(location.pathname);
  const previousSdlcChannelIdRef = useRef<string | null>(null);

  useEffect(() => {
    const previousChannelId = previousSdlcChannelIdRef.current;
    if (previousChannelId && previousChannelId !== sdlcChannelId) {
      useExternalDebuggerStore.getState().close();
      setIsXyneDebuggerOpen(false);
    }
    previousSdlcChannelIdRef.current = sdlcChannelId;
  }, [sdlcChannelId]);

  // Initialize activity tracking
  useActivityTracker(location.pathname);
  const isOnboarding = location.pathname.endsWith('/onboarding');
  // The /ai page is nested under /:workspaceId, so the full pathname looks
  // like "/<workspaceId>/ai" or "/<workspaceId>/ai/<sub>". Match that
  // structure rather than a leading "/ai" prefix (which never matches).
  const isOnAIPage = /^\/[^/]+\/ai(\/|$)/.test(location.pathname);
  // /ai/knowledge is a KB browser (AIKnowledgeScreen), not the full-screen
  // chat experience the isOnAIPage suppression below exists for — it has no
  // embedded chat pane of its own, so "Ask AI" there needs the same global
  // XyneAISidebar drawer /knowledge-base uses, or clicking it does nothing.
  const isOnAIKnowledgePage = /^\/[^/]+\/ai\/knowledge(\/|$)/.test(location.pathname);
  const isOnAIChatExperiencePage = isOnAIPage && !isOnAIKnowledgePage;

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
  const showSdlcDebuggerPanel = isSdlcDebuggerOpen && !isMobile && sdlcChannelId === null;
  // On SDLC routes the framed lane renders its own Ask AI panel inside the iframe,
  // so the host must not also show one (covers both /sdlc and /sdlc/<channelId>).
  const showXyneAIPanel =
    isXyneAIDrawerOpen &&
    !isMobile &&
    !isOnAIChatExperiencePage &&
    !isSdlcRoute &&
    !showSdlcDebuggerPanel;
  const showBrowserPanel = browserPanelState === 'open' && !location.pathname.endsWith('/browser');

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

  // The /ai page already hosts its own full-screen XyneAI experience, so the
  // global XyneAISidebar must never be open there. Close it on any pathname
  // change that lands inside /ai — this covers both opening it elsewhere and
  // then navigating in, and any code path that tries to open it while here.
  // /ai/knowledge is exempt — see isOnAIKnowledgePage above.
  useEffect(() => {
    if (!isOnAIChatExperiencePage) return;
    if (xyneAIActor.getSnapshot().matches('open')) {
      xyneAIActor.send({ type: 'CLOSE' });
    }
  }, [isOnAIChatExperiencePage, isXyneAIDrawerOpen]);

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
      <EncryptionBootstrapProvider>
        <EncryptionInit />
        <ZeroProvider>
          <ZeroFallbackProvider>
            <InitialStateLoader>
              <ShareRecordingHandler />
              <AIOnboardingProvider>
                <AIOnboardingTrigger isOnboarding={isOnboarding} />
                <AIOnboardingOverlay />
                <SlashCommandArtifactSideEffectProvider>
                  {!isInPanelWebview && <SlashCommandArtifactBanner />}
                  <EditProvider>
                    {/* Above the layout branches, so leaving /sdlc hides the frame
                      rather than destroying it. */}
                    <SdlcFrameProvider>
                      {!isSdlcSurface && <SdlcFrameHost />}
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
                        isSdlcSurface && isXyneAIDrawerOpen && !isMobile && !isOnAIPage ? (
                          // SDLC lane (chrome-free iframe) with Ask AI open: render the
                          // XyneAI panel INSIDE the frame so Ask AI ships with this lane.
                          <div className='flex h-screen flex-col'>
                            <ResizableGroup
                              orientation='horizontal'
                              className='flex-1 no-scrollbar overflow-auto'
                              autoSaveId='sdlc-frame-xyneai'
                            >
                              <Panel
                                id='sdlc-frame-content'
                                defaultSize={`${100 - XYNE_AI_PANEL_DEFAULT_SIZE}%`}
                              >
                                <main className='h-full flex-1 no-scrollbar overflow-auto'>
                                  <EditWarningModal />
                                  <Outlet />
                                </main>
                              </Panel>
                              <Separator className='group flex w-[2px] cursor-col-resize items-center justify-center transition-colors'>
                                <div className='h-full w-[2px] bg-transparent group-hover:bg-primary group-active:bg-primary' />
                              </Separator>
                              <Panel
                                id='sdlc-frame-xyneai'
                                defaultSize={`${XYNE_AI_PANEL_DEFAULT_SIZE}%`}
                                maxSize={isXyneDebuggerOpen ? '55%' : '50%'}
                                minSize={isXyneDebuggerOpen ? `${XYNE_AI_PANEL_MIN_SIZE}%` : '25%'}
                              >
                                <XyneAISidebarZIndexShell>
                                  <XyneAISidebar
                                    channelId={xyneAIChannelId}
                                    threadInfo={xyneAIThreadInfo}
                                    startFreshChat={xyneAIStartFreshChat}
                                    canvasInfo={xyneAICanvasInfo}
                                    initialContextSelections={xyneAIInitialContextSelections}
                                    contextOpenNonce={xyneAIContextOpenNonce}
                                    kbCollectionId={xyneAIKbCollectionId ?? ''}
                                    kbChannelId={xyneAIKbChannelId ?? ''}
                                    kbDocId={xyneAIKbDocId ?? ''}
                                    kbDocName={xyneAIKbDocName ?? ''}
                                    kbFolderId={xyneAIKbFolderId ?? ''}
                                    kbFolderName={xyneAIKbFolderName ?? ''}
                                    kbOpenNonce={xyneAIKbOpenNonce}
                                    researchContext={xyneAIResearchContext}
                                    initialQuery={xyneAIInitialQuery ?? undefined}
                                    autoSendNonce={xyneAIAutoSendNonce}
                                    onDebuggerOpenChange={setIsXyneDebuggerOpen}
                                  />
                                </XyneAISidebarZIndexShell>
                              </Panel>
                            </ResizableGroup>
                          </div>
                        ) : (
                          // Inside the browser-panel webview (or SDLC lane with Ask AI
                          // closed) — render only the route content. No GlobalTopBar /
                          // AppSidebar / right panels / ChatDirectory.
                          <main className='flex-1 h-screen'>
                            <EditWarningModal />
                            <Outlet />
                          </main>
                        )
                      ) : isOnboarding ? (
                        // Onboarding screen - full width without sidebar
                        <main
                          className={`flex-1 h-screen ${shouldShowMobileHeader ? 'pt-[60px]' : ''}`}
                        >
                          <EditWarningModal />
                          <Outlet />
                        </main>
                      ) : showXyneAIPanel ||
                        showSdlcDebuggerPanel ||
                        browserPanelState === 'open' ||
                        webviewState === 'closed' ||
                        webviewState === 'idle' ? (
                        <div className='flex flex-col h-screen'>
                          <ResizableGroup
                            orientation='horizontal'
                            className='flex-1 no-scrollbar overflow-auto'
                            autoSaveId='app-root-browser'
                            panelIds={
                              showSdlcDebuggerPanel
                                ? ['app-root-left', 'app-root-sdlc-debugger']
                                : showXyneAIPanel
                                  ? ['app-root-left', 'app-root-xyneai']
                                  : showBrowserPanel
                                    ? ['app-root-left', 'app-root-browser']
                                    : ['app-root-left']
                            }
                          >
                            <Panel
                              id='app-root-left'
                              panelRef={browserPanelLeftRef}
                              defaultSize={
                                showXyneAIPanel
                                  ? `${100 - XYNE_AI_PANEL_DEFAULT_SIZE}%`
                                  : showSdlcDebuggerPanel || showBrowserPanel
                                    ? '65%'
                                    : '100%'
                              }
                            >
                              <div
                                className={`flex h-full ${shouldShowMobileHeader ? 'pt-[60px]' : ''}`}
                              >
                                <AppSidebar />
                                <main className='flex-1 no-scrollbar overflow-auto'>
                                  <EditWarningModal />
                                  <Outlet />
                                </main>
                              </div>
                            </Panel>
                            {showSdlcDebuggerPanel ? (
                              <>
                                <Separator className='w-[2px] transition-colors cursor-col-resize flex items-center justify-center group'>
                                  <div
                                    id='panel-resize-divider'
                                    className='w-[2px] h-full bg-transparent group-hover:bg-primary group-active:bg-primary'
                                  ></div>
                                </Separator>
                                <Panel
                                  id='app-root-sdlc-debugger'
                                  defaultSize='35%'
                                  minSize='30%'
                                  maxSize='55%'
                                >
                                  <SdlcDebuggerPanel />
                                </Panel>
                              </>
                            ) : showXyneAIPanel ? (
                              <>
                                <Separator className='w-[2px] transition-colors cursor-col-resize flex items-center justify-center group'>
                                  <div
                                    id='panel-resize-divider'
                                    className='w-[2px] h-full bg-transparent group-hover:bg-primary group-active:bg-primary'
                                  ></div>
                                </Separator>
                                <Panel
                                  id='app-root-xyneai'
                                  panelRef={xyneAIRightPanelRef}
                                  defaultSize={`${XYNE_AI_PANEL_DEFAULT_SIZE}%`}
                                  maxSize={isXyneDebuggerOpen ? '55%' : '50%'}
                                  minSize={
                                    isXyneDebuggerOpen ? `${XYNE_AI_PANEL_MIN_SIZE}%` : '25%'
                                  }
                                >
                                  <XyneAISidebarZIndexShell>
                                    <XyneAISidebar
                                      channelId={xyneAIChannelId}
                                      threadInfo={xyneAIThreadInfo}
                                      startFreshChat={xyneAIStartFreshChat}
                                      canvasInfo={xyneAICanvasInfo}
                                      initialContextSelections={xyneAIInitialContextSelections}
                                      contextOpenNonce={xyneAIContextOpenNonce}
                                      kbCollectionId={xyneAIKbCollectionId ?? ''}
                                      kbChannelId={xyneAIKbChannelId ?? ''}
                                      kbDocId={xyneAIKbDocId ?? ''}
                                      kbDocName={xyneAIKbDocName ?? ''}
                                      kbFolderId={xyneAIKbFolderId ?? ''}
                                      kbFolderName={xyneAIKbFolderName ?? ''}
                                      kbOpenNonce={xyneAIKbOpenNonce}
                                      researchContext={xyneAIResearchContext}
                                      initialQuery={xyneAIInitialQuery ?? undefined}
                                      autoSendNonce={xyneAIAutoSendNonce}
                                      onDebuggerOpenChange={setIsXyneDebuggerOpen}
                                    />
                                  </XyneAISidebarZIndexShell>
                                </Panel>
                              </>
                            ) : (
                              showBrowserPanel && (
                                <>
                                  <Separator className='w-1 hover:bg-sidebar-divider active:bg-sidebar-divider transition-colors duration-200 cursor-col-resize flex items-center justify-center group'>
                                    <div className='w-0.5 h-8 bg-transparent group-hover:bg-sidebar-divider group-active:bg-sidebar-divider transition-colors duration-200 rounded-full'></div>
                                  </Separator>
                                  <Panel
                                    id='app-root-browser'
                                    panelRef={browserPanelRightRef}
                                    defaultSize='35%'
                                    maxSize='50%'
                                  >
                                    <div className='h-full'>
                                      <BrowserPanel />
                                    </div>
                                  </Panel>
                                </>
                              )
                            )}
                          </ResizableGroup>
                        </div>
                      ) : (
                        // WebView is open - show panel layout with WebView
                        <div className='flex flex-col h-screen'>
                          <ResizableGroup
                            orientation='horizontal'
                            className='flex-1 overflow-hidden'
                            autoSaveId='app-root'
                          >
                            <Panel id='app-root-left' panelRef={leftPanelRef} defaultSize='50%'>
                              <div
                                className={`flex h-full ${shouldShowMobileHeader ? 'pt-[60px]' : ''}`}
                              >
                                <AppSidebar />
                                <main className='flex-1 no-scrollbar overflow-auto'>
                                  <EditWarningModal />
                                  <Outlet />
                                </main>
                              </div>
                            </Panel>
                            <Separator className='w-2 hover:bg-sidebar-divider active:bg-sidebar-divider transition-colors duration-200 cursor-col-resize flex items-center justify-center group'>
                              <div className='w-0.5 h-8 bg-transparent group-hover:bg-sidebar-divider group-active:bg-sidebar-divider transition-colors duration-200 rounded-full'></div>
                            </Separator>
                            <Panel id='app-root-webview' panelRef={rightPanelRef} defaultSize='50%'>
                              <WebView />
                            </Panel>
                          </ResizableGroup>
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
                          {import.meta.env.DEV &&
                            new URLSearchParams(window.location.search).has('devIncomingCall') && (
                              <IncomingCallDevHarness />
                            )}
                          <GlobalCallOverlay />
                          {recordingVersion === 'v2' ? (
                            <NoteTakerOverlayHost />
                          ) : (
                            <RecordingOverlay />
                          )}
                          <GlobalUploadProgress />
                          <NotificationHandler />
                          <ElectronBadgeSync />
                          <ElectronUpdateNudge />
                          <SosAlertBanner />
                          <CallFromRecentsHandler />
                          <CloudAgentFloatingHost />
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
                      <TranscriptCitationModal />
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
                            initialContextSelections={xyneAIInitialContextSelections}
                            contextOpenNonce={xyneAIContextOpenNonce}
                            kbCollectionId={xyneAIKbCollectionId ?? ''}
                            kbChannelId={xyneAIKbChannelId ?? ''}
                            kbDocId={xyneAIKbDocId ?? ''}
                            kbDocName={xyneAIKbDocName ?? ''}
                            kbFolderId={xyneAIKbFolderId ?? ''}
                            kbFolderName={xyneAIKbFolderName ?? ''}
                            kbOpenNonce={xyneAIKbOpenNonce}
                            researchContext={xyneAIResearchContext}
                            initialQuery={xyneAIInitialQuery ?? undefined}
                            autoSendNonce={xyneAIAutoSendNonce}
                            onDebuggerOpenChange={setIsXyneDebuggerOpen}
                            visible={false}
                          />
                        </div>
                      )}
                      {/* XyneAI Mobile Drawer */}
                      {isMobile && !isInPanelWebview && !isOnAIChatExperiencePage && (
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
                            initialContextSelections={xyneAIInitialContextSelections}
                            contextOpenNonce={xyneAIContextOpenNonce}
                            kbCollectionId={xyneAIKbCollectionId ?? ''}
                            kbChannelId={xyneAIKbChannelId ?? ''}
                            kbDocId={xyneAIKbDocId ?? ''}
                            kbDocName={xyneAIKbDocName ?? ''}
                            kbFolderId={xyneAIKbFolderId ?? ''}
                            kbFolderName={xyneAIKbFolderName ?? ''}
                            kbOpenNonce={xyneAIKbOpenNonce}
                            researchContext={xyneAIResearchContext}
                            initialQuery={xyneAIInitialQuery ?? undefined}
                            autoSendNonce={xyneAIAutoSendNonce}
                            onDebuggerOpenChange={setIsXyneDebuggerOpen}
                          />
                        </Drawer>
                      )}
                      {isMobile && !isInPanelWebview && (
                        <Drawer
                          open={isSdlcDebuggerOpen}
                          onOpenChange={open => {
                            if (!open) useExternalDebuggerStore.getState().close();
                          }}
                          title='Debugger'
                          description='Inspect this SDLC run'
                        >
                          <div className='h-[85vh]'>
                            <SdlcDebuggerPanel />
                          </div>
                        </Drawer>
                      )}
                    </SdlcFrameProvider>
                  </EditProvider>
                </SlashCommandArtifactSideEffectProvider>
              </AIOnboardingProvider>
            </InitialStateLoader>
          </ZeroFallbackProvider>
        </ZeroProvider>
      </EncryptionBootstrapProvider>
    </InstrumentationProvider>
  );
};

/** Real screen in the SDLC bundle; the framed placeholder in the main one. */
const SdlcRouteElement = (): ReactElement =>
  isSdlcSurface ? <SdlcScreen /> : <SdlcFrameViewport />;

export const router = createBrowserRouter(
  [
    {
      element: <ProtectedRoute />,
      errorElement: <RouterErrorFallback />,
      children: [
        {
          path: '/newWindow/claw',
          element: <ClawOverlay />,
        },
      ],
    },
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
                  path: 'slack-migration',
                  element: <SlackMigration />,
                },
                {
                  path: 'ai',
                  element: (
                    <ToolbarProtectedRoute path='/ai'>
                      <Outlet />
                    </ToolbarProtectedRoute>
                  ),
                  children: [
                    { index: true, element: <Navigate to='chat/new' replace /> },
                    // ONE route, with `new` as an ordinary value of :sessionId.
                    //
                    // Declaring `chat/new` separately looks harmless but makes two
                    // DISTINCT routes out of the same component, so moving between
                    // them unmounts and remounts AIScreen — wiping activeSessionId,
                    // chatKey and showChatView. The remount re-seeds from
                    // sessionStorage, which can still hold the previous thread, so
                    // the URL effect navigates back to it and remounts again: the
                    // screen visibly bounces between routes on every thread switch.
                    // With a single route, changing the param re-renders in place.
                    { path: 'chat/:sessionId', element: <AIScreen /> },
                    { path: 'daily-brief', element: <AIDailyBriefScreen /> },
                    { path: 'daily-brief/:briefDate', element: <AIDailyBriefScreen /> },
                    { path: 'library', element: <AILibraryScreen /> },
                    {
                      path: 'admin',
                      element: (
                        <RequireClawAdmin>
                          <AIAdminScreen />
                        </RequireClawAdmin>
                      ),
                    },
                    { path: 'library/agent/create', element: <AIAgentCreateScreen /> },
                    { path: 'library/subagent/create', element: <AISubagentCreateScreen /> },
                    { path: 'library/skill/create', element: <AISkillCreateScreen /> },
                    { path: 'library/agent/:slug/edit', element: <AIAgentEditScreen /> },
                    { path: 'library/agent/:slug', element: <AIAgentDetailScreen /> },
                    { path: 'library/subagent/:name/edit', element: <AISubagentEditScreen /> },
                    { path: 'library/subagent/:name', element: <AISubagentDetailScreen /> },
                    { path: 'library/skill/:slug', element: <AISkillDetailScreen /> },
                    { path: 'library/mcp/:type', element: <AIMcpDetailScreen /> },
                    { path: 'library/app/:appId', element: <ArtifactAppScreen /> },
                    {
                      path: 'knowledge',
                      element: <AIKnowledgeScreen />,
                      children: [
                        { index: true, element: <KnowledgeBaseV2Screen /> },
                        {
                          // Mirrors /knowledge-base's own file-viewer route so
                          // opening a file from here stays under /ai/knowledge
                          // instead of hopping to the standalone KB screen.
                          path: ':projectId/:channelId/:collectionId/:folderId/:fileId',
                          element: <FileViewerLayout />,
                        },
                      ],
                    },
                    {
                      path: 'organization',
                      element: (
                        <RequireOrgManager>
                          <AIOrganizationScreen />
                        </RequireOrgManager>
                      ),
                    },
                    { path: 'digital-twin', element: <AIDigitalTwinScreen /> },
                    {
                      element: <AISectionLayout />,
                      children: [
                        { path: 'metrics', element: <ClawMetricsScreen /> },
                        { path: 'settings', element: <ClawSettingsScreen /> },
                      ],
                    },
                  ],
                },
                {
                  path: 'onboarding',
                  element: <QuestionnaireScreen />,
                },
                {
                  // Dev-only surface for the on-device intent classifier. Bypasses the
                  // public-channel eligibility gate, so it is intentionally not linked
                  // from product UI. See docs/ON_DEVICE_INTENT.md
                  path: 'intent-playground',
                  element: <IntentPlaygroundScreen />,
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
                      element: (
                        <ToolbarProtectedRoute path='/chat/dir'>
                          <Outlet />
                        </ToolbarProtectedRoute>
                      ),
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
                          children: [
                            { index: true, element: null },
                            {
                              path: ':channelId/:conversationId',
                              element: <ThreadMessages />,
                            },
                          ],
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
                        // Radar (must come before :channelId). The route stays
                        // registered because the router is built at module scope;
                        // the CAC rollout gate lives inside RadarPanel itself.
                        {
                          path: 'radar',
                          children: [
                            {
                              index: true,
                              element: <RadarPanel />,
                            },
                            {
                              path: ':channelId',
                              element: <RadarPanel />,
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
                              path: ':conversationId/profile/:userId',
                              element: <ProfileSidebar />,
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
                      element: (
                        <ToolbarProtectedRoute path='/chat/dm'>
                          <DmsPage />
                        </ToolbarProtectedRoute>
                      ),
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
                      element: (
                        <ToolbarProtectedRoute path='/chat/canvas'>
                          <CanvasPanel />
                        </ToolbarProtectedRoute>
                      ),
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
                      element: (
                        <ToolbarProtectedRoute path='/chat/activity'>
                          <ActivityListView />
                        </ToolbarProtectedRoute>
                      ),
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
                  path: 'ticket-reports',
                  element: (
                    <ResourceProtectedRoute resourceName='TICKET-REPORTS' minAccess='WRITE'>
                      <TicketReportsScreen />
                    </ResourceProtectedRoute>
                  ),
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
                  path: 'claw-agents',
                  element: (
                    <ToolbarProtectedRoute path='/claw-agents'>
                      <GuestBlockedRoute>
                        <ClawAgentsScreen />
                      </GuestBlockedRoute>
                    </ToolbarProtectedRoute>
                  ),
                  children: [
                    { index: true, element: <AgentsTab /> },
                    { path: 'create', element: <ClawAgentCreateScreen /> },
                    { path: 'agents/:agentSlug', element: <ClawAgentDetailScreen /> },
                    { path: 'mcp', element: <McpTab /> },
                    { path: 'mcp/:mcpId', element: <ClawMcpDetailScreen /> },
                    { path: 'skills', element: <SkillsTab /> },
                    { path: 'skills/create', element: <ClawSkillCreateScreen /> },
                    { path: 'skills/:skillSlug', element: <ClawSkillDetailScreen /> },
                    { path: 'subagents', element: <SubagentsTab /> },
                    { path: 'subagents/create', element: <ClawSubagentCreateScreen /> },
                    { path: 'subagents/:subagentName', element: <ClawSubagentDetailScreen /> },
                    { path: 'organization', element: <ClawOrganizationScreen /> },
                    {
                      path: 'digital-twin',
                      element: <ClawDigitalTwinScreen />,
                      children: [
                        { index: true, element: <DigitalTwinMemoriesTab /> },
                        { path: 'hot', element: <DigitalTwinHotTab /> },
                        { path: 'proposals', element: <DigitalTwinProposalsTab /> },
                        { path: 'recall', element: <DigitalTwinRecallTab /> },
                        { path: 'graph', element: <DigitalTwinGraphTab /> },
                        { path: 'metrics', element: <ClawDigitalTwinMetricsScreen /> },
                        { path: 'settings', element: <DigitalTwinSettingsTab /> },
                      ],
                    },
                    { path: 'metrics', element: <ClawMetricsScreen /> },
                    { path: 'settings', element: <ClawSettingsScreen /> },
                  ],
                },
                {
                  path: 'knowledge-base',
                  element: (
                    <ToolbarProtectedRoute path='/knowledge-base'>
                      <KnowledgeBaseV2Layout />
                    </ToolbarProtectedRoute>
                  ),
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
                  element: (
                    <ToolbarProtectedRoute path='/memory'>
                      <MemoryScreen />
                    </ToolbarProtectedRoute>
                  ),
                },
                {
                path: 'entities',
                element: <EntitiesScreen />,
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
                  path: 'sdlc',
                  element: (
                    <ResourceProtectedRoute resourceName='SDLC' minAccess='READ'>
                      <SdlcRouteElement />
                    </ResourceProtectedRoute>
                  ),
                },
                {
                  path: 'sdlc/:channelId',
                  element: (
                    <ResourceProtectedRoute resourceName='SDLC' minAccess='READ'>
                      <SdlcRouteElement />
                    </ResourceProtectedRoute>
                  ),
                },
                {
                  path: 'sdlc/:channelId/:section',
                  element: (
                    <ResourceProtectedRoute resourceName='SDLC' minAccess='READ'>
                      <SdlcRouteElement />
                    </ResourceProtectedRoute>
                  ),
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
                    <ResourceProtectedRoute
                      resourceName='USER-GROUPS'
                      minAccess='WRITE'
                      allowUserGroupCreator
                    >
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
                  path: 'releaseManager',
                  element: (
                    <ToolbarProtectedRoute path='/releaseManager'>
                      <ReleaseManagerView />
                    </ToolbarProtectedRoute>
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
                  element: (
                    <ToolbarProtectedRoute path='/calls'>
                      <CallHistoryScreen />
                    </ToolbarProtectedRoute>
                  ),
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
                  element: (
                    <ToolbarProtectedRoute path='/recordings'>
                      <RecordingsRoute />
                    </ToolbarProtectedRoute>
                  ),
                },
                {
                  path: 'recordings/:recordingId',
                  element: <RecordingDetailRoute />,
                },
                {
                  path: 'user-groups/:userGroupId/assignment-config',
                  element: (
                    <ResourceProtectedRoute
                      resourceName='USER-GROUPS'
                      minAccess='WRITE'
                      allowUserGroupCreator
                    >
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
                          'deskIntegrations',
                          'workspaceMailboxConnected',
                          'email',
                          'provider',
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
                  element: (
                    <ToolbarProtectedRoute path='/browser'>
                      <BrowserTabsScreen />
                    </ToolbarProtectedRoute>
                  ),
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
                  element: (
                    <ToolbarProtectedRoute path='/scheduled-messages'>
                      <ScheduledMessageScreen />
                    </ToolbarProtectedRoute>
                  ),
                },
                {
                  path: 'automations',
                  element: (
                    <ToolbarProtectedRoute path='/automations'>
                      <AutomationsScreen />
                    </ToolbarProtectedRoute>
                  ),
                  children: [
                    { index: true, element: <AutomationsListScreen /> },
                    { path: 'approvals', element: <AutomationApprovalsScreen /> },
                    { path: 'new', element: <AutomationBuilderScreen /> },
                    { path: ':id', element: <AutomationBuilderScreen /> },
                    { path: ':id/runs', element: <AutomationRunsScreen /> },
                    { path: ':id/runs/:runId', element: <AutomationRunDetailScreen /> },
                  ],
                },
                {
                  path: 'apps',
                  element: (
                    <ToolbarProtectedRoute path='/apps'>
                      <AppsScreen />
                    </ToolbarProtectedRoute>
                  ),
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
                  path: 'roles',
                  element: (
                    <ResourceProtectedRoute resourceName='ROLES'>
                      <RoleManagementScreen />
                    </ResourceProtectedRoute>
                  ),
                },
                {
                  path: 'tag-review',
                  element: (
                    <ResourceProtectedRoute resourceName='WORKSPACE'>
                      <TagReviewView />
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
                  element: (
                    <ToolbarProtectedRoute path='/guide'>
                      <UserGuideScreen />
                    </ToolbarProtectedRoute>
                  ),
                },
              ],
            },
          ],
        },

        {
          path: '/call/:callId',
          element: (
            <EncryptionBootstrapProvider>
              <ZeroProvider>
                <CallRouteHandler />
              </ZeroProvider>
            </EncryptionBootstrapProvider>
          ),
        },
        {
          path: '/redirected',
          element: (
            <EncryptionBootstrapProvider>
              <ZeroProvider>
                <CanvasRedirectPage />
              </ZeroProvider>
            </EncryptionBootstrapProvider>
          ),
        },
        {
          path: '/calls/:callId/:callType',
          element: (
            <EncryptionBootstrapProvider>
              <ZeroProvider>
                <CallPage />
              </ZeroProvider>
            </EncryptionBootstrapProvider>
          ),
        },
        {
          path: '/newWindow/chat/dir',
          element: (
            <EncryptionBootstrapProvider>
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
                      <TranscriptCitationModal />
                    </EditProvider>
                  </InitialStateLoader>
                </ZeroFallbackProvider>
              </ZeroProvider>
            </EncryptionBootstrapProvider>
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
          path: '/newWindow/sdlc/:workspaceId/:channelId/:section',
          element: (
            <EncryptionBootstrapProvider>
              <ZeroProvider>
                <ZeroFallbackProvider>
                  <InitialStateLoader>
                    <div className='h-full bg-background'>
                      <SdlcWindow />
                    </div>
                    {/* roomActor is a module singleton, so this window needs its own. */}
                    <GlobalCallOverlay autoJoinOnAccept={false} />
                  </InitialStateLoader>
                </ZeroFallbackProvider>
              </ZeroProvider>
            </EncryptionBootstrapProvider>
          ),
        },
        {
          path: '/newWindow/create-ticket',
          element: (
            <ZeroProvider>
              <ZeroFallbackProvider>
                <InitialStateLoader>
                  <EditProvider>
                    <div className='h-full bg-background'>
                      <CreateTicketWindow />
                    </div>
                    <AttachmentGalleryModal />
                  </EditProvider>
                </InitialStateLoader>
              </ZeroFallbackProvider>
            </ZeroProvider>
          ),
        },
        {
          path: '/invite',
          element: <AcceptInvitation />,
        },
        {
          path: '/community',
          element: <CommunityWorkspaceSelectionRoute />,
        },
        {
          path: '/auth',
          element: <AuthScreen />,
        },
        {
          path: '/workspaces',
          element: <WorkspaceSelectionScreen />,
        },
        {
          path: '/no-access',
          element: <NoOrganizationAccessScreen />,
        },
        {
          path: '/launch',
          element: <LaunchScreen />,
        },
        {
          path: '/system',
          element: <SystemPalette />,
        },
      ],
    },
    // Last, so it only matches once every route above has failed to.
    {
      path: '*',
      element: <NotFoundScreen />,
      errorElement: <RouterErrorFallback />,
    },
  ],
  // The lane serves under /sdlc-app; every route above is matched relative to it.
  APP_BASE_PATH === '/' ? undefined : { basename: APP_BASE_PATH },
);
