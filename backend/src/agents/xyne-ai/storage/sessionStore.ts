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
  type SessionListItem,
  type SessionMetadata,
} from './customPostgresProvider';
import { convertMessagesToHistory } from './utils';
import type {
  XyneAISession,
  SessionContext,
  HistoryMessage,
  ToolInputContent,
  ToolOutputContent,
  AttachmentMetadata,
} from './types';
import type { XyneAIOutput, AttachmentData } from '../types';
import { uploadXyneAIAttachments } from '../../../services/attachmentUploadService.js';

// Re-export types for external use
export type { XyneAIFeedback, SessionListItem, SessionMetadata };

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

    const metadata: SessionMetadata = {
      channelId: context.channelIds[0],
      channelIds: context.channelIds,
      conversationId: context.conversationId,
    };

    const sessionData = await provider.createSession(sessionId, context.userId, metadata, context.agentName);
    
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
      const history = await convertMessagesToHistory(messages);  // Now async - fetches attachments from GCS
      
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
    attachments?: AttachmentData[],
    traceId?: string,
    previousStepId?: string
  ): Promise<{ session: XyneAISession | undefined; messageId: string }> {
    try {
      const provider = await this.ensureInitialized();

      // Upload attachments to GCS if provided
      let attachmentMetadata: AttachmentMetadata[] | undefined;
      if (attachments && attachments.length > 0) {
        try {
          attachmentMetadata = await uploadXyneAIAttachments(attachments, sessionId);
          logger.info(`[SessionStore] [${sessionId}] Successfully uploaded ${attachmentMetadata.length} attachment(s) to GCS`);
        } catch (error) {
          logger.error(`[SessionStore] [${sessionId}] Failed to upload attachments to GCS:`, error);
          throw new Error(`Failed to upload attachments: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      // Store only query and timestamp in data column (no attachments)
      const content = {
        query,
        timestamp,
      };

      // Pass attachment metadata to provider for storage in attachment column
      const messageData = await provider.addMessage(sessionId, 'USER', content, traceId, attachmentMetadata, previousStepId);

      const session = await this.get(sessionId);
      return { session, messageId: messageData.messageId };
    } catch (error) {
      logger.error(`[SessionStore] [${sessionId}] Error adding user message:`, error);
      return { session: undefined, messageId: '' };
    }
  }

  async addToolInput(
    sessionId: string,
    toolName: string,
    input: unknown,
    traceId?: string,
    previousStepId?: string
  ): Promise<string> {
    try {
      const provider = await this.ensureInitialized();

      const content: ToolInputContent = {
        type: 'tool_input',
        toolName,
        input,
      };

      const messageData = await provider.addMessage(sessionId, 'TOOL_INPUT', content, traceId, undefined, previousStepId);
      return messageData.messageId;
    } catch (error) {
      logger.error(`[SessionStore] [${sessionId}] Error adding TOOL_INPUT:`, error);
      return '';
    }
  }

  async addToolOutput(
    sessionId: string,
    toolName: string,
    output: unknown,
    traceId?: string,
    previousStepId?: string
  ): Promise<string> {
    try {
      const provider = await this.ensureInitialized();

      const content: ToolOutputContent = {
        type: 'tool_output',
        toolName,
        content: output,
      };

      const messageData = await provider.addMessage(sessionId, 'TOOL_OUTPUT', content, traceId, undefined, previousStepId);
      return messageData.messageId;
    } catch (error) {
      logger.error(`[SessionStore] [${sessionId}] Error adding TOOL_OUTPUT:`, error);
      return '';
    }
  }

  async addAssistantMessage(
    sessionId: string,
    output: XyneAIOutput,
    traceId?: string,
    previousStepId?: string
  ): Promise<{ session: XyneAISession; messageId: string } | undefined> {
    try {
      const provider = await this.ensureInitialized();

      const messageData = await provider.addMessage(sessionId, 'ASSISTANT', output, traceId, undefined, previousStepId);
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

  async getUserSessions(userId: string, conversationId?: string): Promise<SessionListItem[]> {
    try {
      const provider = await this.ensureInitialized();
      const sessions = await provider.getUserSessions(userId);
      if (conversationId) {
        return sessions.filter(s => s.threadConversationId === conversationId);
      }
      return sessions;
    } catch (error) {
      logger.error(`[SessionStore] Error getting sessions for user ${userId}:`, error);
      return [];
    }
  }

  async getRawMessages(sessionId: string): Promise<MessageData[]> {
    try {
      const provider = await this.ensureInitialized();
      return await provider.getMessages(sessionId);
    } catch (error) {
      logger.error(`[SessionStore] [${sessionId}] Error getting raw messages:`, error);
      return [];
    }
  }

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

  async getHistoryForPath(sessionId: string, leafMessageId: string): Promise<HistoryMessage[]> {
    try {
      const provider = await this.ensureInitialized();
      const messages = await provider.getMessagesForPath(sessionId, leafMessageId);
      return await convertMessagesToHistory(messages);
    } catch (error) {
      logger.error(`[SessionStore] [${sessionId}] Error getting history for path:`, error);
      return [];
    }
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

  // Before creating a new session, check if one already exists for this (userId, conversationId)
  if (context.conversationId) {
    const existingSessions = await sessionStore.getUserSessions(context.userId, context.conversationId);
    if (existingSessions.length > 0 && existingSessions[0]) {
      const existing = await sessionStore.get(existingSessions[0].sessionId);
      if (existing) {
        logger.info(`[XyneAI SessionStore] Found existing session ${existing.sessionId} for conversationId: ${context.conversationId}`);
        return { session: existing, isNewSession: false };
      }
    }
  }

  const newSession = await sessionStore.create(context);
  return { session: newSession, isNewSession: true };
}
