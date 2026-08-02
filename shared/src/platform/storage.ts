export type ChatCacheEntityKind = 'channel' | 'thread';

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

  readChannelConversationsSync?(channelId: string): unknown[] | null;
  readChatEntitySync?(kind: ChatCacheEntityKind, id: string): unknown | null;

  // Native warm-start path for the newest, server-backed channel rows. This
  // is intentionally bounded and synchronous so a foreground app kill cannot
  // outrun the normal debounced query-cache persistence.
  primeChannelTail?(channelId: string, conversations: unknown[]): void;

  // Optional bounded per-entity chat storage. Native implements this to avoid
  // parsing a growing all-channel blob at startup; existing web adapters keep
  // the legacy blob path unchanged.
  loadChatEntities?(): Promise<ChatCacheEntity[]>;
  writeChatEntity?(
    kind: ChatCacheEntityKind,
    id: string,
    value: unknown,
    fingerprint: string,
  ): Promise<void> | void;
  removeChatEntity?(kind: ChatCacheEntityKind, id: string): Promise<void> | void;

  loadContextPropertySync?(key: string): unknown;
}
