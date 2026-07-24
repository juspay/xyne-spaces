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


const ASK_AI_STATUS = 'INTERACTIVE';

/**
 * Agent name → Workflow name mapping.
 * Every agent that uses the xyne-ai storage layer must be registered here.
 * The sidebar workflow ('Ask AI') is also the default for unknown/undefined agents.
 */
const AGENT_WORKFLOW_MAP = new Map<string, string>([
  ['ask-ai',       'Ask AI'],
  ['ask-ai-chat',  'Ask AI Chat'],
]);

const DEFAULT_WORKFLOW_NAME = 'Ask AI';

function getWorkflowNameForAgent(agentName?: string): string {
  if (!agentName) return DEFAULT_WORKFLOW_NAME;
  return AGENT_WORKFLOW_MAP.get(agentName) ?? DEFAULT_WORKFLOW_NAME;
}

export type XyneAIMessageRole = 'USER' | 'ASSISTANT' | 'TOOL_INPUT' | 'TOOL_OUTPUT' | 'SYSTEM';
export type XyneAIFeedback = 'LIKE' | 'DISLIKE';

export interface SessionMetadata {
  channelId?: string;
  channelIds?: string[];
  conversationId?: string; // threadConversationId
  title?: string;
  isStarred?: boolean;
  branchSelections?: Record<string, string>;
  feedbackMap?: Record<string, number>; // messageId → 0|1|2
  lastInputContext?: Record<string, unknown>;
}

export interface SessionData {
  sessionId: string;
  userId: string;
  metadata: SessionMetadata;
  tag: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionListItem {
  sessionId: string;
  title: string;
  channelId: string;
  threadConversationId?: string;
  isStarred: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastInputContext?: Record<string, unknown>;
}

export interface MessageData {
  messageId: string;
  sessionId: string;
  role: XyneAIMessageRole;
  content: unknown;
  attachment?: AttachmentMetadata[];  // GCS attachment metadata from attachment column
  previousStepId?: string | null;  // Parent message ID for tree structure
  traceId?: string;
  feedback?: XyneAIFeedback | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface XyneAIMemoryProvider {
  createSession(sessionId: string, userId: string, metadata?: SessionMetadata, agentName?: string): Promise<SessionData>;
  getSession(sessionId: string): Promise<SessionData | null>;
  updateSessionMetadata(sessionId: string, metadata: Partial<SessionMetadata>): Promise<boolean>;
  getSessionsByUser(userId: string, conversationId?: string): Promise<SessionData[]>;
  deleteSession(sessionId: string): Promise<boolean>;
  getUserSessions(userId: string, agentName?: string): Promise<SessionListItem[]>;
  findActiveSessionId(userId: string, conversationId: string, tagFilter?: string | { not: string }): Promise<string | null>;
  addMessage(sessionId: string, role: XyneAIMessageRole, content: unknown, traceId?: string, attachmentMetadata?: AttachmentMetadata[], previousStepId?: string): Promise<MessageData>;
  getMessages(sessionId: string): Promise<MessageData[]>;
  getMessagesForPath(sessionId: string, leafMessageId: string): Promise<MessageData[]>;
  getRecentMessages(sessionId: string, limit?: number): Promise<MessageData[]>;
  updateMessageFeedback(messageId: string, feedback: XyneAIFeedback | null): Promise<boolean>;
  initialize(): Promise<void>;
  close(): Promise<void>;
  healthCheck(): Promise<{ healthy: boolean; latencyMs?: number; error?: string }>;
}

export async function createXyneAIMemoryProvider(): Promise<XyneAIMemoryProvider> {
  const workflowIdCache = new Map<string, string>();
  const userWorkspaceCache = new Map<string, string>();

  const resolveWorkspaceId = async (userId: string): Promise<string> => {
    const cached = userWorkspaceCache.get(userId);
    if (cached) return cached;
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { workspaceId: true },
    });
    if (!user) {
      throw new Error(`[XyneAIMemoryProvider] user ${userId} not found — cannot resolve workspace`);
    }
    userWorkspaceCache.set(userId, user.workspaceId);
    return user.workspaceId;
  };

  const getOrCreateWorkflow = async (
    workflowName: string,
    workspaceId: string,
  ): Promise<string> => {
    const cacheKey = `${workflowName}::${workspaceId}`;
    const cached = workflowIdCache.get(cacheKey);
    if (cached) return cached;

    const existing = await db.workflow.findFirst({
      where: { workflowName, workspaceId },
      select: { id: true },
    });

    if (existing) {
      workflowIdCache.set(cacheKey, existing.id);
      return existing.id;
    }

    const workflow = await db.workflow.create({
      data: {
        workflowName,
        workspaceId,
        status: 'NEW',
      },
    });

    const id = workflow.id as string;
    workflowIdCache.set(cacheKey, id);
    logger.info(
      `[XyneAIMemoryProvider] Created workflow '${workflowName}' for workspace ${workspaceId}: ${id}`,
    );
    return id;
  };

  const getOrCreateAskAIWorkflow = async (
    userId: string,
    agentName?: string,
  ): Promise<string> => {
    const workspaceId = await resolveWorkspaceId(userId);
    return getOrCreateWorkflow(getWorkflowNameForAgent(agentName), workspaceId);
  };

  const initialize = async (): Promise<void> => {
    logger.info('[XyneAIMemoryProvider] Initialized');
  };

  const createSession = async (
    sessionId: string,
    userId: string,
    metadata?: SessionMetadata,
    agentName?: string,
  ): Promise<SessionData> => {
    try {
      const workflowId = await getOrCreateAskAIWorkflow(userId, agentName);
      const workspaceId = await resolveWorkspaceId(userId);
      const uuid = sessionId || randomUUID();

      const execution = await db.workflowExecution.create({
        data: {
          id: uuid,
          workspaceId,
          workflowId,
          status: ASK_AI_STATUS,
          tag: 'root',
          ignoreDuration: 0,
          context: metadata ? JSON.stringify(metadata) : null,
        },
      });

      await db.workflowExecutionUsers.create({
        data: {
          workspaceId,
          userId,
          workflowExecutionId: uuid,
        },
      });

      logger.info(`[XyneAIMemoryProvider] [${uuid}] Created session for user ${userId}`);

      return {
        sessionId: execution.id,
        userId,
        metadata: metadata || {},
        tag: execution.tag,
        createdAt: execution.createdAt,
        updatedAt: execution.updatedAt,
      };
    } catch (error) {
      logger.error(`[XyneAIMemoryProvider] [${sessionId}] Failed to create session:`, error);
      throw error;
    }
  };

  const parseSessionMetadata = (context: string | null): SessionMetadata => {
    if (!context) return {};
    try {
      return JSON.parse(context) as SessionMetadata;
    } catch {
      return {};
    }
  };

  const getSession = async (sessionId: string): Promise<SessionData | null> => {
    try {
      const execution = await db.workflowExecution.findUnique({
        where: { id: sessionId },
        include: { workflow: { select: { workflowName: true } } },
      });

      if (!execution) return null;
      // Only accept sessions that belong to a registered agent workflow
      const knownWorkflows = new Set(AGENT_WORKFLOW_MAP.values());
      if (!execution.workflow.workflowName || !knownWorkflows.has(execution.workflow.workflowName)) return null;

      const userMapping = await db.workflowExecutionUsers.findFirst({
        where: { workflowExecutionId: sessionId },
        select: { userId: true },
      });

      return {
        sessionId: execution.id,
        userId: userMapping?.userId || '',
        metadata: parseSessionMetadata(execution.context),
        tag: execution.tag,
        createdAt: execution.createdAt,
        updatedAt: execution.updatedAt,
      };
    } catch (error) {
      logger.error(`[XyneAIMemoryProvider] [${sessionId}] Failed to get session:`, error);
      throw error;
    }
  };

  const updateSessionMetadata = async (sessionId: string, metadata: Partial<SessionMetadata>): Promise<boolean> => {
    try {
      const execution = await db.workflowExecution.findUnique({
        where: { id: sessionId },
        select: { context: true },
      });

      if (!execution) return false;

      const existingMetadata = parseSessionMetadata(execution?.context ?? null);
      const mergedMetadata = { ...existingMetadata, ...metadata };

      await db.workflowExecution.update({
        where: { id: sessionId },
        data: { context: JSON.stringify(mergedMetadata) },
      });

      return true;
    } catch (error) {
      logger.error(`[XyneAIMemoryProvider] [${sessionId}] Failed to update metadata:`, error);
      return false;
    }
  };

  const generateTitleFromQuery = (query: string): string => {
    const trimmed = query.trim();
    return trimmed.length > 50 ? trimmed.substring(0, 50) + '...' : trimmed;
  };

  const getSessionsByUser = async (userId: string, conversationId?: string): Promise<SessionData[]> => {
    try {
      const workflowId = await getOrCreateAskAIWorkflow(userId);

      const userMappings = await db.workflowExecutionUsers.findMany({
        where: { userId },
        select: { workflowExecutionId: true },
      });

      if (userMappings.length === 0) return [];

      const executionIds = userMappings.map(m => m.workflowExecutionId);

      const executions = await db.workflowExecution.findMany({
        where: {
          id: { in: executionIds },
          workflowId,
        },
        orderBy: { updatedAt: 'desc' },
      });

      const sessions: SessionData[] = executions.map(execution => {
        let metadata: Record<string, unknown> = {};
        if (execution.context) {
          try {
            const parsed = JSON.parse(execution.context);
            if (parsed && typeof parsed === 'object') {
              metadata = parsed;
            }
          } catch {
            // ignore parse errors
          }
        }
        return {
          sessionId: execution.id,
          userId,
          metadata,
          tag: execution.tag,
          createdAt: execution.createdAt,
          updatedAt: execution.updatedAt,
        };
      });

      if (conversationId) {
        return sessions.filter(s => s.metadata?.conversationId === conversationId);
      }

      return sessions;
    } catch (error) {
      logger.error(`[XyneAIMemoryProvider] Failed to get sessions for user ${userId}:`, error);
      return [];
    }
  };

  const getUserSessions = async (userId: string): Promise<SessionListItem[]> => {
    try {
      const workflowId = await getOrCreateAskAIWorkflow(userId);

      // Find all session IDs for this user
      const userMappings = await db.workflowExecutionUsers.findMany({
        where: { userId },
        select: { workflowExecutionId: true },
      });
      const sessionIds = userMappings.map(m => m.workflowExecutionId);
      if (sessionIds.length === 0) return [];

      const sessions = await db.workflowExecution.findMany({
        where: {
          id: { in: sessionIds },
          workflowId,
        },
        include: {
          workflowSteps: {
            where: {
              stepExecutorType: 'agent',
              stepName: 'USER',
            },
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { data: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
      });

      return sessions.map(session => {
        const metadata = parseSessionMetadata(session.context);

        // Title: use custom title if set, otherwise auto-generate from first user message
        let title = metadata.title || 'New conversation';
        if (!metadata.title && session.workflowSteps.length > 0 && session.workflowSteps[0]!.data) {
          try {
            const content = JSON.parse(session.workflowSteps[0]!.data);
            if (content.query) {
              title = generateTitleFromQuery(content.query);
            }
          } catch { /* keep default */ }
        }

        return {
          sessionId: session.id,
          title,
          channelId: metadata.channelId || (metadata.channelIds?.[0] ?? ''),
          threadConversationId: metadata.conversationId,
          isStarred: metadata.isStarred || false,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          lastInputContext: metadata.lastInputContext,
        };
      });
    } catch (error) {
      logger.error(`[XyneAIMemoryProvider] Failed to get sessions for user ${userId}:`, error);
      throw error;
    }
  };

  const findActiveSessionId = async (
    userId: string,
    conversationId: string,
    tagFilter: string | { not: string } = { not: 'autodraft' },
  ): Promise<string | null> => {
    try {
      const userMappings = await db.workflowExecutionUsers.findMany({
        where: { userId },
        select: { workflowExecutionId: true },
      });
      if (userMappings.length === 0) return null;
      const row = await db.workflowExecution.findFirst({
        where: {
          id: { in: userMappings.map(m => m.workflowExecutionId) },
          context: { contains: `"conversationId":"${conversationId}"` },
          tag: tagFilter,
        },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      });
      return row?.id ?? null;
    } catch (error) {
      logger.error(
        `[XyneAIMemoryProvider] findActiveSessionId failed for user=${userId} conv=${conversationId}:`,
        error,
      );
      throw error;
    }
  };

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
    attachmentMetadata?: AttachmentMetadata[],
    previousStepId?: string
  ): Promise<MessageData> => {
    try {
      const messageId = randomUUID();

      // Convert attachment metadata to JSON string for storage
      const attachmentJson = attachmentMetadata && attachmentMetadata.length > 0
        ? JSON.stringify(attachmentMetadata)
        : null;

      const parentExecution = await db.workflowExecution.findUniqueOrThrow({
        where: { id: sessionId },
        select: { workspaceId: true, workflow: { select: { workspaceId: true } } },
      });

      const step = await db.workflowStep.create({
        data: {
          id: messageId,
          // WorkflowExecution.workspaceId is nullable; fall back to the parent workflow
          // (Workflow.workspaceId is NOT NULL) so a legacy null-workspace execution does
          // not propagate NULL onto the step.
          workspaceId: parentExecution.workspaceId ?? parentExecution.workflow.workspaceId,
          workflowExecutionId: sessionId,
          stepExecutorType: 'agent',
          stepName: role,
          data: JSON.stringify(content),
          attachment: attachmentJson,
          ...(previousStepId && { previousStepId }),
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
        previousStepId: step.previousStepId,
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
    previousStepId: string | null;
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
        previousStepId: step.previousStepId,
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
          previousStepId: true,
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
          previousStepId: true,
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

  /**
   * Walk the message tree from a leaf message back to root via previousStepId.
   * Returns messages in chronological order (root → leaf).
   * Falls back to full chronological order if no tree structure is found.
   */
  const getMessagesForPath = async (sessionId: string, leafMessageId: string): Promise<MessageData[]> => {
    try {
      const allMessages = await getMessages(sessionId);
      const messageMap = new Map(allMessages.map(m => [m.messageId, m]));

      // Walk from leaf to root
      const path: MessageData[] = [];
      let currentId: string | null | undefined = leafMessageId;
      const visited = new Set<string>();

      while (currentId) {
        if (visited.has(currentId)) break; // prevent cycles
        visited.add(currentId);
        const msg = messageMap.get(currentId);
        if (!msg) break;
        path.unshift(msg);
        currentId = msg.previousStepId;
      }

      // If we found a valid path, return it
      if (path.length > 0) return path;

      // Fallback: return all messages in chronological order (legacy sessions)
      return allMessages;
    } catch (error) {
      logger.error(`[XyneAIMemoryProvider] [${sessionId}] Failed to get messages for path:`, error);
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
    getSessionsByUser,
    deleteSession,
    getUserSessions,
    findActiveSessionId,
    addMessage,
    getMessages,
    getMessagesForPath,
    getRecentMessages,
    updateMessageFeedback,
    initialize,
    close,
    healthCheck,
  };
}
