import { logger, Event as LogEvent } from './logger';
/**
 * IndexedDB storage for Genius AI conversation history
 */
import type { ToolOutput as GeniusToolOutput } from '../types/toolOutput';
import type {
  MessageAttachment,
  SummarizerOutput,
  UserTag,
} from '../components/Chat/XyneAISidebar/utils/XyneAITypes';

const DB_NAME = 'XyneAIDB';
const DB_VERSION = 2;
const STORE_NAME = 'conversations';

export interface StoredMessage {
  id: string;
  type: 'user' | 'bot';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  streamingContent?: string;
  parsedContent?: {
    summary: string;
    keypoints: string[];
    citations: Record<number, number>;
    isComplete: boolean;
  };
  messageIdMapping?: Record<string, string>;
  conversationIdMapping?: Record<string, string>;
  channelIdMapping?: Record<string, string>;
  toolOutputs?: GeniusToolOutput[];
  feedback?: 0 | 1 | 2; // 0 = no feedback, 1 = like, 2 = dislike
  attachments?: MessageAttachment[];
  parentId?: string | null; // Parent message ID for tree branching
  // Summarizer-specific fields — must be persisted so citation badges survive page reload
  summarizerOutput?: SummarizerOutput;
  agentType?: 'genius' | 'summarizer';
  userTags?: Record<string, UserTag>;
}

export interface ConversationHistory {
  id: string; // Unique ID for this conversation (channelId + sessionId + threadConversationId)
  channelId: string;
  sessionId: string;
  threadConversationId?: string; // Thread-specific context (conversationId from thread)
  title: string; // Auto-generated title from first user message
  messages: StoredMessage[];
  createdAt: Date;
  lastUpdated: Date;
  isStarred?: boolean;
  branchSelections?: Record<string, string>; // parentId → selected childId for branching
}

class XyneAIStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private openDB(): Promise<IDBDatabase> {
    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = (): void => {
        this.dbPromise = null; // Reset so next call retries
        reject(new Error('Failed to open IndexedDB'));
      };

      request.onsuccess = (): void => {
        resolve(request.result);
      };

      request.onupgradeneeded = (event): void => {
        const db = (event.target as IDBOpenDBRequest).result;
        const oldVersion = event.oldVersion;

        // Handle migration from v1 to v2
        if (oldVersion < 2) {
          // Delete old store if it exists
          if (db.objectStoreNames.contains(STORE_NAME)) {
            db.deleteObjectStore(STORE_NAME);
          }

          // Create new object store with 'id' as keyPath
          const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          objectStore.createIndex('channelId', 'channelId', { unique: false });
          objectStore.createIndex('lastUpdated', 'lastUpdated', { unique: false });
          objectStore.createIndex('isStarred', 'isStarred', { unique: false });
        }
      };
    });

    return this.dbPromise;
  }

  /**
   * Generate a title from the first user message in the active path.
   * If branchSelections provided, resolves the active path first.
   */
  generateTitle(messages: StoredMessage[], branchSelections?: Record<string, string>): string {
    const displayMessages = branchSelections
      ? resolveActivePath(messages, branchSelections)
      : messages;
    const firstUserMessage = displayMessages.find(m => m.type === 'user');
    if (!firstUserMessage) {
      return 'New conversation';
    }

    // Truncate to reasonable length
    const content = firstUserMessage.content.trim();
    return content.length > 50 ? content.substring(0, 50) + '...' : content;
  }

  async saveConversation(
    channelId: string,
    sessionId: string,
    messages: StoredMessage[],
    threadConversationId?: string,
    branchSelections?: Record<string, string>,
  ): Promise<void> {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      // Always use sessionId as the key - simple and unique from backend
      const conversationId = sessionId;

      // Check if conversation already exists
      const existingRequest = store.get(conversationId);

      return new Promise((resolve, reject) => {
        existingRequest.onsuccess = (): void => {
          const existing = existingRequest.result as ConversationHistory | undefined;

          const conversationHistory: ConversationHistory = {
            id: conversationId,
            channelId, // Keep channelId for reference (original channel)
            sessionId,
            ...(threadConversationId && { threadConversationId }),
            title: existing
              ? existing.title === this.generateTitle(existing.messages, existing.branchSelections)
                ? this.generateTitle(messages, branchSelections) // Auto-generated title — regenerate from updated messages
                : existing.title // Manually renamed — keep it
              : this.generateTitle(messages, branchSelections),
            messages,
            createdAt: existing?.createdAt || new Date(),
            lastUpdated: new Date(),
            isStarred: existing?.isStarred || false,
            ...(branchSelections && { branchSelections }),
          };

          const putRequest = store.put(conversationHistory);

          putRequest.onsuccess = (): void => {
            resolve();
          };

          putRequest.onerror = (): void => {
            reject(new Error('Failed to save conversation'));
          };
        };

        existingRequest.onerror = (): void => {
          reject(new Error('Failed to check existing conversation'));
        };
      });
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[XyneAIStorage] Failed to save conversation:'),
        error: error,
      });
      throw error;
    }
  }

  /**
   * Load a specific conversation by channelId and sessionId
   */
  async loadConversation(
    _channelId: string,
    sessionId: string,
    _threadConversationId?: string,
  ): Promise<ConversationHistory | null> {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      // Always use sessionId as the key
      const request = store.get(sessionId);

      return new Promise((resolve, reject) => {
        request.onsuccess = (): void => {
          const result = request.result as ConversationHistory | undefined;
          if (result) {
            // Convert date strings back to Date objects
            result.createdAt = new Date(result.createdAt);
            result.lastUpdated = new Date(result.lastUpdated);
            result.messages = result.messages.map(msg => ({
              ...msg,
              timestamp: new Date(msg.timestamp),
            }));
          }
          resolve(result || null);
        };
        request.onerror = (): void => {
          reject(new Error('Failed to load conversation'));
        };
      });
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[XyneAIStorage] Failed to load conversation:'),
        error: error,
      });
      return null;
    }
  }

  /**
   * Load the most recent conversation for a channel
   * If threadConversationId is provided, load the most recent for that thread
   * Otherwise, load the most recent channel-level conversation (no thread context)
   */
  async loadLatestConversation(
    channelId: string,
    threadConversationId?: string,
  ): Promise<ConversationHistory | null> {
    try {
      const conversations = await this.getConversationsForChannel(channelId);
      if (conversations.length === 0) return null;

      // Filter conversations based on thread context
      const filteredConversations = conversations.filter(conv => {
        if (threadConversationId) {
          // For thread context, only return conversations with matching threadConversationId
          return conv.threadConversationId === threadConversationId;
        }
        // For channel context, only return conversations without threadConversationId
        return !conv.threadConversationId;
      });

      if (filteredConversations.length === 0) return null;

      // Return the most recently updated conversation
      return filteredConversations.sort(
        (a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime(),
      )[0]!;
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[XyneAIStorage] Failed to load latest conversation:'),
        error: error,
      });
      return null;
    }
  }

  /**
   * Load the most recent global conversation (across all channels)
   * Only returns non-thread conversations (global context)
   */
  async loadLatestGlobalConversation(): Promise<ConversationHistory | null> {
    try {
      const allConversations = await this.getAllConversations();
      if (allConversations.length === 0) return null;

      // Filter to only non-thread conversations (global context)
      const globalConversations = allConversations.filter(conv => !conv.threadConversationId);

      if (globalConversations.length === 0) return null;

      // Return the most recently updated conversation
      return globalConversations.sort(
        (a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime(),
      )[0]!;
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[XyneAIStorage] Failed to load latest global conversation:'),
        error: error,
      });
      return null;
    }
  }

  /**
   * Get all conversations for a specific channel
   */
  async getConversationsForChannel(channelId: string): Promise<ConversationHistory[]> {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('channelId');
      const request = index.getAll(channelId);

      return new Promise((resolve, reject) => {
        request.onsuccess = (): void => {
          const results = (request.result as ConversationHistory[]).map(conv => ({
            ...conv,
            createdAt: new Date(conv.createdAt),
            lastUpdated: new Date(conv.lastUpdated),
            messages: conv.messages.map(msg => ({
              ...msg,
              timestamp: new Date(msg.timestamp),
            })),
          }));
          resolve(results);
        };
        request.onerror = (): void => {
          reject(new Error('Failed to load conversations for channel'));
        };
      });
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[XyneAIStorage] Failed to load conversations for channel:'),
        error: error,
      });
      return [];
    }
  }

  async deleteConversation(
    _channelId: string,
    sessionId: string,
    _threadConversationId?: string,
  ): Promise<void> {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      // Always use sessionId as the key
      store.delete(sessionId);

      return new Promise((resolve, reject) => {
        transaction.oncomplete = (): void => {
          resolve();
        };
        transaction.onerror = (): void => {
          reject(new Error('Failed to delete conversation'));
        };
      });
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[XyneAIStorage] Failed to delete conversation:'),
        error: error,
      });
      throw error;
    }
  }

  async toggleStar(
    _channelId: string,
    sessionId: string,
    _threadConversationId?: string,
  ): Promise<void> {
    try {
      const conversation = await this.loadConversation('', sessionId);
      if (!conversation) return;

      const db = await this.openDB();
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      conversation.isStarred = !conversation.isStarred;
      store.put(conversation);

      return new Promise((resolve, reject) => {
        transaction.oncomplete = (): void => {
          resolve();
        };
        transaction.onerror = (): void => {
          reject(new Error('Failed to toggle star'));
        };
      });
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[XyneAIStorage] Failed to toggle star:'),
        error: error,
      });
      throw error;
    }
  }

  async renameConversation(
    _channelId: string,
    sessionId: string,
    newTitle: string,
    _threadConversationId?: string,
  ): Promise<void> {
    try {
      const conversation = await this.loadConversation('', sessionId);
      if (!conversation) return;

      const db = await this.openDB();
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      conversation.title = newTitle;
      conversation.lastUpdated = new Date();
      store.put(conversation);

      return new Promise((resolve, reject) => {
        transaction.oncomplete = (): void => {
          resolve();
        };
        transaction.onerror = (): void => {
          reject(new Error('Failed to rename conversation'));
        };
      });
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[XyneAIStorage] Failed to rename conversation:'),
        error: error,
      });
      throw error;
    }
  }

  async getAllConversations(): Promise<ConversationHistory[]> {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      return new Promise((resolve, reject) => {
        request.onsuccess = (): void => {
          const results = (request.result as ConversationHistory[]).map(conv => ({
            ...conv,
            lastUpdated: new Date(conv.lastUpdated),
            messages: conv.messages.map(msg => ({
              ...msg,
              timestamp: new Date(msg.timestamp),
            })),
          }));
          resolve(results);
        };
        request.onerror = (): void => {
          reject(new Error('Failed to load all conversations'));
        };
      });
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[XyneAIStorage] Failed to load all conversations:'),
        error: error,
      });
      return [];
    }
  }

  async clearOldConversations(daysOld = 30): Promise<void> {
    try {
      const conversations = await this.getAllConversations();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const deletePromises = conversations
        .filter(conv => conv.lastUpdated < cutoffDate)
        .map(conv => this.deleteConversation(conv.channelId, conv.sessionId));

      await Promise.all(deletePromises);
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[XyneAIStorage] Failed to clear old conversations:'),
        error: error,
      });
    }
  }

  async deleteAllConversationsForChannel(channelId: string): Promise<void> {
    try {
      const conversations = await this.getConversationsForChannel(channelId);
      const deletePromises = conversations.map(conv =>
        this.deleteConversation(conv.channelId, conv.sessionId, conv.threadConversationId),
      );
      await Promise.all(deletePromises);
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[XyneAIStorage] Failed to delete all conversations for channel:'),
        error: error,
      });
      throw error;
    }
  }

  /**
   * Clean up duplicate conversations that were created with old ID format
   * Old format: channelId_sessionId or channelId_threadId_sessionId
   * New format: sessionId (unique, no duplicates)
   */
  async cleanupDuplicateConversations(): Promise<void> {
    try {
      const allConversations = await this.getAllConversations();

      // Group by sessionId to find duplicates
      const sessionGroups = new Map<string, ConversationHistory[]>();
      for (const conv of allConversations) {
        const existing = sessionGroups.get(conv.sessionId) || [];
        existing.push(conv);
        sessionGroups.set(conv.sessionId, existing);
      }

      const db = await this.openDB();

      // For each group with duplicates, keep the newest one and delete others
      for (const [sessionId, conversations] of sessionGroups.entries()) {
        if (conversations.length <= 1) continue;

        // Sort by lastUpdated descending, keep the newest
        conversations.sort((a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime());
        const [newest, ...duplicates] = conversations;

        // If newest has old format ID (not equal to sessionId), migrate it
        if (newest && newest.id !== sessionId) {
          const transaction = db.transaction([STORE_NAME], 'readwrite');
          const store = transaction.objectStore(STORE_NAME);

          // Delete old format entry
          store.delete(newest.id);

          // Save with new format (sessionId only)
          const migratedConversation: ConversationHistory = {
            ...newest,
            id: sessionId,
          };
          store.put(migratedConversation);

          await new Promise<void>((resolve, reject): void => {
            transaction.oncomplete = (): void => resolve();
            transaction.onerror = (): void => reject(new Error('Failed to migrate conversation'));
          });
        }

        // Delete duplicate entries
        for (const duplicate of duplicates) {
          const transaction = db.transaction([STORE_NAME], 'readwrite');
          const store = transaction.objectStore(STORE_NAME);
          store.delete(duplicate.id);
          await new Promise<void>((resolve, reject): void => {
            transaction.oncomplete = (): void => resolve();
            transaction.onerror = (): void => reject(new Error('Failed to delete duplicate'));
          });
        }
      }
    } catch {
      // Silently handle cleanup errors - non-critical operation
    }
  }
}

// Export singleton instance
export const xyneAIStorage = new XyneAIStorage();

// Run cleanup on module load to remove old duplicates
void xyneAIStorage.cleanupDuplicateConversations();

// ============================================================================
// Tree Branching Helpers
// ============================================================================

export const BRANCH_ROOT_KEY = '__root__';

/**
 * Walk the message tree from root, picking the selected branch at each fork.
 * Returns the active path of messages to display.
 */
export function resolveActivePath<T extends { id: string; parentId?: string | null }>(
  allMessages: T[],
  branchSelections: Record<string, string>,
): T[] {
  if (allMessages.length === 0) return [];

  // Legacy conversations: no message has parentId set — return as-is, no branching
  if (allMessages.every(m => m.parentId === null || m.parentId === undefined)) return allMessages;

  // Build children map: parentId → children (sorted by creation order / array index)
  const childrenMap = new Map<string, T[]>();
  for (const msg of allMessages) {
    const key = msg.parentId ?? BRANCH_ROOT_KEY;
    const children = childrenMap.get(key);
    if (children) {
      children.push(msg);
    } else {
      childrenMap.set(key, [msg]);
    }
  }

  const path: T[] = [];
  const visitedIds = new Set<string>();
  let currentKey: string = BRANCH_ROOT_KEY;

  for (let step = 0; step < allMessages.length; step += 1) {
    const children = childrenMap.get(currentKey);
    if (!children || children.length === 0) break;

    // Pick selected child, or default to the last one (most recent)
    const parentId = currentKey;
    const selectedId = branchSelections[parentId];
    const selected = selectedId
      ? (children.find(c => c.id === selectedId) ?? children[children.length - 1]!)
      : children[children.length - 1]!;

    if (visitedIds.has(selected.id)) break;

    path.push(selected);
    visitedIds.add(selected.id);
    currentKey = selected.id;
  }

  return path;
}

/**
 * Get siblings (messages sharing the same parentId) and the current message's index.
 */
export function getSiblings<T extends { id: string; parentId?: string | null }>(
  allMessages: T[],
  messageId: string,
): { siblings: T[]; currentIndex: number } {
  const message = allMessages.find(m => m.id === messageId);
  if (!message) return { siblings: [], currentIndex: -1 };

  const parentKey = message.parentId ?? null;
  const siblings = allMessages.filter(m => (m.parentId ?? null) === parentKey);
  const currentIndex = siblings.findIndex(m => m.id === messageId);

  return { siblings, currentIndex };
}
