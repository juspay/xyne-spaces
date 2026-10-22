import React, { ReactElement, Suspense, useEffect, useMemo } from 'react';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, usePathname, useSegments } from 'expo-router';
import { useCSSVariable } from 'uniwind';
import { useAuth } from '@/src/contexts/AuthContext';
import { useStartupPhase } from '@/src/providers/StartupPhaseProvider';
import {
  CALL_BAR_GAP,
  CALL_BAR_HEIGHT,
  CallBarVisibilityContext,
  useIsCallBarVisible,
} from '@/src/hooks/useIsCallBarVisible';
import { SafeAreaInsetsProvider } from '@/src/hooks/useRawSafeAreaInsets';

import InitialStateLoader from '@/src/providers/InitialStateLoader';
import ZeroProvider from '@/src/providers/ZeroProvider';
import { usePresenceSetup } from '@/src/hooks/usePresenceSetup';
import { useClearExpiredOwnStatus } from '@/src/hooks/useClearExpiredOwnStatus';
import { OngoingCallBanner } from '@/src/components/call/OngoingCallBanner';
import { IncomingCallSync } from '@/src/components/call/IncomingCallSync';
import { DashboardWebViewRouteLoader } from '@/src/components/dashboard-webview/DashboardWebViewLoader';
import {
  SosAlertHost,
  useNotificationSession,
  useCallNotificationSession,
} from '@/src/notifications';
import { ProtectedStartupScreen } from '@/src/components/startup/ProtectedStartupScreen';
import { isWorkspaceSwitchInProgress } from '@/src/services/workspaceSessionReset';
import { useIncomingShareTarget } from '@/src/features/share-target';
import { UpdatePromptGate } from '@/src/features/app-update';
import { RevokedBetaFlagsGate } from '@/src/features/beta-flags';
import { setRouteSnapshot } from '@/src/features/chat/navigation/routeSnapshot';
import { ensureQueryCacheStorageReady } from '@/src/machines/queryCacheMachine';
import { GuideReturnBar } from '@/src/features/user-guide/components/guide-return-bar';
import { isFlagOn, useFlagGeneration } from '@/src/flags';

const DASHBOARD_WEBVIEW_ROUTE_SEGMENTS = new Set(['canvas', 'rca', 'call', 'channel-canvas']);

/** Snappier than the native modal default, which drags at ~500ms. */
const CREATE_WORKSPACE_TRANSITION_MS = 100;

const LazyDashboardWebViewShell = React.lazy(
  () => import('@/src/components/dashboard-webview/DashboardWebViewShell'),
);

// A cold deep link into the protected chat stack must still have the conversation
// list beneath it, so the normal back action has a real destination.
// eslint-disable-next-line @typescript-eslint/naming-convention
export const unstable_settings = {
  // Which group a cold deep link falls back to. Read at module load, which is
  // the same moment the flag snapshot is pinned, so it always matches the shell
  // this process will render.
  anchor: isFlagOn('ui.shell') ? '(spaces)' : '(tabs)',
};

function ClearExpiredOwnStatusEffect({ enabled }: { enabled: boolean }): null {
  useClearExpiredOwnStatus({ enabled });
  return null;
}

function NativeShell(): ReactElement {
  const { hasFirstFramePainted, isProtectedStartupReady } = useStartupPhase();
  const canRunPostStartupServices = hasFirstFramePainted && isProtectedStartupReady;

  // Install the shared synchronous cache reader before any chat child can
  // render. InitialStateLoader still owns the asynchronous hydration pass.
  ensureQueryCacheStorageReady();

  useCallNotificationSession();
  useNotificationSession({ enabled: canRunPostStartupServices });
  usePresenceSetup({ enabled: canRunPostStartupServices });
  useIncomingShareTarget();

  const stackContentBackground = useCSSVariable('--color-background') as string;
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const callBarVisibility = useIsCallBarVisible();

  const contentInsets = useMemo(
    () =>
      callBarVisibility.isCallActive
        ? { ...insets, top: insets.top + CALL_BAR_HEIGHT + CALL_BAR_GAP }
        : insets,
    [insets, callBarVisibility.isCallActive],
  );
  const { channelId, threadId, conversationId, messageId, createdAt } = useLocalSearchParams<{
    channelId?: string;
    threadId?: string;
    conversationId?: string;
    messageId?: string;
    createdAt?: string;
  }>();
  const resolvedMainChannelId =
    pathname?.endsWith('/chat-deeplink') && channelId && !threadId ? channelId : null;

  useEffect(() => {
    setRouteSnapshot(pathname, resolvedMainChannelId, {
      channelId,
      threadId,
      conversationId,
      messageId,
      createdAt,
    });
  }, [channelId, conversationId, createdAt, messageId, pathname, resolvedMainChannelId, threadId]);

  return (
    <>
      <ZeroProvider>
        <ClearExpiredOwnStatusEffect enabled={canRunPostStartupServices} />
        <InitialStateLoader>
          <CallBarVisibilityContext.Provider value={callBarVisibility}>
            <SafeAreaInsetsProvider raw={insets} content={contentInsets}>
              <Stack
                screenOptions={{
                  headerShown: false,
                  freezeOnBlur: Platform.OS === 'android',
                  contentStyle: { backgroundColor: stackContentBackground },
                }}
              >
                <Stack.Screen name='(tabs)' />
                <Stack.Screen name='(spaces)' />
                <Stack.Screen name='(shortcuts)' />
                <Stack.Screen
                  name='call-prejoin'
                  options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
                />
                <Stack.Screen name='native-call' />
                <Stack.Screen name='chat-deeplink' options={{ animation: 'none' }} />
                <Stack.Screen name='canvas' />
                <Stack.Screen name='call/[callId]' />
                <Stack.Screen name='global-search' />
                <Stack.Screen
                  name='attachments-viewer'
                  options={{ presentation: 'fullScreenModal' }}
                />
                <Stack.Screen
                  name='quick-look'
                  options={{ presentation: 'transparentModal', animation: 'fade' }}
                />
                <Stack.Screen
                  name='create-workspace'
                  options={{
                    presentation: 'fullScreenModal',
                    animation: 'slide_from_bottom',
                    animationDuration: CREATE_WORKSPACE_TRANSITION_MS,
                  }}
                />
                <Stack.Screen name='settings' />
                <Stack.Screen name='profile' />
                <Stack.Screen name='share-target' />
                <Stack.Screen name='morning-brief' />
                <Stack.Screen name='guide' />
                <Stack.Screen name='community-join' />
              </Stack>
            </SafeAreaInsetsProvider>
            <OngoingCallBanner />
          </CallBarVisibilityContext.Provider>
          <GuideReturnBar />
          <IncomingCallSync />
          <UpdatePromptGate />
          <RevokedBetaFlagsGate />
        </InitialStateLoader>
      </ZeroProvider>
      {/* Safety-critical UI must not wait for Zero or chat/query startup. */}
      <SosAlertHost />
    </>
  );
}

function ProtectedShell(): ReactElement {
  const { workspaceSessionKey, isLoading: isAuthLoading } = useAuth();
  const segments = useSegments();
  // Applying a flag change remounts this subtree, which is what re-reads the
  // pinned snapshot. Folded into the existing workspace key rather than adding
  // a wrapper: a workspace switch already remounts exactly this much, so the
  // teardown path is one the app exercises in production.
  const flagGeneration = useFlagGeneration();
  const shouldLoadDashboardWebView = (segments as string[]).some(segment =>
    DASHBOARD_WEBVIEW_ROUTE_SEGMENTS.has(segment),
  );

  if (isAuthLoading && isWorkspaceSwitchInProgress()) {
    return <ProtectedStartupScreen label='Switching workspace' progress={0.2} />;
  }

  return (
    <>
      <NativeShell key={`${workspaceSessionKey}:${flagGeneration}`} />

      {shouldLoadDashboardWebView && (
        <Suspense fallback={<DashboardWebViewRouteLoader />}>
          <LazyDashboardWebViewShell />
        </Suspense>
      )}
    </>
  );
}

export default ProtectedShell;
