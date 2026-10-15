import type { StorageAdapter } from '@xyne/shared/platform';
import type { ChatCacheEntity, ChatCacheEntityKind } from './chatCacheTypes';
import {
  FINGERPRINT_FIELD,
  getChannelConversationsQueryHash,
  getThreadConversationQueryHash,
  THREAD_FINGERPRINT_FIELD,
} from '@xyne/shared/machines';

import { lotusStorage } from './localStorage';
import { getActiveWorkspaceId } from '@/src/utils/activeWorkspace';
import { registerPersistedChatWindowReader } from '@/src/features/chat/navigation/restorePersistedChatWindow';
import { containsChatWindowTarget } from '@/src/features/chat/navigation/chatWindowContainment';

const DB_PREFIX = 'xyne-state-machine';
const SCHEMA_VERSION_KEY = '_schemaVersion';

// Global (non-user-scoped) keys for background notification access
const GLOBAL_KEY_PREFIX = 'xyne-global';
const GLOBAL_USER_ID_KEY = `${GLOBAL_KEY_PREFIX}:userId`;
const GLOBAL_SCHEMA_VERSION_KEY = `${GLOBAL_KEY_PREFIX}:schemaVersion`;
const GLOBAL_WORKSPACE_ID_KEY = `${GLOBAL_KEY_PREFIX}:workspaceId`;
// Legacy App Group token key. New writes use platform-protected native
// handoff storage; this key is retained only for one-time cleanup of old
// installations.
const LEGACY_GLOBAL_AUTH_TOKEN_KEY = `${GLOBAL_KEY_PREFIX}:authToken`;
const WARM_CACHE_DIRTY_KEY = `${GLOBAL_KEY_PREFIX}:warmCacheDirty`;
const QUERY_CACHE_RESUME_WRITE_DELAY_MS = 2000;
const CHANNEL_CONVERSATIONS_KEY = 'channelConversations';
const THREAD_CONVERSATIONS_KEY = 'threadConversations';
const CHAT_CACHE_INDEX_KEY = 'chatCacheIndex';
const CHAT_CACHE_MIGRATION_KEY = 'chatCacheEntityVersion';
const MAX_DISK_CHANNELS = 100;
const MAX_DISK_THREADS = 50;
const MAX_DISK_CHANNEL_ROWS = 200;

const sortChannelRows = (rows: unknown[]): unknown[] =>
  [...rows].sort((left, right) => {
    const leftRecord =
      left && typeof left === 'object'
        ? (left as { createdAt?: unknown; conversationId?: unknown })
        : {};
    const rightRecord =
      right && typeof right === 'object'
        ? (right as { createdAt?: unknown; conversationId?: unknown })
        : {};
    const leftCreatedAt =
      typeof leftRecord.createdAt === 'number' && Number.isFinite(leftRecord.createdAt)
        ? leftRecord.createdAt
        : 0;
    const rightCreatedAt =
      typeof rightRecord.createdAt === 'number' && Number.isFinite(rightRecord.createdAt)
        ? rightRecord.createdAt
        : 0;
    return (
      leftCreatedAt - rightCreatedAt ||
      String(leftRecord.conversationId ?? '').localeCompare(
        String(rightRecord.conversationId ?? ''),
      )
    );
  });

const normalizeChatEntityValue = (kind: ChatCacheEntityKind, value: unknown): unknown =>
  kind === 'channel' && Array.isArray(value) ? sortChannelRows(value) : value;

/**
 * Whether a cached chat entity already holds the exact message a notification
 * points at. Re-exported from the shared containment module so notification
 * warm-up, persisted-source selection, and this reader can never drift apart.
 */
export const containsNotificationTarget = containsChatWindowTarget;

type ChatCacheIndexEntry = {
  kind: ChatCacheEntityKind;
  id: string;
  lastAccessedAt: number;
  fingerprint: string;
  serializedCharacterCount: number;
};

export type ChatCacheStats = {
  channelCount: number;
  threadCount: number;
  serializedCharacterCount: number;
};

class MmkvStorageService implements StorageAdapter {
  private currentUserId: string | null = null;
  private currentWorkspaceId: string | null = null;
  private currentSchemaVersion: string | null = null;
  private initialized = false;
  private queryCacheWritesEnabled = true;
  private pendingQueryCacheWrites = new Map<string, string>();
  private pendingQueryCacheRemovals = new Set<string>();
  private pendingQueryCacheFlushTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Query-cache data is only a warm-start hint. Do not start an MMKV write
   * while iOS is transitioning the app to suspension, where a shared-store
   * lock can cause a 0xdead10cc termination.
   */
  setQueryCacheWritesEnabled(enabled: boolean): void {
    this.queryCacheWritesEnabled = enabled;
    if (!enabled) {
      if (this.pendingQueryCacheFlushTimer) {
        clearTimeout(this.pendingQueryCacheFlushTimer);
        this.pendingQueryCacheFlushTimer = null;
      }
      return;
    }

    if (this.initialized) {
      this.migrateLegacyChatBlobs();
    }
    this.schedulePendingQueryCacheWrites();
  }

  private schedulePendingQueryCacheWrites(): void {
    if (
      !this.initialized ||
      !this.queryCacheWritesEnabled ||
      (this.pendingQueryCacheWrites.size === 0 && this.pendingQueryCacheRemovals.size === 0) ||
      this.pendingQueryCacheFlushTimer
    ) {
      return;
    }

    this.pendingQueryCacheFlushTimer = setTimeout(() => {
      this.pendingQueryCacheFlushTimer = null;
      if (!this.queryCacheWritesEnabled) {
        return;
      }
      this.flushPendingQueryCacheChanges();
    }, QUERY_CACHE_RESUME_WRITE_DELAY_MS);
  }

  private persistQueryCacheValue(key: string, value: string): void {
    if (!this.initialized) return;
    this.pendingQueryCacheRemovals.delete(key);
    if (!this.queryCacheWritesEnabled) {
      this.pendingQueryCacheWrites.set(key, value);
      this.schedulePendingQueryCacheWrites();
      return;
    }
    this.pendingQueryCacheWrites.delete(key);
    lotusStorage.set(key, value);
  }

  private removeQueryCacheValue(key: string): void {
    if (!this.initialized) return;
    this.pendingQueryCacheWrites.delete(key);
    if (!this.queryCacheWritesEnabled) {
      this.pendingQueryCacheRemovals.add(key);
      this.schedulePendingQueryCacheWrites();
      return;
    }
    lotusStorage.remove(key);
  }

  private parseChatCacheIndex(raw: string | undefined): ChatCacheIndexEntry[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter(
            (entry): entry is ChatCacheIndexEntry =>
              Boolean(entry) &&
              typeof entry === 'object' &&
              ((entry as ChatCacheIndexEntry).kind === 'channel' ||
                (entry as ChatCacheIndexEntry).kind === 'thread') &&
              typeof (entry as ChatCacheIndexEntry).id === 'string' &&
              typeof (entry as ChatCacheIndexEntry).lastAccessedAt === 'number' &&
              typeof (entry as ChatCacheIndexEntry).fingerprint === 'string' &&
              typeof (entry as ChatCacheIndexEntry).serializedCharacterCount === 'number',
          )
        : [];
    } catch {
      return [];
    }
  }

  /**
   * A background notification may update the same index while a foreground
   * write is queued. Merge the queued snapshot with the latest disk snapshot
   * so the flush cannot discard the background entity.
   */
  private mergeChatCacheIndexValue(
    key: string,
    value: string,
    removedKeys: ReadonlySet<string>,
  ): string {
    if (!key.endsWith(`:${CHAT_CACHE_INDEX_KEY}`)) return value;

    const pendingEntries = this.parseChatCacheIndex(value);
    const persistedEntries = this.parseChatCacheIndex(lotusStorage.getString(key));
    const merged = new Map<string, ChatCacheIndexEntry>();
    const indexPrefix = key.slice(0, -CHAT_CACHE_INDEX_KEY.length);
    for (const entry of [...persistedEntries, ...pendingEntries]) {
      const entityStorageKey = `${indexPrefix}${entry.kind === 'channel' ? 'chan' : 'thread'}:${entry.id}`;
      if (removedKeys.has(entityStorageKey)) continue;
      const entryKey = `${entry.kind}:${entry.id}`;
      const current = merged.get(entryKey);
      // Persisted entries are iterated first. On an equal millisecond stamp,
      // keep the headless/persisted entry rather than letting a queued stale
      // foreground snapshot win the tie.
      if (!current || entry.lastAccessedAt > current.lastAccessedAt) {
        merged.set(entryKey, entry);
      }
    }

    const entries = [...merged.values()];
    for (const kind of ['channel', 'thread'] as const) {
      const max = kind === 'channel' ? MAX_DISK_CHANNELS : MAX_DISK_THREADS;
      const keep = new Set(
        entries
          .filter(entry => entry.kind === kind)
          .sort((left, right) => right.lastAccessedAt - left.lastAccessedAt)
          .slice(0, max)
          .map(entry => `${entry.kind}:${entry.id}`),
      );
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        if (entry?.kind === kind && !keep.has(`${entry.kind}:${entry.id}`)) {
          lotusStorage.remove(
            `${indexPrefix}${entry.kind === 'channel' ? 'chan' : 'thread'}:${entry.id}`,
          );
          entries.splice(index, 1);
        }
      }
    }
    return JSON.stringify(entries);
  }

  private flushPendingQueryCacheWriteValues(removedKeys: ReadonlySet<string>): void {
    const indexKey = this.scopedKey(CHAT_CACHE_INDEX_KEY);
    const pendingIndexRaw = this.pendingQueryCacheWrites.get(indexKey);
    const persistedIndex = this.parseChatCacheIndex(lotusStorage.getString(indexKey));
    const pendingIndex = this.parseChatCacheIndex(pendingIndexRaw);
    const persistedByEntity = new Map<string, ChatCacheIndexEntry>(
      persistedIndex.map(entry => [`${entry.kind}:${entry.id}`, entry] as const),
    );
    const pendingByEntity = new Map<string, ChatCacheIndexEntry>(
      pendingIndex.map(entry => [`${entry.kind}:${entry.id}`, entry] as const),
    );

    for (const [key, value] of this.pendingQueryCacheWrites) {
      if (key === indexKey) continue;

      const channelPrefix = `${this.getKeyPrefix()}:chan:`;
      const threadPrefix = `${this.getKeyPrefix()}:thread:`;
      const kind = key.startsWith(channelPrefix)
        ? 'channel'
        : key.startsWith(threadPrefix)
          ? 'thread'
          : null;
      const id = kind
        ? key.slice((kind === 'channel' ? channelPrefix : threadPrefix).length)
        : null;
      if (kind && id) {
        const entityKey = `${kind}:${id}`;
        const persistedEntry = persistedByEntity.get(entityKey);
        const pendingEntry = pendingByEntity.get(entityKey);
        // A headless notification can update this entity while foreground
        // writes are paused. Never replace that newer payload with the queued
        // pre-background snapshot.
        if (
          persistedEntry &&
          pendingEntry &&
          persistedEntry.lastAccessedAt >= pendingEntry.lastAccessedAt
        ) {
          continue;
        }
      }
      lotusStorage.set(key, value);
    }

    if (pendingIndexRaw !== undefined) {
      lotusStorage.set(
        indexKey,
        this.mergeChatCacheIndexValue(indexKey, pendingIndexRaw, removedKeys),
      );
    }
    this.pendingQueryCacheWrites.clear();
  }

  private flushPendingQueryCacheChanges(): void {
    const removedKeys = new Set(this.pendingQueryCacheRemovals);
    for (const key of removedKeys) lotusStorage.remove(key);
    this.pendingQueryCacheRemovals.clear();
    this.flushPendingQueryCacheWriteValues(removedKeys);
  }

  private readQueryCacheValue(key: string): string | undefined {
    if (this.pendingQueryCacheRemovals.has(key)) return undefined;
    return this.pendingQueryCacheWrites.get(key) ?? lotusStorage.getString(key);
  }

  private getKeyPrefix(): string {
    const scopedUserId = this.currentWorkspaceId
      ? `${this.currentUserId}:${this.currentWorkspaceId}`
      : this.currentUserId;
    return `${DB_PREFIX}-${scopedUserId}`;
  }

  private getRawKeyPrefix(
    userId: string,
    workspaceId: string | null = getActiveWorkspaceId(),
  ): string {
    const scopedUserId = workspaceId ? `${userId}:${workspaceId}` : userId;
    return `${DB_PREFIX}-${scopedUserId}`;
  }

  private scopedKey(key: string): string {
    return `${this.getKeyPrefix()}:${key}`;
  }

  private chatEntityKey(kind: ChatCacheEntityKind, id: string): string {
    return this.scopedKey(`${kind === 'channel' ? 'chan' : 'thread'}:${id}`);
  }

  private readChatCacheIndex(): ChatCacheIndexEntry[] {
    const raw = this.readQueryCacheValue(this.scopedKey(CHAT_CACHE_INDEX_KEY));
    return this.parseChatCacheIndex(raw);
  }

  private writeChatCacheIndex(entries: ChatCacheIndexEntry[]): void {
    this.persistQueryCacheValue(this.scopedKey(CHAT_CACHE_INDEX_KEY), JSON.stringify(entries));
  }

  private updateChatCacheIndex(
    kind: ChatCacheEntityKind,
    id: string,
    fingerprint: string,
    serializedCharacterCount: number,
  ): void {
    const entries = this.readChatCacheIndex().filter(
      entry => !(entry.kind === kind && entry.id === id),
    );
    entries.push({ kind, id, lastAccessedAt: Date.now(), fingerprint, serializedCharacterCount });
    const max = kind === 'channel' ? MAX_DISK_CHANNELS : MAX_DISK_THREADS;
    const sameKind = entries.filter(entry => entry.kind === kind);
    sameKind.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
    for (const entry of sameKind.slice(0, Math.max(0, sameKind.length - max))) {
      this.removeQueryCacheValue(this.chatEntityKey(entry.kind, entry.id));
      const index = entries.findIndex(
        candidate => candidate.kind === entry.kind && candidate.id === entry.id,
      );
      if (index >= 0) entries.splice(index, 1);
    }
    this.writeChatCacheIndex(entries);
  }

  async init(userId: string, schemaVersion: string): Promise<void> {
    const workspaceId = getActiveWorkspaceId();
    if (
      this.initialized &&
      this.currentUserId === userId &&
      this.currentWorkspaceId === workspaceId &&
      this.currentSchemaVersion === schemaVersion
    ) {
      return;
    }

    if (
      this.initialized &&
      (this.currentUserId !== userId ||
        this.currentWorkspaceId !== workspaceId ||
        this.currentSchemaVersion !== schemaVersion)
    ) {
      this.close();
    }

    this.currentUserId = userId;
    this.currentWorkspaceId = workspaceId;
    this.currentSchemaVersion = schemaVersion;

    if (lotusStorage.getString(this.scopedKey(SCHEMA_VERSION_KEY)) === undefined) {
      lotusStorage.set(this.scopedKey(SCHEMA_VERSION_KEY), schemaVersion);
    }

    this.initialized = true;
    if (this.queryCacheWritesEnabled) {
      this.migrateLegacyChatBlobs();
    }
  }

  private migrateLegacyChatBlobs(): void {
    if (lotusStorage.getString(this.scopedKey(CHAT_CACHE_MIGRATION_KEY)) === '1') return;
    try {
      const channelBlob = this.loadContextPropertySync(CHANNEL_CONVERSATIONS_KEY) as Record<
        string,
        unknown
      > | null;
      if (channelBlob) {
        const fingerprint =
          typeof channelBlob[FINGERPRINT_FIELD] === 'string'
            ? (channelBlob[FINGERPRINT_FIELD] as string)
            : getChannelConversationsQueryHash({ userID: this.currentUserId! });
        for (const [id, rows] of Object.entries(channelBlob)) {
          if (id === FINGERPRINT_FIELD || !Array.isArray(rows) || rows.length === 0) continue;
          this.writeChatEntity('channel', id, rows, fingerprint);
        }
      }
      const threadBlob = this.loadContextPropertySync(THREAD_CONVERSATIONS_KEY) as Record<
        string,
        unknown
      > | null;
      if (threadBlob) {
        const fingerprint =
          typeof threadBlob[THREAD_FINGERPRINT_FIELD] === 'string'
            ? (threadBlob[THREAD_FINGERPRINT_FIELD] as string)
            : getThreadConversationQueryHash({ userID: this.currentUserId! });
        for (const [id, value] of Object.entries(threadBlob)) {
          if (id === THREAD_FINGERPRINT_FIELD || !value || typeof value !== 'object') continue;
          this.writeChatEntity('thread', id, value, fingerprint);
        }
      }
      lotusStorage.remove(this.scopedKey(CHANNEL_CONVERSATIONS_KEY));
      lotusStorage.remove(this.scopedKey(THREAD_CONVERSATIONS_KEY));
      lotusStorage.set(this.scopedKey(CHAT_CACHE_MIGRATION_KEY), '1');
    } catch {
      // Chat cache is reconstructible; leave legacy blobs intact for a later retry.
    }
  }

  async saveContextProperty(key: string, value: unknown): Promise<void> {
    if (!this.initialized) {
      throw new Error('MMKV storage adapter not initialized. Call init() first.');
    }
    this.persistQueryCacheValue(this.scopedKey(key), JSON.stringify(value));
  }

  async loadContextProperty(key: string): Promise<unknown> {
    if (!this.initialized) {
      throw new Error('MMKV storage adapter not initialized. Call init() first.');
    }

    const value = lotusStorage.getString(this.scopedKey(key));
    if (value === undefined) {
      return null;
    }

    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  loadContextPropertySync(key: string): unknown {
    if (!this.initialized) {
      const globalContext = this.getGlobalUserContext();
      const userId = this.currentUserId ?? globalContext.userId;
      if (!userId) return null;
      const workspaceId = getActiveWorkspaceId() ?? globalContext.workspaceId;
      const rawKey = `${this.getRawKeyPrefix(userId, workspaceId)}:${key}`;
      const raw = lotusStorage.getString(rawKey);
      if (raw === undefined) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
    const value = lotusStorage.getString(this.scopedKey(key));
    if (value === undefined) {
      return null;
    }
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  /**
   * Versions for the synchronous warm reader. These are read from the same
   * scoped keys as query-cache migration, including during cold startup when
   * the adapter has not been initialized yet.
   */
  getChatCacheSchemaSnapshot(): {
    schemaVersion: string | null;
    entityVersion: string | null;
  } {
    const asString = (value: unknown): string | null => {
      if (typeof value === 'string') return value;
      if (typeof value === 'number' && Number.isFinite(value)) return String(value);
      return null;
    };
    return {
      schemaVersion: asString(this.loadContextPropertySync(SCHEMA_VERSION_KEY)),
      entityVersion: asString(this.loadContextPropertySync(CHAT_CACHE_MIGRATION_KEY)),
    };
  }

  setWarmCacheDirty(): void {
    lotusStorage.set(WARM_CACHE_DIRTY_KEY, '1');
  }

  consumeWarmCacheDirty(): boolean {
    const value = lotusStorage.getString(WARM_CACHE_DIRTY_KEY);
    if (value) {
      lotusStorage.remove(WARM_CACHE_DIRTY_KEY);
      return true;
    }
    return false;
  }

  async saveContext(context: Record<string, unknown>): Promise<void> {
    if (!this.initialized) {
      throw new Error('MMKV storage adapter not initialized. Call init() first.');
    }
    this.persistQueryCacheValue(this.scopedKey('_timestamp'), JSON.stringify(Date.now()));
    for (const [key, value] of Object.entries(context)) {
      this.persistQueryCacheValue(this.scopedKey(key), JSON.stringify(value));
    }
  }

  async loadContext(): Promise<Record<string, unknown> | null> {
    if (!this.initialized) {
      throw new Error('MMKV storage adapter not initialized. Call init() first.');
    }

    const prefix = `${this.getKeyPrefix()}:`;
    const context: Record<string, unknown> = {};

    for (const fullKey of lotusStorage.getAllKeys()) {
      if (
        !fullKey.startsWith(prefix) ||
        fullKey.endsWith(`:${SCHEMA_VERSION_KEY}`) ||
        fullKey.endsWith(':_timestamp')
      ) {
        continue;
      }

      const key = fullKey.replace(prefix, '');
      if (
        key.startsWith('_') ||
        key.startsWith('chan:') ||
        key.startsWith('thread:') ||
        key === CHAT_CACHE_INDEX_KEY ||
        key === CHAT_CACHE_MIGRATION_KEY
      ) {
        continue;
      }

      const value = lotusStorage.getString(fullKey);
      if (value === undefined) {
        continue;
      }

      try {
        context[key] = JSON.parse(value);
      } catch {
        context[key] = value;
      }
    }

    return Object.keys(context).length === 0 ? null : context;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Explicit diagnostic only. Reads the bounded index, never scans MMKV keys
   * or values, and reports serialized character counts rather than bytes.
   */
  getChatCacheStats(): ChatCacheStats {
    if (!this.initialized) {
      return { channelCount: 0, threadCount: 0, serializedCharacterCount: 0 };
    }

    return this.readChatCacheIndex().reduce<ChatCacheStats>(
      (stats, entry) => ({
        channelCount: stats.channelCount + (entry.kind === 'channel' ? 1 : 0),
        threadCount: stats.threadCount + (entry.kind === 'thread' ? 1 : 0),
        serializedCharacterCount: stats.serializedCharacterCount + entry.serializedCharacterCount,
      }),
      { channelCount: 0, threadCount: 0, serializedCharacterCount: 0 },
    );
  }

  close(): void {
    this.initialized = false;
    this.currentUserId = null;
    this.currentWorkspaceId = null;
    this.currentSchemaVersion = null;
    // Writes queued while backgrounded are scoped to the outgoing session's
    // keys. Without this, a delayed flush after an account/workspace switch
    // would resurrect that session's data instead of being discarded with it.
    if (this.pendingQueryCacheFlushTimer) {
      clearTimeout(this.pendingQueryCacheFlushTimer);
      this.pendingQueryCacheFlushTimer = null;
    }
    this.pendingQueryCacheWrites.clear();
    this.pendingQueryCacheRemovals.clear();
  }

  /**
   * Flush writes queued during a short lifecycle pause before a session is
   * closed. Workspace switching is an explicit foreground action, so these
   * writes must not be silently discarded with the outgoing adapter scope.
   */
  flushPendingQueryCacheWrites(): void {
    if (this.pendingQueryCacheFlushTimer) {
      clearTimeout(this.pendingQueryCacheFlushTimer);
      this.pendingQueryCacheFlushTimer = null;
    }

    this.flushPendingQueryCacheChanges();
  }

  // Unscoped shadow accessors — used by notification-warm. Native writers
  // (iOS NSE, Android FCM headless) don't know the user-scope prefix, so
  // shadow keys are stored at the MMKV root with userID embedded in the key.
  async readShadowValue(key: string): Promise<unknown> {
    const value = lotusStorage.getString(key);
    if (value === undefined) return null;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  async writeShadowValue(key: string, value: unknown): Promise<void> {
    lotusStorage.set(key, JSON.stringify(value));
  }

  async removeShadowValue(key: string): Promise<void> {
    lotusStorage.remove(key);
  }

  async dropAllUserDatabases(): Promise<void> {
    const keys = lotusStorage.getAllKeys().filter((key: string) => key.startsWith(DB_PREFIX));
    for (const key of keys) {
      lotusStorage.remove(key);
    }
  }

  async dropUserDatabases(userId: string): Promise<void> {
    const userPrefix = `${DB_PREFIX}-${userId}`;
    const keys = lotusStorage
      .getAllKeys()
      .filter((key: string) => key === userPrefix || key.startsWith(`${userPrefix}:`));
    for (const key of keys) {
      lotusStorage.remove(key);
    }
  }

  /**
   * Get direct access to the underlying MMKV instance.
   * Useful for notification caching that needs to write directly to the same DB
   * that XState will hydrate from, without initializing the full adapter.
   */
  getMMKVInstance(): typeof lotusStorage {
    return lotusStorage;
  }

  /**
   * Write a raw value directly to MMKV with a scoped key.
   * Does NOT require init() to be called first - constructs the key from userId.
   * Used by notification caching in background contexts where XState isn't initialized.
   */
  writeRaw(userId: string, key: string, value: string): void {
    const scopedKey = `${this.getRawKeyPrefix(userId)}:${key}`;
    lotusStorage.set(scopedKey, value);
  }

  writeChatEntityForUser(
    userId: string,
    workspaceId: string | null,
    kind: ChatCacheEntityKind,
    id: string,
    value: unknown,
    fingerprint: string,
  ): void {
    const prefix = this.getRawKeyPrefix(userId, workspaceId);
    const entityPrefix = kind === 'channel' ? 'chan' : 'thread';
    const normalizedValue = normalizeChatEntityValue(kind, value);
    const persistedValue =
      kind === 'channel' && Array.isArray(normalizedValue)
        ? normalizedValue.slice(-MAX_DISK_CHANNEL_ROWS)
        : normalizedValue;
    const serialized = JSON.stringify(persistedValue);
    lotusStorage.set(`${prefix}:${entityPrefix}:${id}`, serialized);

    const indexKey = `${prefix}:${CHAT_CACHE_INDEX_KEY}`;
    let entries: ChatCacheIndexEntry[] = [];
    try {
      const parsed = JSON.parse(lotusStorage.getString(indexKey) ?? '[]') as unknown;
      if (Array.isArray(parsed)) {
        entries = parsed.filter(
          (entry): entry is ChatCacheIndexEntry =>
            Boolean(entry) &&
            typeof entry === 'object' &&
            ((entry as ChatCacheIndexEntry).kind === 'channel' ||
              (entry as ChatCacheIndexEntry).kind === 'thread') &&
            typeof (entry as ChatCacheIndexEntry).id === 'string' &&
            typeof (entry as ChatCacheIndexEntry).lastAccessedAt === 'number' &&
            typeof (entry as ChatCacheIndexEntry).fingerprint === 'string' &&
            typeof (entry as ChatCacheIndexEntry).serializedCharacterCount === 'number',
        );
      }
    } catch {
      entries = [];
    }
    entries = entries.filter(entry => !(entry.kind === kind && entry.id === id));
    entries.push({
      kind,
      id,
      fingerprint,
      lastAccessedAt: Date.now(),
      serializedCharacterCount: serialized.length,
    });
    const max = kind === 'channel' ? MAX_DISK_CHANNELS : MAX_DISK_THREADS;
    const sameKind = entries
      .filter(entry => entry.kind === kind)
      .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
    for (const entry of sameKind.slice(0, Math.max(0, sameKind.length - max))) {
      lotusStorage.remove(`${prefix}:${entry.kind === 'channel' ? 'chan' : 'thread'}:${entry.id}`);
      entries = entries.filter(
        candidate => !(candidate.kind === entry.kind && candidate.id === entry.id),
      );
    }
    lotusStorage.set(indexKey, JSON.stringify(entries));
  }

  /**
   * Read a raw value directly from MMKV with a scoped key.
   * Does NOT require init() to be called first.
   */
  readRaw(userId: string, key: string): string | undefined {
    const scopedKey = `${this.getRawKeyPrefix(userId)}:${key}`;
    return lotusStorage.getString(scopedKey);
  }

  readChannelConversationsSync(channelId: string): unknown[] | null {
    const value = this.readChatEntitySync('channel', channelId);
    return Array.isArray(value) ? value : null;
  }

  /**
   * Read the warm chat window used before notification navigation. The
   * workspace-scoped entity is the canonical JS warm path; the legacy blob is
   * retained as a fallback for notifications written by older extensions.
   * When a target is supplied, prefer whichever source actually contains it.
   */
  readNotificationChatEntitySync(
    kind: ChatCacheEntityKind,
    id: string,
    targetMessageId?: string,
  ): unknown | null {
    const workspaceEntity = this.readChatEntitySync(kind, id);
    const target = targetMessageId?.trim();
    if (!target || containsNotificationTarget(kind, workspaceEntity, target)) {
      if (workspaceEntity !== null) return workspaceEntity;
    }

    const legacyKey = kind === 'channel' ? CHANNEL_CONVERSATIONS_KEY : THREAD_CONVERSATIONS_KEY;
    const legacyBlob = this.loadContextPropertySync(legacyKey);
    const notificationValue =
      legacyBlob && typeof legacyBlob === 'object'
        ? (legacyBlob as Record<string, unknown>)[id]
        : null;

    const legacyEntity =
      notificationValue === null || notificationValue === undefined
        ? null
        : normalizeChatEntityValue(kind, notificationValue);
    if (
      legacyEntity !== null &&
      (!target || containsNotificationTarget(kind, legacyEntity, target))
    ) {
      return legacyEntity;
    }

    return workspaceEntity ?? legacyEntity;
  }

  readChatEntitySync(kind: ChatCacheEntityKind, id: string): unknown | null {
    const globalContext = this.getGlobalUserContext();
    const userId = this.currentUserId ?? globalContext.userId;
    if (!userId) return null;

    // Reads may run while a killed app is mounting, before InitialStateLoader
    // initializes the adapter. Prefer the active workspace during a switch;
    // the persisted workspace is only the early-startup fallback.
    const workspaceId = this.initialized
      ? this.currentWorkspaceId
      : (getActiveWorkspaceId() ?? globalContext.workspaceId);
    const keyPrefix = this.initialized
      ? this.getKeyPrefix()
      : this.getRawKeyPrefix(userId, workspaceId);
    const indexRaw = this.initialized
      ? this.readQueryCacheValue(`${keyPrefix}:${CHAT_CACHE_INDEX_KEY}`)
      : lotusStorage.getString(`${keyPrefix}:${CHAT_CACHE_INDEX_KEY}`);
    if (!indexRaw) return null;

    let entry: ChatCacheIndexEntry | undefined;
    try {
      const index = JSON.parse(indexRaw) as unknown;
      if (!Array.isArray(index)) return null;
      entry = index.find(
        (candidate): candidate is ChatCacheIndexEntry =>
          Boolean(candidate) &&
          typeof candidate === 'object' &&
          (candidate as ChatCacheIndexEntry).kind === kind &&
          (candidate as ChatCacheIndexEntry).id === id &&
          typeof (candidate as ChatCacheIndexEntry).fingerprint === 'string',
      );
    } catch {
      return null;
    }

    const fingerprint =
      kind === 'channel'
        ? getChannelConversationsQueryHash({ userID: userId })
        : getThreadConversationQueryHash({ userID: userId });
    // NSE writes an empty fingerprint because the native extension cannot
    // evaluate the shared query AST. Treat it as an unverified warm hint;
    // foreground JS persistence replaces it with the exact fingerprint.
    if (!entry || (entry.fingerprint !== '' && entry.fingerprint !== fingerprint)) {
      return null;
    }

    const entityKey = `${keyPrefix}:${kind === 'channel' ? 'chan' : 'thread'}:${id}`;
    const raw = this.initialized
      ? this.readQueryCacheValue(entityKey)
      : lotusStorage.getString(entityKey);
    if (!raw) {
      return null;
    }
    try {
      const value = normalizeChatEntityValue(kind, JSON.parse(raw));
      return value;
    } catch {
      return null;
    }
  }

  async loadChatEntities(): Promise<ChatCacheEntity[]> {
    if (!this.initialized) return [];
    const entries = this.readChatCacheIndex().sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
    const entities: ChatCacheEntity[] = [];
    for (const entry of entries) {
      const raw = this.readQueryCacheValue(this.chatEntityKey(entry.kind, entry.id));
      if (!raw) continue;
      try {
        entities.push({
          kind: entry.kind,
          id: entry.id,
          value: normalizeChatEntityValue(entry.kind, JSON.parse(raw)),
          fingerprint: entry.fingerprint,
        });
      } catch {
        this.removeQueryCacheValue(this.chatEntityKey(entry.kind, entry.id));
      }
    }
    return entities;
  }

  writeChatEntity(
    kind: ChatCacheEntityKind,
    id: string,
    value: unknown,
    fingerprint: string,
  ): void {
    const normalizedValue = normalizeChatEntityValue(kind, value);
    const persistedValue =
      kind === 'channel' && Array.isArray(normalizedValue)
        ? normalizedValue.slice(-MAX_DISK_CHANNEL_ROWS)
        : normalizedValue;
    const serialized = JSON.stringify(persistedValue);
    this.persistQueryCacheValue(this.chatEntityKey(kind, id), serialized);
    this.updateChatCacheIndex(kind, id, fingerprint, serialized.length);
  }

  removeChatEntity(kind: ChatCacheEntityKind, id: string): void {
    this.removeQueryCacheValue(this.chatEntityKey(kind, id));
    this.writeChatCacheIndex(
      this.readChatCacheIndex().filter(entry => !(entry.kind === kind && entry.id === id)),
    );
  }

  /**
   * Delete a raw value directly from MMKV with a scoped key.
   * Does NOT require init() to be called first.
   */
  deleteRaw(userId: string, key: string): void {
    const scopedKey = `${this.getRawKeyPrefix(userId)}:${key}`;
    lotusStorage.remove(scopedKey);
  }

  /**
   * Store userId and schemaVersion in global (non-user-scoped) MMKV keys.
   * These are accessible even when app is killed for background notifications.
   */
  setGlobalUserContext(
    userId: string,
    schemaVersion: string,
    workspaceId: string | null | undefined = getActiveWorkspaceId(),
  ): void {
    lotusStorage.set(GLOBAL_USER_ID_KEY, userId);
    lotusStorage.set(GLOBAL_SCHEMA_VERSION_KEY, schemaVersion);
    if (workspaceId) {
      lotusStorage.set(GLOBAL_WORKSPACE_ID_KEY, workspaceId);
    } else {
      lotusStorage.remove(GLOBAL_WORKSPACE_ID_KEY);
    }
  }

  /**
   * Retrieve userId and schemaVersion from global MMKV keys.
   * Used by background notification handlers when XState is not initialized.
   */
  getGlobalUserContext(): {
    userId: string | null;
    schemaVersion: string | null;
    workspaceId: string | null;
  } {
    const userId = lotusStorage.getString(GLOBAL_USER_ID_KEY) ?? null;
    const schemaVersion = lotusStorage.getString(GLOBAL_SCHEMA_VERSION_KEY) ?? null;
    const workspaceId = lotusStorage.getString(GLOBAL_WORKSPACE_ID_KEY) ?? null;
    return { userId, schemaVersion, workspaceId };
  }

  clearGlobalAuthToken(): void {
    lotusStorage.remove(LEGACY_GLOBAL_AUTH_TOKEN_KEY);
  }

  /**
   * Clear the global user context. Called on sign out.
   */
  clearGlobalUserContext(): void {
    lotusStorage.remove(GLOBAL_USER_ID_KEY);
    lotusStorage.remove(GLOBAL_SCHEMA_VERSION_KEY);
    lotusStorage.remove(GLOBAL_WORKSPACE_ID_KEY);
    lotusStorage.remove(LEGACY_GLOBAL_AUTH_TOKEN_KEY);
  }
}

export const mmkvStorageAdapter = new MmkvStorageService();

registerPersistedChatWindowReader((kind, id, targetMessageId) =>
  mmkvStorageAdapter.readNotificationChatEntitySync(kind, id, targetMessageId),
);
