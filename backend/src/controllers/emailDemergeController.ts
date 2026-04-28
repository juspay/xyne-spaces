/**
 * Email Demerge Controller
 * Handles demerge operations to split auto-merged email threads
 */

import { Request, Response } from 'express';
import { EmailRepository } from '@/database/repositories/emailRepository';
import { ChannelRepository } from '@/database/repositories/channelRepository';
import { emailService } from '@/services/emailService';
import { logger } from '@/utils/logger';
import { EmailType } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { vespaQueue } from '@/queues/vespaQueue';
import { mailSchema } from '@/vespa/src/types';

interface DemergeEmailRequest {
  emailId: string;
}

export class EmailDemergeController {
  private emailRepo: EmailRepository;
  private channelRepo: ChannelRepository;
  private prisma;

  constructor() {
    this.emailRepo = new EmailRepository();
    this.channelRepo = new ChannelRepository();
    this.prisma = DatabaseClient.getInstance();
  }

  /**
   * POST /api/email/demerge
   * Demerge an email from its current thread into a new ticket
   */
  demergeEmail = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { emailId } = req.body as DemergeEmailRequest;

      // Validate input
      if (!emailId) {
        return res.status(400).json({ error: 'Email ID is required' });
      }

      // Step 1: Get the email to demerge
      const email = await this.emailRepo.findById(emailId);
      if (!email) {
        return res.status(404).json({ error: 'Email not found' });
      }

      // Step 2: Validate eligibility (must be DEFAULT type and auto-merged condition)
      // Auto-merged condition: type is DEFAULT AND externalThreadId === externalMessageId
      if (email.type !== EmailType.DEFAULT) {
        return res.status(400).json({ error: 'Only DEFAULT type emails can be demerged' });
      }

      if (email.externalThreadId !== email.externalMessageId) {
        return res.status(400).json({ error: 'Email is not marked as auto-merged (externalThreadId != externalMessageId)' });
      }

      // Step 3: Get all emails in the conversation ordered by createdAt
      const allEmails = await this.emailRepo.findByConversationIdOrdered(email.conversationId);
      if (allEmails.length === 0) {
        return res.status(404).json({ error: 'No emails found in conversation' });
      }

      // Step 4: Find position of demerged email in thread
      const demergeIndex = allEmails.findIndex(e => e.id === emailId);
      if (demergeIndex === -1) {
        return res.status(404).json({ error: 'Email not found in conversation' });
      }

      // Step 5: Get the original ticket
      const originalTicket = await this.prisma.ticket.findFirst({
        where: { conversationId: email.conversationId },
      });
      if (!originalTicket) {
        return res.status(404).json({ error: 'Original ticket not found' });
      }

      // Step 6: Get channel info
      const channel = await this.channelRepo.findById(originalTicket.channelId);
      if (!channel) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      // Step 7: Create new conversation and ticket from demerged email
      // Note: createConversationFromEmail handles its own internal transaction for ticket creation
      // Creates only conversation, ticket, and message - no email entry
      const { conversation: newConversation, ticket: newTicket } = await emailService.createConversationFromEmail({
        channelId: originalTicket.channelId,
        userId: originalTicket.createdBy,
        emailSubject: email.subject,
        emailBody: email.body,
        emailTo: email.to,
        emailFrom: email.from,
        emailCc: email.cc,
        emailBcc: email.bcc,
        externalThreadId: email.externalThreadId,
        externalMessageId: email.externalMessageId,
        projectId: originalTicket.projectId,
        boardId: originalTicket.boardId,
        stageName: originalTicket.stageName,
        userGroupId: originalTicket.userGroupId ?? undefined,
      });

      // Step 8: Move emails to new ticket in a transaction
      // Filter all emails that share the same externalThreadId (parent and its replies)
      const externalThreadId = email.externalThreadId;
      const emailsToMove = allEmails.filter(e => e.externalThreadId === externalThreadId);
      const emailIdsToMove = emailsToMove.map(e => e.id);
      
      await this.prisma.$transaction(async (tx) => {
        // Step 8a: Move ALL emails with matching externalThreadId to new ticket
        await tx.email.updateMany({
          where: { id: { in: emailIdsToMove } },
          data: {
            conversationId: newConversation.conversationId,
          },
        });
      });

      // Re-index moved emails in Vespa — conversationId (threadId) and permissions changed
      for (const id of emailIdsToMove) {
        vespaQueue.addJob({ schema: mailSchema, jobType: 'feed', docId: id }).catch(err => {
          logger.error(`[EmailDemergeController] Failed to queue Vespa re-feed for email ${id}:`, err);
        });
      }

      logger.info('[EmailDemergeController] Successfully demerged email', {
        emailId,
        oldTicketId: originalTicket.id,
        newTicketId: newTicket.id,
        emailsMoved: emailIdsToMove.length,
        message: 'Demerged email moved to new ticket',
      });

      return res.status(200).json({
        success: true,
        oldTicket: {
          ticketId: originalTicket.id,
          xyneId: originalTicket.xyneId,
          conversationId: originalTicket.conversationId,
        },
        newTicket: {
          ticketId: newTicket.id,
          xyneId: newTicket.xyneId,
          conversationId: newTicket.conversationId,
        },
        demergedEmailId: emailId,
        emailsMoved: emailIdsToMove.length,
      });
    } catch (error: any) {
      logger.error('[EmailDemergeController] Failed to demerge email:', error);
      return res.status(500).json({
        error: 'Failed to demerge email',
        message: error.message,
      });
    }
  };
}

export const emailDemergeController = new EmailDemergeController();