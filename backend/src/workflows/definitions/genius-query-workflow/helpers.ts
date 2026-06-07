// Helper functions for Genius Query Workflow API calls

import { repositories } from '@/database/repositories';
import { v4 as uuidv4 } from 'uuid';
import { getCanvasUrl } from '@/services/canvasService';
import { marked } from 'marked';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service';
import { convert } from 'html-to-text';
import { FormContextType, FormEntityType } from '@xyne/shared';
import { TicketPriority } from '@prisma/client';
import {
  RequestHandlerSuccess,
  RequestHandlerError,
  ExternalStepRequestResult,
} from '../../workflow-types';
import {
  MerchantIdErrorData,
  QueryRoutingRequest,
  QueryRoutingResponse,
  InvestigationStatusResponse,
  CategorizationRequest,
  CategorizationResponse,
  CategorizationApiResponse,
  TicketDetails,
  DraftResponse,
} from './types';
import { DatabaseClient } from '@/database/client';
import { evaluateAssignmentRule } from '@/utils/assignmentEngine';
import { syncUserWorkload } from '@/utils/workloadUtils';
import { ticketAssignmentService } from '@/services/ticketAssignmentService';
import type { BoardMetadata } from '@xyne/shared';
import {logger} from '@/utils/logger';
import { syncConversationTicketMdFromPrismaTicket } from '@/utils/ticketMd';

const prisma = DatabaseClient.getInstance();

// Query Type to UserGroup mapping for auto-assignment
const QUERY_TYPE_TO_USER_GROUP: Record<string, string> = {
  'EMI': 'incidence-emi',
  'Offers': 'incidence-offers',
  'Payout': 'incidence-payout',
  'Data Support': 'incidence-data-support',
  'Refund - Fast Track': 'incidence-refund-fast-track',
  'Refund - Dev Support': 'incidence-refund-dev-support',
  'Mandate/Subscription - Fast Track': 'incidence-mandate-fast-track',
  'Tokenization': 'incidence-tokenization',
  'PL/SL': 'incidence-pl-sl',
  'PL Routing Issue': 'incidence-pl-routing-issue',
  'Dashboard': 'incidence-dashboard',
  'SDK': 'incidence-sdk',
  'Transaction - Dev Support': 'incidence-transaction-dev-support',
  'Transaction - Fast Track': 'incidence-transaction-fast-track',
  'General Information': 'incidence-general-information',
  'Critical Information': 'incidence-critical-information',
  'Mandate/Subscription': 'incidence-mandate',
  'MS ON-CALL': 'incidence-ms-on-call',
};
const FALLBACK_USER_GROUP = 'incidence-others';
const GENIUS_API_BASE_URL = process.env.GENIUS_API_URL || 'http://localhost:8000';
const GENIUS_QUERY_ROUTING_API_URL = (process.env.GENIUS_API_URL || 'http://localhost:8000') + '/api/v3/query_routing/';
const GENIUS_PROD_URL = 'https://genius.juspay.in';
const QUERY_ROUTING_AUTH = process.env.GENIUS_QUERY_ROUTING_AUTH || "";
const CATEGORIZATION_AUTH = process.env.GENIUS_CATEGORIZATION_AUTH || "";
const BACKEND_URL = process.env.BACKEND_URL
export interface GeniusWebhookPayload {
  session_id: string;
  status: 'completed' | 'failed' | string;
  message?: string;
  error?: string;
  poll_instructions?: {
    method: string;
    url: string;
    body: Record<string, string>;
  };
}

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
        'anchor': (elem, walk, builder) => walk(elem.children, builder) // Remove link URLs
      }
    }).replace(/\s+/g, ' ').trim();
  } catch (error) {
    logger.error('Error converting HTML to plain text in genius query workflow:', error);
    return html
      .replace(/<[^>]+>/g, ' ') // Remove HTML tags
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

export const mapSeverityToPriority = (severity: string | null | undefined): TicketPriority | null => {
  if (!severity) return null;
  
  const normalized = severity.toUpperCase().trim();
  
  switch (normalized) {
    case 'LOW':
      return TicketPriority.LOW;
    case 'MEDIUM':
      return TicketPriority.MEDIUM;
    case 'HIGH':
      return TicketPriority.HIGH;
    case 'CRITICAL':
      return TicketPriority.CRITICAL;
    default:
      logger.warn(`[mapSeverityToPriority] Unknown severity value: ${severity}, defaulting to null`);
      return null;
  }
};

export const storeMerchantIdInForm = async (
  ticketId: string,
  merchantIdValue: string
): Promise<void> => {
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { boardId: true },
    });
    
    if (!ticket) {
      logger.warn(`[storeMerchantIdInForm] Ticket not found: ${ticketId}`);
      return;
    }
    const formMapping = await prisma.formContextMapping.findFirst({
      where: {
        contextId: ticket.boardId,
        contextType: FormContextType.BOARD,
        entityType: FormEntityType.TICKET,
      },
    });

    if (!formMapping) {
      logger.info(`[storeMerchantIdInForm] No form mapping found for board: ${ticket.boardId}`);
      return;
    }

    const merchantField = await prisma.formFields.findFirst({
      where: {
        formId: formMapping.formId,
        fieldName: 'Merchant Id',
      },
    });

    if (!merchantField) {
      logger.info(`[storeMerchantIdInForm] No merchantId field found in form: ${formMapping.formId}`);
      return;
    }
    await prisma.formEntityValues.upsert({
      where: {
        entityId_entityType_fieldId_contextId: {
          entityId: ticketId,
          entityType: 'Ticket',
          fieldId: merchantField.id,
          contextId: '',
        },
      },
      create: {
        formId: formMapping.formId,
        entityId: ticketId,
        entityType: 'Ticket',
        fieldId: merchantField.id,
        fieldValue: '',
        actualFieldValue: merchantIdValue,
      },
      update: {
        actualFieldValue: merchantIdValue,
        updatedAt: new Date(),
      },
    });

    logger.info(`[storeMerchantIdInForm] Successfully stored merchantId in form for ticket: ${ticketId}`);
  } catch (error) {
    logger.error(`[storeMerchantIdInForm] Error storing merchantId in form:`, error);
  }
};

export const storeCategorizationInForms = async (
  ticketId: string,
  categorization: CategorizationResponse
): Promise<void> => {
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { boardId: true },
    });
    
    if (!ticket) {
      logger.warn(`[storeCategorizationInForms] Ticket not found: ${ticketId}`);
      return;
    }

    const formMapping = await prisma.formContextMapping.findFirst({
      where: {
        contextId: ticket.boardId,
        contextType: FormContextType.BOARD,
        entityType: FormEntityType.TICKET,
      },
    });

    if (!formMapping) {
      logger.info(`[storeCategorizationInForms] No form mapping found for board: ${ticket.boardId}`);
      return;
    }

    const fieldsToStore: Record<string, string | null> = {
      'Classification': categorization.Classifications,
      'Enviornment': categorization.Environment, // Note: Production has typo "Enviornment"
      'Incidence': categorization.Incidence,
      'Incidence Primary': categorization['Incidence Primary'],
      'Incidence Secondary': categorization['Incidence Secondary'],
      'Issue Sub Category': categorization['Issue Sub Category'],
      'Issue Type': categorization['Issue Type'],
      'Query Type': categorization['Query Type'],
      'Tag': categorization.Tag,
      'Text Tone': categorization['Text Tone'],
      'Tone': categorization.Tone,
      'Ticket Category': categorization['Ticket Category'],
      'Ticket Genre': categorization['Ticket Genre'],
      'Zoho Ticket Id': categorization['Ticket Id'],
    };

    const formFields = await prisma.formFields.findMany({
      where: {
        formId: formMapping.formId,
        fieldName: {
          in: Object.keys(fieldsToStore),
        },
      },
    });

    if (formFields.length === 0) {
      logger.info(`[storeCategorizationInForms] No categorization fields found in form: ${formMapping.formId}`);
      return;
    }

    const upsertPromises = formFields.map(field => {
      const value = fieldsToStore[field.fieldName];
      if (value === null || value === undefined) {
        return null;
      }

      return prisma.formEntityValues.upsert({
        where: {
          entityId_entityType_fieldId_contextId: {
            entityId: ticketId,
            entityType: 'Ticket',
            fieldId: field.id,
            contextId: '',
          },
        },
        create: {
          formId: formMapping.formId,
          entityId: ticketId,
          entityType: 'Ticket',
          fieldId: field.id,
          fieldValue: '',
          actualFieldValue: value,
        },
        update: {
          actualFieldValue: value,
          updatedAt: new Date(),
        },
      });
    });

    await Promise.all(upsertPromises.filter(p => p !== null));

    logger.info(`[storeCategorizationInForms] Successfully stored ${formFields.length} categorization fields in form for ticket: ${ticketId}`);
  } catch (error) {
    logger.error(`[storeCategorizationInForms] Error storing categorization in forms:`, error);
  }
};

/**
 * Fetch ticket details from database
 */
export const fetchTicketDetails = async (ticketId: string): Promise<TicketDetails> => {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
  });

  if (!ticket) {
    throw new Error(`Ticket not found: ${ticketId}`);
  }

  const metadata = (ticket.metadata as Record<string, any>) || {};
  const zohoTicketId = metadata.ticketId || metadata.zohoTicketId;

  if (!zohoTicketId) {
    logger.warn(`⚠️ No zohoTicketId found in ticket metadata for ${ticketId}`);
  }

  const email = metadata.contactEmail || metadata.reporterEmail || metadata.email;

  return {
    id: ticket.id,
    title: ticket.title,
    description: ticket.description || '',
    metadata,
    zohoTicketId,
    email,
  };
};

/**
 * Initiate query routing
 */
export const initiateQueryRouting = async (
  zohoTicketId: string,
  query: string,
  email: string
): Promise<QueryRoutingResponse> => {
  const requestBody: QueryRoutingRequest = {
    query: JSON.stringify({ ticketId: zohoTicketId, query: query }),
    agent: 'investigation',
    source: 'zoho',
    session_id: '',
    email: email,
    stream: 'False',
  };

  const response = await fetch(`${GENIUS_QUERY_ROUTING_API_URL}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${QUERY_ROUTING_AUTH}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Query routing API failed with status ${response.status}: ${errorBody}`);
  }

  return (await response.json()) as QueryRoutingResponse;
};

export const processMerchantSelectionResponse = async (
  rawResponse: string
): Promise<{ merchant_id: string }> => {
  let response: Record<string, unknown>;
  try {
    response = JSON.parse(rawResponse);
  } catch (e) {
    throw new Error(`Failed to parse merchant selection response: ${rawResponse}`);
  }

  const merchantId = response.merchant_id;
  if (!merchantId || typeof merchantId !== 'string') {
    throw new Error(`Invalid merchant_id in response: ${rawResponse}`);
  }

  return { merchant_id: merchantId };
};

export const initiateInvestigationAndWaitForWebhook = async (
  workflowExecutionId: string,
  workflowStepId: string,
  ticketId: string,
  zohoTicketId: string,
  query: string,
  email: string,
  merchantId?: string
): Promise<ExternalStepRequestResult<MerchantIdErrorData>> => {
  const webhookUrl = `${BACKEND_URL}/api/external-step-response?workflowExecutionId=${encodeURIComponent(workflowExecutionId)}&workflowStepId=${encodeURIComponent(workflowStepId)}`;

  const requestBody = {
    query: JSON.stringify({ ticketId: zohoTicketId, query: query + (merchantId ? ` Merchant ID to search for: ${merchantId}` : "") }),
    agent: 'investigation',
    source: 'zoho',
    session_id: '',
    email: email,
    stream: 'False',
    notification_webhook: webhookUrl
  };

  const response = await fetch(`${GENIUS_API_BASE_URL}/api/v3/query_routing/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${QUERY_ROUTING_AUTH}`,
      'x-source': "auto-diagnostics",
      'x-source-id': zohoTicketId
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const responseJson = await response.json();
    if ((responseJson as any)?.detail?.merchant_id_options) {
      return RequestHandlerError({ merchantIdOptions: (responseJson as any).detail.merchant_id_options });
    }
    throw new Error(`Genius investigation API failed: ${response.status} - ${JSON.stringify(responseJson)}`);
  }

  const result = await response.json() as QueryRoutingResponse;
  
  if (result.status !== 'success' && result.status !== 'invoked') {
    throw new Error(`Genius investigation failed to start. Status: ${result.status}`);
  }

  if (result.merchant_id) {
    // Upsert merchant if it doesn't exist
    await prisma.merchant.upsert({
      where: { mid: result.merchant_id },
      update: {},
      create: { mid: result.merchant_id },
    });
    
    const updatedTicket = await prisma.ticket.update({
      where: { id: ticketId },
      data: {
        merchantId: result.merchant_id,
        updatedAt: new Date(),
      },
    });
    await syncConversationTicketMdFromPrismaTicket(prisma, updatedTicket);
    await storeMerchantIdInForm(ticketId, result.merchant_id);
  }

  return RequestHandlerSuccess();
};

export type InvestigationStepResult = 
  | { needsMerchantSelection: false; sessionId: string; status: string }
  | { needsMerchantSelection: true; merchantIdOptions: string[] };

export const processGeniusWebhookResponse = async (
  rawResponse: string,
  errorData?: MerchantIdErrorData
): Promise<InvestigationStepResult> => {
  if (errorData) {
    return { 
      needsMerchantSelection: true, 
      merchantIdOptions: errorData.merchantIdOptions 
    };
  }

  let payload: GeniusWebhookPayload;
  try {
    payload = JSON.parse(rawResponse);
  } catch (e) {
    throw new Error(`Failed to parse Genius webhook payload: ${rawResponse}`);
  }

  const { session_id, status, error } = payload;

  if (!session_id) {
    throw new Error(`Missing session_id in webhook payload: ${rawResponse}`);
  }

  if (status === 'failed') {
    throw new Error(`Genius investigation failed: ${error || 'Unknown error'}`);
  }

  if (status !== 'completed') {
    throw new Error(`Unexpected webhook status: ${status}. Expected 'completed' or 'failed'.`);
  }  
  return { needsMerchantSelection: false, sessionId: session_id, status };
};

export const fetchCompletedInvestigation = async (
  sessionId: string
): Promise<InvestigationStatusResponse> => {
  logger.info(`[GeniusQuery] Fetching completed investigation for session: ${sessionId}`);

  const response = await fetch(
      `${GENIUS_API_BASE_URL}/api/v3/investigation/status/${sessionId}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${QUERY_ROUTING_AUTH}`,
        },
      }
    );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to fetch investigation result: ${response.status} - ${errorBody}`);
  }

  const result = await response.json() as InvestigationStatusResponse;
  if (result.status !== 'completed') {
    throw new Error(
      `Investigation not completed. Status: ${result.status}. ` +
      `Expected 'completed' after webhook notification.`
    );
  }

  if (!result.result?.markdown) {
    throw new Error('Investigation completed but no markdown result found');
  }
  return result;
};

/**
 * Poll investigation status until completed
 */
export const pollInvestigationStatus = async (
  sessionId: string,
  maxAttempts: number = 60,
  pollInterval: number = 30000
): Promise<InvestigationStatusResponse> => {
  let attempt = 0;

  while (attempt < maxAttempts) {
    const response = await fetch(
      `${GENIUS_API_BASE_URL}/api/v3/investigation/status/${sessionId}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${QUERY_ROUTING_AUTH}`,
        },
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      logger.info(`⚠️ Received 404 on attempt ${attempt + 1}, retrying after delay...`, errorBody);
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      attempt++;
      if (attempt > 5) {
        throw new Error(`Status poll API failed with status ${response.status}: ${errorBody}`);
      }
      continue;
    }

    const statusResponse = (await response.json()) as InvestigationStatusResponse;

    if (statusResponse.status === 'completed') {
      if (!statusResponse.result || !statusResponse.result.markdown) {
        throw new Error('Investigation completed but no result markdown found');
      }
      return statusResponse;
    }

    if (statusResponse.status === 'failed') {
      const errorMsg = statusResponse.error || 'Investigation failed without error message';
      throw new Error(`Investigation failed: ${errorMsg}`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    attempt++;
  }

  throw new Error(`Investigation polling timeout after ${maxAttempts} attempts`);
};

/**
 * Create message in ticket conversation with investigation result
 */
export const getDraftResponse = async (sessionId: string): Promise<DraftResponse> => {
  const response = await fetch(
    `${GENIUS_PROD_URL}/api/v3/analytics/feedback/session/draft?session=${sessionId}`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${QUERY_ROUTING_AUTH}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Draft API failed with status ${response.status}: ${errorBody}`);
  }

  return (await response.json()) as DraftResponse;
};

export const createTicketMessage = async (
  ticketId: string,
  markdown: string,
  userId?: string,
): Promise<{ success: boolean; draftId: string }> => {
  if (!userId) {
    throw new Error('userId is required to create an email draft');
  }

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { conversationId: true, channelId: true },
  });

  if (!ticket || !ticket.conversationId) {
    throw new Error('Ticket or conversation not found');
  }

  const htmlContent = await marked.parse(markdown);

  const emailDraft = await repositories.emailDrafts.create({
    conversationId: ticket.conversationId,
    channelId: ticket.channelId,
    draftContent: htmlContent,
    userId,
  });

  return {
    success: true,
    draftId: emailDraft.id,
  };
};

/**
 * Create investigation canvas with markdown results
 */
export const createInvestigationCanvas = async (
  ticketId: string,
  sessionId: string,
  investigationResult: InvestigationStatusResponse
): Promise<{ canvasId: string; viewAccessId: string; canvasUrl: string }> => {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { conversationId: true, createdBy: true, title: true },
  });

  if (!ticket) {
    throw new Error('Ticket not found');
  }

  const conversation = await prisma.conversation.findUnique({
    where: { conversationId: ticket.conversationId },
    select: { channelId: true },
  });

  if (!conversation) {
    throw new Error('Conversation not found');
  }

  const canvasId = uuidv4();
  const viewAccessId = uuidv4();
  const participantId = uuidv4();
  const now = new Date();

  const markdown = investigationResult.result?.markdown || '';
  const query = investigationResult.query || '';
  

  const canvasContent = [
    {
      id: uuidv4(),
      type: 'heading',
      props: { level: 1 },
      content: [{ type: 'text', text: '🔍 Genius Investigation Result', styles: {} }],
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
        title: `Investigation: ${ticket.title}`,
        content: canvasContent as any,
        channelId: conversation.channelId,
        createdBy: ticket.createdBy,
        viewAccessId,
        editAccessId: null,
        visibility: 'PUBLIC',
        isTemplate: false,
        lastEditedBy: ticket.createdBy,
        lastEditedAt: now,
        createdAt: now,
        updatedAt: now,
        metadata: {
          source: 'genius_investigation',
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

  const canvasUrl = getCanvasUrl(viewAccessId);

  return {
    canvasId,
    viewAccessId,
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
): Promise<{ success: boolean; messageId: string }> => {
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
    senderId: geniusBotUser?.id || "cmjkaarlq0002jq9om34yalc7",
    content: `🔍 Investigation Complete! View detailed results: [Open Canvas](${canvasUrl})`,
    msgType: 'BOT',
    metadata: {
      source: 'genius_investigation',
      canvasId,
      canvasUrl,
      createdAt: new Date().toISOString(),
    },
  });

  return {
    success: true,
    messageId: message.messageId,
  };
};

/**
 * Call categorization API and update ticket metadata
 */
export const categorizateAndUpdateTicket = async (
  ticketId: string,
  zohoTicketId: string
): Promise<{ success: boolean; queryType?: string }> => {
  const requestBody: CategorizationRequest = {
    product: 'Autodiagnostics',
    question: JSON.stringify({ ticket_id: zohoTicketId }),
    mode: 'api',
  };

  const response = await fetch(`${GENIUS_PROD_URL}/zoho/email/parse`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${CATEGORIZATION_AUTH}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.info(`Categorization API failed with status ${response.status}: ${errorBody}`);
    return {success: false}
  }

  const apiResponse = (await response.json()) as CategorizationApiResponse;
  if (!apiResponse.success || !apiResponse.data?.success) {
    logger.info("Categorization not found", apiResponse)
    return {success: false}
  }

  const categorization = apiResponse.data.result;

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
  });

  if (!ticket) {
    throw new Error(`Ticket not found: ${ticketId}`);
  }

  const newMerchantId = categorization.Merchant || ticket.merchantId;
  const newPriority = mapSeverityToPriority(categorization.Severity);

  // Upsert merchant if it doesn't exist
  if (newMerchantId) {
    await prisma.merchant.upsert({
      where: { mid: newMerchantId },
      update: {},
      create: { mid: newMerchantId },
    });
  }

  const updatedTicket = await prisma.ticket.update({
    where: { id: ticketId },
    data: {
      merchantId: newMerchantId, // Update merchantId from categorization, fallback to existing
      ...(newPriority && { priority: newPriority }), // Update priority from severity if valid
      updatedAt: new Date(),
    },
  });
  await syncConversationTicketMdFromPrismaTicket(prisma, updatedTicket);

  if (newPriority) {
    logger.info(`[categorizateAndUpdateTicket] Updated ticket priority to ${newPriority} from severity: ${categorization.Severity}`);
  }
  
  if (newMerchantId) {
    await storeMerchantIdInForm(ticketId, newMerchantId);
  }

  await storeCategorizationInForms(ticketId, categorization);

  return {
    success: true,
    queryType: categorization['Query Type'],
  };
};

/**
 * Auto-assign ticket based on Query Type from categorization
 */
export const assignTicketByQueryType = async (
  ticketId: string,
  queryType: string | undefined,
  userId: string
): Promise<{ success: boolean; assignedUserId?: string; groupName?: string }> => {
  try {
    // Map query type to group name (fallback to 'incidence-others')
    const groupName = queryType && QUERY_TYPE_TO_USER_GROUP[queryType]
      ? QUERY_TYPE_TO_USER_GROUP[queryType]
      : FALLBACK_USER_GROUP;

    logger.info(`[assignTicketByQueryType] Query Type: "${queryType}" -> Group: "${groupName}"`);

    // Find userGroup by name
    const userGroup = await prisma.userGroup.findFirst({
      where: { name: groupName },
    });

    if (!userGroup) {
      logger.warn(`[assignTicketByQueryType] UserGroup not found for name: ${groupName}`);
      return { success: false, groupName };
    }

    // Get ticket's boardId and projectId
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { boardId: true, projectId: true, channelId: true },
    });

    if (!ticket || !ticket.boardId) {
      logger.warn(`[assignTicketByQueryType] Ticket or boardId not found for ticketId: ${ticketId}`);
      return { success: false, groupName };
    }

    // Check board toggle
    const boardRow = await prisma.board.findUnique({ where: { id: ticket.boardId }, select: { metadata: true } });
    const boardMetadata = boardRow?.metadata as BoardMetadata | undefined;

    if (boardMetadata?.fullRoleAssignment === true) {
      const fullRoles = await ticketAssignmentService.assignFullRolesToTicket({
        ticketId,
        userGroupId: userGroup.id,
        boardId: ticket.boardId,
        createdBy: userId,
        projectId: ticket.projectId,
        channelId: ticket.channelId,
      });
      // Update ticket group and assignedTo (member)
      await prisma.ticket.update({
        where: { id: ticketId },
        data: {
          userGroupId: userGroup.id,
          ...(fullRoles.member && { assignedTo: fullRoles.member }),
        },
      });
      return { success: true, assignedUserId: fullRoles.member, groupName };
    }

    // Call assignment engine
    const assignmentResult = await evaluateAssignmentRule(userGroup.id, ticket.boardId, undefined, undefined, ticket.projectId, ticket.channelId);

    if (!assignmentResult.assignedUserId) {
      logger.info(`[assignTicketByQueryType] No user assigned. Reason: ${assignmentResult.reason}`);
      return { success: false, groupName };
    }

    // Update ticket with assignedTo
    const updatedTicket = await prisma.ticket.update({
      where: { id: ticketId },
      data: { 
        assignedTo: assignmentResult.assignedUserId,
        userGroupId: userGroup.id,
      },
    });
    await syncConversationTicketMdFromPrismaTicket(prisma, updatedTicket);

    // Sync workload mapping for the assigned user
    try {
      await syncUserWorkload(assignmentResult.assignedUserId, userGroup.id, ticket.boardId, userId);
      logger.info(`[assignTicketByQueryType] Synced workload for user ${assignmentResult.assignedUserId}`);
    } catch (workloadError) {
      logger.error('[assignTicketByQueryType] Error syncing workload:', workloadError);
      // Don't fail the assignment if workload sync fails
    }

    logger.info(`[assignTicketByQueryType] Successfully assigned ticket ${ticketId} to user ${assignmentResult.assignedUserId} in group ${groupName}`);

    return {
      success: true,
      assignedUserId: assignmentResult.assignedUserId,
      groupName,
    };
  } catch (error) {
    logger.error('[assignTicketByQueryType] Error during assignment:', error);
    return { success: false };
  }
};
