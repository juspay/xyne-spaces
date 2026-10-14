import { useSyncExternalStore } from 'react';

import { deleteKeys, getJson, getString, setJson } from '@/src/services/localStorage';

import type { SosAlert } from './types';

type SosAlertState = {
  userId: string | null;
  alerts: SosAlert[];
};

const STORAGE_PREFIX = '@notif_v3_sos_alerts';
const PREAUTH_STORAGE_KEY = `${STORAGE_PREFIX}:pending`;
const LEGACY_VIEW_INTENT_KEY = '@notif_v3_sos_view_intent';
const USER_ID_KEY = '@lotus_user_id';
const GLOBAL_USER_ID_KEY = 'xyne-global:userId';
const AUTH_TOKEN_SIGNED_OUT_HANDOFF_KEY = 'lotus_auth_token_signed_out';
const AUTH_TOKEN_SIGNED_OUT_STATE = 'signed_out';

const listeners = new Set<() => void>();
const locallyAcknowledgedIds = new Set<string>();

let state: SosAlertState = {
  userId: null,
  // Never hydrate an ownerless pending bucket. It may have been written by a
  // previous account or by a notification arriving after logout.
  alerts: [],
};

function resolveUserId(): string | null {
  if (getString(AUTH_TOKEN_SIGNED_OUT_HANDOFF_KEY) === AUTH_TOKEN_SIGNED_OUT_STATE) return null;
  const userId = getString(USER_ID_KEY)?.trim() || getString(GLOBAL_USER_ID_KEY)?.trim();
  return userId || null;
}

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}:${userId}`;
}

function readPersistedAlerts(userId: string): SosAlert[] {
  const parsed = getJson<SosAlert[]>(storageKey(userId));
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter(alert => Boolean(alert && typeof alert === 'object' && typeof alert.id === 'string'))
    .map(alert => ({
      ...alert,
      // Older user-scoped entries are safe to attribute to the user in their
      // key; owner metadata is required for tray recovery going forward.
      ownerUserId: alert.ownerUserId?.trim() || userId,
    }));
}

function writeAlertsForKey(key: string, alerts: SosAlert[]): void {
  if (alerts.length === 0) {
    deleteKeys([key]);
    return;
  }
  setJson(key, alerts);
}

function writePersistedAlerts(): void {
  if (!state.userId) {
    // Legacy pending data is never a valid source of alerts for a future user.
    deleteKeys([PREAUTH_STORAGE_KEY]);
    return;
  }

  const key = storageKey(state.userId);
  if (state.alerts.length === 0) {
    deleteKeys([key]);
    return;
  }
  writeAlertsForKey(key, state.alerts);
}

function emit(): void {
  listeners.forEach(listener => listener());
}

export function hydrateSosAlerts(userId: string): void {
  if (state.userId === userId) return;
  const persisted = readPersistedAlerts(userId);
  state = { ...state, userId, alerts: persisted };
  // Delete legacy ownerless state; do not promote it across an auth boundary.
  deleteKeys([PREAUTH_STORAGE_KEY, LEGACY_VIEW_INTENT_KEY]);
  writePersistedAlerts();
  emit();
}

export function resetSosAlerts(): void {
  state = { userId: null, alerts: [] };
  locallyAcknowledgedIds.clear();
  deleteKeys([PREAUTH_STORAGE_KEY, LEGACY_VIEW_INTENT_KEY]);
  emit();
}

export function addSosAlert(alert: SosAlert): SosAlert | null {
  const userId = resolveUserId();
  if (!userId) {
    deleteKeys([PREAUTH_STORAGE_KEY]);
    return null;
  }

  const ownerUserId = alert.ownerUserId?.trim();
  if (ownerUserId && ownerUserId !== userId) return null;

  if (state.userId !== userId) {
    state = { userId, alerts: readPersistedAlerts(userId) };
  }

  if (locallyAcknowledgedIds.has(alert.id)) return null;
  const existing = state.alerts.find(existingAlert => existingAlert.id === alert.id);
  if (existing) return existing;
  const ownedAlert = { ...alert, ownerUserId: userId };
  state = {
    ...state,
    alerts: [...state.alerts, ownedAlert],
  };
  writePersistedAlerts();
  emit();
  return ownedAlert;
}

export function getOwnedSosAlert(alertId: string): SosAlert | null {
  const userId = resolveUserId();
  if (!userId || state.userId !== userId) return null;
  return state.alerts.find(alert => alert.id === alertId && alert.ownerUserId === userId) ?? null;
}

export function acknowledgeSosAlertInStore(alertId: string): void {
  locallyAcknowledgedIds.add(alertId);
  const alerts = state.alerts.filter(alert => alert.id !== alertId);
  state = { ...state, alerts };
  writePersistedAlerts();
  emit();
}

export function isSosAlertAcknowledgedLocally(alertId: string): boolean {
  return locallyAcknowledgedIds.has(alertId);
}

export function getSosAlertSnapshot(): SosAlertState {
  return state;
}

export function subscribeSosAlerts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSosAlerts<T>(selector: (state: SosAlertState) => T): T {
  return useSyncExternalStore(
    subscribeSosAlerts,
    () => selector(getSosAlertSnapshot()),
    () => selector(getSosAlertSnapshot()),
  );
}
