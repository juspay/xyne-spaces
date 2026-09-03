import { Prisma } from '@prisma/client';
import {
  EmailType,
  MessageDirection,
  ExternalEntityType,
  AttachmentEntityType,
  ActivityType,
} from '@xyne/shared';
import { randomUUID } from 'crypto';
import { DatabaseClient } from '@/database/client';
import { ConversationRepository } from '@/database/repositories/conversationRepository';
import { EmailRepository } from '@/database/repositories/emailRepository';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { decrypt } from '@/services/encryptionService';
import { syncTicketEmailCount } from '@/database/syncTicketEmailCount';
import { resolveAppDeskInstalledAppId } from '@/integrations/core/deskSources';
import { dispatchEmailEventForEmailId } from '@/apps/core/emailUtils';
import { sendWebhookNotification } from '@/apps/core/eventSubscriptionUtils';
import { AppEventType, BaseAppEvent, DeskReplyEventPayload, DeskReplyAttachment } from '@/apps/types';
import { logger } from '@/utils/logger';

const TAG = '[AppDeskService]';

class AppDeskService {
  private prisma = DatabaseClient.getInstance();
  private conversationRepo = new ConversationRepository();
  private emailRepo = new EmailRepository();
  private externalSourceRepo = new ExternalSourceRepository();

  async sendAppReply(params: {
    conversationId: string;
    body: string;
    userId: string;
    attachmentIds?: string[];
  }): Promise<{ emailId: string; threadId: string; delivered: boolean }> {
    const { conversationId, body, userId, attachmentIds = [] } = params;

    const conversation = await this.conversationRepo.findById(conversationId);
    if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);

    const externalSource = await this.externalSourceRepo.findByChannelId(conversation.channelId);
    if (!externalSource) throw new Error(`No external source for channel ${conversation.channelId}`);
    if (!externalSource.isActive) {
      throw new Error('This desk is disconnected. Reconnect the Xyne App before replying.');
    }

    const emails = await this.emailRepo.findByConversationId(conversationId);
    if (emails.length === 0) throw new Error(`No emails in conversation ${conversationId}`);


    const initialEmail = emails.find(e => e.externalThreadId) ?? emails[emails.length - 1];
    const threadId = initialEmail.externalThreadId; // the app's thread key
    if (!threadId) throw new Error(`No externalThreadId found for conversation ${conversationId}`);

    const installedAppId = resolveAppDeskInstalledAppId(externalSource);
    if (!installedAppId) {
      throw new Error(`App-desk source ${externalSource.name} is missing its backing install`);
    }
    const installedApp = await this.prisma.installedApps.findUnique({
      where: { id: installedAppId },
      select: { webhookUrl: true, app: { select: { signingSecret: true } }, user: { select: { workspaceId: true } } },
    });
    if (!installedApp) {
      throw new Error(`The app backing this desk no longer exists (install ${installedAppId})`);
    }
    const preference = await this.prisma.emailChannelPreference.findUnique({
      where: { channelId: conversation.channelId },
      select: { appWebhookDeliveryEnabled: true },
    });
    const outboundConfigured = preference?.appWebhookDeliveryEnabled ?? true;
    const webhookConfigured = Boolean(
      installedApp.webhookUrl?.trim() && installedApp.app?.signingSecret,
    );
    if (outboundConfigured && !webhookConfigured) {
      throw new Error(
        'This desk delivers replies to the app webhook, but the app has no webhook URL configured. Add one, or turn off "Send replies to app webhook" in Desk Settings.',
      );
    }
    const signingSecret = installedApp.app?.signingSecret ?? null;

    const replier = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });
    const replierName = replier?.email ? `${replier.name} <${replier.email}>` : replier?.name ?? undefined;

    const stagedAttachments = attachmentIds.length > 0
      ? await this.prisma.messageAttachment.findMany({
          where: { id: { in: attachmentIds }, uploadedByUserId: userId },
          select: { id: true, originalFilename: true, url: true, mimetype: true, size: true },
        })
      : [];
    const attachments: DeskReplyAttachment[] = stagedAttachments.map(a => ({
      name: a.originalFilename,
      url: a.url,
      mimeType: a.mimetype,
      ...(a.size != null && { size: a.size }),
    }));

    const externalMessageId = randomUUID();

    const ticket = await this.prisma.ticket.findFirst({
      where: { conversationId },
      select: { id: true },
    });

    const payload: DeskReplyEventPayload = {
      channelId: conversation.channelId,
      conversationId,
      threadId,
      externalId: externalMessageId,
      body,
      ...(attachments.length > 0 && { attachments }),
      replierUserId: userId,
      ...(replierName && { replierName }),
      ...(ticket?.id && { ticketId: ticket.id }),
      ...(installedApp.user?.workspaceId && { workspaceId: installedApp.user.workspaceId }),
    };

    const event: BaseAppEvent = {
      eventType: AppEventType.DESK_REPLY,
      payload,
      timestamp: new Date().toISOString(),
    };

    logger.info(`${TAG} ${outboundConfigured ? 'delivering' : 'recording (webhook delivery disabled)'} DESK_REPLY`, {
      conversationId,
      channelId: conversation.channelId,
      threadId,
      externalId: externalMessageId,
      installedAppId,
      webhookUrl: installedApp?.webhookUrl ?? null,
      outboundConfigured,
      webhookConfigured,
      ticketId: ticket?.id,
      replierUserId: userId,
      replierName,
      attachmentCount: attachments.length,
    });

    const ack = outboundConfigured
      ? await sendWebhookNotification(installedApp.webhookUrl!, event, decrypt(signingSecret!))
      : null;

    const ackExternalId =
      ack?.body && typeof ack.body === 'object' && typeof (ack.body as { externalId?: unknown }).externalId === 'string'
        ? (ack.body as { externalId: string }).externalId
        : externalMessageId;

    if (ack) {
      logger.info(`${TAG} DESK_REPLY accepted by app`, {
        conversationId,
        threadId,
        status: ack.status,
        ackExternalId,
        appAssignedId: ackExternalId !== externalMessageId,
      });
    }

    const email = await this.prisma.$transaction(async (tx) => {
      const created = await tx.email.create({
        data: {
          type: EmailType.REPLY,
          subject: initialEmail.subject,
          body,
          to: [],
          from: replierName ?? 'Xyne',
          cc: [],
          bcc: [],
          conversationId,
          channelId: conversation.channelId,
          workspaceId: conversation.workspaceId,
          externalThreadId: threadId,
          externalMessageId: ackExternalId,
          sentByUserId: userId,
        } as Prisma.EmailUncheckedCreateInput,
      });

      if (outboundConfigured) {
        await tx.externalMessage.create({
          data: {
            externalSourceId: externalSource.id,
            externalId: ackExternalId,
            externalThreadId: threadId,
            messageId: created.id,
            entityId: created.id,
            workspaceId: conversation.workspaceId,
            direction: MessageDirection.OUTGOING,
            entityType: ExternalEntityType.EMAIL,
          },
        });
      }

      if (stagedAttachments.length > 0) {
        await tx.messageAttachment.updateMany({
          where: { id: { in: stagedAttachments.map(a => a.id) } },
          data: { entityType: AttachmentEntityType.EMAIL, entityId: created.id, conversationId },
        });
      }

      return created;
    });

    await syncTicketEmailCount(this.prisma, conversationId);
    void dispatchEmailEventForEmailId(email.id);

    try {
      await this.prisma.ticket.updateMany({
        where: { conversationId, firstRespondedAt: null },
        data: { firstRespondedAt: email.createdAt },
      });
    } catch (err) {
      logger.error(`${TAG} Failed to record first response time`, { conversationId, err });
    }

    // Audit trail + desk metrics: manual agent reply
    try {
      const tickets = await this.prisma.ticket.findMany({
        where: { conversationId },
        select: { id: true, channelId: true },
      });
      await this.prisma.ticketActivity.createMany({
        data: tickets.map(ticket => ({
          ticketId: ticket.id,
          workspaceId: conversation.workspaceId,
          updatedBy: userId,
          timestamp: email.createdAt,
          activityType: ActivityType.EMAIL_SENT,
          channelId: ticket.channelId,
          value: {
            field: 'emailSent',
            emailId: email.id,
            emailType: EmailType.REPLY,
          } as Prisma.InputJsonValue,
        })),
        skipDuplicates: true,
      });
    } catch (err) {
      logger.error(`${TAG} Failed to record email sent activity`, { conversationId, err });
    }

    logger.info(
      `${TAG} ${outboundConfigured ? 'Reply delivered to app webhook' : 'Reply recorded on ticket (webhook delivery disabled)'}`,
      { conversationId, threadId, externalId: ackExternalId, emailId: email.id },
    );

    return { emailId: email.id, threadId, delivered: outboundConfigured };
  }
}

export const appDeskService = new AppDeskService();
