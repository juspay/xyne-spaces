/**
 * IndexedDB storage for Genius AI conversation history
 */
import type { ToolOutput as GeniusToolOutput } from 'cosmic-ai-genius';

const DB_NAME = 'XyneAIDB';
const DB_VERSION = 2; // Incremented for schema change
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
}

export interface ConversationHistory {
  id: string; // Unique ID for this conversation (channelId + sessionId)
  channelId: string;
  sessionId: string;
  title: string; // Auto-generated title from first user message
  messages: StoredMessage[];
  createdAt: Date;
  lastUpdated: Date;
  isStarred?: boolean;
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
   * Generate a title from the first user message
   */
  private generateTitle(messages: StoredMessage[]): string {
    const firstUserMessage = messages.find(m => m.type === 'user');
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
  ): Promise<void> {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const conversationId = `${channelId}_${sessionId}`;

      // Check if conversation already exists
      const existingRequest = store.get(conversationId);

      return new Promise((resolve, reject) => {
        existingRequest.onsuccess = (): void => {
          const existing = existingRequest.result as ConversationHistory | undefined;

          const conversationHistory: ConversationHistory = {
            id: conversationId,
            channelId,
            sessionId,
            title: existing?.title || this.generateTitle(messages),
            messages,
            createdAt: existing?.createdAt || new Date(),
            lastUpdated: new Date(),
            isStarred: existing?.isStarred || false,
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
      console.error('[XyneAIStorage] Failed to save conversation:', error);
      throw error;
    }
  }

  /**
   * Load a specific conversation by channelId and sessionId
   */
  async loadConversation(
    channelId: string,
    sessionId: string,
  ): Promise<ConversationHistory | null> {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const conversationId = `${channelId}_${sessionId}`;
      const request = store.get(conversationId);

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
      console.error('[XyneAIStorage] Failed to load conversation:', error);
      return null;
    }
  }

  /**
   * Load the most recent conversation for a channel
   */
  async loadLatestConversation(channelId: string): Promise<ConversationHistory | null> {
    try {
      const conversations = await this.getConversationsForChannel(channelId);
      if (conversations.length === 0) return null;

      // Return the most recently updated conversation
      return conversations.sort((a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime())[0]!;
    } catch (error) {
      console.error('[XyneAIStorage] Failed to load latest conversation:', error);
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
      console.error('[XyneAIStorage] Failed to load conversations for channel:', error);
      return [];
    }
  }

  async deleteConversation(channelId: string, sessionId: string): Promise<void> {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const conversationId = `${channelId}_${sessionId}`;
      store.delete(conversationId);

      return new Promise((resolve, reject) => {
        transaction.oncomplete = (): void => {
          resolve();
        };
        transaction.onerror = (): void => {
          reject(new Error('Failed to delete conversation'));
        };
      });
    } catch (error) {
      console.error('[XyneAIStorage] Failed to delete conversation:', error);
      throw error;
    }
  }

  async toggleStar(channelId: string, sessionId: string): Promise<void> {
    try {
      const conversation = await this.loadConversation(channelId, sessionId);
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
      console.error('[XyneAIStorage] Failed to toggle star:', error);
      throw error;
    }
  }

  async renameConversation(channelId: string, sessionId: string, newTitle: string): Promise<void> {
    try {
      const conversation = await this.loadConversation(channelId, sessionId);
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
      console.error('[XyneAIStorage] Failed to rename conversation:', error);
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
      console.error('[XyneAIStorage] Failed to load all conversations:', error);
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
      console.error('[XyneAIStorage] Failed to clear old conversations:', error);
    }
  }

  async deleteAllConversationsForChannel(channelId: string): Promise<void> {
    try {
      const conversations = await this.getConversationsForChannel(channelId);
      const deletePromises = conversations.map(conv =>
        this.deleteConversation(conv.channelId, conv.sessionId),
      );
      await Promise.all(deletePromises);
    } catch (error) {
      console.error('[XyneAIStorage] Failed to delete all conversations for channel:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const xyneAIStorage = new XyneAIStorage();
