import { z } from 'zod';
import { logger } from '@/utils/logger';
import { findOrCreateConversation } from './conversationUtils';
import { TicketRepository } from '@/database/repositories/ticketRepository';
import { DatabaseClient } from '@/database/client';
import { TicketPriority, MessageType } from '@prisma/client';
import { TicketActionResponse, TicketEventType } from '../types';
import { resolveSlackMentions } from '@/integrations/adapters/slack-webhook-tickets/utils/slackUserResolver';
import { SlackBlockKitParser } from '@/integrations/adapters/slack-webhook-tickets/utils/slackBlockKitParser';
import { config } from '@/config/env';
import { TicketIdService } from '@/services/ticketIdService';

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
});

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
    // Use MessageType.BOT since tickets are created by external apps
    const conversationResult = await findOrCreateConversation(
      channelId,
      userId,
      processedContent,
      undefined, 
      undefined,
      text ? MessageType.USER : MessageType.SYSTEM
    );
    const finalConversationId = conversationResult.conversationId;
    const messageId = conversationResult.messageId;

    // Generate xyneId and create ticket in a transaction
    const ticket = await prisma.$transaction(async (tx) => {
      // Generate xyneId using project-scoped format
      const xyneId = await TicketIdService.generateTicketId(tx, projectId);
      // Create ticket using repository
      const createdTicket = await ticketRepository.createTicket({
        title,
        description,
        createdBy: userId,
        updatedBy: userId,
        assignedTo,
        userGroupId,
        conversationId: finalConversationId,
        channelId,
        projectId,
        boardId,
        priority: priority || TicketPriority.LOW,
        xyneId,
      });

      // Update conversation with ticketId
      await tx.conversation.update({
        where: { conversationId: finalConversationId },
        data: { ticketId: createdTicket.id },
      });

      return createdTicket;
    });

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
