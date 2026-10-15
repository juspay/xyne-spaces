import { Platform } from 'react-native';
export { SOS_ALERT_METADATA_TYPE } from './sos/constants';
export {
  CALL_NOTIFICATION_TYPES,
  CONTROL_NOTIFICATION_TYPES,
  MESSAGE_NOTIFICATION_TYPES,
  REMINDER_NOTIFICATION_TYPES,
  isTicketNotificationType,
} from './notificationTypeSets';

// ── Device registration (step 1) ─────────────────────────────────────────────
// Persisted key for the stable per-install device id we send to the backend.
// One id per app install keeps device bookkeeping predictable.
export const DEVICE_ID_STORAGE_KEY = '@notif_v3_device_id';

// iOS only: how long (ms) we wait for the APNs token before giving up.
// Firebase cannot mint an FCM token until APNs has handed over its token.
export const APNS_TOKEN_TIMEOUT_MS = 8000;

// iOS only: how often (ms) we re-check for the APNs token while waiting.
export const APNS_TOKEN_POLL_INTERVAL_MS = 250;

// ── Display (step 2) ──────────────────────────────────────────────────────────
// Android channel that chat message notifications post to.
export const MESSAGE_CHANNEL_ID = 'notif_v3_messages';
// Android channel for silent tray rewrites (edit/delete rerenders) — LOW
// importance + no sound/vibration so updating a banner never re-alerts.
export const SILENT_CHANNEL_ID = 'notif_v3_silent_updates';
// Bumped if channel config (sound/importance) ever changes. v2 adds the silent channel.
export const CHANNELS_READY_KEY = '@notif_v3_channels_ready_v2';
// iOS category that wires the Reply + Mark as read quick actions.
export const MESSAGE_CATEGORY_ID = 'NOTIF_V3_MESSAGE';

// FCM `type`s that should show a chat banner. Anything else is ignored in step 2.
// Action button ids (shared by display + event handling).
export const ACTION_REPLY = 'reply';
export const ACTION_MARK_AS_READ = 'mark-as-read';
export const ACTION_DEFAULT = 'default'; // body tap

// ── Platform helper ───────────────────────────────────────────────────────────
export type SupportedPlatform = 'ios' | 'android';
export function getSupportedPlatform(): SupportedPlatform | null {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return null;
}

// ── Navigation ───────────────────────────────────────────────────────
export const CHAT_DEEPLINK_ROUTE = '/(protected)/chat-deeplink';
export const CHAT_ROUTE = '/(protected)/chat/[channelId]';
export const CHAT_THREAD_ROUTE = '/(protected)/chat/[channelId]/[threadId]';
export const TICKET_ROUTE = '/ticket/[ticketId]';

export const SOS_ALERT_CHANNEL_ID = 'notif_v3_sos_alerts';
export const SOS_ALERT_CATEGORY_ID = 'NOTIF_V3_SOS_ALERT';

export const SOS_ALERT_NOTIFICATION_SOUND_ID = 'sos_alert';
export const SOS_ALERT_NOTIFICATION_SOUND_IOS = `${SOS_ALERT_NOTIFICATION_SOUND_ID}.caf`;

export const ACTION_SOS_ACKNOWLEDGE = 'sos-acknowledge';
