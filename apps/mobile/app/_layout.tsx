import 'react-native-get-random-values';
import React, { ReactElement, Suspense, useEffect, useCallback, useState, useRef } from 'react';
import { Stack, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';
import { View, Alert, StatusBar } from 'react-native';
import { KeyboardController, KeyboardProvider } from 'react-native-keyboard-controller';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { useCSSVariable, useUniwind } from 'uniwind';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  ChannelServiceProvider,
  HttpClientProvider,
  InstrumentationProvider,
  SharedAuthProvider,
} from '@xyne/shared/hooks';
import { httpClient } from '@/src/services/sharedHttpClient';
import { getVespaParticipants } from '@/src/services/ChannelService';
import * as Linking from 'expo-linking';
import { AuthProvider, useAuth } from '@/src/contexts/AuthContext';
import { EnrollmentProvider, useEnrollment } from '@/src/contexts/EnrollmentContext';
import { DEFAULT_PORTAL_HOST, PortalHost } from '@/src/components/primitives/portal';
import { NativeToastModalHost } from '@/src/utils/toast';
import {
  AttachmentViewerProvider,
  useAttachmentViewer,
} from '@/src/components/chat/message/viewer/attachment-viewer-context';
import '@/global.css';
import { installTabShellResolver } from '@/src/navigation/installTabShellResolver';
import { IS_COMMUNITY_APP, skipsDeviceEnrollmentGate, TELEMETRY_CONFIG } from '@/src/config';
import { getPendingCommunityWorkspace } from '@/src/services/communityIntent';
import {
  checkEnrollmentAndHealthStatus,
  checkEnrollmentLocal,
} from '@/src/services/EnrollmentStatusService';
import { logger, initializeLogger } from '@/src/utils/logger';
import { crashReporter } from '@/src/utils/crashReporter';
import { CrashErrorBoundary } from '@/src/components/CrashErrorBoundary';
import type { EventType } from '@xyne/shared/logger';
import { verifyMtlsHealthWithRetry } from '@/src/services/MtlsApiService';
import {
  isLikelyNetworkErrorFromUnknown,
  shouldKeepSessionDespiteMtlsHealthFailure,
} from '@/src/utils/networkConnectivityErrors';
import type { ColdStartCallInfo } from '@/src/services/ColdStartCallDetector';
import { navigateToCallDeepLinkIfApplicable, parseCallDeepLink } from '@/src/utils/callDeepLink';
import { parseMessageDeepLink } from '@/src/utils/messageDeepLink';
import { parseRecordingDeepLink } from '@/src/utils/recordingDeepLink';
import { sendRecordingAction } from '@/src/stores/recordingStore';
import { openTicketDeepLink, parseTicketDeepLink } from '@/src/utils/ticketDeepLink';
import { registerDeepLinkQueue } from '@/src/utils/pendingDeepLink';
import { useDeepLinkWorkspaceSwitch } from '@/src/hooks/useDeepLinkWorkspaceSwitch';
import { WorkspaceSwitchOverlay } from '@/src/components/deep-link/workspace-switch-overlay';
import {
  createChatOpenIntent,
  executeChatOpenIntent,
} from '@/src/features/chat/navigation/chatOpenIntent';
import { useAppActivityTracking } from '@/src/hooks/useAppActivityTracking';
import { useScreenDwellTracker } from '@/src/hooks/useScreenDwellTracker';
import { ensureForegroundListSyncProbeListener } from '@/src/hooks/useForegroundListSyncProbe';
import { startupTimings } from '@/src/utils/startupTimings';
import { markTelemetryReady } from '@/src/services/metrics/metricsQueue';
import { StartupPhaseProvider, useStartupPhase } from '@/src/providers/StartupPhaseProvider';
import { initializeMtlsTransport } from '@/src/utils/mtlsTransport';
import { restorePersistentDownloads } from '@/src/modules/downloads/NativeAttachmentDownload';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { queryClient } from '@/src/services/queryClient';
import { BubbleAccentProvider } from '@/src/theme/BubbleAccentProvider';

import {
  appDeviceEnvironment,
  appLoggerLifecycle,
  logger as structuredLogger,
} from '@/src/observability/logging/appLogger';
import { appMetricsLifecycle } from '@/src/observability/metrics/appMetrics';
import { useTrackColdStart } from '@/src/observability/logging/hooks/startup/useTrackColdStart';
import { useTrackActivityOpen } from '@/src/observability/logging/hooks/activity/useTrackActivityOpen';
import { useTrackNotificationOpen } from '@/src/observability/logging/hooks/notification/useTrackNotificationOpen';
import { lotusInstrumentation } from '@/src/observability/zero/lotusInstrumentation';
import { useNotificationNavigation } from '@/src/notifications';
import { initTheme } from '@/src/design-system';

const isHandledDeepLinkUrl = (url: string): boolean =>
  parseTicketDeepLink(url) !== null ||
  parseMessageDeepLink(url) !== null ||
  parseCallDeepLink(url) !== null ||
  parseRecordingDeepLink(url) !== null;

// Stored theme into Uniwind before the first render, so no frame paints the
// default theme first. Module scope, like the route resolver below.
initTheme();

console.log('[App] Boot — JS bundle loaded, splash visible');
// Teach the pure route builder which shell is active, before any route resolves.
installTabShellResolver();

void SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({
  duration: 0,
  fade: false,
});
const POST_FIRST_FRAME_SERVICES_DELAY_MS = 250;
export const unstable_settings = {
  // Signed-out landing: the community list in the community app, login in the main app.
  anchor: IS_COMMUNITY_APP ? 'community' : 'login',
};
const LazyImageViewerModal = React.lazy(
  () => import('@/src/components/chat/message/viewer/image-viewer-modal'),
);
const LazyMediaListModal = React.lazy(
  () => import('@/src/components/chat/message/viewer/media-list-modal'),
);
function AttachmentViewerModals(): ReactElement {
  const { isOpen, isListOpen, listAttachments, openFromList, closeList } = useAttachmentViewer();
  return (
    <>
      {(isOpen || isListOpen) && (
        <Suspense fallback={null}>
          {isOpen && <LazyImageViewerModal />}
          {isListOpen && (
            <LazyMediaListModal
              attachments={listAttachments}
              onItemPress={openFromList}
              onClose={closeList}
            />
          )}
        </Suspense>
      )}
    </>
  );
}
function SharedAuthBridge({ children }: { children: React.ReactNode }): ReactElement | null {
  const { user } = useAuth();
  if (!user) {
    return <>{children}</>;
  }
  return <SharedAuthProvider value={{ userID: user.user_id }}>{children}</SharedAuthProvider>;
}
function RootLayoutNav(): ReactElement {
  const { theme } = useUniwind();
  const { isSignedIn, isLoading: isAuthLoading, token } = useAuth();
  const { isEnrolled, setIsEnrolled, isEnrollmentLoading, setIsEnrollmentLoading } =
    useEnrollment();
  const [coldStartCall, setColdStartCall] = useState<ColdStartCallInfo | null>(null);
  const [isNavigatorMounted, setIsNavigatorMounted] = useState(false);
  const [isRootViewLaidOut, setIsRootViewLaidOut] = useState(false);
  const {
    hasSplashHidden,
    hasFirstFramePainted,
    isProtectedStartupReady,
    markFirstFramePainted,
    markSplashHidden,
  } = useStartupPhase();
  useTrackColdStart({
    hasSplashHidden,
    isEnrollmentLoading,
    isAuthLoading,
    isEnrolled,
    isSignedIn,
  });
  useTrackNotificationOpen({
    hasSplashHidden,
    isProtectedStartupReady,
  });
  // Keep notification tap capture above the auth route boundary. A killed-app
  // tap can briefly enter the login guard while the cached session is restored;
  // mounting this only inside `(protected)` loses the one-shot launch payload.
  useNotificationNavigation();
  useTrackActivityOpen();
  const coldStartNavigatedRef = useRef(false);
  const splashHiddenRef = useRef(false);
  const segments = useSegments();
  const rootNavigationState = useRootNavigationState();
  const router = useRouter();
  const pendingDeepLinkRef = useRef<string | null>(null);
  const pendingDeepLinkRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDeepLinkRetryCountRef = useRef(0);
  const hasReceivedRuntimeDeepLinkRef = useRef(false);
  const didReadInitialDeepLinkRef = useRef(false);
  const processPendingDeepLinkRef = useRef<() => void>(() => undefined);
  const enqueueDeepLinkRef = useRef<(url: string) => void>(() => undefined);
  const didMarkRootNavigationStateReadyRef = useRef(false);
  const didStartRootAsyncServicesRef = useRef(false);
  const telemetryInitializedRef = useRef(false);

  useEffect(() => {
    ensureForegroundListSyncProbeListener();
  }, []);

  // telemery disabled in debug builds to avoid pollution from reloads and dev mode.
  useEffect(() => {
    if (__DEV__ || telemetryInitializedRef.current) {
      return;
    }

    telemetryInitializedRef.current = true;
    void import('@/src/services/metrics/telemetry')
      .then(({ initializeTelemetry }) => {
        return initializeTelemetry();
      })
      .then(() => {
        markTelemetryReady();
      })
      .catch(error => {
        logger.warn('telemetry_initialization_failed' as EventType, { error });
      });
  }, []);

  useEffect(() => {
    const segs = segments as unknown as string[];
    if (Array.isArray(segs) && segs.length > 0) {
      startupTimings.init({ initialRouteSegments: segs });
    }
  }, [segments]);
  const handleUnhealthyMtls = useCallback(
    (status: Awaited<ReturnType<typeof checkEnrollmentAndHealthStatus>>) => {
      if (!status.health?.isCertificateError) {
        Alert.alert(
          'Unable to verify device',
          "We couldn't verify your device certificate. Please check your internet connection and try again.",
        );
      } else {
        Alert.alert(
          'Certificate issue',
          'Your device certificate is invalid or expired. Please re-enroll to continue.',
        );
      }
      setIsEnrolled(false);
    },
    [setIsEnrolled],
  );
  const verifyEnrolledInBackground = useCallback(async () => {
    try {
      if (isEnrolled === false) return;
      const status = await checkEnrollmentAndHealthStatus();
      if (!status.isEnrolled) {
        setIsEnrolled(false);
        return;
      }
      if (!status.isHealthy && status.health?.isCertificateError) {
        handleUnhealthyMtls(status);
      }
    } catch (error) {
      console.error('[RootLayout] Background enrollment error:', error);
    }
  }, [handleUnhealthyMtls, isEnrolled, setIsEnrolled]);
  const checkEnrollmentOnColdStart = useCallback(async () => {
    void startupTimings.mark('enrollment_check_start');
    try {
      if (isEnrolled !== null) {
        setIsEnrollmentLoading(false);
        void startupTimings.mark('enrollment_check_end');
        if (isEnrolled) {
          setTimeout(() => void verifyEnrolledInBackground(), 0);
        }
        return;
      }
      if (skipsDeviceEnrollmentGate()) {
        setIsEnrolled(true);
        setIsEnrollmentLoading(false);
        void startupTimings.mark('enrollment_check_end');
        return;
      }
      const local = await checkEnrollmentLocal();
      setIsEnrolled(local);
      setIsEnrollmentLoading(false);
      void startupTimings.mark('enrollment_check_end');
      if (local) {
        setTimeout(() => void verifyEnrolledInBackground(), 0);
      }
      if (!local) {
        setIsEnrolled(false);
        return;
      }

      setIsEnrolled(true);

      void (async () => {
        try {
          const health = await verifyMtlsHealthWithRetry(1);
          if (health.isHealthy) {
            return;
          }
          if (shouldKeepSessionDespiteMtlsHealthFailure(health)) {
            return;
          }
          handleUnhealthyMtls({
            isEnrolled: true,
            isHealthy: false,
            health,
          });
        } catch (error) {
          console.error('[RootLayout] Background mTLS health error:', error);
          if (isLikelyNetworkErrorFromUnknown(error)) {
            return;
          }
          setIsEnrolled(false);
        }
      })();
    } catch (error) {
      console.error('[RootLayout] Error checking enrollment:', error);
      setIsEnrolled(false);
      setIsEnrollmentLoading(false);
      void startupTimings.mark('enrollment_check_end');
    }
  }, [isEnrolled, setIsEnrolled, setIsEnrollmentLoading, verifyEnrolledInBackground]);
  const checkEnrollmentFull = useCallback(async () => {
    try {
      if (skipsDeviceEnrollmentGate()) {
        setIsEnrolled(true);
        return;
      }
      const status = await checkEnrollmentAndHealthStatus();
      if (!status.isEnrolled) {
        setIsEnrolled(false);
        return;
      }
      if (!status.isHealthy) {
        if (shouldKeepSessionDespiteMtlsHealthFailure(status.health)) {
          setIsEnrolled(true);
          return;
        }
        console.error('[RootLayout] mTLS health check failed:', status.health);
        handleUnhealthyMtls(status);
        return;
      }
      setIsEnrolled(true);
    } catch (error) {
      console.error('[RootLayout] Error checking enrollment:', error);
      if (isLikelyNetworkErrorFromUnknown(error)) {
        const local = await checkEnrollmentLocal();
        setIsEnrolled(local);
        return;
      }
      setIsEnrolled(false);
    } finally {
      setIsEnrollmentLoading(false);
    }
  }, [handleUnhealthyMtls, setIsEnrolled, setIsEnrollmentLoading]);
  useEffect(() => {
    if (didStartRootAsyncServicesRef.current) {
      return;
    }
    didStartRootAsyncServicesRef.current = true;
    try {
      initializeMtlsTransport();
    } catch (e) {
      console.warn('[RootLayout] Failed to init mTLS transport', e);
    }
    void restorePersistentDownloads().catch(e => {
      console.warn('[RootLayout] Failed to restore persistent downloads', e);
    });
    void checkEnrollmentOnColdStart();
  }, [checkEnrollmentOnColdStart]);

  useEffect(() => {
    if (!hasFirstFramePainted) {
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          try {
            KeyboardController.preload();
          } catch (e) {
            if (__DEV__) {
              console.warn('[RootLayout] KeyboardController.preload failed:', e);
            }
          }

          const [{ setupSettingsPersistence }, { persistCurrentSettingsSnapshot }] =
            await Promise.all([
              import('@/src/machines/settingsMachine'),
              import('@/src/theme/persistSettingsSnapshot'),
            ]);
          if (cancelled) return;

          setupSettingsPersistence();
          persistCurrentSettingsSnapshot();
        } catch (e) {
          console.warn('[RootLayout] Failed to init settings persistence', e);
        }

        try {
          const { initializeColdStartDetection, getCachedColdStartCall } =
            await import('@/src/services/ColdStartCallDetector');
          await initializeColdStartDetection();
          const cachedCall = getCachedColdStartCall();
          if (!cancelled && cachedCall) {
            setColdStartCall(cachedCall);
          }
        } catch (e) {
          console.warn('[RootLayout] Cold start detection init failed', e);
        }

        try {
          await initializeLogger();
          await crashReporter.initialize(logger.getClientSessionId());
          const { recoverMmkvDiagnostics } =
            await import('@/src/observability/mmkv/mmkvDiagnosticsRuntime');
          recoverMmkvDiagnostics();
        } catch (e) {
          console.warn('[RootLayout] Logger/crash reporter init failed', e);
        }
      })();
    }, POST_FIRST_FRAME_SERVICES_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [hasFirstFramePainted]);

  useEffect(() => {
    if (!rootNavigationState?.key) {
      setIsNavigatorMounted(false);
      return;
    }
    if (!didMarkRootNavigationStateReadyRef.current) {
      didMarkRootNavigationStateReadyRef.current = true;
      void startupTimings.mark('root_navigation_state_ready');
    }
    setIsNavigatorMounted(true);
  }, [rootNavigationState?.key]);

  // A community invite opened with a live session: the signed-out community screen is guarded off,
  // so hand it to the in-app join screen, which swaps the workspace session.
  useEffect(() => {
    if (
      !IS_COMMUNITY_APP ||
      !isSignedIn ||
      isAuthLoading ||
      isEnrollmentLoading ||
      !rootNavigationState?.key
    ) {
      return;
    }
    const finalSegments = segments as unknown as string[];
    if (finalSegments[1] === 'community-join') {
      return;
    }
    if (!getPendingCommunityWorkspace()) {
      return;
    }
    router.replace('/(protected)/community-join');
  }, [isSignedIn, isAuthLoading, isEnrollmentLoading, rootNavigationState?.key, router, segments]);

  useEffect(() => {
    const signedOutSegment = segments[0] === 'login' || segments[0] === 'community';
    if (signedOutSegment && isEnrolled === false) {
      setIsEnrollmentLoading(true);
      void checkEnrollmentFull();
    }
  }, [segments, isEnrolled, checkEnrollmentFull, setIsEnrollmentLoading]);

  // dwell is recorded before metrics are flushed on background)
  useScreenDwellTracker();

  // Track app foreground/background transitions
  useAppActivityTracking();

  const didMarkAuthLoadingStartRef = useRef(false);
  useEffect(() => {
    if (didMarkAuthLoadingStartRef.current) return;
    if (!isAuthLoading) return;
    didMarkAuthLoadingStartRef.current = true;
    void startupTimings.mark('auth_loading_start');
  }, [isAuthLoading]);

  const didMarkAuthLoadingEndRef = useRef(false);
  useEffect(() => {
    if (didMarkAuthLoadingEndRef.current) return;
    if (isAuthLoading) return;
    didMarkAuthLoadingEndRef.current = true;
    void startupTimings.mark('auth_loading_end');
  }, [isAuthLoading]);

  useEffect(() => {
    if (!rootNavigationState?.key || !isNavigatorMounted) {
      return;
    }
    if (isEnrollmentLoading || isAuthLoading) {
      return;
    }
    const finalSegments = segments as unknown as string[];
    const inProtected = finalSegments[0] === '(protected)';
    const inCallRoute = finalSegments[0] === 'call';
    const inNativeCallRoute = finalSegments[1] === 'native-call';
    if (coldStartCall && isEnrolled && isSignedIn && !inCallRoute && !inNativeCallRoute) {
      const channelId = coldStartCall.channelId || coldStartCall.callId;
      console.log('[RootLayout] Cold start, navigating to native-call', channelId);
      router.replace({
        pathname: '/(protected)/native-call',
        params: {
          channelId,
          callType: coldStartCall.callType,
        },
      } as never);
      coldStartNavigatedRef.current = true;
      setColdStartCall(null);
      void (async () => {
        const { clearColdStartCallCache } = await import('@/src/services/ColdStartCallDetector');
        clearColdStartCallCache();
      })();
      return;
    }
    if (coldStartNavigatedRef.current) {
      if (inNativeCallRoute || inProtected) {
        coldStartNavigatedRef.current = false;
      }
      return;
    }
  }, [
    isEnrolled,
    isSignedIn,
    isEnrollmentLoading,
    isAuthLoading,
    segments,
    router,
    coldStartCall,
    rootNavigationState?.key,
    isNavigatorMounted,
  ]);
  useEffect(() => {
    if (isSignedIn && !isAuthLoading && !isEnrollmentLoading && token && hasFirstFramePainted) {
      const processPendingCall = async (): Promise<void> => {
        try {
          const { callLaunchHandler } = await import('@/src/services/CallLaunchHandler');
          await callLaunchHandler.processPendingCallAction();
        } catch (error) {
          console.error('[RootLayout] Failed to process pending call action:', error);
        }
      };
      void processPendingCall();
    }
  }, [hasFirstFramePainted, isSignedIn, isAuthLoading, isEnrollmentLoading, token]);
  useEffect(() => {
    if (!isSignedIn || isAuthLoading || isEnrollmentLoading || !hasFirstFramePainted) {
      return;
    }
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const { callLaunchHandler } = await import('@/src/services/CallLaunchHandler');
        if (cancelled) return;
        unsubscribe = callLaunchHandler.subscribe(action => {
          if (action.type === 'autoJoin') {
            router.push({
              pathname: '/(protected)/native-call',
              params: {
                channelId: action.payload.channelId || action.payload.callId,
                callType: action.payload.callType,
              },
            });
          }
        });
      } catch (e) {
        console.error('[RootLayout] Failed to subscribe to call launch handler', e);
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [hasFirstFramePainted, isSignedIn, isAuthLoading, isEnrollmentLoading, router]);
  useEffect(() => {
    if (splashHiddenRef.current) return;
    if (!rootNavigationState?.key) return;
    if (!isRootViewLaidOut) return;
    // Do not expose the login route while a returning session is still being
    // restored. The protected route will replace it in the same startup flow.
    if (isAuthLoading) return;
    splashHiddenRef.current = true;
    void startupTimings.mark('splash_hidden');

    void (async () => {
      try {
        void startupTimings.mark('splash_hide_call');
        await SplashScreen.hideAsync();
        void startupTimings.mark('splash_hide_done');
        markSplashHidden();
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            void startupTimings.mark('root_first_frame_painted');
            markFirstFramePainted();
          });
        });
      } catch {
        splashHiddenRef.current = false;
      }
    })();
  }, [
    isAuthLoading,
    isRootViewLaidOut,
    markFirstFramePainted,
    markSplashHidden,
    rootNavigationState?.key,
  ]);
  const runPendingDeepLink = useCallback((): void => {
    processPendingDeepLinkRef.current();
  }, []);

  const abandonPendingDeepLink = useCallback((): void => {
    pendingDeepLinkRef.current = null;
    pendingDeepLinkRetryCountRef.current = 0;
  }, []);

  const {
    switchingToWorkspaceName,
    claim: claimWorkspaceForDeepLink,
    complete: completeDeepLinkWorkspaceSwitch,
    reset: resetDeepLinkWorkspaceSwitch,
  } = useDeepLinkWorkspaceSwitch({
    onWorkspaceReady: runPendingDeepLink,
    onAbandoned: abandonPendingDeepLink,
  });

  // Queue entry point shared by the OS URL events below and by in-app link taps
  // (via `registerDeepLinkQueue`). Everything that opens a message link funnels
  // through the same pending-URL slot, so the workspace switch is applied once, in
  // one place, whatever the entry point was.
  const enqueueDeepLink = useCallback(
    (url: string): void => {
      pendingDeepLinkRef.current = url;
      pendingDeepLinkRetryCountRef.current = 0;
      resetDeepLinkWorkspaceSwitch();
      processPendingDeepLinkRef.current();
    },
    [resetDeepLinkWorkspaceSwitch],
  );

  const processPendingDeepLink = useCallback((): void => {
    if (
      !isSignedIn ||
      isAuthLoading ||
      isEnrollmentLoading ||
      isEnrolled !== true ||
      !rootNavigationState?.key ||
      !isNavigatorMounted ||
      !hasFirstFramePainted ||
      !isProtectedStartupReady
    ) {
      return;
    }
    const url = pendingDeepLinkRef.current;
    if (!url) {
      return;
    }
    if (navigateToCallDeepLinkIfApplicable(router, url)) {
      pendingDeepLinkRef.current = null;
      return;
    }
    const recordingLink = parseRecordingDeepLink(url);
    if (recordingLink) {
      // Widget/Live Activity tap that needed to foreground the app (iOS 16.x,
      // or the Android in-process broadcast's defensive fallback). Dispatch
      // first — recordingStore's state is synchronous and the recordings
      // screen reads it on mount via useSyncExternalStore, so no race.
      sendRecordingAction({
        type: recordingLink.action === 'start' ? 'requestAutoStart' : 'requestStop',
      });
      router.push({ pathname: '/(protected)/(shortcuts)/recordings' as never });
      pendingDeepLinkRef.current = null;
      return;
    }
    const ticketLink = parseTicketDeepLink(url);
    if (ticketLink) {
      // Same claim/enqueue contract as message links below: in-app ticket taps
      // that need a workspace switch enqueue here, so this is the only place
      // that actually switches and then re-opens the URL.
      if (claimWorkspaceForDeepLink(ticketLink)) return;
      openTicketDeepLink(router, ticketLink);
      pendingDeepLinkRef.current = null;
      pendingDeepLinkRetryCountRef.current = 0;
      completeDeepLinkWorkspaceSwitch();
      return;
    }
    const messageLink = parseMessageDeepLink(url);
    if (messageLink) {
      // The link may name another workspace. The URL stays pending across the switch,
      // so the re-entry below resolves the channel in the workspace that owns it.
      if (claimWorkspaceForDeepLink(messageLink)) return;
      const intent = createChatOpenIntent(messageLink, 'deeplink');
      if (intent) {
        if (executeChatOpenIntent(router, intent)) {
          pendingDeepLinkRef.current = null;
          pendingDeepLinkRetryCountRef.current = 0;
          completeDeepLinkWorkspaceSwitch();
          return;
        }

        // The guard normally reuses an active attempt. Keep one retry for the
        // rare case where that attempt expires between the URL event and
        // execution; the URL remains pending until navigation succeeds.
        if (
          pendingDeepLinkRetryCountRef.current === 0 &&
          pendingDeepLinkRetryRef.current === null
        ) {
          pendingDeepLinkRetryCountRef.current = 1;
          pendingDeepLinkRetryRef.current = setTimeout(() => {
            pendingDeepLinkRetryRef.current = null;
            processPendingDeepLinkRef.current();
          }, 100);
        }
        return;
      }
    }
    pendingDeepLinkRef.current = null;
    pendingDeepLinkRetryCountRef.current = 0;
    completeDeepLinkWorkspaceSwitch();
  }, [
    hasFirstFramePainted,
    isAuthLoading,
    isEnrolled,
    isEnrollmentLoading,
    isProtectedStartupReady,
    isNavigatorMounted,
    isSignedIn,
    rootNavigationState?.key,
    router,
    claimWorkspaceForDeepLink,
    completeDeepLinkWorkspaceSwitch,
  ]);

  useEffect(() => {
    processPendingDeepLinkRef.current = processPendingDeepLink;
  }, [processPendingDeepLink]);

  useEffect(() => {
    enqueueDeepLinkRef.current = enqueueDeepLink;
    return registerDeepLinkQueue(enqueueDeepLink);
  }, [enqueueDeepLink]);

  useEffect(() => {
    const handleInitialURL = async (): Promise<void> => {
      if (didReadInitialDeepLinkRef.current) return;
      didReadInitialDeepLinkRef.current = true;
      const initialUrl = await Linking.getInitialURL();
      if (initialUrl && !hasReceivedRuntimeDeepLinkRef.current) {
        if (isHandledDeepLinkUrl(initialUrl)) {
          enqueueDeepLinkRef.current(initialUrl);
        }
      }
    };
    const subscription = Linking.addEventListener('url', ({ url }) => {
      if (!isHandledDeepLinkUrl(url)) return;
      hasReceivedRuntimeDeepLinkRef.current = true;
      enqueueDeepLinkRef.current(url);
    });
    void handleInitialURL();
    return () => {
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    processPendingDeepLink();
  }, [processPendingDeepLink]);
  useEffect(
    () => () => {
      if (pendingDeepLinkRetryRef.current !== null) {
        clearTimeout(pendingDeepLinkRetryRef.current);
        pendingDeepLinkRetryRef.current = null;
      }
      pendingDeepLinkRetryCountRef.current = 0;
    },
    [],
  );

  const stackContentBackground = useCSSVariable('--color-background') as string;

  return (
    <>
      <View
        style={{ flex: 1, backgroundColor: '#000' }}
        onLayout={() => {
          if (!isRootViewLaidOut) {
            setIsRootViewLaidOut(true);
          }
        }}
      >
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Protected guard={!isEnrolled}>
            <Stack.Screen name='enrollment' />
          </Stack.Protected>
          {/* Community app: community is listed first so it is the signed-out landing screen;
              `login` is pushed on top of it, so Back returns to the community list. */}
          <Stack.Protected guard={IS_COMMUNITY_APP && Boolean(isEnrolled) && !isSignedIn}>
            <Stack.Screen name='community' />
          </Stack.Protected>
          <Stack.Protected guard={Boolean(isEnrolled) && !isSignedIn}>
            <Stack.Screen name='login' />
          </Stack.Protected>
          <Stack.Protected guard={isSignedIn && Boolean(isEnrolled)}>
            <Stack.Screen
              name='(protected)'
              options={{ contentStyle: { backgroundColor: stackContentBackground } }}
            />
          </Stack.Protected>
        </Stack>
      </View>
      {switchingToWorkspaceName !== null ? (
        <WorkspaceSwitchOverlay workspaceName={switchingToWorkspaceName} />
      ) : null}
      <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} />
    </>
  );
}
export default function RootLayout(): ReactElement {
  useEffect(() => {
    let cancelled = false;

    appLoggerLifecycle.start();

    void appDeviceEnvironment.start().finally(() => {
      if (!cancelled) {
        structuredLogger.info('app_started');
      }
    });

    return (): void => {
      cancelled = true;
      appDeviceEnvironment.stop();
      appLoggerLifecycle.stop();
    };
  }, []);

  useEffect(() => {
    if (!TELEMETRY_CONFIG.enabled) {
      // eslint-disable-next-line no-console -- Metrics start/skip must be visible in logcat.
      console.warn('[AppMetrics] Skipped start because metrics are disabled.');
      return;
    }

    // eslint-disable-next-line no-console -- Metrics start/skip must be visible in logcat.
    console.warn('[AppMetrics] Starting metrics lifecycle.');
    appMetricsLifecycle.start();

    return (): void => {
      appMetricsLifecycle.stop();
    };
  }, []);

  return (
    <CrashErrorBoundary name='Root'>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <SharedAuthBridge>
            <HttpClientProvider client={httpClient}>
              <ChannelServiceProvider getVespaParticipants={getVespaParticipants}>
                <InstrumentationProvider value={lotusInstrumentation}>
                  <EnrollmentProvider>
                    <GestureHandlerRootView style={{ flex: 1 }}>
                      <BottomSheetModalProvider>
                        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
                          <KeyboardProvider>
                            <BubbleAccentProvider>
                              <AttachmentViewerProvider>
                                <StartupPhaseProvider>
                                  <RootLayoutNav />
                                  <AttachmentViewerModals />
                                </StartupPhaseProvider>
                              </AttachmentViewerProvider>
                              <PortalHost name={DEFAULT_PORTAL_HOST} />
                              {/* iOS has no ToastAndroid, so `showMessageToast`
                                  hands its message to this host instead. Without
                                  it mounted, every toast in the app is silent
                                  there. */}
                              <NativeToastModalHost />
                            </BubbleAccentProvider>
                          </KeyboardProvider>
                        </SafeAreaProvider>
                      </BottomSheetModalProvider>
                    </GestureHandlerRootView>
                  </EnrollmentProvider>
                </InstrumentationProvider>
              </ChannelServiceProvider>
            </HttpClientProvider>
          </SharedAuthBridge>
        </AuthProvider>
      </QueryClientProvider>
    </CrashErrorBoundary>
  );
}
