/**
 * Email Controller
 * Handles email reply operations
 */

import { Request, Response } from 'express';
import { EmailRepository } from '@/database/repositories/emailRepository';
import { ConversationRepository } from '@/database/repositories/conversationRepository';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { ChannelRepository } from '@/database/repositories/channelRepository';
import { EmailDraftRepository } from '@/database/repositories/emailDraftRepository';
import { ExternalMessageRepository } from '@/database/repositories/externalMessageRepository';
// import { ZohoService } from '@/services/zohoService';
import { logger } from '@/utils/logger';
import { EmailType, MessageDirection, ExternalEntityType } from '@prisma/client';
import { ZohoService } from '@/services/zohoService';

interface ReplyEmailRequest {
  body: string;
  type: 'REPLY' | 'REPLY_ALL';
  to?: string[];
  cc?: string[];
  bcc?: string[];
}

export class EmailController {
  private emailRepo = new EmailRepository();
  private conversationRepo = new ConversationRepository();
  private externalSourceRepo = new ExternalSourceRepository();
  private channelRepo = new ChannelRepository();
  private emailDraftRepo = new EmailDraftRepository();
  private externalMessageRepo = new ExternalMessageRepository();

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

      // 2. Fetch initial email (first email in conversation by createdAt)
      const emails = await this.emailRepo.findByConversationId(conversationId);
      if (emails.length === 0) {
        return res.status(404).json({ error: 'No emails found in conversation' });
      }

      // Get initial email (last in array since findByConversationId orders by createdAt DESC)
      const initialEmail = emails[emails.length - 1];

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

      // Get ticketId and fromEmailAddress from initial email
      const ticketId = initialEmail.externalThreadId;
      const fromEmailAddress = initialEmail.to[0]; // Reply from the original recipient address

      // Use external source ID as sourceId for Zoho API
      const sourceId = externalSource.id;

      // 5. Initialize Zoho service and send reply
      const zohoService = ZohoService.fromEncryptedCredentials(
        externalSource.credentials,
        sourceId
      );

      logger.info(`[EmailController] Sending ${type} to ticket ${ticketId} for conversation ${conversationId}`);
      const result = await zohoService.sendReply({
        ticketId,
        content: body,
        to: toRecipients,
        cc: ccRecipients,
        bcc: bccRecipients,
        fromEmailAddress,
      });

     

      // 6. Save reply in database
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
        externalThreadId: result.threadId,
        externalMessageId: result.threadId,
      });

      // 7. Create ExternalMessage tracking record for deduplication
      // This prevents Zoho sync from creating a duplicate email when it syncs back the sent reply
      try {
        await this.externalMessageRepo.create({
          externalSourceId: externalSource.id,
          externalId: result.threadId,
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

      logger.info(`[EmailController] Reply sent. Email ID: ${newEmail.id}, Zoho Thread ID: ${result.threadId}`);

      return res.status(200).json({
        success: true,
        emailId: newEmail.id,
        threadId: result.threadId,
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
