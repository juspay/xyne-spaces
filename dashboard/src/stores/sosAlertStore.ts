/**
 * SOS Alert Store - Holds unacknowledged SOS alerts
 * Unlike regular notifications (transient toast), SOS alerts persist as a
 * full-width banner with a siren sound until the user explicitly clicks
 * Acknowledge. Alerts are mirrored to localStorage (keyed per user) so a
 * page refresh cannot dismiss them.
 */

import { createStore } from '@xstate/store';
import { useSyncExternalStore } from 'react';

export interface SosAlert {
  /** Notification id from the backend */
  id: string;
  title: string;
  message: string;
  actionUrl?: string;
  /** Present on cross-workspace broadcasts */
  workspaceId?: string;
  workspaceName?: string;
  receivedAt: number;
}

export interface SosAlertState {
  alerts: SosAlert[];
  /** Set once hydrated from localStorage for the logged-in user */
  userId: string | null;
}

const STORAGE_PREFIX = 'xyne-sos-alerts';

const storageKey = (userId: string): string => `${STORAGE_PREFIX}:${userId}`;

const readFromStorage = (userId: string): SosAlert[] => {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (a): a is SosAlert =>
        typeof a === 'object' && a !== null && typeof (a as SosAlert).id === 'string',
    );
  } catch {
    return [];
  }
};

const writeToStorage = (userId: string | null, alerts: SosAlert[]): void => {
  if (!userId) return;
  try {
    if (alerts.length === 0) {
      localStorage.removeItem(storageKey(userId));
    } else {
      localStorage.setItem(storageKey(userId), JSON.stringify(alerts));
    }
  } catch {
    // localStorage full/unavailable — banner still works for this session.
  }
};

const initialContext: SosAlertState = {
  alerts: [],
  userId: null,
};

export const sosAlertStore = createStore({
  context: initialContext,
  on: {
    /** Load persisted alerts for the logged-in user (call once on mount). */
    hydrate: (context, event: { userId: string }): SosAlertState => {
      if (context.userId === event.userId) return context;
      const persisted = readFromStorage(event.userId);
      // Only merge in-memory alerts that arrived before auth resolved (userId
      // was null). Never carry over alerts from a previous user's session.
      const preAuthAlerts =
        context.userId === null
          ? context.alerts.filter(a => !persisted.some(p => p.id === a.id))
          : [];
      const merged = [...persisted, ...preAuthAlerts];
      writeToStorage(event.userId, merged);
      return { userId: event.userId, alerts: merged };
    },
    addAlert: (context, event: { alert: SosAlert }): SosAlertState => {
      // Dedupe on notification id (reconnects can re-deliver).
      if (context.alerts.some(a => a.id === event.alert.id)) return context;
      const alerts = [...context.alerts, event.alert];
      writeToStorage(context.userId, alerts);
      return { ...context, alerts };
    },
    acknowledgeAlert: (context, event: { id: string }): SosAlertState => {
      const alerts = context.alerts.filter(a => a.id !== event.id);
      writeToStorage(context.userId, alerts);
      return { ...context, alerts };
    },
    /** Clear on logout so alerts never leak across accounts on a shared machine. */
    reset: (): SosAlertState => initialContext,
  },
});

interface TypedSosAlertStore {
  subscribe: (cb: () => void) => { unsubscribe: () => void };
  getSnapshot: () => { context: SosAlertState };
  send: (event: SosAlertStoreEvent) => void;
}

export type SosAlertStoreEvent =
  | { type: 'hydrate'; userId: string }
  | { type: 'addAlert'; alert: SosAlert }
  | { type: 'acknowledgeAlert'; id: string }
  | { type: 'reset' };

const store = sosAlertStore as unknown as TypedSosAlertStore;

export function useSosAlertStore<T>(selector: (ctx: SosAlertState) => T): T {
  return useSyncExternalStore(
    (cb): (() => void) => {
      const sub = store.subscribe(cb);
      return (): void => {
        sub.unsubscribe();
      };
    },
    (): T => selector(store.getSnapshot().context),
  );
}

export function sendSosAlertEvent(event: SosAlertStoreEvent): void {
  store.send(event);
}
