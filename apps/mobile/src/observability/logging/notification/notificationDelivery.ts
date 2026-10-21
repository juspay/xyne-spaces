import { readNotificationType } from '@/src/notifications/message/messageContext';
import {
  CALL_NOTIFICATION_TYPES,
  CONTROL_NOTIFICATION_TYPES,
  MESSAGE_NOTIFICATION_TYPES,
  REMINDER_NOTIFICATION_TYPES,
  isTicketNotificationType,
} from '@/src/notifications/notificationTypeSets';
import { SOS_ALERT_METADATA_TYPE } from '@/src/notifications/sos/constants';
import type { DeliveryContext, RawPushMessage } from '@/src/notifications/types';

export type NotificationDeliveryCategory =
  'chat' | 'sos' | 'reminder' | 'control' | 'call' | 'prefetch' | 'ticket' | 'unknown';

export type NotificationDisplayCategory = Extract<
  NotificationDeliveryCategory,
  'chat' | 'sos' | 'reminder' | 'ticket'
>;

export type NotificationSkipReason =
  | 'silent_control_signal'
  | 'prefetch_only'
  | 'conversation_already_visible'
  | 'native_call_pipeline'
  | 'os_presented_ticket'
  | 'notifications_paused'
  | 'unsupported_or_invalid_payload';

export type NotificationPresentationOwner = 'app' | 'operating_system';

export type NotificationDeliveryFields = Readonly<{
  notificationId: string | null;
  notificationType: string | null;
  category: NotificationDeliveryCategory;
  fcmMessageId: string | null;
  deliveryContext: DeliveryContext;
  hasNotificationPayload: boolean;
  fcmSentTime: number | null;
}>;

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readMetadataNotificationId(data: Record<string, unknown>): string | null {
  const metadata = data['metadata'];
  if (!metadata) return null;

  if (typeof metadata === 'object' && !Array.isArray(metadata)) {
    return readNonEmptyString((metadata as Record<string, unknown>)['notificationId']);
  }

  if (typeof metadata !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(metadata);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return readNonEmptyString((parsed as Record<string, unknown>)['notificationId']);
  } catch {
    return null;
  }
}

function readMetadataNotificationType(data: Record<string, unknown>): string | null {
  const metadata = data['metadata'];
  if (!metadata) return null;

  if (typeof metadata === 'object' && !Array.isArray(metadata)) {
    return readNonEmptyString((metadata as Record<string, unknown>)['notificationType']);
  }

  if (typeof metadata !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(metadata);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return readNonEmptyString((parsed as Record<string, unknown>)['notificationType']);
  } catch {
    return null;
  }
}

export function classifyNotificationCategory(
  data: Record<string, unknown>,
): NotificationDeliveryCategory {
  if (
    readNonEmptyString(data['notificationType']) === SOS_ALERT_METADATA_TYPE ||
    readNonEmptyString(data['type']) === SOS_ALERT_METADATA_TYPE ||
    readMetadataNotificationType(data) === SOS_ALERT_METADATA_TYPE
  ) {
    return 'sos';
  }

  const type = readNotificationType(data);

  if (CONTROL_NOTIFICATION_TYPES.has(type)) return 'control';
  if (CALL_NOTIFICATION_TYPES.has(type)) return 'call';
  if (REMINDER_NOTIFICATION_TYPES.has(type)) return 'reminder';
  if (data['prefetchOnly'] === '1') return 'prefetch';
  if (isTicketNotificationType(type)) return 'ticket';
  if (MESSAGE_NOTIFICATION_TYPES.has(type)) return 'chat';

  return 'unknown';
}

/**
 * iOS background/killed alert pushes are presented by the Notification
 * Service Extension. JS `setBackgroundMessageHandler` usually does not run
 * for those, and when it does the OS already owns the banner. Funnel logs
 * for this path are emitted from the NSE so Grafana matches the visible tray.
 */
export function isIosOperatingSystemPresentedBanner(
  message: RawPushMessage,
  deliveryContext: DeliveryContext,
  platform: string,
): boolean {
  return (
    platform === 'ios' &&
    deliveryContext === 'background' &&
    message.notification !== undefined &&
    message.notification !== null
  );
}

export function getNotificationDeliveryFields(
  message: RawPushMessage,
  deliveryContext: DeliveryContext,
): NotificationDeliveryFields {
  const data = (message.data ?? {}) as Record<string, unknown>;
  const notificationId =
    readNonEmptyString(data['notificationId']) ?? readMetadataNotificationId(data);
  const notificationType = readNotificationType(data) || null;

  return {
    notificationId,
    notificationType,
    category: classifyNotificationCategory(data),
    fcmMessageId: readNonEmptyString(message.messageId),
    deliveryContext,
    hasNotificationPayload: message.notification !== undefined && message.notification !== null,
    fcmSentTime:
      typeof message.sentTime === 'number' && Number.isFinite(message.sentTime)
        ? message.sentTime
        : null,
  };
}
