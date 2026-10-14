/**
 * Chat-cache types and constants that the mobile app owns locally.
 *
 * The `@xyne/shared` revision pinned in public-source.json does not export
 * these, so they are declared here with the same shape/value as the shared
 * StorageAdapter contract. Drop this file and import from `@xyne/shared` once
 * the pin moves to a revision that exports them.
 */

export type ChatCacheEntityKind = 'channel' | 'thread';

export type ChatCacheEntity = {
  kind: ChatCacheEntityKind;
  id: string;
  value: unknown;
  fingerprint: string;
};

/** Warm-shadow entries older than this are discarded (matches shared's warmShadow.ts). */
export const WARM_SHADOW_MAX_AGE_MS = 30 * 60 * 1000;
