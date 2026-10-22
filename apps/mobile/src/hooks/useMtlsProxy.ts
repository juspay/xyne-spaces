/**
 * useMtlsProxy Hook for Lotus
 *
 * Manages the local mTLS HTTP proxy and provides proxied URLs for accessing
 * mTLS-protected resources via plain HTTP localhost.
 */

import { useCallback, useEffect, useState } from 'react';
import { AppState, NativeModules, Platform } from 'react-native';

import { API_BASE_URL } from '@/src/config';
import {
  bumpProxyEpoch,
  nextForegroundProbeState,
  verifyOrRestartProxy,
  type ProxyRecoveryOutcome,
} from '@/src/hooks/mtlsProxyRecovery';
import { logger, type EventType } from '@/src/utils/logger';
import {
  getAuthSessionGeneration,
  isAuthSessionCurrent,
} from '@/src/services/authSessionLifecycle';

const { MtlsProxy } = NativeModules;

console.log(
  '[useMtlsProxy] NativeModules:',
  Object.keys(NativeModules).filter(
    k => k.toLowerCase().includes('proxy') || k.toLowerCase().includes('mtls'),
  ),
);
console.log('[useMtlsProxy] MtlsProxy module:', MtlsProxy);
console.log('[useMtlsProxy] MtlsProxy methods:', MtlsProxy ? Object.keys(MtlsProxy) : 'undefined');

const DEFAULT_PROXY_PORT = 18080;
const REQUIRED_PROXY_SECURITY_VERSION = 2;
const PROXY_OPERATION_TIMEOUT_MS = 5000;
let proxySecurityCapability: Promise<void> | null = null;

function withProxyTimeout<T>(promise: Promise<T>, operation: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`${operation} timed out after ${PROXY_OPERATION_TIMEOUT_MS}ms`));
    }, PROXY_OPERATION_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  });
}

async function requireSecureProxyModule(): Promise<void> {
  if (proxySecurityCapability) return proxySecurityCapability;

  proxySecurityCapability = withProxyTimeout(
    (async (): Promise<void> => {
      if (!MtlsProxy || typeof MtlsProxy.getProxySecurityVersion !== 'function') {
        throw new Error('Secure mTLS proxy is unavailable in this native build');
      }
      const version = await MtlsProxy.getProxySecurityVersion();
      if (Number(version) < REQUIRED_PROXY_SECURITY_VERSION) {
        throw new Error('Secure mTLS proxy is unavailable in this native build');
      }
    })(),
    'Checking proxy security',
  ).catch(error => {
    proxySecurityCapability = null;
    throw error;
  });

  return proxySecurityCapability;
}

interface UseMtlsProxyResult {
  /** The port the proxy is running on (0 if not running) */
  port: number;
  /** Whether the proxy is currently running */
  isRunning: boolean;
  /** Whether the proxy is currently starting/stopping */
  isLoading: boolean;
  /** Any error that occurred */
  error: Error | null;
  /** Start the proxy server */
  start: () => Promise<void>;
  /** Stop the proxy server */
  stop: () => Promise<void>;
  /**
   * Convert a backend URL to a proxied localhost URL
   * Returns null if proxy is not running
   */
  getProxiedUrl: (backendUrl: string) => Promise<string | null>;
}

export function useMtlsProxy(): UseMtlsProxyResult {
  const [port, setPort] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Check initial state on mount
  useEffect(() => {
    checkStatus();
  }, []);

  const checkStatus = useCallback(async () => {
    try {
      const currentPort = await MtlsProxy?.getPort();
      setPort(currentPort || 0);
      setIsRunning(!!currentPort && currentPort > 0);
    } catch {
      // Proxy module may not be available
      setPort(0);
      setIsRunning(false);
    }
  }, []);

  const start = useCallback(async () => {
    if (isRunning) return;

    setIsLoading(true);
    setError(null);

    try {
      await requireSecureProxyModule();
      // Check if MtlsProxy module exists
      if (!MtlsProxy) {
        throw new Error('MtlsProxy native module not available');
      }

      const actualPort = await MtlsProxy.start(DEFAULT_PROXY_PORT, API_BASE_URL);
      setPort(actualPort);
      setIsRunning(true);
      console.log(`[useMtlsProxy] Proxy started on port ${actualPort}`);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error('[useMtlsProxy] Failed to start proxy:', error);
      setError(error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [isRunning]);

  const stop = useCallback(async () => {
    if (!isRunning) return;

    setIsLoading(true);
    setError(null);

    try {
      await MtlsProxy?.stop();
      setPort(0);
      setIsRunning(false);
      console.log('[useMtlsProxy] Proxy stopped');
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error('[useMtlsProxy] Failed to stop proxy:', error);
      setError(error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [isRunning]);

  const getProxiedUrl = useCallback(
    async (backendUrl: string): Promise<string | null> => {
      if (!isRunning || !MtlsProxy) {
        return null;
      }

      try {
        await requireSecureProxyModule();
        return await MtlsProxy.getProxiedUrl(backendUrl);
      } catch (err) {
        console.error('[useMtlsProxy] Failed to get proxied URL:', err);
        return null;
      }
    },
    [isRunning],
  );

  return {
    port,
    isRunning,
    isLoading,
    error,
    start,
    stop,
    getProxiedUrl,
  };
}

/**
 * Set the authorization token for the proxy server.
 * The proxy will inject this token into proxied requests.
 * The native proxy keeps the token in memory for the current app session.
 */
export async function setProxyAuthToken(token: string | null): Promise<void> {
  if (!MtlsProxy) {
    console.warn('[setProxyAuthToken] MtlsProxy module not available');
    return;
  }
  if (typeof MtlsProxy.setAuthToken !== 'function') {
    console.debug('[setProxyAuthToken] setAuthToken is unavailable in this native build');
    if (token) {
      throw new Error('Secure proxy authentication is unavailable in this native build');
    }
    return;
  }
  try {
    await MtlsProxy.setAuthToken(token);
    console.log(`[setProxyAuthToken] Token ${token ? 'set' : 'cleared'}`);
  } catch (err) {
    console.error('[setProxyAuthToken] Failed to set auth token:', err);
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/**
 * Singleton proxy manager for app-wide proxy lifecycle
 * Ensures proxy is started once and reused across components
 */
let proxyLifecycleTail: Promise<void> = Promise.resolve();

function enqueueProxyLifecycle<T>(operation: () => Promise<T>): Promise<T> {
  const run = proxyLifecycleTail.then(operation, operation);
  proxyLifecycleTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Stop the shared proxy and remove any auth token retained by its native side. */
export async function stopProxyAndClearAuth(): Promise<void> {
  return enqueueProxyLifecycle(async () => {
    if (!MtlsProxy) return;

    let cleanupError: unknown;
    try {
      await withProxyTimeout(setProxyAuthToken(null), 'Clearing proxy auth');
    } catch (error) {
      cleanupError = error;
    }

    try {
      // Always stop natively. A listener can still be in NWListener.waiting
      // after a timed-out start and therefore report port 0; skipping stop in
      // that state would allow it to become ready after logout.
      await withProxyTimeout(Promise.resolve(MtlsProxy.stop()), 'Stopping proxy');
    } catch (error) {
      cleanupError ??= error;
    }

    if (cleanupError) {
      throw cleanupError;
    }
  });
}

export async function ensureProxyRunning(
  authToken?: string,
  expectedGeneration = getAuthSessionGeneration(),
): Promise<number> {
  return enqueueProxyLifecycle(async () => {
    const assertCurrentSession = (): void => {
      if (!isAuthSessionCurrent(expectedGeneration)) {
        throw new Error('Auth session changed while starting mTLS proxy');
      }
    };

    assertCurrentSession();
    await requireSecureProxyModule();
    assertCurrentSession();
    if (!MtlsProxy) {
      const availableModules = Object.keys(NativeModules).sort().join(', ');
      throw new Error(
        `MtlsProxy native module not available. ` + `Available modules: ${availableModules}. `,
      );
    }

    // Set auth token only for the session that requested this proxy.
    if (authToken !== undefined) {
      await withProxyTimeout(setProxyAuthToken(authToken), 'Setting proxy auth');
      assertCurrentSession();
    }

    const currentPort = (await withProxyTimeout(
      Promise.resolve(MtlsProxy.getPort()),
      'Reading proxy status',
    )) as number;
    assertCurrentSession();
    let restartFailed = false;
    if (currentPort > 0) {
      if (Platform.OS !== 'ios') {
        return currentPort;
      }
      // iOS may have reclaimed the listener while the app was suspended
      // without telling it, so a reported port does not prove it is alive.
      installForegroundProxyProbe();
      const outcome = await verifyOrRestartProxy(MtlsProxy, API_BASE_URL, withProxyTimeout);
      reportProxyRecovery('stream_open', outcome);
      assertCurrentSession();
      if (outcome.action === 'restarted') {
        bumpProxyEpoch();
        return outcome.port;
      }
      if (outcome.action !== 'restart_failed') {
        return outcome.port;
      }
      // Restart failed: the old listener is already cancelled, so fall
      // through to the regular start path below.
      restartFailed = true;
    }

    let port: number;
    try {
      // After a failed restart, retry on an ephemeral port like `restart`
      // does: the reclaimed socket may still hold the default port, and a
      // fixed-port bind can sit in `.waiting` until the timeout.
      port = (await withProxyTimeout(
        MtlsProxy.start(restartFailed ? 0 : DEFAULT_PROXY_PORT, API_BASE_URL) as Promise<number>,
        'Starting proxy',
      )) as number;
    } catch (err) {
      console.error('[ensureProxyRunning] Failed to start proxy:', err);
      throw err;
    }
    console.log(`[ensureProxyRunning] Proxy started on port ${port}`);
    assertCurrentSession();
    if (Platform.OS === 'ios') {
      installForegroundProxyProbe();
    }
    if (restartFailed) {
      // The capability rotated, so URLs issued for the old listener are dead.
      bumpProxyEpoch();
    }
    return port;
  });
}

const MTLS_PROXY_RECOVERY_EVENT = 'lotus_ios_mtls_proxy' as EventType;

type ProxyRecoveryReason = 'stream_open' | 'foreground';

function reportProxyRecovery(reason: ProxyRecoveryReason, outcome: ProxyRecoveryOutcome): void {
  // Healthy / not-running checks happen on every video open; only the
  // actionable outcomes are worth a log line.
  if (outcome.action !== 'restarted' && outcome.action !== 'restart_failed') {
    return;
  }
  const payload = {
    diagnostic: 'ios_mtls_proxy',
    phase: outcome.action,
    reason,
    previousPort: outcome.previousPort,
    port: outcome.port,
    ...(outcome.error !== undefined
      ? {
          errorMessage:
            outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
        }
      : {}),
  };
  try {
    if (outcome.action === 'restarted') {
      logger.warn(MTLS_PROXY_RECOVERY_EVENT, payload);
    } else {
      logger.error(MTLS_PROXY_RECOVERY_EVENT, payload);
    }
  } catch {
    // Telemetry must never affect proxy recovery.
  }
}

let foregroundProbeInstalled = false;
let wasBackgroundedSinceActive = false;

/**
 * On iOS, re-check the proxy whenever the app returns from the background so
 * a video screen left open across a suspension gets a working URL again.
 * Installed lazily on first proxy use; does nothing when the proxy is not
 * running (e.g. after logout, which stops it through the same queue).
 */
function installForegroundProxyProbe(): void {
  if (foregroundProbeInstalled || Platform.OS !== 'ios') return;
  foregroundProbeInstalled = true;
  wasBackgroundedSinceActive = AppState.currentState === 'background';
  AppState.addEventListener('change', nextState => {
    const next = nextForegroundProbeState(wasBackgroundedSinceActive, nextState);
    wasBackgroundedSinceActive = next.wasBackgrounded;
    if (!next.probe || !MtlsProxy) return;
    void enqueueProxyLifecycle(async () => {
      const outcome = await verifyOrRestartProxy(MtlsProxy, API_BASE_URL, withProxyTimeout);
      reportProxyRecovery('foreground', outcome);
      if (outcome.action === 'restarted' || outcome.action === 'restart_failed') {
        // Either way, URLs issued for the old listener are dead.
        bumpProxyEpoch();
      }
    }).catch(error => {
      console.warn('[useMtlsProxy] Foreground proxy check failed:', error);
    });
  });
}

/**
 * Ask native code to build a capability-bearing proxy URL. The capability is
 * deliberately never generated or accepted in JavaScript so arbitrary local
 * callers cannot invoke the native proxy without the current app session.
 */
export async function getProxiedUrl(
  backendUrl: string,
  expectedGeneration = getAuthSessionGeneration(),
): Promise<string | null> {
  try {
    if (!isAuthSessionCurrent(expectedGeneration)) return null;
    await requireSecureProxyModule();
    if (!isAuthSessionCurrent(expectedGeneration)) return null;
    const proxiedUrl = await MtlsProxy.getProxiedUrl(backendUrl);
    return isAuthSessionCurrent(expectedGeneration) ? proxiedUrl : null;
  } catch (error) {
    console.error('[getProxiedUrl] Failed to create proxied URL:', error);
    return null;
  }
}
