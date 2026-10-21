import { cacheMmkv, handoffMmkv } from './instances';
import { isHandoffKey, isLegacyAuthHandoffKey } from './keyPolicy';
import { recordHandoffOp, shouldUseSharedStoreFallback } from './lastHandoffOp';

type MmkvStore = typeof cacheMmkv;

type StoredScalar = {
  string?: string;
  boolean?: boolean;
  number?: number;
};

function readStoreValue(store: MmkvStore, key: string): StoredScalar {
  const stringValue = store.getString(key);
  if (stringValue !== undefined) return { string: stringValue };
  const booleanValue = store.getBoolean(key);
  if (booleanValue !== undefined) return { boolean: booleanValue };
  const numberValue = store.getNumber(key);
  if (numberValue !== undefined) return { number: numberValue };
  return {};
}

function readHandoffValue(key: string): StoredScalar {
  return recordHandoffOp('get', key, () => readStoreValue(handoffMmkv, key));
}

function hasStoredValue(value: StoredScalar): boolean {
  return value.string !== undefined || value.boolean !== undefined || value.number !== undefined;
}

/**
 * Cache-class keys stay in process-local MMKV. App Group is consulted only while
 * the main app is foregrounded, so NSE-written blobs can be read before import
 * without taking shared locks in headless/background (0xdead10cc).
 */
function readCacheThenHandoff(key: string): StoredScalar {
  const cached = readStoreValue(cacheMmkv, key);
  if (hasStoredValue(cached)) return cached;
  if (!shouldUseSharedStoreFallback()) return {};
  return readHandoffValue(key);
}

function removeLegacyHandoffCopy(key: string): void {
  if (!shouldUseSharedStoreFallback()) return;
  recordHandoffOp('remove', key, () => {
    try {
      handoffMmkv.remove(key);
    } catch {
      // Legacy App Group cleanup is best-effort.
    }
  });
}

export const lotusStorage = {
  getString(key: string): string | undefined {
    if (isLegacyAuthHandoffKey(key)) {
      // Read only for the one-time protected-token migration. Never route this
      // credential through the normal cache-import or new-write paths.
      const cached = cacheMmkv.getString(key);
      if (cached !== undefined) return cached;
      return recordHandoffOp('get', key, () => handoffMmkv.getString(key));
    }
    if (isHandoffKey(key)) {
      return recordHandoffOp('get', key, () => handoffMmkv.getString(key));
    }
    return readCacheThenHandoff(key).string;
  },

  getBoolean(key: string): boolean | undefined {
    if (isLegacyAuthHandoffKey(key)) return undefined;
    if (isHandoffKey(key)) {
      return recordHandoffOp('get', key, () => handoffMmkv.getBoolean(key));
    }
    return readCacheThenHandoff(key).boolean;
  },

  getNumber(key: string): number | undefined {
    if (isLegacyAuthHandoffKey(key)) return undefined;
    if (isHandoffKey(key)) {
      return recordHandoffOp('get', key, () => handoffMmkv.getNumber(key));
    }
    return readCacheThenHandoff(key).number;
  },

  set(key: string, value: boolean | string | number): void {
    if (isLegacyAuthHandoffKey(key)) {
      throw new Error(`Legacy auth handoff key is write-disabled: ${key}`);
    }
    if (isHandoffKey(key)) {
      recordHandoffOp('set', key, () => {
        handoffMmkv.set(key, value);
      });
      return;
    }
    cacheMmkv.set(key, value);
  },

  remove(key: string): void {
    if (isLegacyAuthHandoffKey(key)) {
      cacheMmkv.remove(key);
      recordHandoffOp('remove', key, () => handoffMmkv.remove(key));
      return;
    }
    if (isHandoffKey(key)) {
      recordHandoffOp('remove', key, () => {
        handoffMmkv.remove(key);
      });
      return;
    }
    cacheMmkv.remove(key);
    removeLegacyHandoffCopy(key);
  },

  contains(key: string): boolean {
    if (isHandoffKey(key)) {
      return recordHandoffOp('get', key, () => handoffMmkv.contains(key));
    }
    if (cacheMmkv.contains(key)) return true;
    if (!shouldUseSharedStoreFallback()) return false;
    return recordHandoffOp('get', key, () => handoffMmkv.contains(key));
  },

  getAllKeys(): string[] {
    const keys = new Set<string>(cacheMmkv.getAllKeys());
    if (!shouldUseSharedStoreFallback()) {
      return [...keys];
    }
    for (const key of recordHandoffOp('getAllKeys', '', () => handoffMmkv.getAllKeys())) {
      keys.add(key);
    }
    return [...keys];
  },
};
