// Helper functions for Xyne Auto RCA Workflow

import axios from 'axios';
import FormData from 'form-data';
import { v4 as uuidv4 } from 'uuid';
import { repositories } from '@/database/repositories';
import { config } from '@/config/env';
import { convert } from 'html-to-text';
import { logger } from '@/utils/logger';
import { getCanvasUrl } from '@/services/canvasService';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service';
import { DatabaseClient } from '@/database/client';
import {
  RequestHandlerSuccess,
  ExternalStepRequestResult,
} from '../../workflow-types';
import type {
  RcaInvestigationStatusResponse,
  RcaInvestigationStepResult,
  RcaWebhookPayload,
  TicketDetails,
  RcaUserContext,
  CanvasResult,
  ShareCanvasResult,
} from './types';

// Backend URL for webhook callbacks
const BACKEND_URL = process.env.BACKEND_URL;
const prisma = DatabaseClient.getInstance();

/**
 * Strip HTML tags and convert to plain text
 */
export const stripHtml = (html: string): string => {
  if (!html || html.trim() === '') {
    return '';
  }

  try {
    return convert(html, {
      wordwrap: false,
      preserveNewlines: false,
      selectors: [
        { selector: 'h1', options: { uppercase: false } },
        { selector: 'h2', options: { uppercase: false } },
        { selector: 'h3', options: { uppercase: false } },
        { selector: 'h4', options: { uppercase: false } },
        { selector: 'h5', options: { uppercase: false } },
        { selector: 'h6', options: { uppercase: false } },
        { selector: 'br', format: 'skip' }
      ],
      formatters: {
        'anchor': (elem, walk, builder) => walk(elem.children, builder)
      }
    }).replace(/\s+/g, ' ').trim();
  } catch (error) {
    logger.error('Error converting HTML to plain text in xyne-auto-rca workflow:', error);
    return html
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }
};

/**
 * Fetch ticket details from database using repository pattern
 */
export const fetchTicketDetails = async (ticketId: string): Promise<TicketDetails> => {
  const ticket = await repositories.tickets.getTicketById(ticketId);

  if (!ticket) {
    throw new Error(`Ticket not found: ${ticketId}`);
  }

  return {
    id: ticket.id,
    title: ticket.title,
    description: ticket.description || '',
    metadata: (ticket.metadata as Record<string, any>) || {},
    createdBy: ticket.createdBy,
  };
};


export const fetchExecutionCreatedBy = async (executionId: string): Promise<string | null> => {
  return await repositories.workflowExecutions.getCreatedBy(executionId);
};

/**
 * Fetch user context from the user who triggered the workflow
 */
export const fetchUserContext = async (userId: string): Promise<RcaUserContext> => {
  const user = await repositories.users.findById(userId);

  if (!user) {
    throw new Error(`User not found: ${userId}`);
  }

  return {
    email: user.email,
    userId: user.id,
    userName: user.name,
  };
};

/**
 * Initiate RCA investigation using the /api/v3/investigation/ endpoint
 * Uses multipart/form-data format with notification webhook
 */
export const initiateRcaInvestigationAndWaitForWebhook = async (
  workflowExecutionId: string,
  workflowStepId: string,
  query: string,
  userContext: RcaUserContext,
  affectedUserEmail: string
): Promise<ExternalStepRequestResult<never>> => {
  // Build webhook URL for callback
  const webhookUrl = `${BACKEND_URL}/api/external-step-response?workflowExecutionId=${encodeURIComponent(workflowExecutionId)}&workflowStepId=${encodeURIComponent(workflowStepId)}`;

  // Build webhook headers
  const webhookHeaders = JSON.stringify({
    'Content-Type': 'application/json',
  });

  // Append affected user email to the query
  const queryWithEmail = `${query}\n\nAffected User Email: ${affectedUserEmail}`;

  // Create FormData for multipart/form-data request
  const formData = new FormData();
  formData.append('query', queryWithEmail);
  formData.append('stream', 'false');
  formData.append('notification_webhook', webhookUrl);
  formData.append('notification_webhook_headers', webhookHeaders);

  logger.info(`[XyneAutoRCA] Initiating investigation with query: ${query.substring(0, 100)}..., affected user: ${affectedUserEmail}`);

  const response = await axios.post(
    `${config.genius.apiUrl}/api/v3/investigation/`,
    formData,
    {
      headers: {
        ...formData.getHeaders(),
        'Authorization': `Basic ${config.xyne.apiKey}`,
        'x-source': 'XyneSpaces',
        'x-source-config': 'xyne_rca',
        'X-Xyne-User-Email': userContext.email,
        'X-Xyne-User-Id': userContext.userId,
        'X-Xyne-User-Name': userContext.userName,
      },
    }
  );

  const result = response.data as { status: string; session_id?: string };

  // API returns: queued, processing, completed, failed, cancelled
  // Only fail on explicit failure states - queued/processing mean request was accepted
  const failureStatuses = ['failed', 'cancelled'];
  if (failureStatuses.includes(result.status)) {
    throw new Error(`RCA investigation failed to start. Status: ${result.status}`);
  }

  logger.info(`[XyneAutoRCA] Investigation initiated (status: ${result.status}), session: ${result.session_id}`);

  return RequestHandlerSuccess();
};

/**
 * Process webhook response from RCA investigation
 */
export const processRcaWebhookResponse = async (
  rawResponse: string
): Promise<RcaInvestigationStepResult> => {
  let payload: RcaWebhookPayload;
  try {
    payload = JSON.parse(rawResponse);
  } catch (e) {
    throw new Error(`Failed to parse RCA webhook payload: ${rawResponse}`);
  }

  const { session_id, status, error } = payload;

  if (!session_id) {
    throw new Error(`Missing session_id in webhook payload: ${rawResponse}`);
  }

  if (status === 'failed') {
    throw new Error(`RCA investigation failed: ${error || 'Unknown error'}`);
  }

  if (status !== 'completed') {
    throw new Error(`Unexpected webhook status: ${status}. Expected 'completed' or 'failed'.`);
  }

  logger.info(`[XyneAutoRCA] Investigation completed for session: ${session_id}`);

  return { sessionId: session_id, status };
};

/**
 * Fetch completed investigation result using POST with session_id
 * Per documented flow: POST /api/v3/investigation/ with { session_id, stream: false }
 */
export const fetchCompletedInvestigation = async (
  sessionId: string,
  userContext: RcaUserContext
): Promise<RcaInvestigationStatusResponse> => {
  logger.info(`[XyneAutoRCA] Fetching completed investigation for session: ${sessionId}`);

  // Create FormData with session_id and stream=false (no query)
  const formData = new FormData();
  formData.append('session_id', sessionId);
  formData.append('stream', 'false');

  const response = await axios.post(
    `${config.genius.apiUrl}/api/v3/investigation/`,
    formData,
    {
      headers: {
        ...formData.getHeaders(),
        'Authorization': `Basic ${config.xyne.apiKey}`,
        'x-source': 'XyneSpaces',
        'x-source-config': 'xyne_rca',
        'X-Xyne-User-Email': userContext.email,
        'X-Xyne-User-Id': userContext.userId,
        'X-Xyne-User-Name': userContext.userName,
      },
    }
  );

  const result = response.data as RcaInvestigationStatusResponse;

  if (result.status !== 'completed') {
    throw new Error(
      `Investigation not completed. Status: ${result.status}. ` +
      `Expected 'completed' after webhook notification.`
    );
  }

  if (!result.result?.markdown) {
    throw new Error('Investigation completed but no markdown result found');
  }

  logger.info(`[XyneAutoRCA] Successfully fetched investigation result for session: ${sessionId}`);

  return result;
};

/**
 * Create investigation canvas with markdown results
 */
export const createInvestigationCanvas = async (
  ticketId: string,
  sessionId: string,
  investigationResult: RcaInvestigationStatusResponse
): Promise<CanvasResult> => {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { conversationId: true, createdBy: true, title: true },
  });

  if (!ticket) {
    throw new Error('Ticket not found');
  }

  if (!ticket.conversationId) {
    throw new Error('Ticket has no conversation');
  }

  const conversation = await prisma.conversation.findUnique({
    where: { conversationId: ticket.conversationId },
    select: { channelId: true },
  });

  if (!conversation) {
    throw new Error('Conversation not found');
  }

  const canvasId = uuidv4();
  const participantId = uuidv4();
  const now = new Date();

  const markdown = investigationResult.result?.markdown || '';
  const query = investigationResult.query || '';

  const canvasContent = [
    {
      id: uuidv4(),
      type: 'heading',
      props: { level: 1 },
      content: [{ type: 'text', text: '🔍 RCA Investigation Result', styles: {} }],
    },
    {
      id: uuidv4(),
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: `Session ID: ${sessionId}`,
          styles: { italic: true },
        },
      ],
    },
    {
      id: uuidv4(),
      type: 'paragraph',
      content: [],
    },
    {
      id: uuidv4(),
      type: 'genius',
      props: {
        title: 'Investigation Results',
        data: '[]',
        content: markdown,
        query: query,
        isLoading: false,
      },
    },
  ];

  await prisma.$transaction([
    prisma.canvas.create({
      data: {
        id: canvasId,
        title: `RCA Investigation: ${ticket.title}`,
        content: canvasContent as any,
        channelId: conversation.channelId,
        createdBy: ticket.createdBy,
        visibility: 'PUBLIC',
        isTemplate: false,
        lastEditedBy: ticket.createdBy,
        lastEditedAt: now,
        createdAt: now,
        updatedAt: now,
        metadata: {
          source: 'xyne_auto_rca',
          sessionId,
          ticketId,
          createdAt: now.toISOString(),
        },
      },
    }),
    prisma.canvasParticipant.create({
      data: {
        id: participantId,
        canvasId,
        userId: ticket.createdBy,
        role: 'OWNER',
        joinedAt: now,
        updatedAt: now,
      },
    }),
  ]);

  const canvasUrl = getCanvasUrl(canvasId);

  logger.info(`[XyneAutoRCA] Created canvas ${canvasId} for ticket ${ticketId}`);

  return {
    canvasId,
    canvasUrl,
  };
};

/**
 * Share canvas link in conversation
 */
export const shareCanvasLink = async (
  ticketId: string,
  canvasUrl: string,
  canvasId: string
): Promise<ShareCanvasResult> => {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { conversationId: true, workspaceId: true },
  });

  if (!ticket || !ticket.conversationId) {
    throw new Error('Ticket or conversation not found');
  }

  if (!ticket.workspaceId) {
    throw new Error('Ticket workspace not found');
  }

  const geniusBotUser = await unifiedBotUserService.getBotByEmail('genius@bot.xyne.ai', ticket.workspaceId);

  const message = await repositories.messages.create({
    conversationId: ticket.conversationId,
    senderId: geniusBotUser?.id || 'cmjkaarlq0002jq9om34yalc7',
    content: `🔍 RCA Investigation Complete! View detailed results: [Open Canvas](${canvasUrl})`,
    msgType: 'BOT',
    metadata: {
      source: 'xyne_auto_rca',
      canvasId,
      canvasUrl,
      createdAt: new Date().toISOString(),
    },
  });

  logger.info(`[XyneAutoRCA] Shared canvas link in conversation for ticket ${ticketId}`);

  return {
    success: true,
    messageId: message.messageId,
  };
};
