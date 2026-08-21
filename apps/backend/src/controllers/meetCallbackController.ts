/**
 * Meet Callback Controller
 * Handles callbacks from SAM service when Google Meet processing is complete
 * Posts the response as a reply in the xyne-spaces conversation thread
 * 
 * Uses Markdown format matching the existing Xyne call summary style
 * (see transcriptService.ts for reference)
 */

import { Request, Response } from 'express';
import { MessageType } from '@xyne/shared';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { repositories } from '@/database/repositories';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service';
import { meetLinkService } from '@/services/meetLinkService';
import { db } from '@/database/client';
import { runAsServiceActor } from '@/database/tenant/context';

/**
 * Zod schema for validating SAM Meet callback payloads
 * Ensures type safety and prevents runtime errors from malformed data
 */
const MeetCallbackResultSchema = z.object({
  summary: z.string().optional(),
  keyOutcomes: z.array(z.string()).optional(),
  actionItems: z.array(z.string()).optional(),
  participants: z.array(z.string()).optional(),
  duration: z.number().optional(),
  transcript: z.string().optional(),
}).passthrough(); // Allow additional fields for forward compatibility

const MeetCallbackSchema = z.object({
  status: z.enum(['completed', 'failed', 'processing']),
  result: MeetCallbackResultSchema.optional(),
  error: z.string().optional(),
  message: z.string().optional(),
});

export type MeetCallbackPayload = z.infer<typeof MeetCallbackSchema>;

export class MeetCallbackController {
  /**
   * POST /api/meet/callback
   * Called by SAM service when Google Meet processing is complete
   * 
   * Query params:
   *   - xyneTicketId: XYNE ticket ID (e.g., "XYNE-123")
   *   - threadId: External thread ID (for reference)
   *   - meetCode: The Google Meet code
   */
  handleMeetCallback = async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate payload using Zod schema
      const validationResult = MeetCallbackSchema.safeParse(req.body);
      if (!validationResult.success) {
        logger.warn('[MeetCallbackController] Invalid payload received', {
          errors: validationResult.error.flatten(),
        });
        res.status(400).json({
          error: 'Invalid payload format',
        });
        return;
      }
      const payload = validationResult.data;

      // Extract identifiers from query params
      const xyneTicketId = typeof req.query.xyneTicketId === 'string' ? req.query.xyneTicketId : '';
      const workspaceId = req.query.workspaceId as string;
      const threadId = req.query.threadId as string;
      const meetCode = req.query.meetCode as string;

      logger.info('[MeetCallbackController] Received callback from SAM', {
        xyneTicketId,
        workspaceId,
        threadId,
        meetCode,
        status: payload.status,
      });

      if (!xyneTicketId) {
        res.status(400).json({
          error: 'Missing required parameter: xyneTicketId',
        });
        return;
      }

      if (!workspaceId) {
        res.status(400).json({
          error: 'Missing required parameter: workspaceId',
        });
        return;
      }

      if (!meetCode) {
        res.status(400).json({
          error: 'Missing required parameter: meetCode',
        });
        return;
      }

      let targetConversationId: string | null = null;
      let targetWorkspaceId = workspaceId;

      const conversationIdFromPrefix = xyneTicketId.startsWith(meetLinkService.CHAT_CONVERSATION_PREFIX)
        && xyneTicketId.length > meetLinkService.CHAT_CONVERSATION_PREFIX.length
        ? xyneTicketId.slice(meetLinkService.CHAT_CONVERSATION_PREFIX.length)
        : null;

      const chatConversation = conversationIdFromPrefix
        ? await repositories.conversations.findByIdAndWorkspace(conversationIdFromPrefix, workspaceId)
        : null;
      if (chatConversation) {
        targetConversationId = chatConversation.conversationId;
      } else {
        const ticket = await repositories.tickets.findByXyneIdForMeet(xyneTicketId, workspaceId);
        if (!ticket) {
          logger.warn('[MeetCallbackController] Ticket or conversation not found', { xyneTicketId });
          res.status(404).json({
            error: 'Ticket or conversation not found',
            xyneTicketId,
          });
          return;
        }

        if (!ticket.conversationId) {
          logger.warn('[MeetCallbackController] Ticket has no conversation', { xyneTicketId });
          res.status(404).json({
            error: 'Ticket has no associated conversation',
            xyneTicketId,
          });
          return;
        }

        targetConversationId = ticket.conversationId;
        targetWorkspaceId = ticket.workspaceId;
      }

      if (!targetConversationId) {
        res.status(500).json({
          error: 'Failed to resolve target conversation',
        });
        return;
      }

      // Format the message content as Markdown (matching Xyne call summary format)
      const messageContent = this.formatMeetResponseMarkdown(payload, meetCode);

      // Get the Xyne Automatic bot user for posting the message (same as call summaries)
      const botUser = await unifiedBotUserService.getBotByEmail('xyne-automatic@bot.xyne.ai', targetWorkspaceId);
      if (!botUser) {
        logger.error('[MeetCallbackController] Xyne Automatic bot not found');
        res.status(500).json({
          error: 'Bot user not found',
          message: 'Xyne Automatic bot is not registered',
        });
        return;
      }
      const senderId = botUser.id;

      const now = new Date();
      // SAM webhook → no HTTP tenant context. Open one from the resolved workspace so the system
      // message insert gets workspaceId stamped instead of leaking NULL.
      const message = await runAsServiceActor('meet-callback', targetWorkspaceId,
        () => db.$transaction(async (tx) => {
        const createdMessage = await tx.message.create({
          data: {
            conversationId: targetConversationId,
            workspaceId: targetWorkspaceId,
            senderId,
            content: messageContent,
            msgType: MessageType.BOT,
            metadata: {
              contentFormat: 'markdown',
              messageSubtype: 'call_summary',
            },
          },
        });

        await tx.conversation.update({
          where: { conversationId: targetConversationId },
          data: {
            replyCount: {
              increment: 1,
            },
            lastActivityAt: now,
          },
        });

        await tx.conversationParticipant.updateMany({
          where: { conversationId: targetConversationId },
          data: { lastReplyAt: now },
        });

        return createdMessage;
      }));

      logger.info('[MeetCallbackController] Successfully posted SAM response to thread', {
        xyneTicketId,
        conversationId: targetConversationId,
        messageId: message.messageId,
      });

      res.status(200).json({
        success: true,
        message: 'Callback processed successfully',
        messageId: message.messageId,
        conversationId: targetConversationId,
      });
    } catch (error) {
      logger.error('[MeetCallbackController] Error processing callback:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to process callback',
      });
    }
  };

  /**
   * Format the SAM response into Markdown (matching Xyne call summary format)
   * This format is rendered by the frontend's Markdown component with special styling
   */
  private formatMeetResponseMarkdown(payload: MeetCallbackPayload, meetCode: string): string {
    const meetUrl = `https://meet.google.com/${meetCode}`;

    if (payload.status === 'failed') {
      return `## Google Meet Processing Failed

**Meeting:** [${meetCode}](${meetUrl})

**Status:** ❌ Failed

**Error:** ${payload.error || payload.message || 'Unknown error'}

Please try processing the meeting again or contact support.`;
    }

    if (payload.status === 'processing') {
      return `## Google Meet Processing In Progress

**Meeting:** [${meetCode}](${meetUrl})

**Status:** ⏳ Processing

The meeting is still being processed. You will receive an update when it's complete.`;
    }

    // Completed status - build Markdown content matching Xyne call summary format
    const result = payload.result || {};
    const parts: string[] = [];

    // Summary section
    parts.push('## Summary:');
    if (result.summary) {
      parts.push(result.summary);
    } else {
      parts.push('No summary available.');
    }
    parts.push('');

    // Key outcomes section
    parts.push('## Key outcomes:');
    if (result.keyOutcomes && result.keyOutcomes.length > 0) {
      result.keyOutcomes.forEach((outcome, index) => {
        parts.push(`${index + 1}. ${outcome}`);
      });
    } else {
      parts.push('1. No key outcomes recorded');
    }
    parts.push('');

    // Action Items section
    parts.push('## Action Items:');
    if (result.actionItems && result.actionItems.length > 0) {
      result.actionItems.forEach((item) => {
        parts.push(`- ${item}`);
      });
    } else {
      parts.push('- None');
    }
    parts.push('');

    // Participants section
    parts.push('## Participants:');
    if (result.participants && result.participants.length > 0) {
      result.participants.forEach((participant) => {
        parts.push(`- ${participant}`);
      });
    } else {
      parts.push('- No participants recorded');
    }

    return parts.join('\n');
  }
}

export const meetCallbackController = new MeetCallbackController();
