/**
 * Platform-agnostic storage adapter interface.
 * Abstracts IndexedDB (web) vs AsyncStorage/SQLite (native).
 */
export interface StorageAdapter {
  init(userId: string, schemaVersion: string): Promise<void>;
  saveContextProperty(key: string, value: unknown): Promise<void>;
  saveContext(context: Record<string, unknown>): Promise<void>;
  loadContext(): Promise<Record<string, unknown> | null>;
  isInitialized(): boolean;
  close(): void;
  dropAllUserDatabases(): Promise<void>;
}
