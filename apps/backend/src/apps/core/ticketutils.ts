import { z } from 'zod';
import { logger } from '@/utils/logger';
import { findOrCreateConversation } from './conversationUtils';
import { TicketRepository, emitTicketCreated } from '@/database/repositories/ticketRepository';
import { DatabaseClient } from '@/database/client';
import { resolveWorkspaceIdFromModel } from '@/database/tenant/workspace-utils';
import type { Prisma } from '@prisma/client';
import {
  MessageType,
  TicketPriority,
  VespaInsertionStatus,
  VespaOperationType,
} from '@xyne/shared';
import { TicketActionResponse, TicketEventType } from '../types';
import { resolveSlackMentions } from '@/integrations/adapters/slack-webhook-tickets/utils/slackUserResolver';
import { SlackBlockKitParser } from '@/integrations/adapters/slack-webhook-tickets/utils/slackBlockKitParser';
import { config } from '@/config/env';
import { buildCreationFormFieldChanges } from '@/services/ticketCustomFieldService';
import { vespaQueue } from '@/queues/vespaQueue';
import { ticketSchema } from '@/vespa/src/types';
import { NAMESPACE } from '@/vespa/src/config';
import { currentWorkspaceId } from '@/database/tenant/context';
import { createTicketWithConversationTx } from '@/bypassAcl/transactions/ticketutils';

// Initialize Block Kit parser instance
const blockKitParser = new SlackBlockKitParser();

/**
 * Schema for validating createTicketWithConversation function parameters
 */
const CreateTicketParamsSchema = z.object({
  title: z.string().min(1, 'Title is required').trim(),
  description: z.string().min(1, 'Description is required').trim(),
  projectId: z.string().min(1, 'Project ID is required').trim(),
  boardId: z.string().min(1, 'Board ID is required').trim(),
  channelId: z.string().min(1, 'Channel ID is required').trim(),
  userId: z.string().min(1, 'User ID is required').trim(),
  priority: z.nativeEnum(TicketPriority).optional(),
  assignedTo: z.string().trim().optional(),
  userGroupId: z.string().trim().optional(),
  text: z.string().trim().optional(),
  stageName: z.string().trim().optional(),
  eta: z.date().optional(),
  ticketType: z.string().trim().optional(),
  merchantId: z.string().trim().min(1).optional(),
  customFieldValues: z.object({
    formId: z.string().min(1, 'Form ID is required').trim(),
    contextId: z.string().min(1, 'Context ID is required').trim(),
    fieldValues: z.array(z.object({
      fieldId: z.string().min(1, 'Field ID is required').trim(),
      fieldName: z.string().trim().optional(),
      fieldValue: z.string(),
      actualFieldValue: z.custom<Prisma.InputJsonValue>(() => true),
    })),
  }).optional(),
});


export async function pushVespaJobForTicket(
  ticketId: string,
  userId: string,
  workspaceId?: string
): Promise<void> {
  vespaQueue.addJob({
    schema: ticketSchema,
    jobType: "feed",
    docId: ticketId,
    ...(workspaceId ? { workspaceId } : {}),
  }).catch(async (error) => {
    logger.error('[CREATE-TICKET] Error queuing Vespa job for ticket:', error);
    try {
      const db = DatabaseClient.getInstance();
      const vespaLogs = db.vespaInsertionLogs;
      if (vespaLogs) {
        const logWorkspaceId = workspaceId ?? currentWorkspaceId();
        if (!logWorkspaceId) throw new Error('workspaceId required: no tenant context');
        await vespaLogs.create({
          data: {
            status: VespaInsertionStatus.FAILED,
            type: VespaOperationType.INSERT,
            entityId: ticketId,
            entityType: ticketSchema,
            namespace: NAMESPACE,
            errorMessage: `Failed to enqueue Vespa job: ${error instanceof Error ? error.message : String(error)}`,
            errorDetails: JSON.stringify(error),
            userId: userId,
            workspaceId: logWorkspaceId,
            createdAt: new Date(),
          },
        });
      }
    } catch (dbError) {
      logger.error('[CREATE-TICKET] Failed to log Vespa insertion error to database:', dbError);
    }
  });
}

/**
 * Create a ticket with a conversation
 * 
 * Creates a new conversation with the provided text (or ticket title if text is not provided)
 * and then creates a ticket linked to that conversation. The ticket is created with a generated xyneId.
 * 
 * @param params - Ticket creation parameters
 * @returns The ticket action response with event type, ticket details, and conversation info
 */
export async function createTicketWithConversation(
  params: z.infer<typeof CreateTicketParamsSchema>
): Promise<TicketActionResponse> {
  try {
    // Validate parameters with Zod
    const paramsResult = CreateTicketParamsSchema.safeParse(params);
    if (!paramsResult.success) {
      const errorMessages = paramsResult.error.errors
        .map((err) => `${err.path.join('.')}: ${err.message}`)
        .join(', ');
      throw new Error(`Validation error: ${errorMessages}`);
    }

    const {
      title,
      description,
      projectId,
      boardId,
      channelId,
      userId,
      priority,
      assignedTo,
      userGroupId,
      text,
      stageName,
      eta,
      ticketType,
      merchantId,
      customFieldValues,
    } = paramsResult.data;

    const prisma = DatabaseClient.getInstance();
    const ticketRepository = new TicketRepository();

    // Process text: resolve Slack mentions and parse with BlockKit parser (same as fileUtils.ts)
    // If text is not provided, use ticket title as message content
    const botOauthToken = config.slackBotToken;
    let resolvedText = text;
    
    // If no text provided, use ticket title as message content
    if (!resolvedText) {
      resolvedText = `Ticket created : ${title}`;
    } else {
      // Resolve Slack mentions only if text was explicitly provided
      resolvedText = await resolveSlackMentions(resolvedText, botOauthToken);
    }

    const processedContent = blockKitParser.parse({
      text: resolvedText,
      attachments: undefined,
    });

    // Create a new conversation with the processed text
    // The text will be used as the message content to which the ticket will be attached
    const conversationResult = await findOrCreateConversation(
      channelId,
      userId,
      processedContent,
      false,
      undefined,
      undefined,
      MessageType.BOT,
    );
    const finalConversationId = conversationResult.conversationId;
    const messageId = conversationResult.messageId;

    const workspaceId = await resolveWorkspaceIdFromModel(prisma, 'project', { id: projectId });

    // Build the automation formFieldChanges record before the transaction so the
    // repository's TICKET_CREATED emission can carry it (custom fields themselves
    // are written in the same transaction below).
    const formFieldChanges =
      customFieldValues && customFieldValues.fieldValues.length > 0
        ? buildCreationFormFieldChanges(
            customFieldValues.fieldValues.map(fv => ({
              fieldId: fv.fieldId,
              fieldName: 'fieldName' in fv && typeof fv.fieldName === 'string' ? fv.fieldName : fv.fieldId,
              actualFieldValue: fv.actualFieldValue,
            })),
          )
        : undefined;

    // Generate xyneId and create ticket in a transaction
    const ticket = await createTicketWithConversationTx(prisma, projectId, ticketRepository, title, description, userId, assignedTo, userGroupId, finalConversationId, channelId, workspaceId, boardId, priority, stageName, eta, ticketType, merchantId, formFieldChanges, customFieldValues);

    // Automations re-read the ticket on their own connection, so the event must
    // not be published before the transaction above commits.
    void emitTicketCreated(ticket, undefined, ticket.createdBy);

    logger.info(`[CREATE-TICKET] Created ticket ${ticket.id} (${ticket.xyneId}) in conversation ${finalConversationId}`);

    return {
      eventType: TicketEventType.TICKET_CREATED,
      ticketId: ticket.id,
      xyneId: ticket.xyneId,
      conversationId: finalConversationId,
      messageId: messageId,
    };
  } catch (error) {
    logger.error('[CREATE-TICKET] Error creating ticket:', error);
    throw error;
  }
}

