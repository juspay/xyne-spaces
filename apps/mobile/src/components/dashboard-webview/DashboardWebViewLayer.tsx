import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useCSSVariable } from 'uniwind';
import { TRUSTED_ORIGINS } from '@xyne/shared';

import { API_ORIGIN, DASHBOARD_ORIGIN, isMtlsFeatureEnabled } from '@/src/config';
import { ensureMtlsForWebView } from '@/src/utils/mtlsWebView';
import { resolveTrustedCanvasWebViewPath } from '@/src/utils/dashboardWebViewNavigation';
import {
  isAllowedDashboardRoute,
  isAllowedDashboardNavigation,
  createFocusedRouteLockScript,
  isSafeExternalWebViewUrl,
  isTrustedWebViewOrigin,
  updateTrustedWebViewNavigation,
  type TrustedWebViewNavigationState,
} from '@/src/utils/webViewSecurity';
import { useAuth } from '@/src/contexts/AuthContext';
import {
  getAuthSessionGeneration,
  getAuthOperation,
  enqueueAuthCookieMutation,
  isAuthScopeCurrent,
  isAuthSessionCurrent,
} from '@/src/services/authSessionLifecycle';
import { DashboardWebViewLoader } from './DashboardWebViewLoader';
import { useWebViewEngine } from './WebViewEngineContext';
import { HeaderBackButton } from '@/src/components/ui/header-icon-button';
import { tabRoute } from '@/src/navigation/routes';
import {
  DASHBOARD_SESSION_COOKIE_NAMES,
  areDashboardSessionCookiesSynchronized,
  selectDashboardSessionCookies,
} from '@/src/utils/dashboardWebViewCookiePolicy';

const USER_ID_KEY = '@lotus_user_id';

const BRIDGE_CHANNEL = 'xyne-spaces-bridge';
const WEB_SOURCE = 'xyne-dashboard';
const BRIDGE_VERSION = 1;

const NATIVE_DM_ROOT = tabRoute('dms');

type WebOutboundMessageType =
  | 'WEB_APP_READY'
  | 'REQUEST_GOOGLE_SIGN_IN'
  | 'WEB_SIGN_OUT'
  | 'AUTH_STATE_SYNC'
  | 'REQUEST_NATIVE_SHELL'
  | 'START_NOTE_TAKER';

type BridgeEnvelope<T extends string = string, P = unknown> = {
  channel: string;
  source: string;
  type: T;
  version: number;
  timestamp: number;
  payload?: P;
};

const BRIDGE_MESSAGE_TYPES = new Set<WebOutboundMessageType>([
  'WEB_APP_READY',
  'REQUEST_GOOGLE_SIGN_IN',
  'WEB_SIGN_OUT',
  'AUTH_STATE_SYNC',
  'REQUEST_NATIVE_SHELL',
  'START_NOTE_TAKER',
]);

const bootstrapScript = ` 
(function () { 
  try { 
    window.nativeCallSupported = false; 
    window.__lotusCanvasHost = { version: 2 }; 
    window.addEventListener('error', function () {}); 
    window.addEventListener('unhandledrejection', function () {}); 
  } catch (_) {} 
})(); 
true; 
`;

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

const parseBridgeEnvelope = (raw: string): BridgeEnvelope | null => {
  try {
    const parsed = JSON.parse(raw) as BridgeEnvelope;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.channel !== BRIDGE_CHANNEL) return null;
    if (parsed.source !== WEB_SOURCE) return null;
    if (parsed.version !== BRIDGE_VERSION) return null;
    if (
      typeof parsed.type !== 'string' ||
      !BRIDGE_MESSAGE_TYPES.has(parsed.type as WebOutboundMessageType)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export default function DashboardWebViewLayer(): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signIn, signOut } = useAuth();
  const { webRef, state, setReady, post, navigate } = useWebViewEngine();
  const backgroundColor = (useCSSVariable('--color-background') as string) || '#FFFFFF';
  const foregroundColor = (useCSSVariable('--color-foreground') as string) || '#111827';
  const mutedColor = (useCSSVariable('--color-muted-foreground') as string) || '#6B7280';
  const destructiveColor = (useCSSVariable('--color-destructive') as string) || '#FF4F4F';

  const [mtlsReady, setMtlsReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isHandlingBridgeSignIn, setIsHandlingBridgeSignIn] = useState(false);
  const [hasInitialPageLoaded, setHasInitialPageLoaded] = useState(false);
  const trustedNavigationRef = useRef<TrustedWebViewNavigationState>({
    url: null,
    generation: 0,
  });

  const isTrustedDashboardMessageOrigin = useCallback(
    (url: string): boolean => isTrustedWebViewOrigin(url, DASHBOARD_ORIGIN),
    [],
  );

  const markNavigationStart = useCallback((): void => {
    trustedNavigationRef.current = {
      url: null,
      generation: trustedNavigationRef.current.generation + 1,
    };
  }, []);

  const handleNavigationStateChange = useCallback(
    ({ url }: { url: string }): void => {
      trustedNavigationRef.current = updateTrustedWebViewNavigation(
        trustedNavigationRef.current,
        url,
        DASHBOARD_ORIGIN,
        state.navigationTarget,
      );
    },
    [state.navigationTarget],
  );

  const isCurrentTrustedNavigation = useCallback(
    (generation: number): boolean => {
      const current = trustedNavigationRef.current;
      return (
        current.generation === generation &&
        current.url !== null &&
        isAllowedDashboardRoute(current.url, DASHBOARD_ORIGIN, state.navigationTarget)
      );
    },
    [state.navigationTarget],
  );

  const exitToNativeShell = useCallback(() => {
    if (state.presentation === 'overlay' && router.canGoBack()) {
      router.back();
      return;
    }

    router.replace(NATIVE_DM_ROOT);
  }, [router, state.presentation]);

  const getCookieManager = useCallback(async () => {
    const mod = await import('@react-native-cookies/cookies');
    return mod.default;
  }, []);

  const syncAuthCookiesToDashboardOrigin = useCallback(
    async (requireSessionCookie = false): Promise<boolean> => {
      const generation = getAuthSessionGeneration();
      const operation = getAuthOperation();
      const isCurrent = (): boolean => isAuthScopeCurrent(generation, operation);
      let synchronized = true;

      try {
        await enqueueAuthCookieMutation(
          generation,
          async () => {
            if (!isCurrent()) {
              synchronized = false;
              return;
            }

            const CookieManager = await getCookieManager();
            const sourceCookies = await CookieManager.get(API_ORIGIN);
            if (!isCurrent()) {
              synchronized = false;
              return;
            }

            const sessionCookies = selectDashboardSessionCookies(
              sourceCookies as Record<string, unknown>,
            );
            // An unauthenticated dashboard needs no cookie handoff.
            if (sessionCookies.length === 0) {
              synchronized = !requireSessionCookie;
              return;
            }

            for (const cookie of sessionCookies) {
              if (!isCurrent()) {
                synchronized = false;
                return;
              }
              const persisted = await CookieManager.set(
                DASHBOARD_ORIGIN,
                cookie as never,
                Platform.OS === 'ios',
              );
              if (!persisted) {
                synchronized = false;
                return;
              }
            }

            if (Platform.OS === 'android') {
              await CookieManager.flush();
            }
            if (!isCurrent()) {
              synchronized = false;
              return;
            }

            const destinationCookies = await CookieManager.get(
              DASHBOARD_ORIGIN,
              Platform.OS === 'ios',
            );
            if (
              !areDashboardSessionCookiesSynchronized(
                destinationCookies as Record<string, unknown>,
                sessionCookies,
              )
            ) {
              synchronized = false;
            }
          },
          isCurrent,
        );
        if (!isCurrent()) synchronized = false;
      } catch {
        synchronized = false;
      }
      return synchronized;
    },
    [getCookieManager],
  );

  const hasSessionCookie = useCallback(async (): Promise<boolean> => {
    try {
      const CookieManager = await getCookieManager();
      const cookies = await CookieManager.get(API_ORIGIN);
      for (const cookieName of DASHBOARD_SESSION_COOKIE_NAMES) {
        const sessionCookie = cookies?.[cookieName];
        if (!sessionCookie) continue;
        if (typeof sessionCookie === 'string') return Boolean(sessionCookie);
        if (
          typeof sessionCookie === 'object' &&
          'value' in sessionCookie &&
          typeof sessionCookie.value === 'string'
        ) {
          return Boolean(sessionCookie.value);
        }
      }
      return false;
    } catch {
      return false;
    }
  }, [getCookieManager]);

  const waitForSessionCookie = useCallback(
    async (timeoutMs = 4000): Promise<boolean> => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        if (await hasSessionCookie()) return true;
        await sleep(250);
      }
      return false;
    },
    [hasSessionCookie],
  );

  const resolveUserId = useCallback(async (): Promise<string | null> => {
    if (user?.user_id) return user.user_id;
    const storedUserId = await AsyncStorage.getItem(USER_ID_KEY);
    return storedUserId || null;
  }, [user?.user_id]);

  const setWebViewUserId = useCallback(
    (userId?: string | null): void => {
      if (!userId || !webRef.current) return;
      const script = ` 
        (function() { 
          try { 
            localStorage.setItem('user_id', ${JSON.stringify(userId)}); 
          } catch (e) {} 
        })(); 
        true; 
      `;
      try {
        webRef.current.injectJavaScript(script);
      } catch {
        // ignore injection failures
      }
    },
    [webRef],
  );

  const sendNativeReady = useCallback(() => {
    post('NATIVE_READY', {
      platform: Platform.OS,
      version: 'lotus-engine-v2',
    });
  }, [post]);

  const sendGoogleSignInResult = useCallback(
    (payload: {
      success: boolean;
      userId?: string;
      hasRefreshToken?: boolean;
      error?: string;
      errorMessage?: string;
    }) => {
      post('GOOGLE_SIGN_IN_RESULT', payload);
    },
    [post],
  );

  const bootstrapExistingNativeSession = useCallback(
    async (navigationGeneration: number): Promise<boolean> => {
      const authGeneration = getAuthSessionGeneration();
      const hasSessionCookie = await waitForSessionCookie(1500);
      if (!hasSessionCookie || !(await syncAuthCookiesToDashboardOrigin(true))) return false;
      const userId = await resolveUserId();
      if (
        !userId ||
        !isAuthSessionCurrent(authGeneration) ||
        !isCurrentTrustedNavigation(navigationGeneration)
      ) {
        return false;
      }

      setWebViewUserId(userId);
      if (
        !isAuthSessionCurrent(authGeneration) ||
        !isCurrentTrustedNavigation(navigationGeneration)
      ) {
        return false;
      }
      sendGoogleSignInResult({
        success: true,
        userId,
        hasRefreshToken: true,
      });
      return true;
    },
    [
      isCurrentTrustedNavigation,
      resolveUserId,
      sendGoogleSignInResult,
      setWebViewUserId,
      syncAuthCookiesToDashboardOrigin,
      waitForSessionCookie,
    ],
  );

  const handleBridgeGoogleSignIn = useCallback(
    async (navigationGeneration: number) => {
      if (isHandlingBridgeSignIn) return;
      let authGeneration = getAuthSessionGeneration();
      setIsHandlingBridgeSignIn(true);
      try {
        await signIn();
        authGeneration = getAuthSessionGeneration();
        const hasSessionCookie = await waitForSessionCookie(5000);
        if (!hasSessionCookie || !(await syncAuthCookiesToDashboardOrigin(true))) {
          throw new Error('Unable to synchronize secure session cookies.');
        }
        const userId = await resolveUserId();
        if (!userId) {
          throw new Error('Native sign-in succeeded but no session cookie was found.');
        }
        if (
          !isAuthSessionCurrent(authGeneration) ||
          !isCurrentTrustedNavigation(navigationGeneration)
        ) {
          return;
        }
        setWebViewUserId(userId);
        if (
          !isAuthSessionCurrent(authGeneration) ||
          !isCurrentTrustedNavigation(navigationGeneration)
        ) {
          return;
        }
        sendGoogleSignInResult({
          success: true,
          userId,
          hasRefreshToken: true,
        });
      } catch (error) {
        if (
          !isAuthSessionCurrent(authGeneration) ||
          !isCurrentTrustedNavigation(navigationGeneration)
        ) {
          return;
        }
        sendGoogleSignInResult({
          success: false,
          error: 'SIGN_IN_FAILED',
          errorMessage: error instanceof Error ? error.message : 'Unable to complete sign-in.',
        });
      } finally {
        setIsHandlingBridgeSignIn(false);
      }
    },
    [
      isHandlingBridgeSignIn,
      isCurrentTrustedNavigation,
      resolveUserId,
      sendGoogleSignInResult,
      setWebViewUserId,
      signIn,
      syncAuthCookiesToDashboardOrigin,
      waitForSessionCookie,
    ],
  );

  const handleWebMessage = useCallback(
    async (event: WebViewMessageEvent) => {
      const messageUrl = event.nativeEvent.url;
      // Android may report only the document origin for bridge messages. Use
      // the native navigation callback for the selected-path check instead of
      // requiring the bridge URL to contain a path.
      if (!isTrustedDashboardMessageOrigin(messageUrl)) return;

      if (
        !trustedNavigationRef.current.url &&
        isAllowedDashboardRoute(messageUrl, DASHBOARD_ORIGIN, state.navigationTarget)
      ) {
        trustedNavigationRef.current = {
          url: messageUrl,
          generation: trustedNavigationRef.current.generation + 1,
        };
      }
      const navigationGeneration = trustedNavigationRef.current.generation;
      if (!isCurrentTrustedNavigation(navigationGeneration)) return;
      const envelope = parseBridgeEnvelope(event.nativeEvent.data);
      if (!envelope) return;

      switch (envelope.type as WebOutboundMessageType) {
        case 'WEB_APP_READY': {
          setReady(true);
          sendNativeReady();
          await bootstrapExistingNativeSession(navigationGeneration);
          break;
        }
        case 'REQUEST_GOOGLE_SIGN_IN': {
          await handleBridgeGoogleSignIn(navigationGeneration);
          break;
        }
        case 'WEB_SIGN_OUT': {
          await signOut();
          break;
        }
        case 'AUTH_STATE_SYNC': {
          break;
        }
        case 'REQUEST_NATIVE_SHELL': {
          exitToNativeShell();
          break;
        }
        case 'START_NOTE_TAKER': {
          router.push('/(protected)/(shortcuts)/recordings' as never);
          break;
        }
        default:
          break;
      }
    },
    [
      bootstrapExistingNativeSession,
      exitToNativeShell,
      handleBridgeGoogleSignIn,
      isCurrentTrustedNavigation,
      isTrustedDashboardMessageOrigin,
      state.navigationTarget,
      router,
      sendNativeReady,
      setReady,
      signOut,
    ],
  );

  /**
   * A trusted canvas link (including a public share link on another trusted origin) stays inside
   * the WebView: native re-targets the focused route to the normalized canvas path instead of
   * handing the link to the OS browser, which has no mTLS client certificate.
   */
  const resolveCanvasNavigation = useCallback(
    (url: string): string | null =>
      resolveTrustedCanvasWebViewPath(
        url,
        DASHBOARD_ORIGIN,
        TRUSTED_ORIGINS,
        state.navigationTarget,
      ),
    [state.navigationTarget],
  );

  const handleDashboardNavigationRequest = useCallback(
    ({ url, isTopFrame }: { url: string; isTopFrame: boolean }): boolean => {
      if (!isTopFrame) return true;
      if (isAllowedDashboardNavigation(url, DASHBOARD_ORIGIN, isTopFrame, state.navigationTarget)) {
        return true;
      }
      const canvasPath = resolveCanvasNavigation(url);
      if (canvasPath) {
        navigate(canvasPath);
        return false;
      }
      if (isSafeExternalWebViewUrl(url)) {
        void Linking.openURL(url).catch(() => undefined);
      }
      return false;
    },
    [navigate, resolveCanvasNavigation, state.navigationTarget],
  );

  const handleDashboardOpenWindow = useCallback(
    ({ nativeEvent }: { nativeEvent: { targetUrl: string } }): void => {
      const targetUrl = nativeEvent.targetUrl;
      if (isAllowedDashboardRoute(targetUrl, DASHBOARD_ORIGIN, state.navigationTarget)) {
        webRef.current?.injectJavaScript(
          `window.location.href = ${JSON.stringify(targetUrl)}; true;`,
        );
        return;
      }

      const canvasPath = resolveCanvasNavigation(targetUrl);
      if (canvasPath) {
        navigate(canvasPath);
        return;
      }

      if (isSafeExternalWebViewUrl(targetUrl)) {
        void Linking.openURL(targetUrl).catch(() => undefined);
      }
    },
    [navigate, resolveCanvasNavigation, state.navigationTarget, webRef],
  );

  // mTLS + cookie sync on mount
  useEffect(() => {
    if (!state.isBooted) {
      return;
    }

    let mounted = true;
    void (async () => {
      try {
        if (isMtlsFeatureEnabled()) {
          await ensureMtlsForWebView();
        }
        const cookiesSynced = await syncAuthCookiesToDashboardOrigin();
        if (mounted && cookiesSynced) {
          setMtlsReady(true);
        } else if (mounted) {
          setLoadError('Unable to initialize secure connection. Please try again.');
        }
      } catch {
        if (mounted) setLoadError('Unable to initialize secure connection. Please try again.');
      }
    })();
    return () => {
      mounted = false;
    };
  }, [state.isBooted, syncAuthCookiesToDashboardOrigin]);

  const source = useMemo(() => {
    const path = state.navigationTarget ?? '/';
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return { uri: `${DASHBOARD_ORIGIN}${normalizedPath}` };
  }, [state.navigationTarget]);
  const focusedRouteLockScript = useMemo(
    () => createFocusedRouteLockScript(state.navigationTarget),
    [state.navigationTarget],
  );
  const visible = state.presentation !== 'hidden';

  if (!state.isBooted) {
    return null;
  }

  if (loadError) {
    return (
      <View
        pointerEvents={visible ? 'auto' : 'none'}
        style={[
          StyleSheet.absoluteFill,
          styles.center,
          {
            backgroundColor,
            opacity: visible ? 1 : 0,
          },
        ]}
        collapsable={false}
      >
        <Text style={[styles.errorTitle, { color: foregroundColor }]}>Couldn&apos;t load</Text>
        <Text style={[styles.errorMessage, { color: mutedColor }]}>{loadError}</Text>
        <TouchableOpacity
          style={[styles.retryButton, { backgroundColor: destructiveColor }]}
          onPress={() => {
            setLoadError(null);
            setMtlsReady(false);
            setHasInitialPageLoaded(false);
            setReady(false);
            void (async () => {
              try {
                if (isMtlsFeatureEnabled()) {
                  await ensureMtlsForWebView();
                }
                const cookiesSynced = await syncAuthCookiesToDashboardOrigin();
                if (!cookiesSynced) {
                  throw new Error('Unable to synchronize secure session cookies.');
                }
                setMtlsReady(true);
              } catch {
                setLoadError('Unable to initialize secure connection.');
              }
            })();
          }}
          activeOpacity={0.7}
        >
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const bottomOffset = state.presentation === 'fullscreen' ? 0 : state.overlayBottomInset;
  const shouldShowNativeBackButton = visible && state.presentation === 'overlay';

  return (
    <View
      pointerEvents={visible ? 'auto' : 'none'}
      style={{
        position: 'absolute',
        top: insets.top,
        left: 0,
        right: 0,
        bottom: bottomOffset,
        opacity: visible ? 1 : 0,
        zIndex: visible ? 50 : 0,
        paddingBottom: state.presentation === 'fullscreen' ? insets.bottom : 0,
        backgroundColor,
      }}
      collapsable={false}
    >
      {mtlsReady && (
        <WebView
          ref={webRef}
          source={source}
          style={styles.webView}
          cacheEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          domStorageEnabled
          javaScriptEnabled
          onMessage={handleWebMessage}
          onNavigationStateChange={handleNavigationStateChange}
          onShouldStartLoadWithRequest={handleDashboardNavigationRequest}
          onOpenWindow={handleDashboardOpenWindow}
          onLoadStart={() => {
            markNavigationStart();
            setHasInitialPageLoaded(false);
            setReady(false);
          }}
          onLoadProgress={({ nativeEvent }) => {
            if (nativeEvent.progress >= 0.15) {
              setHasInitialPageLoaded(true);
            }
          }}
          onLoadEnd={() => {
            setHasInitialPageLoaded(true);
            setReady(true);
          }}
          injectedJavaScriptBeforeContentLoaded={`${bootstrapScript}\n${focusedRouteLockScript}`}
          // Keep the transport whitelist broad so the callback runs before
          // react-native-webview can hand an untrusted URL to the OS. The
          // callback applies the exact parsed-origin policy and explicitly
          // hands safe HTTP(S) links off to the OS.
          originWhitelist={['*']}
          allowsInlineMediaPlayback
          // Auto-grant only to the exact top-level dashboard origin; deny
          // capture requests from cross-origin frames without prompting.
          mediaCapturePermissionGrantType='grantIfSameHostElseDeny'
          applicationNameForUserAgent='lotusWebEngine'
          onError={e => {
            setHasInitialPageLoaded(true);
            setLoadError(e.nativeEvent?.description || 'Failed to load');
          }}
          onHttpError={e => {
            setHasInitialPageLoaded(true);
            const { statusCode } = e.nativeEvent;
            if (statusCode >= 400) {
              setLoadError(`Server error (${statusCode}). Please try again.`);
            }
          }}
        />
      )}
      {shouldShowNativeBackButton && (
        <View
          pointerEvents='box-none'
          style={[
            styles.topControls,
            {
              top: insets.top + 8,
            },
          ]}
        >
          <HeaderBackButton liquidGlass onPress={exitToNativeShell} iconColor='#F9FAFB' />
        </View>
      )}
      {(!mtlsReady || !hasInitialPageLoaded) && (
        <DashboardWebViewLoader absolute label='Loading workspace' />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  webView: {
    flex: 1,
    ...Platform.select({ android: { overScrollMode: 'never' as const } }),
  },
  topControls: {
    left: 16,
    position: 'absolute',
    zIndex: 60,
  },
  nativeBackButton: {
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
    minWidth: 72,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  nativeBackButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  errorTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  errorMessage: { fontSize: 14, textAlign: 'center', marginBottom: 16 },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  retryButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
