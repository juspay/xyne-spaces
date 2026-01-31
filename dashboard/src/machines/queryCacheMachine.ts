import { setup, assign, createActor } from 'xstate';
import { indexedDBService } from '../services/indexedDBService';
import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../zero/queries';
import { QueryResult } from '@rocicorp/zero/react';

/**
 * Query Cache Machine
 *
 * XState machine for managing query result caching.
 * Stores query results in a Map indexed by query hash.
 * Persists to IndexedDB for cross-session caching.
 * Implements access-based TTL eviction (2 days).
 */

const TTL_DEFAULT_MS = 2 * 24 * 60 * 60 * 1000; // 2 days in milliseconds

/* -------------------------- TYPES -------------------------- */

export type Conversation = QueryResultType<typeof queries.channelConversationsPaginated>[number];

export interface CacheEntry<T> {
  data: QueryResult<T>;
  lastAccessed: number; // Timestamp in ms
}

export interface QueryCacheContext {
  //eslint-disable-next-line @typescript-eslint/no-explicit-any
  cache: Map<string, CacheEntry<any>>;
  channelConversations: {
    [channelId: string]: Conversation[];
  };
}

export type QueryCacheEvent =
  | {
      type: 'SET_KEY';
      hash: string;
      //eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: QueryResult<any>;
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
  | { type: 'ACCESS_KEY'; hash: string }
  | { type: 'EVICT_STALE_ENTRIES' };

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

      const newCache = new Map(context.cache);
      newCache.set(event.hash, {
        data: event.data,
        lastAccessed: Date.now(),
      });

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
    updateAccessTime: assign(({ event, context }) => {
      if (event.type === 'ACCESS_KEY') {
        const entry = context.cache.get(event.hash);
        if (!entry) return context;

        const newCache = new Map(context.cache);
        newCache.set(event.hash, {
          ...entry,
          lastAccessed: Date.now(),
        });

        return {
          ...context,
          cache: newCache,
        };
      }
      return context;
    }),
    evictStaleEntries: assign(({ context }) => {
      const now = Date.now();

      // Evict stale cache entries
      //eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newCache = new Map<string, CacheEntry<any>>();
      for (const [key, entry] of context.cache) {
        if (now - entry.lastAccessed < TTL_DEFAULT_MS) {
          newCache.set(key, entry);
        }
      }

      const cacheEvictedCount = context.cache.size - newCache.size;

      if (cacheEvictedCount > 0) {
        console.log(`Evicted ${cacheEvictedCount} stale cache entries`);
      }

      return {
        ...context,
        cache: newCache,
      };
    }),
  },
}).createMachine({
  id: 'queryCache',
  context: {
    cache: new Map(),
    channelConversations: {},
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
    ACCESS_KEY: {
      actions: 'updateAccessTime',
    },
    ACCESS_CONVERSATION: {
      actions: 'updateAccessTime',
    },
    EVICT_STALE_ENTRIES: {
      actions: 'evictStaleEntries',
    },
  },
});

export const queryCacheActor = createActor(queryCacheMachine).start();

// Debounce function for persistence
let persistTimeout: NodeJS.Timeout | null = null;
const PERSIST_DEBOUNCE_MS = 500;

/**
 * Setup persistence middleware for query cache
 * Initializes IndexedDB and subscribes to state changes
 * Saves each cache entry and conversation as individual keys in IndexedDB
 * TTL logic is handled by XState machine via lastAccessed timestamps
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
          const { cache, channelConversations } = snapshot.context;

          // Save each cache entry as individual key in IndexedDB
          cache.forEach((value, key) => {
            indexedDBService.saveContextProperty(key, value).catch(error => {
              console.error(`Failed to persist query cache entry ${key} to IndexedDB:`, error);
            });
          });

          // Save conversations
          indexedDBService
            .saveContextProperty(`channelConversations`, channelConversations)
            .catch(error => {
              console.error(`Failed to persist conversations to IndexedDB:`, error);
            });
        }, PERSIST_DEBOUNCE_MS);
      }),
    )
    .catch(error => {
      console.error('Failed to initialize IndexedDB for query cache:', error);
    });
};

/**
 * Hydrate query cache and conversations from IndexedDB
 * Loads persisted cache entries and conversations in separate operations
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

    for (const [key, value] of Object.entries(context)) {
      if (key === 'channelConversations') {
        Object.assign(conversationsData, value as Record<string, Conversation[]>);
      } else {
        // Regular cache entry - now storing CacheEntry objects directly
        //eslint-disable-next-line @typescript-eslint/no-explicit-any
        cacheData[key] = value as CacheEntry<any>;
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
    return Object.keys(cacheData).length > 0 || Object.keys(conversationsData).length > 0;
  } catch (error) {
    console.error('Failed to hydrate query cache from IndexedDB:', error);
    return false;
  }
};
