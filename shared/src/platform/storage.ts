export type ChatCacheEntityKind = 'channel' | 'thread';

/**
 * One persisted chat window: a channel's rows, or a whole thread. Stored per
 * entity so a cold start reads only the window it opens instead of parsing an
 * all-channels blob that grows with every channel ever visited.
 */
export type ChatCacheEntity = {
  kind: ChatCacheEntityKind;
  id: string;
  value: unknown;
  fingerprint: string;
};

/**
 * Platform-agnostic storage adapter interface.
 * Abstracts IndexedDB (web) vs AsyncStorage/SQLite (native).
 */
export interface StorageAdapter {
  init(userId: string, schemaVersion: string): Promise<void>;
  saveContextProperty(key: string, value: unknown): Promise<void>;
  saveContext(context: Record<string, unknown>): Promise<void>;
  loadContext(): Promise<Record<string, unknown> | null>;
  loadContextProperty(key: string): Promise<unknown>;
  isInitialized(): boolean;
  close(): void;
  dropAllUserDatabases(): Promise<void>;

  // Optional unscoped shadow accessors. Used by the notification-warm flow:
  // native (iOS NSE / Android FCM) writes prefetched query results under a
  // stable, unscoped key that the JS-side hooks consume on cold boot.
  // Distinct from the user-scoped `*ContextProperty` methods so a native
  // writer without knowledge of the scope prefix can still round-trip.
  readShadowValue?(key: string): Promise<unknown>;
  writeShadowValue?(key: string, value: unknown): Promise<void>;
  removeShadowValue?(key: string): Promise<void>;

  // Optional synchronous readers. A cold open from a notification paints
  // before any async hydration resolves, so an adapter backed by synchronous
  // storage (e.g. MMKV) can serve that window immediately. Adapters without
  // synchronous storage omit them and keep the async path.
  readChannelConversationsSync?(channelId: string): unknown[] | null;
  readChatEntitySync?(kind: ChatCacheEntityKind, id: string): unknown | null;
  loadContextPropertySync?(key: string): unknown;

  // Optional bounded per-entity chat storage. Implement all three or none:
  // a partial implementation keeps the legacy single-blob path, which is the
  // only way hydration and deletion stay consistent.
  loadChatEntities?(): Promise<ChatCacheEntity[]>;
  writeChatEntity?(
    kind: ChatCacheEntityKind,
    id: string,
    value: unknown,
    fingerprint: string,
  ): Promise<void> | void;
  removeChatEntity?(kind: ChatCacheEntityKind, id: string): Promise<void> | void;
}
