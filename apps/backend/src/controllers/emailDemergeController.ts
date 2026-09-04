/**
 * Email Demerge Controller
 * Handles demerge operations to split auto-merged email threads
 *
 * Demerge keeps provider thread/message ids intact and only moves the selected
 * provider-thread group into a new Xyne ticket.
 */

import { Request, Response } from 'express';
import { EmailType } from '@xyne/shared';
import { EmailRepository } from '@/database/repositories/emailRepository';
import { syncTicketEmailCount } from '@/database/syncTicketEmailCount';
import { ChannelRepository } from '@/database/repositories/channelRepository';
import { ChannelParticipantRepository } from '@/database/repositories/channelParticipantRepository';
import { emailService } from '@/services/emailService';
import { logger } from '@/utils/logger';
import { DatabaseClient } from '@/database/client';
import { vespaQueue } from '@/queues/vespaQueue';
import { mailSchema } from '@/vespa/src/types';
import { config as appConfig } from '@/config/env';
import { tagGenerationPipeline, DESK_EMAIL_SOURCE_TYPE, deskEmailConfigKey } from '@/tags';
import { syncTicketTagsForConversation } from '@/tags/deskTicket';

interface DemergeEmailRequest {
  emailId: string;
}

export class EmailDemergeController {
  private emailRepo: EmailRepository;
  private channelRepo: ChannelRepository;
  private channelParticipantRepo: ChannelParticipantRepository;
  private prisma;

  constructor() {
    this.emailRepo = new EmailRepository();
    this.channelRepo = new ChannelRepository();
    this.channelParticipantRepo = new ChannelParticipantRepository();
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

      // Step 2: Validate eligibility (must be DEFAULT type)
      if (email.type !== EmailType.DEFAULT) {
        return res.status(400).json({ error: 'Only DEFAULT type emails can be demerged' });
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

      const rootEmail = allEmails[0];
      if (email.id === rootEmail.id) {
        return res.status(400).json({ error: 'Root email cannot be demerged' });
      }

      if (email.externalThreadId !== email.externalMessageId) {
        return res.status(400).json({ error: 'Email is not marked as auto-merged (externalThreadId != externalMessageId)' });
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

      const userId = req.user?.id;
      const workspaceId = req.user?.workspaceId;
      if (!userId || !workspaceId) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      if (originalTicket.workspaceId !== workspaceId || channel.workspaceId !== workspaceId) {
        return res.status(404).json({ error: 'Ticket not found' });
      }
      if (channel.visibility === 'PRIVATE') {
        const isParticipant = await this.channelParticipantRepo.isParticipant(originalTicket.channelId, userId);
        if (!isParticipant) {
          return res.status(403).json({ error: 'Not a member of this channel' });
        }
      }

      // Demerge is intentionally NOT gated on the inbox's auto-merge setting —
      // tickets that were auto-merged in the past must remain demerge-able even
      // after the merchant disables the setting.

      // Step 7: Move the selected provider-thread group. Provider thread ids
      // must not be rewritten; future inbound mails use those ids for routing.
      const selectedThreadId = email.externalThreadId;
      const rootThreadId = rootEmail.externalThreadId;
      const emailsToMove = allEmails.filter(e => e.externalThreadId === selectedThreadId);
      const emailIdsToMove = emailsToMove.map(e => e.id);

      if (emailIdsToMove.length === 0) {
        return res.status(400).json({ error: 'No emails found for selected external thread' });
      }

      // Step 8: Create new conversation and ticket from demerged email
      const { conversation: newConversation, ticket: newTicket } = await emailService.createConversationFromEmail({
        channelId: originalTicket.channelId,
        userId: originalTicket.createdBy,
        emailSubject: email.subject,
        emailBody: email.body,
        emailTo: email.to,
        emailFrom: email.from,
        emailCc: email.cc,
        emailBcc: email.bcc,
        externalThreadId: selectedThreadId,
        externalMessageId: email.externalMessageId,
        projectId: originalTicket.projectId,
        boardId: originalTicket.boardId,
        stageName: originalTicket.stageName,
        userGroupId: originalTicket.userGroupId ?? undefined,
        ticketMetadata: {
          fromEmailAddress: email.from,
        },
      });

      // Step 9: Move emails in a transaction. external_message.entityId still
      // points to these email ids, so no external_message rewrite is needed.
      await this.prisma.$transaction(async (tx) => {
        await tx.email.updateMany({
          where: { id: { in: emailIdsToMove } },
          data: {
            conversationId: newConversation.conversationId,
          },
        });
        await syncTicketEmailCount(tx, originalTicket.conversationId);
        await syncTicketEmailCount(tx, newConversation.conversationId);
      });

      // Re-sync old ticket's tags — emails moved out so its latest email changed,
      // but no tag write fired on the old conversation's side.
      // New conversation's ticket tags are covered by the regen jobs below.
      void syncTicketTagsForConversation(email.conversationId);

      // Re-index moved emails in Vespa — conversationId (threadId) and permissions changed
      for (const id of emailIdsToMove) {
        vespaQueue.addJob({ schema: mailSchema, jobType: 'feed', docId: id, workspaceId: originalTicket.workspaceId || undefined }).catch(err => {
          logger.error(`[EmailDemergeController] Failed to queue Vespa re-feed for email ${id}:`, err);
        });
      }

      // Enqueue tag generation for all moved emails (fire-and-forget).
      // Priority 2 — same as new emails; demerge creates a new conversation.
      if (appConfig.enableTagGenerationPipeline && originalTicket.workspaceId) {
        void tagGenerationPipeline.addGenerationJobs(
          emailIdsToMove.map(id => ({
            sourceId: id,
            sourceType: DESK_EMAIL_SOURCE_TYPE,
            workspaceId: originalTicket.workspaceId!,
            configKey: deskEmailConfigKey(originalTicket.channelId),
          })),
          2,
        ).then((count) => {
          logger.info(`[TagFramework] Enqueued ${count} tag generation jobs for demerged emails in channel ${originalTicket.channelId}`);
        }).catch((err: unknown) => {
          logger.error(`[TagFramework] Failed to enqueue tag generation jobs for demerged emails`, err);
        });
      }

      logger.info('[EmailDemergeController] Successfully demerged email', {
        emailId,
        selectedThreadId,
        rootThreadId,
        oldTicketId: originalTicket.id,
        newTicketId: newTicket.id,
        emailsMoved: emailIdsToMove.length,
        message: 'Demerged provider-thread group moved to new ticket',
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
          conversationId: newConversation.conversationId,
        },
        demergedEmailId: emailId,
        emailsMoved: emailIdsToMove.length,
        splitThreadId: selectedThreadId,
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
