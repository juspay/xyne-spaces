import { normalizeData, parseMetadata, readNonEmptyString } from '../message/messageContext';
import { SOS_ALERT_METADATA_TYPE } from './constants';
import type { SosAlert } from './types';

function extractWorkspaceIdFromActionUrl(actionUrl: string | undefined): string | undefined {
  if (!actionUrl?.startsWith('/')) return undefined;

  const first = actionUrl.split('/').filter(Boolean)[0];
  return first && first !== 'chat' && first !== 'tickets' && first !== 'support'
    ? first
    : undefined;
}

export function isSosAlertData(data: Record<string, string>): boolean {
  const metadata = parseMetadata(data);
  const notificationType =
    readNonEmptyString(data['notificationType']) ??
    readNonEmptyString(metadata['notificationType']);

  return notificationType === SOS_ALERT_METADATA_TYPE;
}

export function extractSosAlert(data: Record<string, string>): SosAlert | null {
  if (!isSosAlertData(data)) return null;

  const metadata = parseMetadata(data);
  const id =
    readNonEmptyString(data['notificationId']) ?? readNonEmptyString(metadata['notificationId']);

  if (!id) return null;

  const title =
    readNonEmptyString(data['msg_title']) ?? readNonEmptyString(data['title']) ?? 'SOS alert';

  const body =
    readNonEmptyString(data['msg_body']) ??
    readNonEmptyString(data['message']) ??
    readNonEmptyString(data['body']) ??
    '';

  const actionUrl =
    readNonEmptyString(data['actionUrl']) ??
    readNonEmptyString(data['deeplink']) ??
    readNonEmptyString(metadata['actionUrl']) ??
    undefined;

  const workspaceId =
    readNonEmptyString(data['workspaceId']) ??
    readNonEmptyString(metadata['workspaceId']) ??
    extractWorkspaceIdFromActionUrl(actionUrl);

  const ownerUserId = readNonEmptyString(data['ownerUserId']);

  return {
    id,
    ...(ownerUserId ? { ownerUserId } : {}),
    title,
    body,
    ...(actionUrl ? { actionUrl } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    receivedAt: Date.now(),
    rawData: data,
  };
}

export function buildSosTrayData(alert: SosAlert): Record<string, string> {
  return {
    ...alert.rawData,
    _sos: 'true',
    notificationType: SOS_ALERT_METADATA_TYPE,
    type: alert.rawData['type'] || 'MENTION',
    notificationId: alert.id,
    ['msg_title']: alert.title,
    ['msg_body']: alert.body,
    ...(alert.actionUrl ? { actionUrl: alert.actionUrl, deeplink: alert.actionUrl } : {}),
    ...(alert.workspaceId ? { workspaceId: alert.workspaceId } : {}),
    ...(alert.ownerUserId ? { ownerUserId: alert.ownerUserId } : {}),
  };
}

export function extractSosAlertFromTrayData(
  raw: Record<string, unknown> | undefined,
): SosAlert | null {
  return extractSosAlert(normalizeData(raw));
}
