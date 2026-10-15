export const NOTIFICATION_GROUP_PREFIX = '@notif_v3_group:';
export const NOTIFICATION_SOS_PREFIX = '@notif_v3_sos_alerts:';

/**
 * Returns notification handoff keys that must not survive an auth boundary.
 * Notification payloads are user-scoped even though the MMKV store is shared
 * with the native extensions, so remove every user-scoped copy on logout.
 */
export function getUserNotificationStorageKeys(keys: readonly string[]): string[] {
  return keys.filter(
    key => key.startsWith(NOTIFICATION_GROUP_PREFIX) || key.startsWith(NOTIFICATION_SOS_PREFIX),
  );
}
