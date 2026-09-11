import { logger, Event as LogEvent } from '../../utils/logger';
/**
 * IndexedDB storage for XyneAI streaming state persistence
 * Allows streams to continue across sidebar open/close cycles
 */
import type { ToolOutput as GeniusToolOutput } from '../../types/toolOutput';
import type {
  Message,
  MessageAttachment,
} from '../../components/Chat/XyneAISidebar/utils/XyneAITypes';

const DB_NAME = 'XyneAIStreamsDB';
const DB_VERSION = 1;
const STORE_NAME = 'streams';

export type StreamStatus = 'streaming' | 'completed' | 'error' | 'aborted';

export interface StreamChunk {
  type: string;
  content?: string | undefined;
  data?: Record<string, unknown>;
  timestamp: number;
}

export interface StreamRecord {
  streamId: string;
  threadId: string; // channelId_threadConversationId or channelId for channel-level
  sessionId: string;
  status: StreamStatus;
  chunks: StreamChunk[];
  messages: Message[];
  rawContent: string;
  toolOutputs: GeniusToolOutput[];
  finalResponse: string | null;
  startedAt: number;
  completedAt: number | null;
  error: string | null;
  // Request context for resuming
  query: string;
  channelIds: string[];
  webSearchEnabled: boolean;
  deepResearchEnabled: boolean;
  attachments: MessageAttachment[];
  version?: 'v1' | 'v2';
}

class XyneAIStreamStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private openDB(): Promise<IDBDatabase> {
    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = (): void => {
        logger.error(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('[XyneAIStreamStorage] Failed to open IndexedDB'),
        });
        reject(new Error('Failed to open IndexedDB'));
      };

      request.onsuccess = (): void => {
        resolve(request.result);
      };

      request.onupgradeneeded = (event): void => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create object store with streamId as keyPath
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'streamId' });
          objectStore.createIndex('threadId', 'threadId', { unique: false });
          objectStore.createIndex('status', 'status', { unique: false });
          objectStore.createIndex('startedAt', 'startedAt', { unique: false });
        }
      };
    });

    return this.dbPromise;
  }

  /**
   * Create a new stream record
   */
  async createStream(
    streamId: string,
    threadId: string,
    sessionId: string,
    query: string,
    channelIds: string[],
    webSearchEnabled: boolean,
    deepResearchEnabled: boolean,
    attachments: MessageAttachment[],
    initialMessages: Message[],
    version?: 'v1' | 'v2',
  ): Promise<void> {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const record: StreamRecord = {
        streamId,
        threadId,
        sessionId,
        status: 'streaming',
        chunks: [],
        messages: initialMessages,
        rawContent: '',
        toolOutputs: [],
        finalResponse: null,
        startedAt: Date.now(),
        completedAt: null,
        error: null,
        query,
        channelIds,
        webSearchEnabled,
        deepResearchEnabled,
        attachments,
        ...(version && { version }),
      };

      return new Promise((resolve, reject) => {
        const request = store.put(record);
        request.onsuccess = (): void => resolve();
        request.onerror = (): void => reject(new Error('Failed to create stream record'));
      });
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[XyneAIStreamStorage] Failed to create stream:'),
        error: error,
      });
      throw error;
    }
  }

  /**
   * Append a chunk to an existing stream
   */
  async appendChunk(streamId: string, chunk: StreamChunk): Promise<void> {
    try {
      const record = await this.getStream(streamId);
      if (!record) {
        logger.warn(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_warn',
          message: String('[XyneAIStreamStorage] Stream not found for chunk append:'),
          context: [streamId],
        });
        return;
      }

      record.chunks.push(chunk);

      // Update rawContent if this is a content chunk
      if ((chunk.type === 'delta' || chunk.type === 'content') && chunk.content) {
        record.rawContent += chunk.content;
      }

      const db = await this.openDB();
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      return new Promise((resolve, reject) => {
        const request = store.put(record);
        request.onsuccess = (): void => resolve();
        request.onerror = (): void => reject(new Error('Failed to append chunk'));
      });
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[XyneAIStreamStorage] Failed to append chunk:'),
        error: error,
      });
      throw error;
    }
  }

  /**
   * Update threadId on a stream record (e.g. after migrating draft → server session key)
   */
  async updateStreamThreadId(streamId: string, newThreadId: string): Promise<void> {
    try {
      const record = await this.getStream(streamId);
      if (!record) {
        logger.warn(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_warn',
          message: String('[XyneAIStreamStorage] Stream not found for thread id update:'),
          context: [streamId],
        });
        return;
      }

      record.threadId = newThreadId;

      const db = await this.openDB();
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      return new Promise((resolve, reject) => {
        const request = store.put(record);
        request.onsuccess = (): void => resolve();
        request.onerror = (): void => reject(new Error('Failed to update stream thread id'));
      });
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[XyneAIStreamStorage] Failed to update stream thread id:'),
        error: error,
      });
    }
  }

  /**
   * Update messages for a stream
   */
  async updateMessages(streamId: string, messages: Message[]): Promise<void> {
    try {
      const record = await this.getStream(streamId);
      if (!record) {
        logger.warn(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_warn',
          message: String('[XyneAIStreamStorage] Stream not found for message update:'),
          context: [streamId],
        });
        return;
      }

      record.messages = messages;

      const db = await this.openDB();
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      return new Promise((resolve, reject) => {
        const request = store.put(record);
        request.onsuccess = (): void => resolve();
        request.onerror = (): void => reject(new Error('Failed to update messages'));
      });
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[XyneAIStreamStorage] Failed to update messages:'),
        error: error,
      });
      throw error;
    }
  }

  /**
   * Mark stream as completed
   */
  async completeStream(streamId: string, finalResponse: string): Promise<void> {
    try {
      const record = await this.getStream(streamId);
      if (!record) {
        logger.warn(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_warn',
          message: String('[XyneAIStreamStorage] Stream not found for completion:'),
          context: [streamId],
        });
        return;
      }

      record.status = 'completed';
      record.finalResponse = finalResponse;
      record.completedAt = Date.now();

      const db = await this.openDB();
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      return new Promise((resolve, reject) => {
        const request = store.put(record);
        request.onsuccess = (): void => resolve();
        request.onerror = (): void => reject(new Error('Failed to complete stream'));
      });
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[XyneAIStreamStorage] Failed to complete stream:'),
        error: error,
      });
      throw error;
    }
  }

  /**
   * Mark stream as errored
   */
  async errorStream(streamId: string, error: string): Promise<void> {
    try {
      const record = await this.getStream(streamId);
      if (!record) {
        logger.warn(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_warn',
          message: String('[XyneAIStreamStorage] Stream not found for error:'),
          context: [streamId],
        });
        return;
      }

      record.status = 'error';
      record.error = error;
      record.completedAt = Date.now();

      const db = await this.openDB();
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      return new Promise((resolve, reject) => {
        const request = store.put(record);
        request.onsuccess = (): void => resolve();
        request.onerror = (): void => reject(new Error('Failed to error stream'));
      });
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[XyneAIStreamStorage] Failed to mark stream as errored:'),
        error: error,
      });
      throw error;
    }
  }

  /**
   * Mark stream as aborted
   */
  async abortStream(streamId: string): Promise<void> {
    try {
      const record = await this.getStream(streamId);
      if (!record) {
        logger.warn(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_warn',
          message: String('[XyneAIStreamStorage] Stream not found for abort:'),
          context: [streamId],
        });
        return;
      }

      record.status = 'aborted';
      record.completedAt = Date.now();

      const db = await this.openDB();
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      return new Promise((resolve, reject) => {
        const request = store.put(record);
        request.onsuccess = (): void => resolve();
        request.onerror = (): void => reject(new Error('Failed to abort stream'));
      });
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[XyneAIStreamStorage] Failed to abort stream:'),
        error: error,
      });
      throw error;
    }
  }

  /**
   * Get a stream record by ID
   */
  async getStream(streamId: string): Promise<StreamRecord | null> {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(streamId);

      return new Promise((resolve, reject) => {
        request.onsuccess = (): void => {
          const result = request.result as StreamRecord | undefined;
          resolve(result || null);
        };
        request.onerror = (): void => {
          reject(new Error('Failed to get stream'));
        };
      });
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[XyneAIStreamStorage] Failed to get stream:'),
        error: error,
      });
      return null;
    }
  }

  /**
   * Get active stream for a thread (streaming or recently completed)
   */
  async getActiveStreamForThread(threadId: string): Promise<StreamRecord | null> {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('threadId');
      const request = index.getAll(threadId);

      return new Promise((resolve, reject) => {
        request.onsuccess = (): void => {
          const results = request.result as StreamRecord[];

          // Find active streaming stream
          const streamingRecord = results.find(r => r.status === 'streaming');
          if (streamingRecord) {
            resolve(streamingRecord);
            return;
          }

          // Or find recently completed stream (within last 5 minutes)
          const recentCutoff = Date.now() - 5 * 60 * 1000;
          const recentCompleted = results
            .filter(r => r.status === 'completed' && r.completedAt && r.completedAt > recentCutoff)
            .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))[0];

          resolve(recentCompleted || null);
        };
        request.onerror = (): void => {
          reject(new Error('Failed to get active stream for thread'));
        };
      });
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[XyneAIStreamStorage] Failed to get active stream for thread:'),
        error: error,
      });
      return null;
    }
  }

  /**
   * Get all active streams (currently streaming)
   */
  async getAllActiveStreams(): Promise<StreamRecord[]> {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('status');
      const request = index.getAll('streaming');

      return new Promise((resolve, reject) => {
        request.onsuccess = (): void => {
          resolve(request.result as StreamRecord[]);
        };
        request.onerror = (): void => {
          reject(new Error('Failed to get active streams'));
        };
      });
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[XyneAIStreamStorage] Failed to get active streams:'),
        error: error,
      });
      return [];
    }
  }

  /**
   * Delete a stream record
   */
  async deleteStream(streamId: string): Promise<void> {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      return new Promise((resolve, reject) => {
        const request = store.delete(streamId);
        request.onsuccess = (): void => resolve();
        request.onerror = (): void => reject(new Error('Failed to delete stream'));
      });
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[XyneAIStreamStorage] Failed to delete stream:'),
        error: error,
      });
      throw error;
    }
  }

  /**
   * Clean up old completed/errored/aborted streams (older than 1 hour)
   */
  async cleanupOldStreams(): Promise<void> {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      return new Promise((resolve, reject) => {
        request.onsuccess = (): void => {
          const records = request.result as StreamRecord[];
          const cutoff = Date.now() - 60 * 60 * 1000; // 1 hour ago

          for (const record of records) {
            if (
              record.status !== 'streaming' &&
              record.completedAt &&
              record.completedAt < cutoff
            ) {
              store.delete(record.streamId);
            }
          }

          resolve();
        };
        request.onerror = (): void => {
          reject(new Error('Failed to cleanup old streams'));
        };
      });
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[XyneAIStreamStorage] Failed to cleanup old streams:'),
        error: error,
      });
    }
  }
}

// Export singleton instance
export const xyneAIStreamStorage = new XyneAIStreamStorage();
