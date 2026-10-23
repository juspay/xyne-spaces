import { EventType, type Event } from 'react-native-notify-kit';

import { ACTION_SOS_ACKNOWLEDGE } from '../config';
import { dismissSosAlert } from './actionsApi';
import { presentSosNotification, silenceDisplayedSosNotification } from './display';
import { extractSosAlertFromTrayData } from './parser';
import { addSosAlert, getOwnedSosAlert, isSosAlertAcknowledgedLocally } from './store';

export async function handleSosTrayEvent({ type, detail }: Event): Promise<boolean> {
  const alert = extractSosAlertFromTrayData(
    detail.notification?.data as Record<string, unknown> | undefined,
  );

  if (!alert) return false;

  if (type === EventType.DISMISSED) {
    if (isSosAlertAcknowledgedLocally(alert.id)) return true;

    const ownedAlert = alert.ownerUserId ? addSosAlert(alert) : getOwnedSosAlert(alert.id);
    if (!ownedAlert) return true;
    try {
      await presentSosNotification(ownedAlert);
    } catch {
      // Tray re-display is best-effort; inbound delivery owns display failure logs.
    }
    return true;
  }

  if (type === EventType.PRESS) {
    const ownedAlert = alert.ownerUserId ? addSosAlert(alert) : getOwnedSosAlert(alert.id);
    if (!ownedAlert) return true;
    if (detail.notification) {
      await silenceDisplayedSosNotification(detail.notification);
    }
    return true;
  }

  if (type === EventType.ACTION_PRESS) {
    const actionId = detail.pressAction?.id;

    if (actionId === ACTION_SOS_ACKNOWLEDGE) {
      const ownedAlert = alert.ownerUserId ? addSosAlert(alert) : getOwnedSosAlert(alert.id);
      if (!ownedAlert) return true;
      await dismissSosAlert(ownedAlert);
      return true;
    }
  }

  return true;
}
