/**
 * Email Controller
 * Handles email reply operations
 */

import { Request, Response } from 'express';
import { EmailRepository } from '@/database/repositories/emailRepository';
import { ConversationRepository } from '@/database/repositories/conversationRepository';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { ChannelRepository } from '@/database/repositories/channelRepository';
import { ChannelParticipantRepository } from '@/database/repositories/channelParticipantRepository';
import { EmailDraftRepository } from '@/database/repositories/emailDraftRepository';
import { ExternalMessageRepository } from '@/database/repositories/externalMessageRepository';
import { MessageAttachmentRepository } from '@/database/repositories/messageAttachmentRepository';
import { logger } from '@/utils/logger';
import { EmailType, MessageDirection, ExternalEntityType, AttachmentEntityType } from '@prisma/client';
import { ZohoService } from '@/services/zohoService';
import { MicrosoftDeskService } from '@/services/microsoftDeskService';
import { GoogleService } from '@/services/googleService';

interface ReplyEmailRequest {
  body: string;
  type: 'REPLY' | 'REPLY_ALL';
  to?: string[];
  cc?: string[];
  bcc?: string[];
  attachmentIds?: string[];
}

export class EmailController {
  private emailRepo = new EmailRepository();
  private conversationRepo = new ConversationRepository();
  private externalSourceRepo = new ExternalSourceRepository();
  private channelRepo = new ChannelRepository();
  private channelParticipantRepo = new ChannelParticipantRepository();
  private emailDraftRepo = new EmailDraftRepository();
  private externalMessageRepo = new ExternalMessageRepository();
  private messageAttachmentRepo = new MessageAttachmentRepository();

  /**
   * POST /api/email/:conversationId/reply
   * Send email reply (REPLY or REPLY_ALL)
   */
  replyToEmail = async (req: Request, res: Response) => {
    try {
      const { conversationId } = req.params;
      const { body, type, to: customTo, cc: customCc, bcc: customBcc } = req.body as ReplyEmailRequest;

      // Validate input
      if (!body || typeof body !== 'string') {
        return res.status(400).json({ error: 'Body is required' });
      }

      if (!type || !['REPLY', 'REPLY_ALL'].includes(type)) {
        return res.status(400).json({ error: 'Type must be REPLY or REPLY_ALL' });
      }

      // 1. Fetch conversation
      const conversation = await this.conversationRepo.findById(conversationId);
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      // 1a. Channel membership gate: only participants of the conversation's
      // channel may send replies. Mirrors the Zero ACL enforcement on the read
      // side so the write path can't be used to bypass channel ACLs.
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthenticated' });
      }
      const isMember = await this.channelParticipantRepo.isParticipant(
        conversation.channelId,
        userId,
      );
      if (!isMember) {
        logger.warn('[EmailController] Reply blocked: user is not a channel member', {
          userId,
          channelId: conversation.channelId,
          conversationId,
        });
        return res.status(403).json({ error: 'Not a member of this channel' });
      }

      // 2. Fetch initial email (first email in conversation by createdAt)
      const emails = await this.emailRepo.findByConversationId(conversationId);
      if (emails.length === 0) {
        return res.status(404).json({ error: 'No emails found in conversation' });
      }

      // Get initial email (last in array since findByConversationId orders by createdAt DESC)
      const initialEmail = emails[emails.length - 1];
      // Most recent email (first in DESC-ordered array) — used as isReplyTo for Zoho threading
      const latestEmail = emails[0];

      // 3. Compose recipients based on reply type or use custom recipients if provided
      let toRecipients: string[];
      let ccRecipients: string[] = [];
      let bccRecipients: string[] = [];

      if (customTo && customTo.length > 0) {
        toRecipients = customTo;
        ccRecipients = customCc || [];
        bccRecipients = customBcc || [];
      } else if (type === 'REPLY') {
        toRecipients = [initialEmail.from];
      } else {
        const allRecipients = [initialEmail.from, ...initialEmail.to];
        toRecipients = [...new Set(allRecipients)];
        ccRecipients = initialEmail.cc || [];
      }

      // 4. Get external source for Zoho credentials
      const channel = await this.channelRepo.findById(conversation.channelId);
      if (!channel) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      const externalSource = await this.externalSourceRepo.findByChannelId(channel.id);
      if (!externalSource) {
        return res.status(404).json({ error: 'External source not found' });
      }

      // Get fromEmailAddress from initial email
      const fromEmailAddress = initialEmail.to[0]; // Reply from the original recipient address

      logger.info(`[EmailController] Sending ${type} via ${externalSource.sourceType} for conversation ${conversationId}`);

      // 5. Send reply via the appropriate provider
      // messageId (optional) is the per-message unique id from the provider —
      // used for the email row's externalMessageId + webhook dedup. Falls back
      // to threadId for providers (Zoho/Microsoft) that don't expose one.
      let result: { threadId: string; messageId?: string };

      if (externalSource.sourceType === 'microsoft') {
        const sender = MicrosoftDeskService.createEmailSender(
          externalSource.credentials,
          externalSource.id
        );
        result = await sender.replyToConversation({
          content: body,
          subject: initialEmail.subject,
          to: toRecipients,
          cc: ccRecipients,
          bcc: bccRecipients,
          latestExternalMessageId: latestEmail.externalMessageId,
          threadId: latestEmail.externalThreadId,
        });
      } else if (externalSource.sourceType === 'google') {
        const sender = GoogleService.createEmailSender(
          externalSource.credentials,
          externalSource.id
        );
        result = await sender.replyToConversation({
          content: body,
          subject: initialEmail.subject,
          to: toRecipients,
          cc: ccRecipients,
          bcc: bccRecipients,
          threadId: initialEmail.externalThreadId,
          latestExternalMessageId: latestEmail.externalMessageId,
        });
      } else {
        // Zoho (default)
        const attachmentIds = req.body.attachmentIds || [];
        const ticketId = initialEmail.externalThreadId;
        const sourceId = externalSource.id;

        const zohoService = ZohoService.fromEncryptedCredentials(
          externalSource.credentials,
          sourceId
        );

        const zohoResult = await zohoService.sendReply({
          ticketId,
          content: body,
          to: toRecipients,
          cc: ccRecipients,
          bcc: bccRecipients,
          fromEmailAddress,
          attachmentIds,
          inReplyToThreadId: latestEmail.externalMessageId !== latestEmail.externalThreadId
            ? latestEmail.externalMessageId
            : undefined,
        });
        result = { threadId: zohoResult.threadId };
      }

      // 6. Save reply in database
      const externalMessageId = result.messageId || result.threadId;
      const emailType = type === 'REPLY' ? EmailType.REPLY : EmailType.REPLY_ALL;
      const newEmail = await this.emailRepo.create({
        type: emailType,
        subject: `Re: ${initialEmail.subject}`,
        body,
        to: toRecipients,
        from: fromEmailAddress,
        cc: ccRecipients,
        bcc: bccRecipients,
        conversationId,
        channelId: conversation.channelId,
        externalThreadId: result.threadId,
        externalMessageId,
      });

      // 7. Create ExternalMessage tracking record for deduplication
      // This prevents Zoho sync from creating a duplicate email when it syncs back the sent reply
      try {
        await this.externalMessageRepo.create({
          externalSourceId: externalSource.id,
          externalId: externalMessageId,
          externalThreadId: initialEmail.externalThreadId,
          entityId: newEmail.id,
          direction: MessageDirection.OUTGOING,
          entityType: ExternalEntityType.EMAIL,
        });
        logger.info(`[EmailController] ExternalMessage tracking record created for email: ${newEmail.id}`);
      } catch (error) {
        logger.warn(`[EmailController] Failed to create ExternalMessage tracking record:`, error);
      }

      try {
        await this.emailDraftRepo.deleteByConversationId(conversationId);
        logger.info(`[EmailController] Draft deleted for conversation: ${conversationId}`);
      } catch (error) {
        logger.warn(`[EmailController] Failed to delete draft for conversation ${conversationId}:`, error);
      }

      // 8. Store Zoho attachment references in MessageAttachment table for UI display
      let storedAttachments: any[] = [];
      if (externalSource.sourceType === 'zoho') {
        const attachmentIds = req.body.attachmentIds || [];
        if (attachmentIds.length > 0) {
          try {
          const emailWorkspaceId = await this.channelRepo.getWorkspaceId(conversation.channelId);
            for (const attachmentId of attachmentIds) {
              await this.messageAttachmentRepo.create({
                entityType: AttachmentEntityType.EMAIL,
                entityId: newEmail.id,
                url: `https://desk.zoho.com/api/v1/uploads/${attachmentId}`,
                originalFilename: `attachment-${attachmentId}`,
                size: 0,
                mimetype: 'application/octet-stream',
                createdBy: req.user?.id || 'system',
                uploadedByUserId: req.user?.id || 'system',
                storageProvider: 'zoho',
                conversationId: conversationId,
              workspaceId: emailWorkspaceId,
                metadata: { zohoAttachmentId: attachmentId, source: 'zoho_upload' },
              });
            }
            logger.info(`[EmailController] Stored ${attachmentIds.length} attachment references for email: ${newEmail.id}`);
          } catch (error) {
            logger.warn(`[EmailController] Failed to store attachment references:`, error);
          }

          try {
            storedAttachments = await this.messageAttachmentRepo.findByEntityIdAndType(newEmail.id, AttachmentEntityType.EMAIL);
          } catch (error) {
            logger.warn(`[EmailController] Failed to fetch stored attachments:`, error);
          }
        }
      }

      logger.info(`[EmailController] Reply sent. Email ID: ${newEmail.id}, Zoho Thread ID: ${result.threadId}`);

      return res.status(200).json({
        success: true,
        emailId: newEmail.id,
        threadId: result.threadId,
        attachments: storedAttachments.map(att => ({
          id: att.id,
          url: att.url,
          originalFilename: att.originalFilename,
          size: att.size,
          mimetype: att.mimetype,
        })),
      });
    } catch (error: any) {
      logger.error('[EmailController] Failed to send email reply:', error);
      return res.status(500).json({
        error: 'Failed to send email reply',
        message: error.message,
      });
    }
  };
}
