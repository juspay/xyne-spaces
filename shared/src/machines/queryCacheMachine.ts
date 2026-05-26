import { setup, assign, createActor } from 'xstate';
import type { StorageAdapter } from '../platform/storage.js';
import { queries } from '../zero/queries.js';
import type { QueryResultType } from '@rocicorp/zero';
import type { QueryResult } from '@rocicorp/zero/react';
import type { Context } from '../zero/schema.js';

/**
 * Query Cache Machine
 *
 * XState machine for managing query result caching.
 * Stores query results in a Map indexed by query hash.
 * Uses a StorageAdapter for cross-session persistence (IndexedDB on web, AsyncStorage on native).
 */

/* -------------------------- TYPES -------------------------- */

export type Conversation = QueryResultType<typeof queries.channelConversationsPaginatedV3>[number];

export type CallHistoryEntry = QueryResultType<typeof queries.userCallHistory>[number];
export type RecordingEntry = QueryResultType<typeof queries.userRecordings>[number];

export const CALL_HISTORY_KEY = 'callHistory';
export const RECORDINGS_KEY = 'recordings';

export interface CallHistoryState {
  calls: CallHistoryEntry[];
  hasMore: boolean;
}

export interface RecordingsState {
  recordings: RecordingEntry[];
  hasMore: boolean;
}

export interface CacheEntry<T> {
  data: QueryResult<T>;
  lastUpdatedAt?: number;
}

export interface QueryCacheContext {
  //eslint-disable-next-line @typescript-eslint/no-explicit-any
  cache: Map<string, CacheEntry<any>>;
  isHydrated: boolean;
  channelConversations: {
    [channelId: string]: Conversation[];
  };
  callHistory: CallHistoryState;
  recordings: RecordingsState;
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
  | { type: 'MERGE_CONVERSATION'; channelId: string; conversation: Conversation }
  | { type: 'MERGE_CALL_HISTORY_PAGE'; page: CallHistoryEntry[]; hasMore: boolean }
  | { type: 'HYDRATE_CALL_HISTORY'; data: CallHistoryState }
  | { type: 'MERGE_RECORDINGS_PAGE'; page: RecordingEntry[]; hasMore: boolean }
  | { type: 'HYDRATE_RECORDINGS'; data: RecordingsState }
  | { type: 'SET_HYDRATED' };

export const FINGERPRINT_FIELD = '__conversationFingerprint__';

/* -------------------------- STATE MACHINE -------------------------- */

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
    mergeConversation: assign({
      channelConversations: ({ context, event }) => {
        if (event.type !== 'MERGE_CONVERSATION') return context.channelConversations;
        const { channelId, conversation } = event;
        const existing = context.channelConversations[channelId] ?? [];
        // Replace if exists, otherwise prepend (newest first)
        const idx = existing.findIndex(c => c.conversationId === conversation.conversationId);
        const updated = idx >= 0
          ? existing.map((c, i) => (i === idx ? conversation : c))
          : [conversation, ...existing];
        return { ...context.channelConversations, [channelId]: updated };
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
    mergeRecordingsPage: assign({
      recordings: ({ context, event }) => {
        if (event.type !== 'MERGE_RECORDINGS_PAGE') return context.recordings;
        const map = new Map(context.recordings.recordings.map(r => [r.id, r]));
        for (const rec of event.page) map.set(rec.id, rec);
        const recordings = [...map.values()].sort(
          (a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id),
        );
        const hasMore = !event.hasMore
          ? false
          : context.recordings.recordings.length === 0
            ? true
            : context.recordings.hasMore;
        return { recordings, hasMore };
      },
    }),
    hydrateRecordings: assign({
      recordings: ({ event }) => {
        if (event.type !== 'HYDRATE_RECORDINGS') return { recordings: [], hasMore: true };
        return event.data;
      },
    }),
    setHydrated: assign({ isHydrated: true }),
  },
}).createMachine({
  id: 'queryCache',
  context: {
    cache: new Map(),
    isHydrated: false,
    channelConversations: {},
    callHistory: { calls: [], hasMore: true },
    recordings: { recordings: [], hasMore: true },
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
    MERGE_CONVERSATION: {
      actions: 'mergeConversation',
    },
    MERGE_CALL_HISTORY_PAGE: {
      actions: 'mergeCallHistoryPage',
    },
    HYDRATE_CALL_HISTORY: {
      actions: 'hydrateCallHistory',
    },
    MERGE_RECORDINGS_PAGE: {
      actions: 'mergeRecordingsPage',
    },
    HYDRATE_RECORDINGS: {
      actions: 'hydrateRecordings',
    },
    SET_HYDRATED: {
      actions: 'setHydrated',
    },
  },
});

export const queryCacheActor = createActor(queryCacheMachine).start();

// Debounce function for persistence
let persistTimeout: ReturnType<typeof setTimeout> | null = null;
const PERSIST_DEBOUNCE_MS = 500;

/**
 * Get the AST-based hash for the channelConversationsPaginatedV3 query.
 * This hash changes automatically when the query structure changes.
 */
export const getChannelConversationsQueryHash = (context: { userID: string }): string => {
  try {
    const query = queries.channelConversationsPaginatedV3.fn({
      args: {
        channelId: '__dummy__',
        limit: 1,
        start: null,
        direction: 'forward' as const,
        isMember: false,
      },
      ctx: context as Context,
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
      ctx: {} as Context,
    });
    // @ts-expect-error - hash() is part of QueryImpl, not public Query interface
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    return query.hash() as string;
  } catch {
    return '';
  }
};

/**
 * Get the AST-based hash for the userRecordings query.
 */
export const getRecordingsQueryHash = (): string => {
  try {
    const query = queries.userRecordings.fn({
      args: { limit: 1, start: null },
      ctx: {} as Context,
    });
    // @ts-expect-error - hash() is part of QueryImpl, not public Query interface
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    return query.hash() as string;
  } catch {
    return '';
  }
};

/**
 * Setup persistence middleware for query cache.
 * Accepts a StorageAdapter for platform-agnostic persistence.
 */
export const setupQueryCachePersistence = (
  storage: StorageAdapter,
  userId: string,
  schemaVersion: string,
): void => {
  storage
    .init(userId, schemaVersion)
    .then(() =>
      queryCacheActor.subscribe(snapshot => {
        if (persistTimeout) {
          clearTimeout(persistTimeout);
        }

        persistTimeout = setTimeout(() => {
          const { cache, channelConversations, callHistory, recordings } = snapshot.context;

          cache.forEach((value, key) => {
            storage.saveContextProperty(key, value).catch(error => {
              console.error(`Failed to persist query cache entry ${key}:`, error);
            });
          });

          const conversationHash = getChannelConversationsQueryHash({ userID: userId });

          const payload: Record<string, unknown> = {
            ...channelConversations,
            [FINGERPRINT_FIELD]: conversationHash,
          };

          storage.saveContextProperty('channelConversations', payload).catch(error => {
            console.error('Failed to persist conversations:', error);
          });

          storage
            .saveContextProperty(CALL_HISTORY_KEY, {
              ...callHistory,
              [FINGERPRINT_FIELD]: getCallHistoryQueryHash(),
            })
            .catch(error => {
              console.error('Failed to persist call history:', error);
            });

          storage
            .saveContextProperty(RECORDINGS_KEY, {
              ...recordings,
              [FINGERPRINT_FIELD]: getRecordingsQueryHash(),
            })
            .catch(error => {
              console.error('Failed to persist recordings:', error);
            });
        }, PERSIST_DEBOUNCE_MS);
      }),
    )
    .catch(error => {
      console.error('Failed to initialize storage for query cache:', error);
    });
};

/**
 * Hydrate query cache and conversations from storage.
 * Accepts a StorageAdapter for platform-agnostic persistence.
 */
export const hydrateQueryCacheFromStorage = async (
  storage: StorageAdapter,
  userId: string,
  schemaVersion: string,
): Promise<boolean> => {
  try {
    await storage.init(userId, schemaVersion);

    const context = await storage.loadContext();

    if (!context) {
      return false;
    }

    //eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cacheData: Record<string, CacheEntry<any>> = {};
    const conversationsData: Record<string, Conversation[]> = {};
    let callHistoryHydrated = false;
    let recordingsHydrated = false;

    const currentConversationHash = getChannelConversationsQueryHash({ userID: userId });

    for (const [key, value] of Object.entries(context)) {
      if (key === 'channelConversations') {
        const raw = value as Record<string, unknown>;

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

        const storedHash = raw[FINGERPRINT_FIELD];

        const currentCallHistoryHash = getCallHistoryQueryHash();

        if (storedHash !== undefined && storedHash !== currentCallHistoryHash) {
          console.log(
            'callHistory discarded: query has changed since last save ' +
              `(stored hash: ${storedHash}, current: ${currentCallHistoryHash}).`,
          );
          continue;
        }

        queryCacheActor.send({
          type: 'HYDRATE_CALL_HISTORY',
          data: { calls: raw.calls, hasMore: raw.hasMore },
        });
        callHistoryHydrated = true;
      } else if (key === RECORDINGS_KEY) {
        const raw = value as RecordingsState & { [FINGERPRINT_FIELD]?: string };

        const storedHash = raw[FINGERPRINT_FIELD];
        const currentRecordingsHash = getRecordingsQueryHash();

        if (storedHash !== undefined && storedHash !== currentRecordingsHash) {
          console.log(
            'recordings discarded: query has changed since last save ' +
              `(stored hash: ${storedHash}, current: ${currentRecordingsHash}).`,
          );
          continue;
        }

        queryCacheActor.send({
          type: 'HYDRATE_RECORDINGS',
          data: { recordings: raw.recordings, hasMore: raw.hasMore },
        });
        recordingsHydrated = true;
      } else {
        const entry = value as CacheEntry<unknown>;
        //eslint-disable-next-line @typescript-eslint/no-explicit-any
        cacheData[key] = entry as CacheEntry<any>;
      }
    }

    if (Object.keys(cacheData).length > 0) {
      queryCacheActor.send({
        type: 'HYDRATE_CACHE',
        cacheData,
      });
      console.log(`Hydrated ${Object.keys(cacheData).length} query cache entries from storage`);
    }

    if (Object.keys(conversationsData).length > 0) {
      queryCacheActor.send({
        type: 'HYDRATE_CONVERSATIONS',
        conversationsData,
      });
      console.log(
        `Hydrated ${Object.keys(conversationsData).length} conversation caches from storage`,
      );
    }

    return (
      Object.keys(cacheData).length > 0 ||
      Object.keys(conversationsData).length > 0 ||
      callHistoryHydrated ||
      recordingsHydrated
    );
  } catch (error) {
    console.error('Failed to hydrate query cache from storage:', error);
    return false;
  }
};
