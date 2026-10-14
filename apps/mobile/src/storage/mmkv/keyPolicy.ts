/**
 * Non-secret keys that must live in App Group MMKV so the Notification Service
 * Extension (and other processes) can read them. Reusable credentials are
 * deliberately excluded and use their platform-protected handoff instead.
 */
export const HANDOFF_EXACT_KEYS = [
  '@lotus_user_id',
  '@lotus_user_cache',
  'xyne-global:userId',
  'xyne-global:schemaVersion',
  'xyne-global:workspaceId',
  'xyne-global:notificationSoundId',
  '@lotus_zero_connected_at',
  'settings:v1',
  // Non-secret logout tombstone mirrored for the notification extension. The
  // canonical migration marker remains process-local so upgrades cannot miss
  // an existing signed-out state.
  'lotus_auth_token_signed_out',
] as const;

/** Credentials written by older builds. They must never be imported into the
 * process-local cache, but cleanup still has to address the App Group copy. */
export const LEGACY_AUTH_HANDOFF_KEYS = ['lotus_auth_token', 'xyne-global:authToken'] as const;

export const HANDOFF_KEY_PREFIXES = ['@notif_v3_group:', '@notif_v3_sos_alerts:'] as const;

/** Legacy App Group cache blobs from older NSE builds. Copy if missing, then delete. */
export const SHARED_CACHE_IMPORT_PREFIXES = [
  'xyne-state-machine',
  'warm_shadow:',
  '@lotus_activity_rows',
  '@lotus_channel_messages',
  '@lotus_thread_messages',
] as const;

export function isHandoffKey(key: string): boolean {
  if ((HANDOFF_EXACT_KEYS as readonly string[]).includes(key)) {
    return true;
  }
  return HANDOFF_KEY_PREFIXES.some(prefix => key.startsWith(prefix));
}

export function isLegacyAuthHandoffKey(key: string): boolean {
  return (LEGACY_AUTH_HANDOFF_KEYS as readonly string[]).includes(key);
}

export function isSharedCacheImportKey(key: string): boolean {
  return SHARED_CACHE_IMPORT_PREFIXES.some(prefix => key.startsWith(prefix));
}
