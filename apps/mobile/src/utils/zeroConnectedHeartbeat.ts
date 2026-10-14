import type { Zero } from '@rocicorp/zero';
import { AppState, type NativeEventSubscription } from 'react-native';

import { lotusStorage, withMmkvCaller } from '@/src/services/localStorage';

/**
 * Shared-MMKV heartbeat: while Zero is `connected` and the app is `active`,
 * stamps `@lotus_zero_connected_at` every {@link HEARTBEAT_INTERVAL_MS}.
 * JS warm reads this handoff key to skip redundant HTTP when live
 * sync is already running. Do not stamp in background — that is a periodic
 * App Group write while iOS may suspend (0xdead10cc).
 */
export const ZERO_CONNECTED_AT_KEY = '@lotus_zero_connected_at';

const HEARTBEAT_INTERVAL_MS = 10_000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let appStateSubscription: NativeEventSubscription | null = null;
let zeroConnected = false;

function stampNow(): void {
  if (AppState.currentState !== 'active') return;
  withMmkvCaller('heartbeat', () => {
    lotusStorage.set(ZERO_CONNECTED_AT_KEY, String(Date.now()));
  });
}

function startInterval(): void {
  if (intervalHandle) return;
  stampNow();
  intervalHandle = setInterval(stampNow, HEARTBEAT_INTERVAL_MS);
}

function stopInterval(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

function syncHeartbeat(): void {
  if (zeroConnected && AppState.currentState === 'active') {
    startInterval();
    return;
  }
  stopInterval();
}

export function subscribeZeroConnectedHeartbeat(zero: Zero): () => void {
  const handleName = (name: string): void => {
    zeroConnected = name === 'connected';
    syncHeartbeat();
  };
  handleName(zero.connection.state.current.name);
  const unsubscribe = zero.connection.state.subscribe(state => handleName(state.name));
  appStateSubscription?.remove();
  appStateSubscription = AppState.addEventListener('change', () => {
    syncHeartbeat();
  });
  return () => {
    unsubscribe();
    appStateSubscription?.remove();
    appStateSubscription = null;
    zeroConnected = false;
    stopInterval();
  };
}
