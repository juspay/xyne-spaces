import { lotusStorage } from '@/src/services/localStorage';
import { DEFAULT_SOUND_ID, isKnownSoundId, type NotificationSoundId } from './soundMetadata';

/**
 * Shared MMKV key. MUST equal `Constants.notificationSoundKey` in
 * `lotus/plugins/notification-service/NotificationService.swift` so the
 * iOS NSE can override APNs sound for background/killed-state pushes.
 */
export const NOTIFICATION_SOUND_PREF_KEY = 'xyne-global:notificationSoundId';

export function readNotificationSoundPreference(): NotificationSoundId {
  const raw = lotusStorage.getString(NOTIFICATION_SOUND_PREF_KEY);
  if (raw === 'none') return DEFAULT_SOUND_ID;
  return isKnownSoundId(raw) ? raw : DEFAULT_SOUND_ID;
}

export function writeNotificationSoundPreference(id: NotificationSoundId): void {
  lotusStorage.set(NOTIFICATION_SOUND_PREF_KEY, id);
}
