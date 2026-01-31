/**
 * Session Store for Xyne AI Agent using Custom PostgreSQL Provider
 */

import { randomUUID } from 'crypto';
import { logger } from '../../../utils/logger.js';
import { 
  createXyneAIMemoryProvider, 
  type XyneAIMemoryProvider,
  type MessageData,
  type XyneAIFeedback,
} from './customPostgresProvider';
import { convertMessagesToHistory } from './utils';
import type {
  XyneAISession,
  SessionContext,
  HistoryMessage,
  ToolInputContent,
  ToolOutputContent,
} from './types';
import type { XyneAIOutput } from '../types';

// Re-export XyneAIFeedback for external use
export type { XyneAIFeedback };

// ============================================================================
// Session Store Class
// ============================================================================

class XyneAISessionStore {
  private memoryProvider: XyneAIMemoryProvider | null = null;
  private initPromise: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (this.memoryProvider) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._doInitialize();
    return this.initPromise;
  }

  private async _doInitialize(): Promise<void> {
    try {
      this.memoryProvider = await createXyneAIMemoryProvider();
      await this.memoryProvider.initialize();
    } catch (error) {
      logger.error('[SessionStore] Failed to initialize:', error);
      throw error;
    }
  }

  private async ensureInitialized(): Promise<XyneAIMemoryProvider> {
    if (!this.memoryProvider) await this.initialize();
    if (!this.memoryProvider) throw new Error('[SessionStore] Memory provider not initialized');
    return this.memoryProvider;
  }

  generateSessionId(): string {
    return randomUUID();
  }

  // ============================================================================
  // Session Operations
  // ============================================================================

  async create(context: SessionContext): Promise<XyneAISession> {
    const provider = await this.ensureInitialized();
    const sessionId = this.generateSessionId();
    
    const metadata = {
      channelIds: context.channelIds,
      conversationId: context.conversationId,
    };
    
    const sessionData = await provider.createSession(sessionId, context.userId, metadata);
    
    logger.info(`[SessionStore] [${sessionId}] Created new session for user: ${context.userId}`);
    
    return {
      sessionId: sessionData.sessionId,
      context: { 
        userId: sessionData.userId,
        channelIds: context.channelIds,
        conversationId: context.conversationId,
      },
      history: [],
      createdAt: sessionData.createdAt.toISOString(),
      updatedAt: sessionData.updatedAt.toISOString(),
    };
  }

  async get(sessionId: string): Promise<XyneAISession | undefined> {
    try {
      const provider = await this.ensureInitialized();
      
      const sessionData = await provider.getSession(sessionId);
      if (!sessionData) return undefined;
      
      const messages = await provider.getMessages(sessionId);
      const history = convertMessagesToHistory(messages);
      
      // Extract channelIds and conversationId from metadata
      const metadata = sessionData.metadata || {};
      const channelIds = Array.isArray(metadata.channelIds) ? metadata.channelIds : [];
      const conversationId = typeof metadata.conversationId === 'string' ? metadata.conversationId : undefined;
      
      return {
        sessionId: sessionData.sessionId,
        context: { 
          userId: sessionData.userId,
          channelIds,
          conversationId,
        },
        history,
        createdAt: sessionData.createdAt.toISOString(),
        updatedAt: sessionData.updatedAt.toISOString(),
      };
    } catch (error) {
      logger.error(`[SessionStore] [${sessionId}] Error getting session:`, error);
      return undefined;
    }
  }

  async exists(sessionId: string): Promise<boolean> {
    const session = await this.get(sessionId);
    return session !== undefined;
  }

  async delete(sessionId: string): Promise<boolean> {
    try {
      const provider = await this.ensureInitialized();
      const result = await provider.deleteSession(sessionId);
      return result;
    } catch (error) {
      logger.error(`[SessionStore] [${sessionId}] Error deleting session:`, error);
      return false;
    }
  }

  // ============================================================================
  // Message Operations
  // ============================================================================

  async addUserMessage(
    sessionId: string, 
    query: string, 
    timestamp: string,
    traceId?: string
  ): Promise<XyneAISession | undefined> {
    try {
      const provider = await this.ensureInitialized();
      
      const content = { query, timestamp };
      await provider.addMessage(sessionId, 'USER', content, traceId);
      logger.info(`[SessionStore] [${sessionId}] Added user message`);
      return this.get(sessionId);
    } catch (error) {
      logger.error(`[SessionStore] [${sessionId}] Error adding user message:`, error);
      return undefined;
    }
  }

  async addToolInput(
    sessionId: string,
    toolName: string,
    input: unknown,
    traceId?: string
  ): Promise<void> {
    try {
      const provider = await this.ensureInitialized();
      
      const content: ToolInputContent = {
        type: 'tool_input',
        toolName,
        input,
      };
      
      await provider.addMessage(sessionId, 'TOOL_INPUT', content, traceId);
    } catch (error) {
      logger.error(`[SessionStore] [${sessionId}] Error adding TOOL_INPUT:`, error);
    }
  }

  async addToolOutput(
    sessionId: string,
    toolName: string,
    output: unknown,
    traceId?: string
  ): Promise<void> {
    try {
      const provider = await this.ensureInitialized();
      
      const content: ToolOutputContent = {
        type: 'tool_output',
        toolName,
        content: output,
      };
      
      await provider.addMessage(sessionId, 'TOOL_OUTPUT', content, traceId);
    } catch (error) {
      logger.error(`[SessionStore] [${sessionId}] Error adding TOOL_OUTPUT:`, error);
    }
  }

  async addAssistantMessage(
    sessionId: string, 
    output: XyneAIOutput,
    traceId?: string
  ): Promise<{ session: XyneAISession; messageId: string } | undefined> {
    try {
      const provider = await this.ensureInitialized();
      
      const messageData = await provider.addMessage(sessionId, 'ASSISTANT', output, traceId);
      logger.info(`[SessionStore] [${sessionId}] Added assistant message`);
      
      const session = await this.get(sessionId);
      if (!session) return undefined;
      
      return { session, messageId: messageData.messageId };
    } catch (error) {
      logger.error(`[SessionStore] [${sessionId}] Error adding assistant message:`, error);
      return undefined;
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  async updateMetadata(sessionId: string, metadata: Record<string, unknown>): Promise<boolean> {
    try {
      const provider = await this.ensureInitialized();
      return await provider.updateSessionMetadata(sessionId, metadata);
    } catch (error) {
      logger.error(`[SessionStore] [${sessionId}] Error updating metadata:`, error);
      return false;
    }
  }

  async updateMessageFeedback(messageId: string, feedback: XyneAIFeedback | null): Promise<boolean> {
    try {
      const provider = await this.ensureInitialized();
      return await provider.updateMessageFeedback(messageId, feedback);
    } catch (error) {
      logger.error(`[SessionStore] Error updating feedback for ${messageId}:`, error);
      return false;
    }
  }

  async getHistoryForContext(sessionId: string): Promise<HistoryMessage[]> {
    const session = await this.get(sessionId);
    if (!session) return [];
    return session.history;
  }

  async getRecentMessages(sessionId: string, limit: number = 50): Promise<MessageData[]> {
    try {
      const provider = await this.ensureInitialized();
      return await provider.getRecentMessages(sessionId, limit);
    } catch (error) {
      logger.error(`[SessionStore] [${sessionId}] Error getting recent messages:`, error);
      return [];
    }
  }

  async close(): Promise<void> {
    if (this.memoryProvider) {
      await this.memoryProvider.close();
      this.memoryProvider = null;
      this.initPromise = null;
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs?: number; error?: string }> {
    try {
      const provider = await this.ensureInitialized();
      return await provider.healthCheck();
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

// ============================================================================
// Exports
// ============================================================================

export const sessionStore = new XyneAISessionStore();

export async function initializeSessionStore(): Promise<void> {
  await sessionStore.initialize();
}

export async function shutdownSessionStore(): Promise<void> {
  await sessionStore.close();
}

export async function getOrCreateSession(
  sessionId: string | undefined,
  context: SessionContext
): Promise<{ session: XyneAISession; isNewSession: boolean }> {
  if (sessionId) {
    const existing = await sessionStore.get(sessionId);
    if (existing) {
      // Check if userId matches (session belongs to this user)
      if (existing.context.userId === context.userId) {
        // Check if channelIds have changed
        const existingChannelIds = existing.context.channelIds || [];
        const newChannelIds = context.channelIds || [];
        const channelIdsChanged = 
          existingChannelIds.length !== newChannelIds.length ||
          !existingChannelIds.every((id, idx) => id === newChannelIds[idx]);
        
        // If context has changed (different channel/conversation), update it
        if (
          channelIdsChanged ||
          existing.context.conversationId !== context.conversationId
        ) {
          const updatedMetadata = {
            channelIds: context.channelIds,
            conversationId: context.conversationId,
          };
          
          await sessionStore.updateMetadata(sessionId, updatedMetadata);
          
          logger.debug(`[XyneAI SessionStore] Updated session context: ${sessionId} -> channelIds: ${JSON.stringify(context.channelIds)}`);
          
          const updatedSession: XyneAISession = {
            ...existing,
            context: {
              userId: existing.context.userId,
              channelIds: context.channelIds,
              conversationId: context.conversationId,
            },
            updatedAt: new Date().toISOString(),
          };
          
          return { session: updatedSession, isNewSession: false };
        }
        
        return { session: existing, isNewSession: false };
      }
    }
  }

  const newSession = await sessionStore.create(context);
  return { session: newSession, isNewSession: true };
}
