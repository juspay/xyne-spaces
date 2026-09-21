import { setup, assign, createActor } from 'xstate';
import type { ChatCacheEntity, ChatCacheEntityKind, StorageAdapter } from '../platform/storage.js';
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

export type ThreadConversation = NonNullable<
  QueryResultType<typeof queries.threadConversationV2>
>;
export type CallHistoryEntry = QueryResultType<typeof queries.userCallHistoryV2>[number];
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
  lastAccessedAt?: number;
  accessCount?: number;
  estimatedSize?: number;
}

export interface QueryCacheContext {
  //eslint-disable-next-line @typescript-eslint/no-explicit-any
  cache: Map<string, CacheEntry<any>>;
  isHydrated: boolean;
  channelConversations: {
    [channelId: string]: Conversation[];
  };
  // Thread caches, keyed by conversationId. Each entry is the full
  // `threadConversation` query result (conversation + inline messages +
  // related ticket/call/participants). Bounded by MAX_CACHED_THREADS.
  threadConversations: {
    [conversationId: string]: ThreadConversation;
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
  | {
      type: 'SET_THREAD_CONVERSATION';
      conversationId: string;
      conversation: ThreadConversation;
    }
  | {
      type: 'HYDRATE_THREAD_CONVERSATIONS';
      threadConversationsData: {
        [conversationId: string]: ThreadConversation;
      };
    }
  | {
      type: 'MERGE_RECORDINGS_PAGE';
      page: RecordingEntry[];
      hasMore: boolean;
      /** @deprecated pass `start: null` instead */
      isFirstPage?: boolean;
      start?: { id: string; startedAt: number } | null;
    }
  | { type: 'HYDRATE_RECORDINGS'; data: RecordingsState }
  | { type: 'SET_HYDRATED' };

export const FINGERPRINT_FIELD = '__conversationFingerprint__';
// Threads carry their own fingerprint so a schema bump to the thread query
// doesn't invalidate the channel cache (and vice versa).
export const THREAD_FINGERPRINT_FIELD = '__threadFingerprint__';
export const THREAD_CONVERSATIONS_KEY = 'threadConversations';

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
        lastAccessedAt: Date.now(),
        accessCount: (existing?.accessCount ?? 0) + 1,
        estimatedSize: existing?.estimatedSize,
      };

      // Estimate size on first write or when data reference changes
      if (!existing || existing.data !== event.data) {
        try {
          entry.estimatedSize = JSON.stringify(event.data).length;
        } catch {
          entry.estimatedSize = 1000; // fallback 1KB
        }
      }

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
          const next = {
            ...context.channelConversations,
            [event.channelId]: capConversations(event.conversations),
          };
          // LRU cap: the cache is a warm-start hint, not a source of truth.
          // Without a bound it grows with every channel ever opened (and the
          // persistence layer clones all of it). Object key order is
          // insertion order for string keys, so deleting + re-adding the
          // current channel keeps "least recently SET" at the front.
          const capped = next[event.channelId]!;
          delete next[event.channelId];
          next[event.channelId] = capped;
          const keys = Object.keys(next);
          for (let i = 0; i < keys.length - MAX_CACHED_CHANNELS; i++) {
            delete next[keys[i]!];
          }
          return next;
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
        // Cap here too: background channels receive MERGE_CONVERSATION per
        // incoming message and could otherwise grow unboundedly over a long
        // session without ever being re-SET.
        return { ...context.channelConversations, [channelId]: capConversations(updated) };
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
    setThreadConversation: assign({
      threadConversations: ({ context, event }) => {
        if (event.type !== "SET_THREAD_CONVERSATION")
          return context.threadConversations;
        const next = {
          ...context.threadConversations,
          [event.conversationId]: event.conversation,
        };
        // Same LRU trick as channels: string-key insertion order lets us
        // treat the head of Object.keys as least-recently-set.
        delete next[event.conversationId];
        next[event.conversationId] = event.conversation;
        const keys = Object.keys(next);
        for (let i = 0; i < keys.length - MAX_CACHED_THREADS; i++) {
          delete next[keys[i]!];
        }
        return next;
      },
    }),
    hydrateThreadConversations: assign(({ event, context }) => {
      if (event.type !== "HYDRATE_THREAD_CONVERSATIONS") return context;
      return {
        ...context,
        threadConversations: { ...event.threadConversationsData },
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
        return { calls, hasMore: event.hasMore };
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

        // Cursor the page was fetched with. `null` = first page; `undefined`
        // (legacy callers without `start`/`isFirstPage`) = upsert-only merge.
        const start = event.start !== undefined ? event.start : event.isFirstPage ? null : undefined;

        if (start !== undefined) {
          // Range-based eviction: a synced page is the authoritative source for
          // the key range it covers — (start, oldestInPage] in (startedAt desc,
          // id desc) order, unbounded above when start is null (first page) and
          // unbounded below when the page is short (end of list reached).
          // Accumulated entries inside that range that the query no longer
          // returns were deleted since the last sync (Zero drives the removal).
          // Range- (not id-diff-) based so a moving window that jumps between
          // ranges never evicts rows that merely fell outside the new window.
          const oldestInPage = event.page[event.page.length - 1];
          const pageIds = new Set(event.page.map(r => r.id));
          const reachedEnd = !event.hasMore;
          for (const [id, rec] of map) {
            const afterStart =
              start === null ||
              rec.startedAt < start.startedAt ||
              (rec.startedAt === start.startedAt && rec.id < start.id);
            const beforeOrAtOldest =
              reachedEnd ||
              (oldestInPage !== undefined &&
                (rec.startedAt > oldestInPage.startedAt ||
                  (rec.startedAt === oldestInPage.startedAt && rec.id >= oldestInPage.id)));
            if (afterStart && beforeOrAtOldest && !pageIds.has(id)) {
              map.delete(id);
            }
          }
        }

        for (const rec of event.page) map.set(rec.id, rec);

        const recordings = [...map.values()].sort(
          (a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id),
        );

        const hasMore =
          start === null
            ? event.hasMore
            : !event.hasMore
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
    threadConversations: {},
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
    SET_THREAD_CONVERSATION: {
      actions: "setThreadConversation",
    },
    HYDRATE_THREAD_CONVERSATIONS: {
      actions: "hydrateThreadConversations",
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

// LRU bound for per-channel conversation caches (warm-start data only).
const MAX_CACHED_CHANNELS = 50;
// Threads are much larger per entry (whole message list inline), so keep the
// bound tighter.
const MAX_CACHED_THREADS = 30;

/* -------------------------- STORAGE REF -------------------------- */

let _storageAdapter: StorageAdapter | null = null;

export function setStorageAdapter(storage: StorageAdapter): void {
  _storageAdapter = storage;
}

export function getStorageAdapter(): StorageAdapter | null {
  return _storageAdapter;
}

export async function loadCacheEntryFromStorage(hash: string): Promise<CacheEntry<unknown> | null> {
  if (!_storageAdapter) return null;
  try {
    const value = await _storageAdapter.loadContextProperty(hash);
    if (!value || value === null) return null;
    return value as CacheEntry<unknown>;
  } catch {
    return null;
  }
}

/* -------------------------- LRU EVICTION -------------------------- */

const EVICTION_MAX_ENTRIES = 300;
const EVICTION_RECENCY_PROTECT_MS = 60 * 60 * 1000; // 1 hour
const EVICTION_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const ACCESS_COUNT_DECAY_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Evict cache entries that exceed the max entry limit.
 * Skips entries accessed within the last hour.
 * Among eligible entries, evicts the one with highest estimatedSize / (1 + accessCount).
 */
function runEviction(): void {
  const { cache } = queryCacheActor.getSnapshot().context;
  if (cache.size <= EVICTION_MAX_ENTRIES) return;

  const now = Date.now();
  let worstKey: string | null = null;
  let worstScore = -1;

  for (const [key, entry] of cache) {
    const lastAccessed = entry.lastAccessedAt ?? 0;
    if (now - lastAccessed < EVICTION_RECENCY_PROTECT_MS) continue;

    const size = entry.estimatedSize ?? 1000;
    const accesses = entry.accessCount ?? 1;
    const score = size / (1 + accesses);

    if (score > worstScore) {
      worstScore = score;
      worstKey = key;
    }
  }

  if (worstKey) {
    const newCache = new Map(cache);
    newCache.delete(worstKey);
    queryCacheActor.send({ type: 'HYDRATE_CACHE', cacheData: Object.fromEntries(newCache) });
  }
}

/**
 * Decay access counts so old frequency doesn't dominate forever.
 * Halves all accessCount values.
 */
function decayAccessCounts(): void {
  const { cache } = queryCacheActor.getSnapshot().context;
  let hasChanges = false;

  for (const entry of cache.values()) {
    if (entry.accessCount && entry.accessCount > 1) {
      entry.accessCount = Math.floor(entry.accessCount / 2);
      hasChanges = true;
    }
  }

  if (hasChanges) {
    // Mutation is fine here — the Map entries are objects, and XState
    // subscribers won't re-fire since we're not changing the Map reference.
    // The decayed counts will be picked up on next eviction check.
  }
}

// Start eviction and decay timers
if (typeof setInterval !== 'undefined') {
  setInterval(runEviction, EVICTION_CHECK_INTERVAL_MS);
  setInterval(decayAccessCounts, ACCESS_COUNT_DECAY_INTERVAL_MS);
}

// Per-channel bound. Warm-start only ever renders a ~100-item window, so
// caching more than this per channel is pure memory + persistence-clone cost.
const MAX_CONVERSATIONS_PER_CHANNEL = 200;

/** Keep the newest N conversations by createdAt (input order preserved otherwise). */
const capConversations = (conversations: Conversation[]): Conversation[] => {
  if (conversations.length <= MAX_CONVERSATIONS_PER_CHANNEL) return conversations;
  return [...conversations]
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-MAX_CONVERSATIONS_PER_CHANNEL);
};

// Debounce function for persistence
let persistTimeout: ReturnType<typeof setTimeout> | null = null;
// 2s: persistence is a crash-recovery cache, not a source of truth — there is
// no UX benefit to flushing faster, and each flush structured-clones data into
// IndexedDB on the main thread (measured ~450ms long tasks at 500ms).
const PERSIST_DEBOUNCE_MS = 2000;

// References persisted in the previous flush, used to skip unchanged entries.
// The machine's reducers replace values immutably, so reference equality is a
// valid "unchanged" check. Before dirty-tracking, EVERY cache key was re-`put`
// into IndexedDB on EVERY flush — profiled at ~660ms of main-thread time for
// four channel opens.
const lastPersistedRefs = new Map<string, unknown>();

// Schedule work off the critical path when the platform supports it
// (requestIdleCallback exists in browsers; guarded for React Native).
const runWhenIdle = (fn: () => void): void => {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void })
    .requestIdleCallback;
  if (typeof ric === 'function') {
    ric(fn, { timeout: 2000 });
  } else {
    fn();
  }
};

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
 * Get the AST-based hash for the threadConversation query.
 * This hash changes automatically when the query structure changes.
 * Uses dummy args since the query shape does not depend on runtime arg values.
 */
export const getThreadConversationQueryHash = (context: {
  userID: string;
}): string => {
  try {
    const query = queries.threadConversationV2.fn({
      args: { conversationId: "__dummy__" },
      ctx: context as Context,
    });
    // @ts-expect-error - hash() is part of QueryImpl, not public Query interface
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    return query.hash() as string;
  } catch {
    return "";
  }
};

/**
 * Get the AST-based hash for the userCallHistory query.
 * This hash changes automatically when the query structure changes.
 * Uses dummy args since the query shape does not depend on runtime arg values.
 */
export const getCallHistoryQueryHash = (): string => {
  try {
    const query = queries.userCallHistoryV2.fn({
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

// Set by setupQueryCachePersistence; lets flushQueryCachePersistence run the
// persist body immediately (e.g. on pagehide, where debounce + idle callbacks
// would never fire before the page dies).
let persistNow: (() => void) | null = null;

const lastPersistedChannelRefs = new Map<string, unknown>();
const lastPersistedThreadRefs = new Map<string, unknown>();

type PendingEntityOperation = {
  token: symbol;
  remove: boolean;
  value?: unknown;
  fingerprint?: string;
};

type EntityOperationRefs = Map<string, unknown>;
type EntityOperationState = Map<string, PendingEntityOperation>;
type EntityOperationChains = Map<string, Promise<void>>;

const pendingChannelOperations: EntityOperationState = new Map();
const pendingThreadOperations: EntityOperationState = new Map();
const channelOperationChains: EntityOperationChains = new Map();
const threadOperationChains: EntityOperationChains = new Map();

// Incrementing this prevents a delayed flush from an old user/workspace
// session from writing into the storage scope established by a later setup.
let chatPersistenceGeneration = 0;

const hasChatEntityStorage = (storage: StorageAdapter): boolean =>
  Boolean(storage.loadChatEntities && storage.writeChatEntity && storage.removeChatEntity);

const queueChatEntityOperation = (
  storage: StorageAdapter,
  kind: ChatCacheEntityKind,
  id: string,
  operation: Omit<PendingEntityOperation, 'token'>,
  persistedRefs: EntityOperationRefs,
  pendingOperations: EntityOperationState,
  operationChains: EntityOperationChains,
  generation: number,
): void => {
  const previous = pendingOperations.get(id);
  if (
    previous &&
    previous.remove === operation.remove &&
    (operation.remove ||
      (previous.value === operation.value && previous.fingerprint === operation.fingerprint))
  ) {
    return;
  }

  const token = Symbol(`${kind}:${id}`);
  const current: PendingEntityOperation = { ...operation, token };
  pendingOperations.set(id, current);
  const priorChain = operationChains.get(id) ?? Promise.resolve();
  const markSucceeded = (): void => {
    if (generation !== chatPersistenceGeneration) return;
    // Track the last acknowledged disk value even when a newer operation is
    // already queued. This preserves deletion intent when that newer removal
    // fails and allows the next flush to retry it.
    if (current.remove) persistedRefs.delete(id);
    else persistedRefs.set(id, current.value);
    if (pendingOperations.get(id)?.token === token) pendingOperations.delete(id);
  };
  const markFailed = (): void => {
    if (generation !== chatPersistenceGeneration) return;
    // A failed operation remains dirty because the acknowledged ref is not
    // advanced; the next flush will queue it again.
    if (pendingOperations.get(id)?.token === token) pendingOperations.delete(id);
  };
  const execute = (): void | Promise<void> => {
    // Keep this check immediately adjacent to the adapter call. In particular,
    // do not insert Promise.resolve().then() here: mobile's MMKV adapter is
    // synchronous and flushQueryCachePersistence must write before lifecycle
    // code can disable the outgoing storage scope.
    if (generation !== chatPersistenceGeneration) return;
    try {
      const result = current.remove
        ? storage.removeChatEntity!(kind, id)
        : storage.writeChatEntity!(kind, id, current.value, current.fingerprint ?? '');
      return Promise.resolve(result).then(markSucceeded, markFailed);
    } catch {
      markFailed();
    }
  };

  const nextChain = operationChains.has(id)
    ? priorChain.catch(() => {}).then(execute)
    : Promise.resolve(execute());

  operationChains.set(id, nextChain);
  void nextChain.finally(() => {
    if (operationChains.get(id) === nextChain) operationChains.delete(id);
  });
};

/**
 * Write each changed chat window as its own record, and delete records for
 * windows the cache dropped. Successful refs are tracked only after the
 * adapter operation completes; this makes a failed native write retryable.
 */
function persistChatEntities(
  storage: StorageAdapter,
  kind: ChatCacheEntityKind,
  entries: Record<string, unknown>,
  fingerprint: string,
  persistedRefs: EntityOperationRefs,
  pendingOperations: EntityOperationState,
  operationChains: EntityOperationChains,
  generation: number,
): boolean {
  if (!hasChatEntityStorage(storage)) return false;

  for (const [id, value] of Object.entries(entries)) {
    const pending = pendingOperations.get(id);
    if (
      !pending &&
      persistedRefs.get(id) === value
    ) {
      continue;
    }
    if (
      pending &&
      !pending.remove &&
      pending.value === value &&
      pending.fingerprint === fingerprint
    ) {
      continue;
    }
    queueChatEntityOperation(
      storage,
      kind,
      id,
      { remove: false, value, fingerprint },
      persistedRefs,
      pendingOperations,
      operationChains,
      generation,
    );
  }
  for (const id of [...persistedRefs.keys()]) {
    if (id in entries) continue;
    queueChatEntityOperation(
      storage,
      kind,
      id,
      { remove: true },
      persistedRefs,
      pendingOperations,
      operationChains,
      generation,
    );
  }
  for (const [id, pending] of pendingOperations) {
    if (id in entries || pending.remove) continue;
    queueChatEntityOperation(
      storage,
      kind,
      id,
      { remove: true },
      persistedRefs,
      pendingOperations,
      operationChains,
      generation,
    );
  }
  return true;
}

/**
 * Setup persistence middleware for query cache.
 * Accepts a StorageAdapter for platform-agnostic persistence.
 */
export const setupQueryCachePersistence = (
  storage: StorageAdapter,
  userId: string,
  schemaVersion: string,
): void => {
  setStorageAdapter(storage);
  const generation = ++chatPersistenceGeneration;
  lastPersistedRefs.clear();
  // Entity references belong to the storage scope this setup establishes, so a
  // previous user/workspace session must never suppress writes in a new one.
  lastPersistedChannelRefs.clear();
  lastPersistedThreadRefs.clear();
  pendingChannelOperations.clear();
  pendingThreadOperations.clear();
  channelOperationChains.clear();
  threadOperationChains.clear();

  const doPersist = (): void => {
    if (generation !== chatPersistenceGeneration) return;

    // Read the LATEST snapshot at flush time (not the one that scheduled
    // the flush) so dirty-tracking compares against current state.
    const {
      cache,
      channelConversations,
      threadConversations,
      callHistory,
      recordings,
    } = queryCacheActor.getSnapshot().context;

    // Only persist cache entries whose reference changed since the
    // last flush. Each `put` structured-clones on the main thread, so
    // rewriting the entire cache per flush was the dominant cost.
    // The Map stores REFERENCES to objects the actor context already
    // holds (not copies), so marginal memory is key + pointer.
    cache.forEach((value, key) => {
      if (lastPersistedRefs.get(key) === value) return;
      lastPersistedRefs.set(key, value);
      storage.saveContextProperty(key, value).catch(() => {});
    });

    // Prune refs for keys no longer in the cache. Without this, a
    // ref to an EVICTED entry's value would pin it against GC and
    // the Map would accumulate dead keys.
    for (const key of lastPersistedRefs.keys()) {
      if (
        !cache.has(key) &&
        key !== 'channelConversations' &&
        key !== THREAD_CONVERSATIONS_KEY &&
        key !== CALL_HISTORY_KEY &&
        key !== RECORDINGS_KEY
      ) {
        lastPersistedRefs.delete(key);
      }
    }

    const conversationHash = getChannelConversationsQueryHash({ userID: userId });
    if (hasChatEntityStorage(storage)) {
      persistChatEntities(
        storage,
        'channel',
        channelConversations,
        conversationHash,
        lastPersistedChannelRefs,
        pendingChannelOperations,
        channelOperationChains,
        generation,
      );
      lastPersistedRefs.set('channelConversations', channelConversations);
    } else if (lastPersistedRefs.get('channelConversations') !== channelConversations) {
      lastPersistedRefs.set('channelConversations', channelConversations);
      const payload: Record<string, unknown> = {
        ...channelConversations,
        [FINGERPRINT_FIELD]: conversationHash,
      };

      storage.saveContextProperty('channelConversations', payload).catch(() => {});
    }

    const threadHash = getThreadConversationQueryHash({ userID: userId });
    if (hasChatEntityStorage(storage)) {
      persistChatEntities(
        storage,
        'thread',
        threadConversations,
        threadHash,
        lastPersistedThreadRefs,
        pendingThreadOperations,
        threadOperationChains,
        generation,
      );
      lastPersistedRefs.set(THREAD_CONVERSATIONS_KEY, threadConversations);
    } else if (lastPersistedRefs.get(THREAD_CONVERSATIONS_KEY) !== threadConversations) {
      lastPersistedRefs.set(THREAD_CONVERSATIONS_KEY, threadConversations);
      const threadPayload: Record<string, unknown> = {
        ...threadConversations,
        [THREAD_FINGERPRINT_FIELD]: threadHash,
      };

      storage.saveContextProperty(THREAD_CONVERSATIONS_KEY, threadPayload).catch(() => {});
    }

    if (lastPersistedRefs.get(CALL_HISTORY_KEY) !== callHistory) {
      lastPersistedRefs.set(CALL_HISTORY_KEY, callHistory);
      storage
        .saveContextProperty(CALL_HISTORY_KEY, {
          ...callHistory,
          [FINGERPRINT_FIELD]: getCallHistoryQueryHash(),
        })
        .catch(() => {});
    }

    if (lastPersistedRefs.get(RECORDINGS_KEY) !== recordings) {
      lastPersistedRefs.set(RECORDINGS_KEY, recordings);
      storage
        .saveContextProperty(RECORDINGS_KEY, {
          ...recordings,
          [FINGERPRINT_FIELD]: getRecordingsQueryHash(),
        })
        .catch(() => {});
    }
  };

  storage
    .init(userId, schemaVersion)
    .then(() => {
      if (generation !== chatPersistenceGeneration) return;
      persistNow = doPersist;
      queryCacheActor.subscribe(() => {
        if (persistTimeout) {
          clearTimeout(persistTimeout);
        }

        persistTimeout = setTimeout(() => {
          runWhenIdle(doPersist);
        }, PERSIST_DEBOUNCE_MS);
      });
    })
    .catch(() => {});
};

/**
 * Persist dirty cache state to storage IMMEDIATELY — no debounce, no idle
 * callback. Call from `pagehide` so the warm-start cache survives a refresh:
 * the IDB transaction kicked off here completes even as the page unloads,
 * whereas the debounced path would die with the page. No-op until
 * setupQueryCachePersistence's storage init has finished.
 */
export const flushQueryCachePersistence = (): void => {
  if (persistTimeout) {
    clearTimeout(persistTimeout);
    persistTimeout = null;
  }
  persistNow?.();
};

const capHydratedEntries = <T>(
  entries: Record<string, T>,
  preferredIds: Set<string>,
  maxEntries: number,
): Record<string, T> => {
  const allEntries = Object.entries(entries);
  const preferred = allEntries.filter(([id]) => preferredIds.has(id));
  const fallback = allEntries.filter(([id]) => !preferredIds.has(id));
  // Entity adapters return most-recent-first. The actor's object-key LRU is
  // oldest-first, so reverse the entity portion before hydration and retain
  // the newest legacy entries when the two sources are mixed.
  return Object.fromEntries([...fallback, ...preferred.reverse()].slice(-maxEntries));
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
  setStorageAdapter(storage);
  try {
    await storage.init(userId, schemaVersion);

    // Adapters with per-entity chat storage keep their windows outside the
    // context blob, so a session with only entities must still hydrate. A
    // failed entity read must not discard a usable legacy blob.
    let chatEntities: ChatCacheEntity[] = [];
    if (hasChatEntityStorage(storage)) {
      try {
        chatEntities = (await storage.loadChatEntities!()) ?? [];
      } catch {
        chatEntities = [];
      }
    }
    let context: Record<string, unknown> | null = null;
    try {
      context = await storage.loadContext();
    } catch {
      context = null;
    }

    if (!context && chatEntities.length === 0) {
      return false;
    }

    // Only hydrate special keys (conversations, threads, call history, recordings).
    // Generic cache entries are lazy-loaded from IndexedDB on demand via useCachedQuery.
    const conversationsData: Record<string, Conversation[]> = {};
    const threadConversationsData: Record<string, ThreadConversation> = {};
    const entityChannelIds = new Set<string>();
    const entityThreadIds = new Set<string>();
    let callHistoryHydrated = false;
    let recordingsHydrated = false;

    const currentConversationHash = getChannelConversationsQueryHash({ userID: userId });
    const currentThreadHash = getThreadConversationQueryHash({ userID: userId });

    for (const entity of chatEntities) {
      if (entity.kind !== 'channel' && entity.kind !== 'thread') continue;
      const expectedHash =
        entity.kind === 'channel' ? currentConversationHash : currentThreadHash;
      if (entity.fingerprint && entity.fingerprint !== expectedHash) continue;

      if (entity.kind === 'channel') {
        if (Array.isArray(entity.value)) {
          conversationsData[entity.id] = entity.value as Conversation[];
          entityChannelIds.add(entity.id);
        }
      } else if (entity.value && typeof entity.value === 'object' && !Array.isArray(entity.value)) {
        threadConversationsData[entity.id] = entity.value as ThreadConversation;
        entityThreadIds.add(entity.id);
      }
    }

    for (const [key, value] of Object.entries(context ?? {})) {
      if (key === 'channelConversations') {
        const raw = value as Record<string, unknown>;

        const storedHash = raw[FINGERPRINT_FIELD] as string | undefined;

        if (storedHash !== undefined && storedHash !== currentConversationHash) {
          continue;
        }

        // The blob is unbounded on disk; the actor is not. Keep the newest
        // entries so hydration can never exceed the in-memory LRU bound.
        const channelEntries = Object.entries(raw).filter(
          ([channelId, conversations]) =>
            channelId !== FINGERPRINT_FIELD &&
            Array.isArray(conversations) &&
            (conversations as unknown[]).length > 0,
        );
        for (const [channelId, conversations] of channelEntries.slice(-MAX_CACHED_CHANNELS)) {
          if (!Object.prototype.hasOwnProperty.call(conversationsData, channelId)) {
            conversationsData[channelId] = conversations as Conversation[];
          }
        }
      } else if (key === THREAD_CONVERSATIONS_KEY) {
        const raw = value as Record<string, unknown>;
        const storedHash = raw[THREAD_FINGERPRINT_FIELD] as string | undefined;
        if (storedHash !== undefined && storedHash !== currentThreadHash) {
          continue;
        }
        const threadEntries = Object.entries(raw).filter(
          ([conversationId, conversation]) =>
            conversationId !== THREAD_FINGERPRINT_FIELD &&
            conversation &&
            typeof conversation === 'object',
        );
        for (const [conversationId, conversation] of threadEntries.slice(-MAX_CACHED_THREADS)) {
          if (!Object.prototype.hasOwnProperty.call(threadConversationsData, conversationId)) {
            threadConversationsData[conversationId] = conversation as ThreadConversation;
          }
        }
      } else if (key === CALL_HISTORY_KEY) {
        const raw = value as CallHistoryState & { [FINGERPRINT_FIELD]?: string };

        const storedHash = raw[FINGERPRINT_FIELD];

        const currentCallHistoryHash = getCallHistoryQueryHash();

        if (storedHash !== undefined && storedHash !== currentCallHistoryHash) {
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
          continue;
        }

        queryCacheActor.send({
          type: 'HYDRATE_RECORDINGS',
          data: { recordings: raw.recordings, hasMore: raw.hasMore },
        });
        recordingsHydrated = true;
      }
      // Generic cache entries (else branch) are intentionally NOT hydrated.
      // They will be lazy-loaded from IndexedDB when useCachedQuery requests them.
    }

    const cappedConversationsData = capHydratedEntries(
      conversationsData,
      entityChannelIds,
      MAX_CACHED_CHANNELS,
    );
    const cappedThreadConversationsData = capHydratedEntries(
      threadConversationsData,
      entityThreadIds,
      MAX_CACHED_THREADS,
    );

    if (Object.keys(cappedConversationsData).length > 0) {
      queryCacheActor.send({
        type: 'HYDRATE_CONVERSATIONS',
        conversationsData: cappedConversationsData,
      });
    }

    if (Object.keys(cappedThreadConversationsData).length > 0) {
      queryCacheActor.send({
        type: "HYDRATE_THREAD_CONVERSATIONS",
        threadConversationsData: cappedThreadConversationsData,
      });
    }

    return (
      Object.keys(cappedConversationsData).length > 0 ||
      Object.keys(cappedThreadConversationsData).length > 0 ||
      callHistoryHydrated ||
      recordingsHydrated
    );
  } catch {
    return false;
  }
};
