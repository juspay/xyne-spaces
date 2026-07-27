import { indexedDBService } from '../services/indexedDBService';
import type { StorageAdapter } from '@xyne/shared/platform';
import type { QueryResultType } from '@rocicorp/zero';
import { queries } from '../zero/queries';

export {
  queryCacheMachine,
  queryCacheActor,
  getChannelConversationsQueryHash,
  getCallHistoryQueryHash,
  getRecordingsQueryHash,
  flushQueryCachePersistence,
  FINGERPRINT_FIELD,
  CALL_HISTORY_KEY,
  RECORDINGS_KEY,
} from '@xyne/shared/machines';

export type {
  QueryCacheConversation as Conversation,
  CacheEntry,
  QueryCacheContext,
  QueryCacheEvent,
  CallHistoryState,
  RecordingEntry,
  RecordingsState,
} from '@xyne/shared/machines';

// Dashboard-specific call history types (used by usePaginatedCalls)
export type CallHistoryEntry = QueryResultType<typeof queries.userCallHistoryV2>[number];

import {
  setupQueryCachePersistence as _setupPersistence,
  hydrateQueryCacheFromStorage as _hydrateFromStorage,
} from '@xyne/shared/machines';

/**
 * IndexedDB-backed StorageAdapter for web.
 * Wraps the existing indexedDBService singleton.
 */
const indexedDBStorageAdapter: StorageAdapter = {
  init: (userId: string, schemaVersion: string) =>
    indexedDBService.init(userId, schemaVersion).then(() => {}),
  saveContextProperty: (key: string, value: unknown) =>
    indexedDBService.saveContextProperty(key, value),
  saveContext: (context: Record<string, unknown>) => indexedDBService.saveContext(context),
  loadContext: () => indexedDBService.loadContext(),
  loadContextProperty: (key: string) => indexedDBService.loadContextProperty(key),
  isInitialized: () => indexedDBService.isInitialized(),
  close: () => indexedDBService.close(),
  dropAllUserDatabases: () => indexedDBService.dropAllUserDatabases(),
};

/**
 * Setup persistence using IndexedDB (web-specific).
 */
export const setupQueryCachePersistence = (
  userId: string,
  schemaVersion: string,
  _workspaceId?: string,
): void => {
  _setupPersistence(indexedDBStorageAdapter, userId, schemaVersion);
};

/**
 * Hydrate query cache from IndexedDB (web-specific).
 */
export const hydrateQueryCacheFromIndexedDB = async (
  userId: string,
  schemaVersion: string,
  _workspaceId?: string,
): Promise<boolean> => {
  return _hydrateFromStorage(indexedDBStorageAdapter, userId, schemaVersion);
};
