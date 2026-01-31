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
// import { ZohoService } from '@/services/zohoService';
import { logger } from '@/utils/logger';
import { EmailType } from '@prisma/client';
import { ZohoService } from '@/services/zohoService';

interface ReplyEmailRequest {
  body: string;
  type: 'REPLY' | 'REPLY_ALL';
}

export class EmailController {
  private emailRepo = new EmailRepository();
  private conversationRepo = new ConversationRepository();
  private externalSourceRepo = new ExternalSourceRepository();
  private channelRepo = new ChannelRepository();
  private emailDraftRepo = new EmailDraftRepository();

  /**
   * POST /api/email/:conversationId/reply
   * Send email reply (REPLY or REPLY_ALL)
   */
  replyToEmail = async (req: Request, res: Response) => {
    try {
      const { conversationId } = req.params;
      const { body, type } = req.body as ReplyEmailRequest;

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

      // 3. Compose recipients based on reply type
      let toRecipients: string[];
      let ccRecipients: string[] = [];

      if (type === 'REPLY') {
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
        bcc: [],
        conversationId,
        externalThreadId: result.threadId,
        externalMessageId: result.threadId,
      });

      // 7. Delete draft for this conversation since email has been sent
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
