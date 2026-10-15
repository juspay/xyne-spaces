import { AppState, type AppStateStatus } from 'react-native';

export type ActivitySyncReason =
  | 'push_received'
  | 'push_opened'
  | 'app_foreground'
  | 'screen_focus'
  | 'live_query_reconnected'
  | 'manual_refresh';

export type ActivitySyncUrgency = 'immediate' | 'deferred' | 'passive';

export type ActivitySyncState = {
  urgency: ActivitySyncUrgency;
  lastReason: ActivitySyncReason | null;
  lastTriggeredAt: number;
  refreshNonce: number;
};

const COALESCE_WINDOW_MS = 1_500;

const listeners = new Set<() => void>();

const state: ActivitySyncState = {
  urgency: 'deferred',
  lastReason: null,
  lastTriggeredAt: 0,
  refreshNonce: 0,
};

let lastAppState: AppStateStatus = AppState.currentState;
let hasInstalledAppStateListener = false;

const urgencyByReason: Record<ActivitySyncReason, ActivitySyncUrgency> = {
  push_received: 'immediate',
  push_opened: 'immediate',
  app_foreground: 'deferred',
  screen_focus: 'deferred',
  live_query_reconnected: 'passive',
  manual_refresh: 'immediate',
};

const urgencyRank: Record<ActivitySyncUrgency, number> = {
  passive: 0,
  deferred: 1,
  immediate: 2,
};

const emit = (): void => {
  listeners.forEach(listener => listener());
};

export const getActivitySyncState = (): ActivitySyncState => ({ ...state });

export const subscribeToActivitySync = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
};

export const ensureActivitySyncAppStateListener = (): void => {
  if (hasInstalledAppStateListener) {
    return;
  }

  hasInstalledAppStateListener = true;
  AppState.addEventListener('change', nextState => {
    const wasBackgrounded = lastAppState !== 'active';
    lastAppState = nextState;
    if (nextState === 'active' && wasBackgrounded) {
      triggerActivitySync('app_foreground');
    }
  });
};

export const triggerActivitySync = (reason: ActivitySyncReason): void => {
  const now = Date.now();
  const withinWindow = now - state.lastTriggeredAt < COALESCE_WINDOW_MS;
  const nextUrgency = urgencyByReason[reason];

  if (withinWindow) {
    if (urgencyRank[nextUrgency] <= urgencyRank[state.urgency]) {
      state.lastReason = reason;
      state.lastTriggeredAt = now;
      return;
    }

    state.lastReason = reason;
    state.lastTriggeredAt = now;
    state.urgency = nextUrgency;
    state.refreshNonce += 1;
    emit();
    return;
  }

  state.lastReason = reason;
  state.lastTriggeredAt = now;
  state.urgency = nextUrgency;
  state.refreshNonce += 1;
  emit();
};
