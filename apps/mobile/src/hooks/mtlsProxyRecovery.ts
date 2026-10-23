/**
 * Stale mTLS proxy recovery (iOS).
 *
 * iOS can reclaim the app's loopback listening socket while the app is
 * suspended without notifying the NWListener. The native proxy then keeps
 * reporting a port while nothing accepts connections, and every video opened
 * afterwards fails with "Could not connect to the server" until the app is
 * restarted.
 *
 * This module holds the pure decision logic (no React Native imports, so it is
 * unit-testable under node) and a tiny "proxy epoch" store. The epoch is bumped
 * whenever the listener is replaced; the capability rotates on restart, so
 * every proxied URL handed out before the bump is dead and must be re-issued.
 */

export type MtlsProxyHealthNative = {
  getPort: () => unknown;
  checkHealth?: () => unknown;
  restart?: (apiBaseUrl: string) => unknown;
};

export type ProxyRecoveryAction =
  'not_running' | 'unsupported' | 'healthy' | 'restarted' | 'restart_failed';

export type ProxyRecoveryOutcome = Readonly<{
  action: ProxyRecoveryAction;
  /** Port the proxy is listening on after this check (0 if none). */
  port: number;
  /** Port reported before the check. */
  previousPort: number;
  error?: unknown;
}>;

export type ProxyTimeout = <T>(promise: Promise<T>, operation: string) => Promise<T>;

const passthroughTimeout: ProxyTimeout = promise => promise;

function toPort(value: unknown): number {
  const port = Number(value);
  return Number.isFinite(port) && port > 0 ? port : 0;
}

/**
 * Verify the running proxy answers on loopback; replace it if it does not.
 *
 * - Never starts a proxy that was not running (`not_running`).
 * - Keeps today's behaviour on native builds without the probe (`unsupported`).
 * - A probe that throws or times out counts as unhealthy.
 */
export async function verifyOrRestartProxy(
  native: MtlsProxyHealthNative,
  apiBaseUrl: string,
  withTimeout: ProxyTimeout = passthroughTimeout,
): Promise<ProxyRecoveryOutcome> {
  const previousPort = toPort(
    await withTimeout(Promise.resolve(native.getPort()), 'Reading proxy status'),
  );
  if (previousPort === 0) {
    return { action: 'not_running', port: 0, previousPort };
  }

  const { checkHealth, restart } = native;
  if (typeof checkHealth !== 'function' || typeof restart !== 'function') {
    return { action: 'unsupported', port: previousPort, previousPort };
  }

  let healthy = false;
  try {
    healthy =
      (await withTimeout(Promise.resolve(checkHealth.call(native)), 'Checking proxy health')) ===
      true;
  } catch {
    healthy = false;
  }
  if (healthy) {
    return { action: 'healthy', port: previousPort, previousPort };
  }

  try {
    const port = toPort(
      await withTimeout(Promise.resolve(restart.call(native, apiBaseUrl)), 'Restarting proxy'),
    );
    if (port === 0) {
      return {
        action: 'restart_failed',
        port: 0,
        previousPort,
        error: new Error('Proxy restart returned no port'),
      };
    }
    return { action: 'restarted', port, previousPort };
  } catch (error) {
    return { action: 'restart_failed', port: 0, previousPort, error };
  }
}

/**
 * Tracks whether the app has been in the background since it was last
 * active. iOS can go `background -> inactive -> active`, so `inactive` must
 * not reset the flag. Only a return from a real suspension can lose the
 * listener; `active -> inactive -> active` (control centre, notification
 * shade, permission prompts) must not trigger a probe.
 */
export function nextForegroundProbeState(
  wasBackgrounded: boolean,
  nextState: string,
): Readonly<{ probe: boolean; wasBackgrounded: boolean }> {
  if (nextState === 'background') {
    return { probe: false, wasBackgrounded: true };
  }
  if (nextState === 'active') {
    return { probe: wasBackgrounded, wasBackgrounded: false };
  }
  return { probe: false, wasBackgrounded };
}

// ---------------------------------------------------------------------------
// Proxy epoch: incremented every time proxied URLs are invalidated.
// ---------------------------------------------------------------------------

let proxyEpoch = 0;
const epochListeners = new Set<() => void>();

export function getProxyEpoch(): number {
  return proxyEpoch;
}

export function subscribeProxyEpoch(listener: () => void): () => void {
  epochListeners.add(listener);
  return (): void => {
    epochListeners.delete(listener);
  };
}

export function bumpProxyEpoch(): number {
  proxyEpoch += 1;
  for (const listener of Array.from(epochListeners)) {
    try {
      listener();
    } catch {
      // A subscriber must never break proxy recovery.
    }
  }
  return proxyEpoch;
}
