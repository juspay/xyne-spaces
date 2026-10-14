import { AppState, type NativeEventSubscription } from 'react-native';
import { mmkvStorageAdapter } from '../services/mmkvStorageAdapter';
import { importSharedMmkvCache } from '../services/localStorage';
import { getActiveWorkspaceId } from '../utils/activeWorkspace';
import {
  setupQueryCachePersistence as _setupPersistence,
  hydrateQueryCacheFromStorage as _hydrateFromStorage,
  flushQueryCachePersistence,
} from '@xyne/shared/machines';

// Per-entity chat persistence in @xyne/shared is bounded and dirty-reference
// aware, and always uses the debounced write path. The MMKV adapter defers
// every write while the app is suspending.

export {
  queryCacheMachine,
  queryCacheActor,
  getChannelConversationsQueryHash,
  FINGERPRINT_FIELD,
  type CacheEntry,
  type QueryCacheContext,
  type QueryCacheEvent,
  type Conversation,
} from '@xyne/shared/machines';

/**
 * Setup persistence using MMKV (native-specific).
 */
export const setupQueryCachePersistence = (userId: string, schemaVersion: string): void => {
  const workspaceId = getPersistenceWorkspaceId();
  const setupKey = getQueryCacheSetupKey(userId, schemaVersion, workspaceId);
  if (queryCachePersistenceSetupKey === setupKey) return;

  setupQueryCachePersistenceLifecycle();
  _setupPersistence(mmkvStorageAdapter, userId, schemaVersion);
  queryCachePersistenceSetupKey = setupKey;
};

let queryCachePersistenceSetupKey: string | null = null;

const getPersistenceWorkspaceId = (): string =>
  getActiveWorkspaceId() ?? mmkvStorageAdapter.getGlobalUserContext().workspaceId ?? '';

const getQueryCacheSetupKey = (
  userId: string,
  schemaVersion: string,
  workspaceId: string,
): string => `${userId}:${schemaVersion}:${workspaceId}`;

/**
 * Register the synchronous storage reader before a protected chat screen can
 * render. Hydration remains asynchronous and owned by InitialStateLoader; this
 * helper only installs the shared adapter pointer and is safe to call repeatedly.
 */
export const ensureQueryCacheStorageReady = (): boolean => {
  const { userId, schemaVersion } = mmkvStorageAdapter.getGlobalUserContext();
  if (!userId || !schemaVersion) {
    // A sign-out clears the global context. Forget the previous identity so a
    // later login of the same user creates a fresh persistence binding.
    queryCachePersistenceSetupKey = null;
    return false;
  }

  setupQueryCachePersistence(userId, schemaVersion);
  return true;
};

let lifecycleSubscription: NativeEventSubscription | null = null;

function setupQueryCachePersistenceLifecycle(): void {
  if (lifecycleSubscription) {
    return;
  }

  mmkvStorageAdapter.setQueryCacheWritesEnabled(AppState.currentState === 'active');
  if (AppState.currentState === 'active') {
    importSharedMmkvCache();
  }
  lifecycleSubscription = AppState.addEventListener('change', nextState => {
    if (nextState === 'background') {
      // The adapter must still accept writes while the shared persistence
      // coordinator flushes its dirty references. Disable writes only after
      // that synchronous flush has completed.
      flushQueryCachePersistence();
      mmkvStorageAdapter.setQueryCacheWritesEnabled(false);
      return;
    }

    // Keep writes enabled through transient iOS `inactive` states so the
    // subsequent `background` transition can flush the pending queue.
    if (nextState === 'active') {
      importSharedMmkvCache();
      mmkvStorageAdapter.setQueryCacheWritesEnabled(true);
    }
  });
}

/**
 * Hydrate query cache from MMKV (native-specific).
 */
export const hydrateQueryCacheFromStorage = async (
  userId: string,
  schemaVersion: string,
): Promise<boolean> => {
  importSharedMmkvCache();
  return _hydrateFromStorage(mmkvStorageAdapter, userId, schemaVersion);
};
