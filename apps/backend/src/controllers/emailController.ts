/**
 * Email Controller
 * Handles email reply operations
 */

import { Request, Response } from 'express';
import { EmailRepository } from '@/database/repositories/emailRepository';
import { ConversationRepository } from '@/database/repositories/conversationRepository';
import { ChannelRepository } from '@/database/repositories/channelRepository';
import { ChannelParticipantRepository } from '@/database/repositories/channelParticipantRepository';
import { EmailDraftRepository } from '@/database/repositories/emailDraftRepository';
import { ExternalMessageRepository } from '@/database/repositories/externalMessageRepository';
import { MessageAttachmentRepository } from '@/database/repositories/messageAttachmentRepository';
import { EmailChannelPreferenceRepository } from '@/database/repositories/emailChannelPreferenceRepository';
import { UserRepository } from '@/database/repositories/users';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { resolveChannelDefaultBoard } from '@/utils/channelDefaultBoard';
import { Prisma } from '@prisma/client';
import {
  EmailType,
  MessageDirection,
  ExternalEntityType,
  AttachmentEntityType,
  ActivityType,
} from '@xyne/shared';
import { db } from '@/database/client';
import {
  listS2SClawAgents,
  getConversationTranscript,
  forkClawConversation,
} from '@/services/clawAgentService';
import { vespaClient } from '@/services/vespaSearch';
import { mailSchema } from '@/vespa/src/types';
import { ZohoService } from '@/services/zohoService';
import { MicrosoftDeskService } from '@/services/microsoftDeskService';
import { GoogleService } from '@/services/googleService';
import { ExternalAttachmentService } from '@/services/externalAttachmentService';
import { applyInlineAttachments } from '@/utils/inlineAttachments';
import { appendReplyQuote } from '@/utils/replyQuote';
import { reattachTrailImages } from '@/utils/reattachTrailImages';
import { ExternalSourcePlatform } from '@/integrations/core/types';
import { adapterRegistry } from '@/integrations/core/adapterRegistry';
import { AttachmentUploadError } from '@/integrations/core/baseMailReplySender';
import { extractEmailAddress } from '@/utils/email';
import { emailService } from '@/services/emailService';
import { config as appConfig } from '@/config/env';
import { tagGenerationPipeline } from '@/tags/pipeline';
import { DESK_EMAIL_SOURCE_TYPE, deskEmailConfigKey } from '@/tags';
import { ChannelExternalSourceResolver } from '@/services/channelExternalSourceResolver';
import { mockDeskMailService } from '@/services/mockDeskMailService';
import { parseMockDeskCredentials } from '@/utils/mockDeskCredentials';
import { recordTicketTimelineEvent } from '@/services/ticketTimelineEventService';
import { v4 as uuidv4 } from 'uuid';

interface ReplyEmailRequest {
  body: string;
  type: 'REPLY' | 'REPLY_ALL';
  to?: string[];
  cc?: string[];
  bcc?: string[];
  attachmentIds?: string[];
  replyToEmailId?: string;
  subject?: string;
  draftId?: string;
  from?: string;
}

export class EmailController {
  private emailRepo = new EmailRepository();
  private conversationRepo = new ConversationRepository();
  private channelExternalSourceResolver = new ChannelExternalSourceResolver();
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
      const { body, type, to: customTo, cc: customCc, bcc: customBcc, replyToEmailId, subject: requestSubject } =
        req.body as ReplyEmailRequest;
      const {
        draftId,
      } = req.body as ReplyEmailRequest;
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

      // Check if email reply is disabled for this ticket (e.g., during Auto RCA generation)
      try {
        const ticket = await db.ticket.findFirst({
          where: { conversationId },
          select: { id: true, emailReplyEnabled: true },
        });
        if (ticket && ticket.emailReplyEnabled === false) {
          logger.warn('[EmailController] Reply blocked: emailReplyEnabled is false', {
            userId,
            ticketId: ticket.id,
            conversationId,
          });
          return res.status(403).json({
            error: 'email_reply_disabled',
            message: 'Email sending is temporarily disabled for this ticket. An automated process is in progress.',
          });
        }
        // If no ticket found, allow reply (this is a conversation without a ticket)
      } catch (lockCheckError) {
        // On any error, fail-open - NEVER block email replies due to lock check errors
        logger.warn('[EmailController] Email reply check failed, allowing reply (fail-open)', {
          userId,
          conversationId,
          error: lockCheckError instanceof Error ? lockCheckError.message : 'Unknown error',
        });
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

      // 4. Get external source for credentials
      const channel = await this.channelRepo.findById(conversation.channelId);
      if (!channel) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      const externalSource = await this.channelExternalSourceResolver.resolveForChannel(channel.id);
      if (!externalSource) {
        return res.status(404).json({ error: 'External source not found' });
      }

      const quoteSource =
        (replyToEmailId && emails.find(e => e.id === replyToEmailId)) || latestEmail;
      const isGmail = externalSource.sourceType === ExternalSourcePlatform.GOOGLE;
      const bodyWithQuote = isGmail
        ? appendReplyQuote(safeBody, {
            from: quoteSource.from,
            body: quoteSource.body,
            createdAt: quoteSource.createdAt,
          })
        : safeBody;

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
      // Resolution priority for the From address on outbound mail:
      //   0. Caller-supplied `from` — explicit override, highest priority.
      //   1. Admin-configured Gmail send-as alias (`preference.sendAsEmail`) —
      //      explicit user intent, highest priority.
      //   2. The bound mailbox from the OAuth integration, with `extractEmailAddress`
      //      cleaning legacy displayName wrappers like "Microsoft (foo@bar.com)".
      //   3. Owner's user-account email — last-resort fallback when there's no
      //      integration or the displayName doesn't contain a parseable email.
      const { from: requestedFrom } = req.body as ReplyEmailRequest;
      const fromEmailAddress =
        requestedFrom ||
        preference.sendAsEmail ||
        extractEmailAddress(externalSource.displayName) ||
        owner.email;

      if (!customTo || customTo.length === 0) {
        return res.status(400).json({ error: 'Recipients required' });
      }
      const toRecipients = customTo;
      const ccRecipients = customCc || [];
      const bccRecipients = customBcc || [];

      logger.info(`[EmailController] Sending ${type} via ${externalSource.sourceType} for conversation ${conversationId}`);

      // Mail-providers (those with a registered mail-reply sender) take
      if (attachmentIds.length > 0) {
        const rows = await this.messageAttachmentRepo.findByIds(attachmentIds);
        const allowed = new Set(
          rows.filter(r => r.uploadedByUserId === userId).map(r => r.id),
        );
        const denied = attachmentIds.filter(id => !allowed.has(id));
        if (denied.length > 0) {
          logger.warn('[EmailController] Reply blocked: unauthorized attachment ids', {
            userId,
            conversationId,
            denied,
          });
          return res.status(403).json({ error: 'Unauthorized attachment access' });
        }
      }

      // attachment bytes inline; Zoho takes its own native attachmentIds in
      // the send body and doesn't need buffer resolution here.
      const adapter = adapterRegistry.getAdapter(externalSource.name);
      const isMailProvider = !!adapter.sendMailReply;
      const { attachments: preparedAttachments, stagedRowIds: stagedAttachmentRowIds } =
        await new ExternalAttachmentService().prepareOutboundAttachments(
          isMailProvider ? { attachmentIds } : {},
        );

      const inlineRewrite = isMailProvider
        ? applyInlineAttachments(bodyWithQuote, preparedAttachments)
        : {
            body: bodyWithQuote,
            attachments: preparedAttachments,
            inlineCidByAttachmentId: new Map<string, string>(),
          };
          
      const outboundBody = inlineRewrite.body;
      const inlineCidByAttachmentId = inlineRewrite.inlineCidByAttachmentId;
      const priorEmailIds = emails.map(e => e.id).filter(id => id);
      const priorAttachments = priorEmailIds.length > 0
        ? await db.messageAttachment.findMany({
            where: {
              entityType: AttachmentEntityType.EMAIL,
              entityId: { in: priorEmailIds },
            },
            select: {
              id: true,
              url: true,
              originalFilename: true,
              mimetype: true,
              metadata: true,
            },
          })
        : [];
      const trailAttachments = isMailProvider
        ? await reattachTrailImages({
            body: outboundBody,
            excludeCids: inlineCidByAttachmentId.values(),
            priorAttachments,
          })
        : [];
      const fileAttachments = [...inlineRewrite.attachments, ...trailAttachments];

      // 5. Send reply via the appropriate provider
      // messageId (optional) is the per-message unique id from the provider —
      // used for the email row's externalMessageId + webhook dedup. Falls back
      // to threadId for providers (Zoho/Microsoft) that don't expose one.
      const baseSubject = requestSubject?.trim()
        ? requestSubject.trim().replace(/^(re:\s*)+/i, '').trim()
        : initialEmail.subject.replace(/^(re:\s*)+/i, '').trim();
      const replySubject = `Re: ${baseSubject}`;

      let result: { threadId: string; messageId?: string };

      // Mock Desk short-circuit (test/dev only). When the resolved source carries
      // mock credentials AND the DESK_MOCK_ENABLED flag is on, capture the outbound
      // reply into the in-memory mock mailbox instead of dispatching to a real
      // provider — whose credentials are fabricated and would fail auth. Everything
      // after this branch (DB persistence, activity, dedup) runs unchanged.
      const isMockDeskSource =
        appConfig.isDeskMockEnabled &&
        parseMockDeskCredentials(externalSource.credentials).isMock;

      if (isMockDeskSource) {
        const captured = mockDeskMailService.captureSentMail({
          kind: 'reply',
          channelId: conversation.channelId,
          conversationId,
          from: fromEmailAddress,
          to: toRecipients,
          cc: ccRecipients,
          bcc: bccRecipients,
          subject: replySubject,
          body: outboundBody,
          threadId:
            latestEmail.externalThreadId ?? initialEmail.externalThreadId ?? undefined,
          attachmentCount: fileAttachments.length,
        });
        result = { threadId: captured.threadId, messageId: captured.messageId };
      } else if (externalSource.sourceType === ExternalSourcePlatform.MICROSOFT) {
        const sender = MicrosoftDeskService.createEmailSender(
          externalSource.credentials,
          externalSource.id
        );
         result = await sender.replyToConversation({
          content: outboundBody,
          subject: replySubject,
          to: toRecipients,
          cc: ccRecipients,
          bcc: bccRecipients,
          latestExternalMessageId: latestEmail.externalMessageId,
          threadId: latestEmail.externalThreadId,
          ...(fromEmailAddress && { fromEmailAddress }),
          ...(fileAttachments.length > 0 && { attachments: fileAttachments }),
        });
      } else if (externalSource.sourceType === ExternalSourcePlatform.GOOGLE) {
        const sender = GoogleService.createEmailSender(
          externalSource.credentials,
          externalSource.id
        );
        try {
          result = await sender.replyToConversation({
            content: outboundBody,
            subject: replySubject,
            to: toRecipients,
            cc: ccRecipients,
            bcc: bccRecipients,
            threadId: initialEmail.externalThreadId,
            latestExternalMessageId: latestEmail.externalMessageId,
            ...(fromEmailAddress && { fromEmailAddress }),
            ...(fileAttachments.length > 0 && { attachments: fileAttachments }),
          });
        } catch (sendErr: any) {
          logger.error('[EmailController] Google replyToConversation failed', {
            conversationId,
            message: sendErr?.message,
          });
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
          content: bodyWithQuote,
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
        type,
        channelName: channel.name,
        userEmail: req.user?.email,
      });

      // 6. Save reply in database
      const externalMessageId = result.messageId || result.threadId;
      const emailType = type === 'REPLY' ? EmailType.REPLY : EmailType.REPLY_ALL;
      const newEmail = await this.emailRepo.create({
        type: emailType,
        subject: replySubject,
        body: outboundBody,
        to: toRecipients,
        from: fromEmailAddress,
        cc: ccRecipients,
        bcc: bccRecipients,
        conversationId,
        channelId: conversation.channelId,
        externalThreadId: result.threadId,
        externalMessageId,
        sentByUserId: userId,
      });
      
      await db.ticket.updateMany({
        where: { conversationId },
        data: { lastEmailAt: newEmail.createdAt },
      });

      // 6a. Record the reply as a ticket event, mirroring how stage changes surface: a
      // ticket_activities row for the Details → Activity timeline, plus a SYSTEM message for the
      // Messages thread. Non-blocking — the email is already sent, so a failure here must never
      // fail the reply. Uses ActivityType.METADATA with a `field: 'emailReply'` discriminator so
      // no new enum value / migration is needed (see also 'stageFormFile' / 'customField').
      try {
        const replyingUser = await this.userRepo.findById(userId);
        const replierName = replyingUser?.name || req.user?.name || 'Someone';

        const ticketForActivity = await db.ticket.findFirst({
          where: { conversationId },
          select: { id: true, workspaceId: true },
        });

        await recordTicketTimelineEvent({
          activity: ticketForActivity
            ? {
                ticketId: ticketForActivity.id,
                updatedBy: userId,
                workspaceId: ticketForActivity.workspaceId,
                activityType: ActivityType.METADATA,
                value: {
                  field: 'emailReply',
                  type: emailType,
                  to: toRecipients,
                } as Prisma.InputJsonValue,
              }
            : undefined,
          message: {
            conversationId,
            senderId: userId,
            content: `${replierName} replied to the email`,
            activityType: 'EMAIL_REPLY',
            workspaceId: channel.workspaceId,
          },
        });
      } catch (activityError) {
        logger.warn('[EmailController] Failed to record reply activity/message', {
          conversationId,
          error: activityError instanceof Error ? activityError.message : String(activityError),
        });
      }

      // Record the first response time for SLA tracking.
      // Uses newEmail.createdAt so the timestamp matches the persisted email record.
      await emailService.recordFirstResponse(conversationId, newEmail.createdAt);

      // Audit trail + desk metrics: manual agent reply.
      await emailService.recordEmailSentActivity(
        conversationId,
        newEmail.id,
        emailType,
        userId,
        newEmail.createdAt,
      );

      if (appConfig.enableTagGenerationPipeline && channel.workspaceId) {
        void tagGenerationPipeline.addGenerationJob({
          sourceId: newEmail.id,
          sourceType: DESK_EMAIL_SOURCE_TYPE,
          workspaceId: channel.workspaceId,
          configKey: deskEmailConfigKey(conversation.channelId),
        }, 2).then((jobId) => {
          logger.info(`[TagFramework] Enqueued tag generation job ${jobId} for reply email ${newEmail.id}`);
        }).catch((err: unknown) => {
          logger.error(`[TagFramework] Failed to enqueue tag generation for reply email ${newEmail.id}`, err);
        });
      }

      void (async (): Promise<void> => {
        try {
          const { emitEmailSent } = await import('@/automations/triggers/email-sent.trigger');
          await emitEmailSent(newEmail.id);
        } catch (err) {
          logger.warn('[EmailController] emitEmailSent failed for reply', {
            emailId: newEmail.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })();

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

        if (inlineCidByAttachmentId.size > 0) {
          await Promise.allSettled(
            [...inlineCidByAttachmentId.entries()].map(async ([attId, cid]) => {
              const row = await db.messageAttachment.findUnique({
                where: { id: attId },
                select: { metadata: true },
              });
              const existing = (row?.metadata ?? {}) as Record<string, unknown>;
              await db.messageAttachment.update({
                where: { id: attId },
                data: { metadata: { ...existing, contentId: cid, isInline: true } },
              });
            }),
          );
        }
      }

      if (draftId) {
        try {
          await this.emailDraftRepo.deleteById(draftId);
          logger.info(`[EmailController] Draft deleted after send: ${draftId}`);
        } catch (error) {
          logger.warn(`[EmailController] Failed to delete draft ${draftId}:`, error);
        }
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

      const externalSource = await this.channelExternalSourceResolver.resolveForChannel(channelId);
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

  listPeople = async (req: Request, res: Response) => {
    try {
      const { channelId } = req.params;
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthenticated' });
      if (channelId) {
        const isMember = await this.channelParticipantRepo.isParticipant(channelId, userId);
        if (!isMember) {
          return res.status(403).json({ error: 'Not a member of this channel' });
        }
      }

      const esc = (v: string): string => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const cond =
        (channelId ? `channelId contains "${esc(channelId)}" and ` : '') +
        `entity contains "support_desk" and permissions contains "${esc(userId)}"`;

      const dedupeByEmail = (
        raws: Array<{ value: string; count: number }>,
      ): Array<{ name: string | null; email: string; count: number }> => {
        const byEmail = new Map<string, { name: string | null; email: string; count: number }>();
        for (const { value, count } of raws) {
          const m = value.match(/<([^>]+)>/);
          const email = (m ? m[1] : value).trim().toLowerCase();
          if (!email || !email.includes('@')) continue;
          const name = m ? value.slice(0, value.indexOf('<')).trim() || null : null;
          const existing = byEmail.get(email);
          if (existing) existing.count += count;
          else byEmail.set(email, { name, email, count });
        }
        return Array.from(byEmail.values()).sort((a, b) => b.count - a.count);
      };

      const grouping = (field: string): string =>
        `all(group(${field}) order(-count()) max(500) each(output(count())))`;
      const yql =
        `select * from ${mailSchema} where ${cond} ` +
        `| all(${grouping('from')} ${grouping('to')} ${grouping('cc')})`;
      const resp = await vespaClient.search<any>({
        yql,
        hits: 0,
        'ranking.profile': 'unranked',
      });

      // Bucket grouped entries by their field label (grouplist:from / :to / :cc).
      const byField: Record<string, Array<{ value: string; count: number }>> = {};
      const walk = (node: any): void => {
        for (const c of node?.children ?? []) {
          if (typeof c?.id === 'string' && c.id.startsWith('grouplist:') && c.label) {
            const bucket = (byField[c.label] ??= []);
            for (const g of c.children ?? []) {
              if (g?.value != null && g?.fields?.['count()'] != null) {
                bucket.push({ value: String(g.value), count: Number(g.fields['count()']) });
              }
            }
          }
          walk(c);
        }
      };
      walk(resp?.root ?? {});

      // Senders feed `from:`; recipients (to + cc, merged on dedupe) feed `to:`.
      const senders = dedupeByEmail(byField['from'] ?? []);
      const recipients = dedupeByEmail([...(byField['to'] ?? []), ...(byField['cc'] ?? [])]);

      res.setHeader('Cache-Control', 'private, max-age=300, stale-while-revalidate=3600');
      return res.json({ senders, recipients });
    } catch (error: any) {
      logger.error('[EmailController] listPeople error:', {
        message: error?.message,
      });
      return res.status(500).json({ error: 'Failed to list desk people' });
    }
  };

  listClawAgents = async (req: Request, res: Response) => {
    try {
      const { channelId } = req.params;
      if (!channelId) return res.status(400).json({ error: 'channelId required' });

      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthenticated' });
      const isMember = await this.channelParticipantRepo.isParticipant(channelId, userId);
      if (!isMember) {
        return res.status(403).json({ error: 'Not a member of this channel' });
      }

      const participantUserIds = new Set(
        await this.channelParticipantRepo.getBotAppParticipantUserIds(channelId),
      );
      if (participantUserIds.size === 0) {
        return res.json({ agents: [] });
      }

      const allAgents = await listS2SClawAgents();
      const agents = allAgents
        .filter(a => a.spacesAppUserId && participantUserIds.has(a.spacesAppUserId))
        .map(a => ({ slug: a.slug, name: a.name, color: a.color }));

      res.setHeader('Cache-Control', 'no-store');
      return res.json({ agents });
    } catch (error: any) {
      logger.error('[EmailController] listClawAgents error:', {
        message: error?.message,
        status: error?.response?.status,
      });
      return res.status(502).json({ error: 'Failed to list channel claw agents' });
    }
  };

  getAutoDraftTranscript = async (req: Request, res: Response) => {
    try {
      const { conversationId } = req.params;
      const channelId = (req.query.channelId as string | undefined)?.trim();
      if (!conversationId || !channelId) {
        return res.status(400).json({ error: 'conversationId and channelId are required' });
      }

      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthenticated' });
      const isMember = await this.channelParticipantRepo.isParticipant(channelId, userId);
      if (!isMember) {
        return res.status(403).json({ error: 'Not a member of this channel' });
      }

      const preference = await this.emailChannelPreferenceRepo.findByChannelId(channelId);
      const agentSlug = preference?.autoDraftAgentSlug?.trim() || 'draft-agent';
      const personaUserId = preference?.ownerUserId || null;
      if (!personaUserId) {
        return res.json({ available: false, messages: [] });
      }

      const transcript = await getConversationTranscript({
        agentSlug,
        conversationId,
        userId: personaUserId,
        // The insight is scoped to the current channel, so use the
        // authenticated viewer's verified workspace context to disambiguate
        // the persona's Spaces surface identity for the S2S Claw request.
        spacesWorkspaceId: req.user?.workspaceId,
      });

      res.setHeader('Cache-Control', 'no-store');
      return res.json({ available: true, agentSlug, ...transcript });
    } catch (error: any) {
      logger.error('[EmailController] getAutoDraftTranscript error:', {
        message: error?.message,
      });
      return res.status(502).json({ error: 'Failed to fetch auto-draft transcript' });
    }
  };

  continueAutoDraft = async (req: Request, res: Response) => {
    try {
      const { conversationId } = req.params;
      const channelId = (req.body?.channelId as string | undefined)?.trim();
      if (!conversationId || !channelId) {
        return res.status(400).json({ error: 'conversationId and channelId are required' });
      }

      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthenticated' });
      const isMember = await this.channelParticipantRepo.isParticipant(channelId, userId);
      if (!isMember) {
        return res.status(403).json({ error: 'Not a member of this channel' });
      }

      const preference = await this.emailChannelPreferenceRepo.findByChannelId(channelId);
      const agentSlug = preference?.autoDraftAgentSlug?.trim() || 'draft-agent';
      const targetConversationId = uuidv4().replace(/_/g, '-');

      const forked = await forkClawConversation({
        agentSlug,
        sourceConversationId: conversationId,
        targetConversationId,
        userId,
        spacesWorkspaceId: req.user?.workspaceId,
      });

      if (!forked.success) {
        logger.warn('[EmailController] continueAutoDraft: fork failed', {
          conversationId,
          agentSlug,
          error: forked.error,
        });
        return res
          .status(409)
          .json({ error: 'Auto-draft conversation is no longer available to continue' });
      }

      return res.json({ conversationId: targetConversationId, agentSlug });
    } catch (error: any) {
      logger.error('[EmailController] continueAutoDraft error:', {
        message: error?.message,
      });
      return res.status(502).json({ error: 'Failed to continue auto-draft' });
    }
  };

  composeEmail = async (req: Request, res: Response) => {
    try {
      const {
        channelId,
        to,
        cc = [],
        bcc = [],
        subject,
        body,
      } = req.body as {
        channelId?: string;
        to?: string[];
        cc?: string[];
        bcc?: string[];
        subject?: string;
        body?: string;
      };
      const attachmentIds: string[] = Array.isArray(req.body.attachmentIds)
        ? req.body.attachmentIds
        : [];

      if (!channelId) {
        return res.status(400).json({ error: 'channelId is required' });
      }
      if (!Array.isArray(to) || to.length === 0) {
        return res.status(400).json({ error: 'At least one recipient is required' });
      }
      if (typeof subject !== 'string' || subject.trim().length === 0) {
        return res.status(400).json({ error: 'Subject is required' });
      }
      const hasContent = typeof body === 'string' && body.trim().length > 0;
      if (!hasContent && attachmentIds.length === 0) {
        return res.status(400).json({ error: 'Body or at least one attachment is required' });
      }

      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthenticated' });
      }

      const isMember = await this.channelParticipantRepo.isParticipant(channelId, userId);
      if (!isMember) {
        return res.status(403).json({ error: 'Not a member of this channel' });
      }

      const channel = await this.channelRepo.findById(channelId);
      if (!channel) {
        return res.status(404).json({ error: 'Channel not found' });
      }
      if (channel.type !== 'EMAIL') {
        return res.status(400).json({ error: 'Channel must be of type EMAIL' });
      }

      const externalSource = await this.channelExternalSourceResolver.resolveForChannel(channel.id);
      if (!externalSource) {
        return res.status(404).json({ error: 'External source not found for channel' });
      }

      const adapter = adapterRegistry.getAdapter(externalSource.name);
      if (!adapter.sendMailNew) {
        return res.status(400).json({
          error: `Provider ${externalSource.sourceType} does not support new mail`,
        });
      }

      const safeSubject = subject.trim();
      const safeBody = hasContent ? body : '';

      // Resolve send-as before dispatching so the provider sets the right
      // `From:` header (Gmail alias / Graph send-as / DL). Priority mirrors
      // the reply path:
      //   1. Admin-configured alias on EmailChannelPreference.sendAsEmail
      //   2. Bound mailbox from the OAuth integration (cleaned of legacy
      //      "Microsoft (foo@bar)" wrappers via extractEmailAddress)
      //   3. Owner's user-account email — last-resort fallback
      const preference = await this.emailChannelPreferenceRepo.findByChannelId(channel.id);
      let ownerEmail = '';
      if (preference?.ownerUserId) {
        const owner = await this.userRepo.findById(preference.ownerUserId);
        ownerEmail = owner?.email || '';
      }
      const fromEmail =
        preference?.sendAsEmail ||
        extractEmailAddress(externalSource.displayName) ||
        ownerEmail ||
        externalSource.displayName ||
        '';

      if (attachmentIds.length > 0) {
        const rows = await this.messageAttachmentRepo.findByIds(attachmentIds);
        const allowed = new Set(rows.filter(r => r.uploadedByUserId === userId).map(r => r.id));
        const denied = attachmentIds.filter(id => !allowed.has(id));
        if (denied.length > 0) {
          logger.warn('[EmailController] Compose blocked: unauthorized attachment ids', {
            userId,
            channelId,
            denied,
          });
          return res.status(403).json({ error: 'Unauthorized attachment access' });
        }
      }

      const { attachments: preparedAttachments, stagedRowIds: stagedAttachmentRowIds } =
        await new ExternalAttachmentService().prepareOutboundAttachments({ attachmentIds });

      const inlineRewrite = applyInlineAttachments(safeBody, preparedAttachments);
      const outboundBody = inlineRewrite.body;
      const fileAttachments = inlineRewrite.attachments;
      const inlineCidByAttachmentId = inlineRewrite.inlineCidByAttachmentId;

      // Mock Desk short-circuit (test/dev only) — mirror the reply path. Capture
      // the composed mail into the in-memory mock mailbox instead of calling the
      // real provider when the source carries mock credentials and the flag is on.
      const isMockDeskSource =
        appConfig.isDeskMockEnabled &&
        parseMockDeskCredentials(externalSource.credentials).isMock;

      const sendResult = isMockDeskSource
        ? ((): { threadId: string; messageId?: string } => {
            const captured = mockDeskMailService.captureSentMail({
              kind: 'compose',
              channelId,
              from: fromEmail,
              to: [...new Set(to)],
              cc: [...new Set(cc)],
              bcc: [...new Set(bcc)],
              subject: safeSubject,
              body: outboundBody,
              attachmentCount: fileAttachments.length,
            });
            return { threadId: captured.threadId, messageId: captured.messageId };
          })()
        : await adapter.sendMailNew({
            encryptedCredentials: externalSource.credentials,
            sourceId: externalSource.id,
            subject: safeSubject,
            body: outboundBody,
            to: [...new Set(to)],
            cc: [...new Set(cc)],
            bcc: [...new Set(bcc)],
            ...(fromEmail && { fromEmailAddress: fromEmail }),
            ...(fileAttachments.length > 0 && { fileAttachments }),
          });

      const externalMessageId = sendResult.messageId || sendResult.threadId;

      try {
        let boardId: string | undefined =
          preference?.boardId ?? externalSource.boardId ?? undefined;
        if (!boardId) {
          const resolved = await resolveChannelDefaultBoard(db, channelId);
          boardId = resolved?.boardId;
        }

        const created = await emailService.createConversationWithEmail({
          channelId,
          userId,
          ...(boardId && { boardId }),
          emailSubject: safeSubject,
          emailBody: outboundBody,
          emailTo: [...new Set(to)],
          emailFrom: fromEmail,
          emailCc: [...new Set(cc)],
          emailBcc: [...new Set(bcc)],
          externalThreadId: sendResult.threadId,
          externalMessageId,
          receivedAt: new Date(),
          emailType: EmailType.COMPOSE,
          sentByUserId: userId,
        });

        if (!created || !('conversation' in created) || !('ticket' in created) || !('email' in created)) {
          logger.warn('[EmailController] composeEmail: conversation creation skipped', { created });
          return res.status(200).json({
            success: true,
            sent: true,
            threadId: sendResult.threadId,
          });
        }

        const { conversation, ticket, email: newEmail } = created;

        // Audit trail + desk metrics: manual compose counts as an agent send.
        await emailService.recordEmailSentActivity(
          conversation.conversationId,
          newEmail.id,
          EmailType.COMPOSE,
          userId,
          newEmail.createdAt,
        );

        // Compose-only: the agent who composes a new email owns the resulting
        // ticket — assign it to them so it doesn't sit unassigned. Reply/Reply-all
        // on an existing thread never reaches this path and keeps its assignee.
        try {
          await repositories.tickets.updateTicketAssignee(ticket.id, userId, userId);
        } catch (error) {
          logger.warn('[EmailController] composeEmail: auto-assign to composer failed', {
            ticketId: ticket.id,
            userId,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }

        try {
          await this.externalMessageRepo.create({
            externalSourceId: externalSource.id,
            externalId: externalMessageId,
            externalThreadId: sendResult.threadId,
            entityId: newEmail.id,
            direction: MessageDirection.OUTGOING,
            entityType: ExternalEntityType.EMAIL,
          });
        } catch (error) {
          if (
            !(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
          ) {
            logger.warn('[EmailController] Failed to create ExternalMessage record:', error);
          }
        }

        if (stagedAttachmentRowIds.length > 0) {
          try {
            // Atomic two-phase rebind: if the second updateMany throws after
            // the first commits, the rows would otherwise be left with
            // entityType=EMAIL + entityId=newEmail.id but conversationId=NULL,
            // breaking any read path that filters attachments by both.
            // $transaction ensures all-or-nothing.
            await db.$transaction([
              db.messageAttachment.updateMany({
                where: { id: { in: stagedAttachmentRowIds } },
                data: {
                  entityType: AttachmentEntityType.EMAIL,
                  entityId: newEmail.id,
                },
              }),
              db.messageAttachment.updateMany({
                where: { id: { in: stagedAttachmentRowIds } },
                data: { conversationId: conversation.conversationId },
              }),
            ]);
          } catch (error) {
            logger.warn(
              `[EmailController] Failed to rebind staged attachments to email ${newEmail.id}:`,
              error,
            );
          }

          if (inlineCidByAttachmentId.size > 0) {
            await Promise.allSettled(
              [...inlineCidByAttachmentId.entries()].map(async ([attId, cid]) => {
                const row = await db.messageAttachment.findUnique({
                  where: { id: attId },
                  select: { metadata: true },
                });
                const existing = (row?.metadata ?? {}) as Record<string, unknown>;
                await db.messageAttachment.update({
                  where: { id: attId },
                  data: { metadata: { ...existing, contentId: cid, isInline: true } },
                });
              }),
            );
          }
        }

        logger.info('[EmailController] email_sent', {
          event: 'email_sent',
          type: 'COMPOSE',
          channelName: channel.name,
          ticketId: ticket.id,
          userEmail: req.user?.email,
        });

        return res.status(200).json({
          success: true,
          sent: true,
          ticketId: ticket.id,
          ticketXyneId: ticket.xyneId,
          conversationId: conversation.conversationId,
          channelId,
          emailId: newEmail.id,
          threadId: sendResult.threadId,
        });
      } catch (postSendError: any) {
        logger.error(
          '[EmailController] new email sent but failed to create local ticket/conversation',
          {
            channelId,
            threadId: sendResult.threadId,
            externalMessageId,
            message: postSendError?.message,
          },
        );

        if (stagedAttachmentRowIds.length > 0) {
          try {
            await db.messageAttachment.deleteMany({
              where: { id: { in: stagedAttachmentRowIds } },
            });
          } catch (cleanupError) {
            logger.warn(
              '[EmailController] Failed to clean up orphaned staged attachments',
              { stagedAttachmentRowIds, error: cleanupError },
            );
          }
        }
        return res.status(200).json({
          success: true,
          sent: true,
          threadId: sendResult.threadId,
          warning:
            postSendError?.message ||
            'Email sent, but xyne could not record it. It will appear when the recipient replies.',
        });
      }
    } catch (error: any) {
      if (error instanceof AttachmentUploadError) {
        return res.status(422).json({
          error: 'attachment_upload_failed',
          message: error.message,
          failedAttachments: error.failedAttachments,
        });
      }

      const responseData = error?.response?.data;
      const oauthError =
        typeof responseData === 'object' && responseData !== null
          ? {
              providerError: responseData.error,
              providerErrorDescription: responseData.error_description,
              providerMessage:
                typeof responseData.error === 'object'
                  ? responseData.error.message
                  : undefined,
            }
          : undefined;
      logger.error('[EmailController] Failed to send new email', {
        message: error?.message,
        code: error?.code,
        status: error?.response?.status,
        ...oauthError,
      });
      return res.status(500).json({
        error: 'Failed to send new email',
        message: error?.message,
      });
    }
  };
}
