import { setup, assign, createActor } from 'xstate';
import { indexedDBService, FINGERPRINT_FIELD } from '../services/indexedDBService';
import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../zero/queries';
import { QueryResult } from '@rocicorp/zero/react';

/**
 * Query Cache Machine
 *
 * XState machine for managing query result caching.
 * Stores query results in a Map indexed by query hash.
 * Persists to IndexedDB for cross-session caching.
 */

/* -------------------------- TYPES -------------------------- */

export type Conversation = QueryResultType<typeof queries.channelConversationsPaginatedV2>[number];

export type CallHistoryEntry = QueryResultType<typeof queries.userCallHistory>[number];

export const CALL_HISTORY_KEY = 'callHistory';

export interface CallHistoryState {
  calls: CallHistoryEntry[];
  hasMore: boolean;
}

export interface CacheEntry<T> {
  data: QueryResult<T>;
  lastUpdatedAt?: number;
}

export interface QueryCacheContext {
  //eslint-disable-next-line @typescript-eslint/no-explicit-any
  cache: Map<string, CacheEntry<any>>;
  channelConversations: {
    [channelId: string]: Conversation[];
  };
  callHistory: CallHistoryState;
}

export type QueryCacheEvent =
  | {
      type: 'SET_KEY';
      hash: string;
      //eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: QueryResult<any>;
      lastUpdatedAt?: number;
    }
  | {
      type: 'HYDRATE_CACHE';
      //eslint-disable-next-line @typescript-eslint/no-explicit-any
      cacheData: Record<string, CacheEntry<any>>;
    }
  | {
      type: 'HYDRATE_CONVERSATIONS';
      conversationsData: {
        [channelId: string]: Conversation[];
      };
    }
  | { type: 'SET_CONVERSATIONS'; channelId: string; conversations: Conversation[] }
  | { type: 'MERGE_CALL_HISTORY_PAGE'; page: CallHistoryEntry[]; hasMore: boolean }
  | { type: 'HYDRATE_CALL_HISTORY'; data: CallHistoryState };

/* -------------------------- STATE MACHINE -------------------------- */

/**
 * XState machine for managing query cache
 *
 * Simple stateless machine that acts as a global cache store.
 * No complex state transitions - just cache operations.
 */
export const queryCacheMachine = setup({
  types: {
    context: {} as QueryCacheContext,
    events: {} as QueryCacheEvent,
  },
  actions: {
    setCache: assign(({ event, context }) => {
      if (event.type !== 'SET_KEY') return context;

      const existing = context.cache.get(event.hash);
      const newCache = new Map(context.cache);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const resolvedLastUpdatedAt = event.lastUpdatedAt ?? existing?.lastUpdatedAt;
      //eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entry: CacheEntry<any> = {
        data: event.data,
      };

      if (resolvedLastUpdatedAt !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        entry.lastUpdatedAt = resolvedLastUpdatedAt;
      }

      newCache.set(event.hash, entry);

      return {
        ...context,
        cache: newCache,
      };
    }),
    hydrateCache: assign(({ event, context }) => {
      if (event.type !== 'HYDRATE_CACHE') return context;

      // Convert object to Map, preserving CacheEntry structure
      //eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newCache = new Map<string, CacheEntry<any>>();

      for (const [key, entry] of Object.entries(event.cacheData)) {
        newCache.set(key, entry);
      }

      return {
        ...context,
        cache: newCache,
      };
    }),
    setConversations: assign({
      channelConversations: ({ context, event }) => {
        if (event.type === 'SET_CONVERSATIONS') {
          return {
            ...context.channelConversations,
            [event.channelId]: event.conversations,
          };
        }
        return context.channelConversations;
      },
    }),
    hydrateConversations: assign(({ event, context }) => {
      if (event.type !== 'HYDRATE_CONVERSATIONS') return context;

      const wrappedConversations: { [channelId: string]: Conversation[] } = {};

      for (const [channelId, conversations] of Object.entries(event.conversationsData)) {
        wrappedConversations[channelId] = conversations;
      }

      return {
        ...context,
        channelConversations: wrappedConversations,
      };
    }),
    mergeCallHistoryPage: assign({
      callHistory: ({ context, event }) => {
        if (event.type !== 'MERGE_CALL_HISTORY_PAGE') return context.callHistory;
        const map = new Map(context.callHistory.calls.map(c => [c.id, c]));
        for (const call of event.page) map.set(call.id, call);
        const calls = [...map.values()].sort(
          (a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id),
        );
        // Only allow hasMore to flip false→true on a fresh (empty cache) load
        const hasMore = !event.hasMore
          ? false
          : context.callHistory.calls.length === 0
            ? true
            : context.callHistory.hasMore;
        return { calls, hasMore };
      },
    }),
    hydrateCallHistory: assign({
      callHistory: ({ event }) => {
        if (event.type !== 'HYDRATE_CALL_HISTORY') return { calls: [], hasMore: true };
        return event.data;
      },
    }),
  },
}).createMachine({
  id: 'queryCache',
  context: {
    cache: new Map(),
    channelConversations: {},
    callHistory: { calls: [], hasMore: true },
  },
  on: {
    SET_KEY: {
      actions: 'setCache',
    },
    HYDRATE_CACHE: {
      actions: 'hydrateCache',
    },
    HYDRATE_CONVERSATIONS: {
      actions: 'hydrateConversations',
    },
    SET_CONVERSATIONS: {
      actions: 'setConversations',
    },
    MERGE_CALL_HISTORY_PAGE: {
      actions: 'mergeCallHistoryPage',
    },
    HYDRATE_CALL_HISTORY: {
      actions: 'hydrateCallHistory',
    },
  },
});

export const queryCacheActor = createActor(queryCacheMachine).start();

// Debounce function for persistence
let persistTimeout: NodeJS.Timeout | null = null;
const PERSIST_DEBOUNCE_MS = 500;

/**
 * Get the AST-based hash for the channelConversationsPaginatedV2 query.
 * This hash changes automatically when the query structure changes.
 */
export const getChannelConversationsQueryHash = (context: { userID: string }): string => {
  try {
    // Build the query with context and dummy args to get the Query object
    // The fn() returns a QueryImpl which has the hash() method
    const query = queries.channelConversationsPaginatedV2.fn({
      args: {
        channelId: '__dummy__',
        limit: 1,
        start: null,
        direction: 'forward' as const,
      },
      ctx: context,
    });
    // @ts-expect-error - hash() is part of QueryImpl, not public Query interface
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    return query.hash() as string;
  } catch {
    return '';
  }
};

/**
 * Get the AST-based hash for the userCallHistory query.
 * This hash changes automatically when the query structure changes.
 * Uses dummy args since the query shape does not depend on runtime arg values.
 */
export const getCallHistoryQueryHash = (): string => {
  try {
    const query = queries.userCallHistory.fn({
      args: { limit: 1, start: null },
      ctx: {} as { userID: string },
    });
    // @ts-expect-error - hash() is part of QueryImpl, not public Query interface
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    return query.hash() as string;
  } catch {
    return '';
  }
};

/**
 * Setup persistence middleware for query cache
 * Initializes IndexedDB and subscribes to state changes.
 */
export const setupQueryCachePersistence = (userId: string, schemaVersion: string): void => {
  // Initialize IndexedDB with schema version and userId
  indexedDBService
    .init(userId, schemaVersion)
    .then(() =>
      // Subscribe to state changes and persist to IndexedDB
      queryCacheActor.subscribe(snapshot => {
        // Clear any existing timeout
        if (persistTimeout) {
          clearTimeout(persistTimeout);
        }

        // Debounce the persistence operation
        persistTimeout = setTimeout(() => {
          const { cache, channelConversations, callHistory } = snapshot.context;

          // Save each cache entry as individual key in IndexedDB
          cache.forEach((value, key) => {
            indexedDBService.saveContextProperty(key, value).catch(error => {
              console.error(`Failed to persist query cache entry ${key} to IndexedDB:`, error);
            });
          });

          // Compute the hash for channelConversations query and embed it
          const conversationHash = getChannelConversationsQueryHash({ userID: userId });

          const payload: Record<string, unknown> = {
            ...channelConversations,
            [FINGERPRINT_FIELD]: conversationHash,
          };

          indexedDBService.saveContextProperty('channelConversations', payload).catch(error => {
            console.error('Failed to persist conversations to IndexedDB:', error);
          });

          indexedDBService
            .saveContextProperty(CALL_HISTORY_KEY, {
              ...callHistory,
              [FINGERPRINT_FIELD]: getCallHistoryQueryHash(),
            })
            .catch(error => {
              console.error('Failed to persist call history to IndexedDB:', error);
            });
        }, PERSIST_DEBOUNCE_MS);
      }),
    )
    .catch(error => {
      console.error('Failed to initialize IndexedDB for query cache:', error);
    });
};

/**
 * Hydrate query cache and conversations from IndexedDB.
 *
 * For channelConversations, the stored payload includes a hash that was computed
 * from the query structure at save time. At hydration, we compare it with the
 * current hash - if they differ, the query has changed and we discard the cached data.
 */
export const hydrateQueryCacheFromIndexedDB = async (
  userId: string,
  schemaVersion: string,
): Promise<boolean> => {
  try {
    // Initialize IndexedDB with schema version and userId
    await indexedDBService.init(userId, schemaVersion);

    // Load all persisted context
    const context = await indexedDBService.loadContext();

    if (!context) {
      return false;
    }

    // Separate cache entries and conversations
    //eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cacheData: Record<string, CacheEntry<any>> = {};
    const conversationsData: Record<string, Conversation[]> = {};
    let callHistoryHydrated = false;

    // Get current hash for channelConversations query
    const currentConversationHash = getChannelConversationsQueryHash({ userID: userId });

    for (const [key, value] of Object.entries(context)) {
      if (key === 'channelConversations') {
        const raw = value as Record<string, unknown>;

        // Compare the stored query hash with the current hash
        const storedHash = raw[FINGERPRINT_FIELD] as string | undefined;

        if (storedHash !== undefined && storedHash !== currentConversationHash) {
          console.log(
            'channelConversations discarded: query has changed since last save ' +
              `(stored hash: ${storedHash}, current: ${currentConversationHash}).`,
          );
          continue;
        }

        for (const [channelId, conversations] of Object.entries(raw)) {
          if (channelId === FINGERPRINT_FIELD) continue;
          if (Array.isArray(conversations) && conversations.length > 0) {
            conversationsData[channelId] = conversations as Conversation[];
          }
        }
      } else if (key === CALL_HISTORY_KEY) {
        const raw = value as CallHistoryState & { [FINGERPRINT_FIELD]?: string };

        // Discard if the query AST has changed since the data was saved
        const storedHash = raw[FINGERPRINT_FIELD];
        const currentCallHistoryHash = getCallHistoryQueryHash();

        if (storedHash !== undefined && storedHash !== currentCallHistoryHash) {
          console.log(
            'callHistory discarded: query has changed since last save ' +
              `(stored hash: ${storedHash}, current: ${currentCallHistoryHash}).`,
          );
        } else if (Array.isArray(raw?.calls) && raw.calls.length > 0) {
          queryCacheActor.send({
            type: 'HYDRATE_CALL_HISTORY',
            data: { calls: raw.calls, hasMore: raw.hasMore },
          });
          callHistoryHydrated = true;
          console.log(`Hydrated ${raw.calls.length} call history entries from IndexedDB`);
        }
      } else {
        // Regular cache entry
        const entry = value as CacheEntry<unknown>;
        //eslint-disable-next-line @typescript-eslint/no-explicit-any
        cacheData[key] = entry as CacheEntry<any>;
      }
    }

    // Hydrate cache if there are entries
    if (Object.keys(cacheData).length > 0) {
      queryCacheActor.send({
        type: 'HYDRATE_CACHE',
        cacheData,
      });
      console.log(`Hydrated ${Object.keys(cacheData).length} query cache entries from IndexedDB`);
    }

    // Hydrate conversations if there are entries
    if (Object.keys(conversationsData).length > 0) {
      queryCacheActor.send({
        type: 'HYDRATE_CONVERSATIONS',
        conversationsData,
      });
      console.log(
        `Hydrated ${Object.keys(conversationsData).length} conversation caches from IndexedDB`,
      );
    }

    // Return true if we hydrated anything
    return (
      Object.keys(cacheData).length > 0 ||
      Object.keys(conversationsData).length > 0 ||
      callHistoryHydrated
    );
  } catch (error) {
    console.error('Failed to hydrate query cache from IndexedDB:', error);
    return false;
  }
};
