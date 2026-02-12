/**
 * Custom PostgreSQL Memory Provider for Xyne AI using Workflow Tables
 * 
 * Uses existing Workflow/WorkflowExecution/WorkflowStep tables:
 * - Workflow: 1 row with workflowName = "Ask AI"
 * - WorkflowExecution: Sessions (session_id = execution id, UUID format)
 * - WorkflowStep: Messages (stepName = role, data = content JSON)
 * - WorkflowExecutionUsers: Maps userId to session via FK
 */

import { randomUUID } from 'crypto';
import { db } from '../../../database/client.js';
import { logger } from '../../../utils/logger.js';
import type { AttachmentMetadata } from './types.js';


const ASK_AI_WORKFLOW_NAME = 'Ask AI';
const ASK_AI_STATUS = 'INTERACTIVE';

export type XyneAIMessageRole = 'USER' | 'ASSISTANT' | 'TOOL_INPUT' | 'TOOL_OUTPUT' | 'SYSTEM';
export type XyneAIFeedback = 'LIKE' | 'DISLIKE';

export interface SessionData {
  sessionId: string;
  userId: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageData {
  messageId: string;
  sessionId: string;
  role: XyneAIMessageRole;
  content: unknown;
  attachment?: AttachmentMetadata[];  // GCS attachment metadata from attachment column
  traceId?: string;
  feedback?: XyneAIFeedback | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface XyneAIMemoryProvider {
  createSession(sessionId: string, userId: string, metadata?: Record<string, unknown>): Promise<SessionData>;
  getSession(sessionId: string): Promise<SessionData | null>;
  updateSessionMetadata(sessionId: string, metadata: Record<string, unknown>): Promise<boolean>;
  deleteSession(sessionId: string): Promise<boolean>;
  addMessage(sessionId: string, role: XyneAIMessageRole, content: unknown, traceId?: string, attachmentMetadata?: AttachmentMetadata[]): Promise<MessageData>;
  getMessages(sessionId: string): Promise<MessageData[]>;
  getRecentMessages(sessionId: string, limit?: number): Promise<MessageData[]>;
  updateMessageFeedback(messageId: string, feedback: XyneAIFeedback | null): Promise<boolean>;
  initialize(): Promise<void>;
  close(): Promise<void>;
  healthCheck(): Promise<{ healthy: boolean; latencyMs?: number; error?: string }>;
}

export async function createXyneAIMemoryProvider(): Promise<XyneAIMemoryProvider> {
  let askAIWorkflowId: string | null = null;

  const getOrCreateAskAIWorkflow = async (): Promise<string> => {
    if (askAIWorkflowId) return askAIWorkflowId;
    
    const existing = await db.workflow.findFirst({
      where: { workflowName: ASK_AI_WORKFLOW_NAME },
      select: { id: true },
    });
    
    if (existing) {
      askAIWorkflowId = existing.id;
      return askAIWorkflowId;
    }
    
    const workflow = await db.workflow.create({
      data: {
        workflowName: ASK_AI_WORKFLOW_NAME,
        status: 'NEW',
      },
    });
    
    askAIWorkflowId = workflow.id as string;
    logger.info(`[XyneAIMemoryProvider] Created Ask AI workflow: ${askAIWorkflowId}`);
    return askAIWorkflowId;
  };

  const initialize = async (): Promise<void> => {
    try {
      await getOrCreateAskAIWorkflow();
      logger.info('[XyneAIMemoryProvider] Initialized');
    } catch (error) {
      logger.error('[XyneAIMemoryProvider] Failed to initialize:', error);
      throw error;
    }
  };

  const createSession = async (
    sessionId: string,
    userId: string,
  ): Promise<SessionData> => {
    try {
      const workflowId = await getOrCreateAskAIWorkflow();
      const uuid = sessionId || randomUUID();
      
      const execution = await db.workflowExecution.create({
        data: {
          id: uuid,
          workflowId,
          status: ASK_AI_STATUS,
          tag: 'root',
          ignoreDuration: 0,
        },
      });
      
      await db.workflowExecutionUsers.create({
        data: {
          userId,
          workflowExecutionId: uuid,
        },
      });
      
      logger.info(`[XyneAIMemoryProvider] [${uuid}] Created session for user ${userId}`);
      
      return {
        sessionId: execution.id,
        userId,
        metadata: {},
        createdAt: execution.createdAt,
        updatedAt: execution.updatedAt,
      };
    } catch (error) {
      logger.error(`[XyneAIMemoryProvider] [${sessionId}] Failed to create session:`, error);
      throw error;
    }
  };

  const getSession = async (sessionId: string): Promise<SessionData | null> => {
    try {
      const execution = await db.workflowExecution.findUnique({
        where: { id: sessionId },
        include: { workflow: { select: { workflowName: true } } },
      });
      
      if (!execution) return null;
      if (execution.workflow.workflowName !== ASK_AI_WORKFLOW_NAME) return null;
      
      const userMapping = await db.workflowExecutionUsers.findFirst({
        where: { workflowExecutionId: sessionId },
        select: { userId: true },
      });
      
      return {
        sessionId: execution.id,
        userId: userMapping?.userId || '',
        metadata: {},
        createdAt: execution.createdAt,
        updatedAt: execution.updatedAt,
      };
    } catch (error) {
      logger.error(`[XyneAIMemoryProvider] [${sessionId}] Failed to get session:`, error);
      throw error;
    }
  };

  const updateSessionMetadata = async (): Promise<boolean> => true;

  const deleteSession = async (sessionId: string): Promise<boolean> => {
    try {
      // 1. Delete user mapping
      await db.workflowExecutionUsers.deleteMany({
        where: { workflowExecutionId: sessionId },
      });
      
      // 2. Delete all messages/steps for this session
      await db.workflowStep.deleteMany({
        where: { workflowExecutionId: sessionId },
      });
      
      // 3. Delete the session (workflow execution)
      await db.workflowExecution.delete({ where: { id: sessionId } });
      
      logger.info(`[XyneAIMemoryProvider] [${sessionId}] Deleted session and all messages`);
      return true;
    } catch (error) {
      logger.error(`[XyneAIMemoryProvider] [${sessionId}] Failed to delete session:`, error);
      return false;
    }
  };

  const addMessage = async (
    sessionId: string,
    role: XyneAIMessageRole,
    content: unknown,
    traceId?: string,
    attachmentMetadata?: AttachmentMetadata[]
  ): Promise<MessageData> => {
    try {
      const messageId = randomUUID();

      // Convert attachment metadata to JSON string for storage
      const attachmentJson = attachmentMetadata && attachmentMetadata.length > 0
        ? JSON.stringify(attachmentMetadata)
        : null;

      const step = await db.workflowStep.create({
        data: {
          id: messageId,
          workflowExecutionId: sessionId,
          stepExecutorType: 'agent',
          stepName: role,
          data: JSON.stringify(content),
          attachment: attachmentJson,
        },
      });
      
      await db.workflowExecution.update({
        where: { id: sessionId },
        data: { updatedAt: new Date() },
      });
      
      logger.info(`[XyneAIMemoryProvider] [${sessionId}] Added ${role} message`);
      
      return {
        messageId: step.id,
        sessionId,
        role,
        content,
        traceId,
        createdAt: step.createdAt,
        updatedAt: step.updatedAt,
      };
    } catch (error) {
      logger.error(`[XyneAIMemoryProvider] [${sessionId}] Failed to add message:`, error);
      throw error;
    }
  };

  const parseStepToMessage = (step: {
    id: string;
    workflowExecutionId: string;
    stepName: string | null;
    data: string | null;
    attachment: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): MessageData | null => {
    if (!step.data || !step.stepName) return null;
    
    try {
      // Parse attachment metadata if exists
      let attachmentMetadata: AttachmentMetadata[] | undefined;
      if (step.attachment) {
        try {
          const parsed = JSON.parse(step.attachment);
          // Handle both array and single object formats
          attachmentMetadata = Array.isArray(parsed) ? parsed : [parsed];
        } catch (error) {
          logger.warn(`[XyneAIMemoryProvider] Failed to parse attachment metadata for step ${step.id}:`, error);
        }
      }

      return {
        messageId: step.id,
        sessionId: step.workflowExecutionId,
        role: step.stepName as XyneAIMessageRole,
        content: JSON.parse(step.data),
        attachment: attachmentMetadata,
        createdAt: step.createdAt,
        updatedAt: step.updatedAt,
      };
    } catch {
      return null;
    }
  };

  const getMessages = async (sessionId: string): Promise<MessageData[]> => {
    try {
      const steps = await db.workflowStep.findMany({
        where: { workflowExecutionId: sessionId, stepExecutorType: 'agent' },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          workflowExecutionId: true,
          stepName: true,
          data: true,
          attachment: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      
      return steps.map(parseStepToMessage).filter((msg): msg is MessageData => msg !== null);
    } catch (error) {
      logger.error(`[XyneAIMemoryProvider] [${sessionId}] Failed to get messages:`, error);
      throw error;
    }
  };

  const getRecentMessages = async (sessionId: string, limit: number = 50): Promise<MessageData[]> => {
    try {
      const steps = await db.workflowStep.findMany({
        where: { workflowExecutionId: sessionId, stepExecutorType: 'agent' },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          workflowExecutionId: true,
          stepName: true,
          data: true,
          attachment: true, 
          createdAt: true,
          updatedAt: true,
        },
      });
      
      return steps.reverse().map(parseStepToMessage).filter((msg): msg is MessageData => msg !== null);
    } catch (error) {
      logger.error(`[XyneAIMemoryProvider] [${sessionId}] Failed to get recent messages:`, error);
      throw error;
    }
  };

  const updateMessageFeedback = async (): Promise<boolean> => true;

  const close = async (): Promise<void> => {};

  const healthCheck = async (): Promise<{ healthy: boolean; latencyMs?: number; error?: string }> => {
    const start = Date.now();
    try {
      await db.$queryRaw`SELECT 1`;
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  };

  return {
    createSession,
    getSession,
    updateSessionMetadata,
    deleteSession,
    addMessage,
    getMessages,
    getRecentMessages,
    updateMessageFeedback,
    initialize,
    close,
    healthCheck,
  };
}
