import type { BotConversationState } from './types/bot.js';
import {logger} from '@/utils/logger';

/**
 * Conversation storage interface
 */
export interface ConversationStorage {
  get(conversationId: string): Promise<BotConversationState | null>;
  set(state: BotConversationState): Promise<void>;
  delete(conversationId: string): Promise<boolean>;
  list(botName?: string, userId?: string): Promise<BotConversationState[]>;
  cleanup(olderThan: Date): Promise<number>;
}

/**
 * In-memory conversation storage implementation
 */
export class MemoryConversationStorage implements ConversationStorage {
  private readonly conversations = new Map<string, BotConversationState>();
  private cleanupTimer?: NodeJS.Timeout;
  private readonly cleanupInterval = 60000; // 1 minute

  constructor() {
    this.startCleanup();
  }

  async get(conversationId: string): Promise<BotConversationState | null> {
    const state = this.conversations.get(conversationId);
    
    // Check if expired
    if (state && state.expiresAt && state.expiresAt < new Date()) {
      this.conversations.delete(conversationId);
      return null;
    }
    
    return state || null;
  }

  async set(state: BotConversationState): Promise<void> {
    this.conversations.set(state.conversationId, {
      ...state,
      updatedAt: new Date()
    });
  }

  async delete(conversationId: string): Promise<boolean> {
    return this.conversations.delete(conversationId);
  }

  async list(botName?: string, userId?: string): Promise<BotConversationState[]> {
    const states = Array.from(this.conversations.values());
    
    return states.filter(state => {
      // Filter expired states
      if (state.expiresAt && state.expiresAt < new Date()) {
        this.conversations.delete(state.conversationId);
        return false;
      }
      
      // Apply filters
      if (botName && state.botName !== botName) {
        return false;
      }
      
      if (userId && state.state.userId !== userId) {
        return false;
      }
      
      return true;
    });
  }

  async cleanup(olderThan: Date): Promise<number> {
    let cleanedCount = 0;
    
    for (const [conversationId, state] of this.conversations.entries()) {
      if (state.updatedAt < olderThan || (state.expiresAt && state.expiresAt < new Date())) {
        this.conversations.delete(conversationId);
        cleanedCount++;
      }
    }
    
    return cleanedCount;
  }

  private startCleanup(): void {
    this.cleanupTimer = setInterval(async () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const cleaned = await this.cleanup(oneHourAgo);
      
      if (cleaned > 0) {
        logger.debug(`[ConversationStorage] Cleaned up ${cleaned} expired conversations`);
      }
    }, this.cleanupInterval);
  }

  public stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }
}

/**
 * Conversation manager for handling bot conversation state
 */
export class ConversationManager {
  private readonly storage: ConversationStorage;
  private readonly defaultTtl = 24 * 60 * 60 * 1000; // 24 hours

  constructor(storage?: ConversationStorage) {
    this.storage = storage || new MemoryConversationStorage();
  }

  /**
   * Get conversation state
   */
  async getConversation(conversationId: string): Promise<BotConversationState | null> {
    try {
      return await this.storage.get(conversationId);
    } catch (error) {
      logger.error(`[ConversationManager] Failed to get conversation: ${conversationId}`, error);
      return null;
    }
  }

  /**
   * Create new conversation
   */
  async createConversation(
    conversationId: string,
    botName: string,
    initialState: Record<string, unknown> = {},
    ttl?: number
  ): Promise<BotConversationState> {
    const now = new Date();
    const expiresAt = ttl ? new Date(now.getTime() + ttl) : new Date(now.getTime() + this.defaultTtl);
    
    const state: BotConversationState = {
      conversationId,
      botName,
      state: initialState,
      createdAt: now,
      updatedAt: now,
      expiresAt
    };

    try {
      await this.storage.set(state);
      logger.debug(`[ConversationManager] Created conversation: ${conversationId}`, {
        botName,
        expiresAt
      });
      return state;
    } catch (error) {
      logger.error(`[ConversationManager] Failed to create conversation: ${conversationId}`, error);
      throw error;
    }
  }

  /**
   * Update conversation state
   */
  async updateConversation(
    conversationId: string,
    updates: Partial<Record<string, unknown>>,
    ttl?: number
  ): Promise<BotConversationState | null> {
    try {
      const existing = await this.storage.get(conversationId);
      if (!existing) {
        logger.warn(`[ConversationManager] Conversation not found for update: ${conversationId}`);
        return null;
      }

      const now = new Date();
      const expiresAt = ttl ? new Date(now.getTime() + ttl) : existing.expiresAt;

      const updatedState: BotConversationState = {
        ...existing,
        state: {
          ...existing.state,
          ...updates
        },
        updatedAt: now,
        ...(expiresAt && { expiresAt })
      };

      await this.storage.set(updatedState);
      logger.debug(`[ConversationManager] Updated conversation: ${conversationId}`);
      return updatedState;
    } catch (error) {
      logger.error(`[ConversationManager] Failed to update conversation: ${conversationId}`, error);
      return null;
    }
  }

  /**
   * Delete conversation
   */
  async deleteConversation(conversationId: string): Promise<boolean> {
    try {
      const deleted = await this.storage.delete(conversationId);
      if (deleted) {
        logger.debug(`[ConversationManager] Deleted conversation: ${conversationId}`);
      }
      return deleted;
    } catch (error) {
      logger.error(`[ConversationManager] Failed to delete conversation: ${conversationId}`, error);
      return false;
    }
  }

  /**
   * Get or create conversation
   */
  async getOrCreateConversation(
    conversationId: string,
    botName: string,
    initialState: Record<string, unknown> = {},
    ttl?: number
  ): Promise<BotConversationState> {
    let conversation = await this.getConversation(conversationId);
    
    if (!conversation) {
      conversation = await this.createConversation(conversationId, botName, initialState, ttl);
    } else if (conversation.botName !== botName) {
      // Bot changed, create new conversation
      await this.deleteConversation(conversationId);
      conversation = await this.createConversation(conversationId, botName, initialState, ttl);
    }
    
    return conversation;
  }

  /**
   * List conversations
   */
  async listConversations(botName?: string, userId?: string): Promise<BotConversationState[]> {
    try {
      return await this.storage.list(botName, userId);
    } catch (error) {
      logger.error('[ConversationManager] Failed to list conversations', error);
      return [];
    }
  }

  /**
   * Get conversation state value
   */
  async getStateValue<T = unknown>(conversationId: string, key: string): Promise<T | undefined> {
    const conversation = await this.getConversation(conversationId);
    return conversation?.state[key] as T | undefined;
  }

  /**
   * Set conversation state value
   */
  async setStateValue(conversationId: string, key: string, value: unknown): Promise<boolean> {
    const updated = await this.updateConversation(conversationId, { [key]: value });
    return updated !== null;
  }

  /**
   * Extend conversation TTL
   */
  async extendConversation(conversationId: string, additionalTtl: number): Promise<boolean> {
    try {
      const existing = await this.storage.get(conversationId);
      if (!existing) {
        return false;
      }

      const now = new Date();
      const currentExpiry = existing.expiresAt || new Date(now.getTime() + this.defaultTtl);
      const newExpiry = new Date(currentExpiry.getTime() + additionalTtl);

      const updatedState: BotConversationState = {
        ...existing,
        expiresAt: newExpiry,
        updatedAt: now
      };

      await this.storage.set(updatedState);
      logger.debug(`[ConversationManager] Extended conversation TTL: ${conversationId}`, {
        newExpiry
      });
      return true;
    } catch (error) {
      logger.error(`[ConversationManager] Failed to extend conversation: ${conversationId}`, error);
      return false;
    }
  }

  /**
   * Cleanup expired conversations
   */
  async cleanup(olderThan?: Date): Promise<number> {
    const cutoff = olderThan || new Date(Date.now() - this.defaultTtl);
    
    try {
      const cleaned = await this.storage.cleanup(cutoff);
      if (cleaned > 0) {
        logger.debug(`[ConversationManager] Cleaned up ${cleaned} conversations`);
      }
      return cleaned;
    } catch (error) {
      logger.error('[ConversationManager] Failed to cleanup conversations', error);
      return 0;
    }
  }

  /**
   * Get conversation statistics
   */
  async getStats(): Promise<{
    totalConversations: number;
    conversationsByBot: Record<string, number>;
    oldestConversation?: Date;
    newestConversation?: Date;
  }> {
    try {
      const conversations = await this.storage.list();
      const conversationsByBot: Record<string, number> = {};
      let oldestDate: Date | undefined;
      let newestDate: Date | undefined;

      for (const conversation of conversations) {
        // Count by bot
        conversationsByBot[conversation.botName] = (conversationsByBot[conversation.botName] || 0) + 1;
        
        // Track oldest/newest
        if (!oldestDate || conversation.createdAt < oldestDate) {
          oldestDate = conversation.createdAt;
        }
        if (!newestDate || conversation.createdAt > newestDate) {
          newestDate = conversation.createdAt;
        }
      }

      return {
        totalConversations: conversations.length,
        conversationsByBot,
        oldestConversation: oldestDate,
        newestConversation: newestDate
      };
    } catch (error) {
      logger.error('[ConversationManager] Failed to get stats', error);
      return {
        totalConversations: 0,
        conversationsByBot: {}
      };
    }
  }
}

/**
 * Global conversation manager instance
 */
export const conversationManager = new ConversationManager();