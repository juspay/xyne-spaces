import { Prisma, Conversation, Email, ExternalSource } from '@prisma/client';
import {
  EmailType,
  MessageDirection,
  ExternalEntityType,
  AttachmentEntityType,
  ActivityType,
  ChannelType,
} from '@xyne/shared';
import { randomUUID } from 'crypto';
import { DatabaseClient } from '@/database/client';
import { ConversationRepository } from '@/database/repositories/conversationRepository';
import { EmailRepository } from '@/database/repositories/emailRepository';
import { ExternalMessageRepository } from '@/database/repositories/externalMessageRepository';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { decrypt } from '@/services/encryptionService';
import { syncTicketEmailCount } from '@/database/syncTicketEmailCount';
import { resolveAppDeskInstalledAppId, scopeExternalMessageIdToSource } from '@/integrations/core/deskSources';
import { dispatchEmailEventForEmailId } from '@/apps/core/emailUtils';
import { sendWebhookNotification } from '@/apps/core/eventSubscriptionUtils';
import { AppEventType, BaseAppEvent, DeskReplyEventPayload, DeskReplyAttachment } from '@/apps/types';
import { logger } from '@/utils/logger';

const TAG = '[AppDeskService]';

class AppDeskService {
  private prisma = DatabaseClient.getInstance();
  private conversationRepo = new ConversationRepository();
  private emailRepo = new EmailRepository();
  private externalMessageRepo = new ExternalMessageRepository();
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

    const emails = await this.emailRepo.findByConversationId(conversationId);
    if (emails.length === 0) throw new Error(`No emails in conversation ${conversationId}`);

    const externalSource = await this.resolveConversationAppSource(conversation, emails);
    if (!externalSource.isActive) {
      throw new Error('This desk is disconnected. Reconnect the Xyne App before replying.');
    }


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
          // Namespaced: ackExternalId is chosen by the app, and Email's unique is
          // channel-scoped — two apps on one channel would collide here (P2002
          // after the webhook already fired, so the retry double-delivers).
          externalMessageId: scopeExternalMessageIdToSource(externalSource.id, ackExternalId),
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

  private async resolveConversationAppSource(
    conversation: Conversation,
    emails: Email[],
  ): Promise<ExternalSource> {
    const channelSources = await this.externalSourceRepo.listChannelAppSources(conversation.channelId);
    const link = await this.externalMessageRepo.findLatestAppDeskLinkByEmailIds(
      emails.map(e => e.id),
      channelSources.map(s => s.id),
    );
    const linked = link ? channelSources.find(s => s.id === link.externalSourceId) : undefined;
    if (linked) return linked;

    // No app-desk link on this conversation. On an APP channel every ticket is
    // app-sourced by construction, so a single active app is an unambiguous
    // answer for rows predating the link write. On any other desk type the
    // channel also carries email/Slack/social tickets, and guessing here would
    // ship an agent's reply to a third-party webhook instead of the customer.
    const channel = await this.prisma.channel.findUnique({
      where: { id: conversation.channelId },
      select: { type: true },
    });
    const activeSources = channelSources.filter(s => s.isActive);
    if (channel?.type === ChannelType.APP && activeSources.length === 1 && activeSources[0]) {
      return activeSources[0];
    }
    if (activeSources.length > 0) {
      throw new Error(
        `Cannot route reply: conversation ${conversation.conversationId} is not linked to an app-desk source ` +
        `on channel ${conversation.channelId} (${channel?.type ?? 'unknown'} desk, ` +
        `${activeSources.length} connected app(s)). This ticket did not originate from an app.`,
      );
    }
    throw new Error(`No external source for channel ${conversation.channelId}`);
  }
}

export const appDeskService = new AppDeskService();
