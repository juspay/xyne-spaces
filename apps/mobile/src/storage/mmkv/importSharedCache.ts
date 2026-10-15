import { AppState } from 'react-native';

import { copyMmkvValue } from './copyValue';
import { cacheMmkv, handoffMmkv } from './instances';
import { isHandoffKey, isLegacyAuthHandoffKey, isSharedCacheImportKey } from './keyPolicy';
import { recordHandoffOp, withMmkvCaller } from './lastHandoffOp';

const MIGRATION_FLAG_KEY = 'lotus-cache:migrated-v1';

function isHeadlessRuntime(): boolean {
  return globalThis.__XYNE_HEADLESS__ === true;
}

function removeFromHandoff(key: string): void {
  recordHandoffOp('remove', key, () => {
    try {
      handoffMmkv.remove(key);
    } catch {
      // Shared-file cleanup is best-effort.
    }
  });
}

/**
 * Bring NSE/legacy cache blobs into the process-local store, then drop them
 * from App Group so `lotus-startup` stays limited to true handoff keys.
 *
 * Cache wins when the key already exists (JS warm in this process). NSE fills
 * holes. Never run this while headless or not `active`.
 */
export function importSharedMmkvCache(): void {
  if (isHeadlessRuntime() || AppState.currentState !== 'active') {
    return;
  }

  withMmkvCaller('import', () => {
    try {
      const migrated = cacheMmkv.getBoolean(MIGRATION_FLAG_KEY) === true;
      const sharedKeys = recordHandoffOp('getAllKeys', '', () => handoffMmkv.getAllKeys());
      for (const key of sharedKeys) {
        if (AppState.currentState !== 'active') {
          return;
        }
        if (isHandoffKey(key) || isLegacyAuthHandoffKey(key)) {
          continue;
        }

        const shouldCopy = isSharedCacheImportKey(key)
          ? !cacheMmkv.contains(key)
          : !migrated && !cacheMmkv.contains(key);

        if (shouldCopy) {
          copyMmkvValue(handoffMmkv, cacheMmkv, key);
        }

        removeFromHandoff(key);
      }
      if (!migrated) {
        cacheMmkv.set(MIGRATION_FLAG_KEY, true);
      }
    } catch {
      // Import is best-effort. Foreground cache misses can still fall back to handoff.
    }
  });
}
