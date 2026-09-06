import { logger, Event as LogEvent } from '../utils/logger';
/**
 * IndexedDB Service for persisting XState machine context
 * Uses Zero's schema version for cache invalidation
 * Stores each context property as individual keys
 * Scopes databases by userId for multi-user support
 */

const DB_PREFIX = 'xyne-state-machine';
const STORE_NAME = 'state';
/** DB version — bump when adding object stores below (onupgradeneeded creates missing ones). */
const DB_VERSION = 2;
/** Sync-engine persistence stores (see @xyne/shared/sync SyncStore). */
export const SYNC_ROWS_STORE = 'sync_rows'; // keyPath [table, pk] → { table, pk, row, version }
export const SYNC_MEMBERS_STORE = 'sync_members'; // keyPath [inst, table, pk], index byRow [table, pk]
export const SYNC_META_STORE = 'sync_meta'; // keyPath inst → { inst, offset, lastActiveAt }
const SCHEMA_VERSION_KEY = '_schemaVersion';
const ENCRYPTION_KEYS_DB_NAME = 'xyne-encryption-keys';

export const FINGERPRINT_FIELD = '__conversationFingerprint__';

class IndexedDBService {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<IDBDatabase> | null = null;
  private currentSchemaVersion: string | null = null;
  private currentUserId: string | null = null;

  /**
   * Initialize IndexedDB.
   * Scopes database to the provided userId.
   */
  async init(userId: string, schemaVersion: string): Promise<IDBDatabase> {
    // If already initialized with same userId and version, return existing
    if (this.db && this.currentUserId === userId && this.currentSchemaVersion === schemaVersion) {
      return this.db;
    }

    // Close existing connection if userId or schema version changed
    if (this.db && (this.currentUserId !== userId || this.currentSchemaVersion !== schemaVersion)) {
      this.close();
    }

    if (
      this.initPromise &&
      this.currentUserId === userId &&
      this.currentSchemaVersion === schemaVersion
    ) {
      return this.initPromise;
    }

    this.currentUserId = userId;
    this.currentSchemaVersion = schemaVersion;
    this.initPromise = this.openDatabase(userId, schemaVersion);
    return this.initPromise;
  }

  private getDatabaseName(userId: string): string {
    return `${DB_PREFIX}-${userId}`;
  }

  private async openDatabase(userId: string, schemaVersion: string): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const dbName = this.getDatabaseName(userId);
      const request = indexedDB.open(dbName, DB_VERSION);

      request.onerror = () => {
        reject(new Error('Failed to open IndexedDB'));
      };

      request.onblocked = () => {
        // Another tab holds an older version open; the upgrade waits for it. Surface it.
        logger.warn(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_warn',
          message: String(`IndexedDB upgrade blocked by another tab for ${dbName}`),
        });
      };

      request.onsuccess = async () => {
        const db = request.result;

        // Let a newer-version open in another tab proceed by closing this connection.
        db.onversionchange = () => {
          db.close();
          this.db = null;
        };

        try {
          const storedVersion = await this.getStoredSchemaVersion(db);
          if (storedVersion === null) {
            await this.setStoredSchemaVersion(db, schemaVersion);
          }
        } catch {
          // Ignore errors
        }

        this.db = db;
        resolve(db);
      };

      request.onupgradeneeded = event => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
        // Sync-engine persistence stores (added in DB_VERSION 2). Rows are single-copy,
        // members is the persisted CVR (with a reverse index for the last-member check).
        if (!db.objectStoreNames.contains(SYNC_ROWS_STORE)) {
          db.createObjectStore(SYNC_ROWS_STORE, { keyPath: ['table', 'pk'] });
        }
        if (!db.objectStoreNames.contains(SYNC_MEMBERS_STORE)) {
          const members = db.createObjectStore(SYNC_MEMBERS_STORE, {
            keyPath: ['inst', 'table', 'pk'],
          });
          members.createIndex('byRow', ['table', 'pk'], { unique: false });
        }
        if (!db.objectStoreNames.contains(SYNC_META_STORE)) {
          db.createObjectStore(SYNC_META_STORE, { keyPath: 'inst' });
        }
      };
    });
  }

  private async getStoredSchemaVersion(db: IDBDatabase): Promise<string | null> {
    return new Promise(resolve => {
      try {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(SCHEMA_VERSION_KEY);

        request.onsuccess = () => {
          //eslint-disable-next-line  @typescript-eslint/no-unsafe-argument
          resolve(request.result ?? null);
        };

        request.onerror = () => {
          resolve(null);
        };
      } catch {
        resolve(null);
      }
    });
  }

  private async setStoredSchemaVersion(db: IDBDatabase, version: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(version, SCHEMA_VERSION_KEY);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to store schema version'));
    });
  }

  /**
   * Load a single context property from IndexedDB
   */
  async loadContextProperty(key: string): Promise<unknown> {
    if (!this.db) {
      throw new Error('IndexedDB not initialized. Call init() first.');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onsuccess = () => {
        resolve(request.result ?? null);
      };
      request.onerror = () => reject(new Error(`Failed to load ${key} from IndexedDB`));
    });
  }

  /**
   * Save a single context property to IndexedDB
   */
  async saveContextProperty(key: string, value: unknown): Promise<void> {
    if (!this.db) {
      throw new Error('IndexedDB not initialized. Call init() first.');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(value, key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error(`Failed to save ${key} to IndexedDB`));
    });
  }

  /**
   * Save entire context to IndexedDB (each property as separate key)
   */
  async saveContext(context: Record<string, unknown>): Promise<void> {
    if (!this.db) {
      throw new Error('IndexedDB not initialized. Call init() first.');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      // Store timestamp
      store.put(Date.now(), '_timestamp');

      // Store each context property
      for (const [key, value] of Object.entries(context)) {
        store.put(value, key);
      }

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error('Failed to save context to IndexedDB'));
    });
  }

  /**
   * Load entire context from IndexedDB
   * Returns all stored values as-is without any TTL filtering
   * TTL logic is handled by XState machine
   */
  async loadContext(): Promise<Record<string, unknown> | null> {
    if (!this.db) {
      throw new Error('IndexedDB not initialized. Call init() first.');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.openCursor();
      const context: Record<string, unknown> = {};

      request.onsuccess = event => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          const key = cursor.key as string;
          // Skip internal keys
          if (!key.startsWith('_')) {
            context[key] = cursor.value;
          }
          cursor.continue();
        } else {
          // Done iterating
          if (Object.keys(context).length === 0) {
            resolve(null);
          } else {
            resolve(context);
          }
        }
      };

      transaction.oncomplete = () => resolve(context);

      transaction.onerror = () => reject(new Error('Failed to load context from IndexedDB'));
      request.onerror = () => reject(new Error('Failed to iterate through cache entries'));
    });
  }

  /**
   * Check if database is initialized
   */
  isInitialized(): boolean {
    return this.db !== null;
  }

  /** The raw DB handle (for the sync-engine SyncStore, which owns its own object stores). */
  getDb(): IDBDatabase | null {
    return this.db;
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initPromise = null;
    }
  }

  /**
   * Drop all user-scoped databases
   * This is useful when clearing data for logged-out users
   */
  async dropAllUserDatabases(): Promise<void> {
    this.close();

    try {
      const databases = await indexedDB.databases();

      if (!databases) {
        return;
      }

      const userDatabases = databases
        .filter(
          db => db.name && (db.name.startsWith(DB_PREFIX) || db.name === ENCRYPTION_KEYS_DB_NAME),
        )
        .map(db => db.name as string);

      const dropPromises = userDatabases.map(dbName => {
        return new Promise<void>(res => {
          const dropRequest = indexedDB.deleteDatabase(dbName);
          dropRequest.onsuccess = () => res();
          dropRequest.onerror = () => res();
          dropRequest.onblocked = () => {
            logger.warn(LogEvent.FRONTEND_ERROR, {
              type: 'migrated_console_warn',
              message: String(`Database deletion blocked for ${dbName}, proceeding anyway`),
            });
            res();
          };
        });
      });

      await Promise.all(dropPromises);

      if (userDatabases.length > 0) {
        logger.info(LogEvent.INFO, {
          type: 'migrated_console_log',
          message: String(`Dropped ${userDatabases.length} user-scoped databases`),
        });
      }
    } catch (error) {
      // If we can't list databases, just proceed
      logger.warn(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_warn',
        message: String('Failed to list user databases:'),
        context: [error],
      });
    }
  }
}

// Export singleton instance
export const indexedDBService = new IndexedDBService();
