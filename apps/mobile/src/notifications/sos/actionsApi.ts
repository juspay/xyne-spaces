import notifee from 'react-native-notify-kit';

import { apiRequest } from '@/src/services/apiClient';
import { buildAuthenticatedHeaders } from '@/src/services/authToken';
import {
  getAuthOperation,
  getAuthSessionGeneration,
  isAuthScopeCurrent,
} from '@/src/services/authSessionLifecycle';
import { websocketService } from '@/src/services/websocketService';

import { acknowledgeSosAlertInStore, getOwnedSosAlert } from './store';
import type { SosAlert } from './types';

export async function dismissSosAlert(alert: SosAlert): Promise<void> {
  const generation = getAuthSessionGeneration();
  const operation = getAuthOperation();
  const ownedAlert = getOwnedSosAlert(alert.id);
  if (!ownedAlert || ownedAlert.ownerUserId !== alert.ownerUserId) return;

  acknowledgeSosAlertInStore(alert.id);

  await notifee.cancelNotification(alert.id).catch(() => {});
  if (!isAuthScopeCurrent(generation, operation)) return;

  try {
    const headers = await buildAuthenticatedHeaders();
    if (!isAuthScopeCurrent(generation, operation)) return;
    await apiRequest<{ success: boolean }>(`/notifications/${alert.id}/dismiss`, {
      method: 'PATCH',
      headers,
    });
  } catch {
    // The local user already acted. Keep this non-fatal; server sync can re-deliver if needed.
  }

  if (!isAuthScopeCurrent(generation, operation)) return;
  websocketService.emit('sos_alert_acknowledged', { alertId: alert.id });
}
