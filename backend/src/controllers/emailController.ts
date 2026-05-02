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
import { EmailChannelPreferenceRepository } from '@/database/repositories/emailChannelPreferenceRepository';
import { UserRepository } from '@/database/repositories/users';
import { logger } from '@/utils/logger';
import { EmailType, MessageDirection, ExternalEntityType, AttachmentEntityType, Prisma } from '@prisma/client';
import { db } from '@/database/client';
import { ZohoService } from '@/services/zohoService';
import { MicrosoftDeskService } from '@/services/microsoftDeskService';
import { GoogleService } from '@/services/googleService';
import { ExternalAttachmentService } from '@/services/externalAttachmentService';
import { ExternalSourcePlatform } from '@/integrations/core/types';
import { adapterRegistry } from '@/integrations/core/adapterRegistry';
import { AttachmentUploadError } from '@/integrations/core/baseMailReplySender';
import { extractEmailAddress } from '@/utils/email';

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
  private emailChannelPreferenceRepo = new EmailChannelPreferenceRepository();
  private userRepo = new UserRepository();

  /**
   * POST /api/email/:conversationId/reply
   * Send email reply (REPLY or REPLY_ALL)
   *
   * Allows attachment-only sends (empty body) when at least one
   * `attachmentIds` entry is provided.
   */
  replyToEmail = async (req: Request, res: Response) => {
    try {
      const { conversationId } = req.params;
      const { body, type, to: customTo, cc: customCc, bcc: customBcc } = req.body as ReplyEmailRequest;
      const attachmentIds: string[] = Array.isArray(req.body.attachmentIds) ? req.body.attachmentIds : [];

      // Validate input — body OR at least one attachment is required.
      if ((typeof body !== 'string' || body.trim().length === 0) && attachmentIds.length === 0) {
        return res.status(400).json({ error: 'Body or at least one attachment is required' });
      }
      if (typeof body !== 'undefined' && typeof body !== 'string') {
        return res.status(400).json({ error: 'Body must be a string' });
      }

      if (!type || !['REPLY', 'REPLY_ALL'].includes(type)) {
        return res.status(400).json({ error: 'Type must be REPLY or REPLY_ALL' });
      }

      const safeBody = typeof body === 'string' ? body : '';

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

      // 4. Get external source for credentials
      const channel = await this.channelRepo.findById(conversation.channelId);
      if (!channel) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      const externalSource = await this.externalSourceRepo.findByChannelId(channel.id);
      if (!externalSource) {
        return res.status(404).json({ error: 'External source not found' });
      }

      const preference = await this.emailChannelPreferenceRepo.findByChannelId(channel.id);
      if (!preference?.ownerUserId) {
        return res.status(400).json({
          error: 'Desk owner not configured for this channel. Set ownerUserId in EmailChannelPreference.',
        });
      }
      const owner = await this.userRepo.findById(preference.ownerUserId);
      if (!owner?.email) {
        return res.status(400).json({ error: 'Desk owner user not found or has no email.' });
      }
      const fromEmailAddress =
        extractEmailAddress(externalSource.displayName) ?? owner.email;

      logger.info(`[EmailController] Sending ${type} via ${externalSource.sourceType} for conversation ${conversationId}`);

      // Mail-providers (those with a registered mail-reply sender) take
      // attachment bytes inline; Zoho takes its own native attachmentIds in
      // the send body and doesn't need buffer resolution here.
      const adapter = adapterRegistry.getAdapter(externalSource.name);
      const isMailProvider = !!adapter.sendMailReply;
      const { attachments: fileAttachments, stagedRowIds: stagedAttachmentRowIds } =
        await new ExternalAttachmentService().prepareOutboundAttachments(
          isMailProvider ? { attachmentIds } : {},
        );

      // 5. Send reply via the appropriate provider
      // messageId (optional) is the per-message unique id from the provider —
      // used for the email row's externalMessageId + webhook dedup. Falls back
      // to threadId for providers (Zoho/Microsoft) that don't expose one.
      let result: { threadId: string; messageId?: string };

      if (externalSource.sourceType === ExternalSourcePlatform.MICROSOFT) {
        const sender = MicrosoftDeskService.createEmailSender(
          externalSource.credentials,
          externalSource.id
        );
        result = await sender.replyToConversation({
          content: safeBody,
          subject: initialEmail.subject,
          to: toRecipients,
          cc: ccRecipients,
          bcc: bccRecipients,
          latestExternalMessageId: latestEmail.externalMessageId,
          threadId: latestEmail.externalThreadId,
          ...(fileAttachments.length > 0 && { attachments: fileAttachments }),
        });
      } else if (externalSource.sourceType === ExternalSourcePlatform.GOOGLE) {
        const sender = GoogleService.createEmailSender(
          externalSource.credentials,
          externalSource.id
        );
        try {
          result = await sender.replyToConversation({
            content: safeBody,
            subject: initialEmail.subject,
            to: toRecipients,
            cc: ccRecipients,
            bcc: bccRecipients,
            threadId: initialEmail.externalThreadId,
            latestExternalMessageId: latestEmail.externalMessageId,
            ...(fileAttachments.length > 0 && { attachments: fileAttachments }),
          });
        } catch (sendErr: any) {
          if (fileAttachments.length > 0) {
            const reason = sendErr instanceof Error ? sendErr.message : String(sendErr);
            throw new AttachmentUploadError(
              fileAttachments.map(a => ({ name: a.name, reason })),
            );
          }
          throw sendErr;
        }
      } else {
        // Zoho (default)
        const ticketId = initialEmail.externalThreadId;
        const sourceId = externalSource.id;

        const zohoService = ZohoService.fromEncryptedCredentials(
          externalSource.credentials,
          sourceId
        );

        const zohoResult = await zohoService.sendReply({
          ticketId,
          content: safeBody,
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

      logger.info('[EmailController] email_sent', {
        event: 'email_sent',
        channelName: channel.name,
        userEmail: req.user?.email,
      });

      // 6. Save reply in database
      const externalMessageId = result.messageId || result.threadId;
      const emailType = type === 'REPLY' ? EmailType.REPLY : EmailType.REPLY_ALL;
      const newEmail = await this.emailRepo.create({
        type: emailType,
        subject: `Re: ${initialEmail.subject}`,
        body: safeBody,
        to: toRecipients,
        from: fromEmailAddress,
        cc: ccRecipients,
        bcc: bccRecipients,
        conversationId,
        channelId: conversation.channelId,
        externalThreadId: result.threadId,
        externalMessageId,
      });
      
      await db.ticket.updateMany({
        where: { conversationId },
        data: { lastEmailAt: new Date() },
      });

      // 7. Create ExternalMessage tracking record for deduplication.
      // Prevents the provider sync from re-creating an Email row for the
      // outbound message we just sent.
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
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        ) {
          logger.warn(`[EmailController] Failed to create ExternalMessage tracking record:`, error);
        }
      }

      // 7a. Rebind any pre-staged GCS attachments (MS/Google) to the sent
      // Email row so the UI renders them under this message. The upload
      // endpoint stages them with `entityId='pending-email:<conversationId>'`.
      if (stagedAttachmentRowIds.length > 0) {
        try {
          await this.messageAttachmentRepo.updateManyEntityTypeAndId(
            stagedAttachmentRowIds,
            AttachmentEntityType.EMAIL,
            newEmail.id,
          );
        } catch (error) {
          logger.warn(`[EmailController] Failed to rebind staged attachments to email ${newEmail.id}:`, error);
        }
      }

      try {
        await this.emailDraftRepo.deleteByConversationId(conversationId);
        logger.info(`[EmailController] Draft deleted for conversation: ${conversationId}`);
      } catch (error) {
        logger.warn(`[EmailController] Failed to delete draft for conversation ${conversationId}:`, error);
      }

      // 8. Store Zoho attachment references in MessageAttachment table for UI display.
      let storedAttachments: Array<{
        id: string;
        url: string;
        originalFilename: string;
        size: number;
        mimetype: string;
      }> = [];
      if (externalSource.sourceType === 'zoho' && attachmentIds.length > 0) {
        try {
          const emailWorkspaceId = await this.channelRepo.getWorkspaceId(conversation.channelId);
          await Promise.all(
            attachmentIds.map(attachmentId =>
              this.messageAttachmentRepo.create({
                entityType: AttachmentEntityType.EMAIL,
                entityId: newEmail.id,
                url: `https://desk.zoho.com/api/v1/uploads/${attachmentId}`,
                originalFilename: `attachment-${attachmentId}`,
                size: 0,
                mimetype: 'application/octet-stream',
                createdBy: userId,
                uploadedByUserId: userId,
                storageProvider: 'zoho',
                conversationId: conversationId,
                workspaceId: emailWorkspaceId,
                metadata: { zohoAttachmentId: attachmentId, source: 'zoho_upload' },
              }),
            ),
          );
          logger.info(`[EmailController] Stored ${attachmentIds.length} Zoho attachment references for email: ${newEmail.id}`);
        } catch (error) {
          logger.warn(`[EmailController] Failed to store Zoho attachment references:`, error);
        }
      }

      // Always surface the canonical attachments-for-this-email list (covers
      // both Zoho rows just created and MS/Google rows rebound above).
      try {
        const stored = await this.messageAttachmentRepo.findByEntityIdAndType(
          newEmail.id,
          AttachmentEntityType.EMAIL,
        );
        storedAttachments = stored.map(att => ({
          id: att.id,
          url: att.url,
          originalFilename: att.originalFilename,
          size: att.size,
          mimetype: att.mimetype,
        }));
      } catch (error) {
        logger.warn(`[EmailController] Failed to fetch stored attachments:`, error);
      }

      logger.info(`[EmailController] Reply sent. Email ID: ${newEmail.id}, Thread ID: ${result.threadId}`);

      return res.status(200).json({
        success: true,
        emailId: newEmail.id,
        threadId: result.threadId,
        attachments: storedAttachments,
      });
    } catch (error: any) {
      if (error instanceof AttachmentUploadError) {
        logger.error('[EmailController] Reply aborted — attachment upload failed', {
          failed: error.failedAttachments.map(f => f.name),
        });
        return res.status(422).json({
          error: 'attachment_upload_failed',
          message: error.message,
          failedAttachments: error.failedAttachments,
        });
      }
      // Log only the safe fields. Provider SDKs (Gaxios/Graph) attach the
      // entire request config — including the raw MIME body + base64 attachment
      // bytes — to thrown errors. Logging `error` directly leaks that payload.
      logger.error('[EmailController] Failed to send email reply', {
        message: error?.message,
        code: error?.code,
        status: error?.response?.status,
      });
      return res.status(500).json({
        error: 'Failed to send email reply',
        message: error?.message,
      });
    }
  };

  listContacts = async (req: Request, res: Response) => {
    try {
      const { channelId } = req.params;
      if (!channelId) return res.status(400).json({ error: 'channelId required' });

      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthenticated' });
      const isMember = await this.channelParticipantRepo.isParticipant(channelId, userId);
      if (!isMember) {
        return res.status(403).json({ error: 'Not a member of this channel' });
      }

      const externalSource = await this.externalSourceRepo.findByChannelId(channelId);
      if (!externalSource) {
        return res.json({ contacts: [] });
      }

      let contacts: Array<{ name: string | null; email: string }> = [];
      if (externalSource.sourceType === ExternalSourcePlatform.GOOGLE) {
        contacts = await GoogleService.listContacts(externalSource.credentials, externalSource.id);
      } else if (externalSource.sourceType === ExternalSourcePlatform.MICROSOFT) {
        contacts = await MicrosoftDeskService.listContacts(
          externalSource.credentials,
          externalSource.id,
        );
      }
      res.setHeader('Cache-Control', 'private, max-age=300, stale-while-revalidate=3600');
      return res.json({ contacts });
    } catch (error: any) {
      logger.error('[EmailController] listContacts error:', {
        message: error?.message,
        status: error?.response?.status,
      });
      return res.status(500).json({ error: 'Failed to list desk contacts' });
    }
  };
}
