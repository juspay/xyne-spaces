import { Prisma } from '@prisma/client';
import {
  EmailType,
  MessageDirection,
  ExternalEntityType,
  ActivityType,
  AttachmentEntityType,
} from '@xyne/shared';
import { randomUUID } from 'crypto';
import { DatabaseClient } from '@/database/client';
import { ConversationRepository } from '@/database/repositories/conversationRepository';
import { EmailRepository } from '@/database/repositories/emailRepository';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { decrypt } from '@/services/encryptionService';
import { syncTicketEmailCount } from '@/database/syncTicketEmailCount';
import { extractSlackChannelId } from '@/integrations/core/deskSources';
import { dispatchEmailEventForEmailId } from '@/apps/core/emailUtils';
import { ExternalAttachmentService } from '@/services/externalAttachmentService';
import { logger } from '@/utils/logger';
import { htmlToSlackMrkdwn } from '@/integrations/adapters/slack-desk/slackMrkdwn';

const TAG = '[SlackDeskService]';

class SlackDeskService {
  private prisma = DatabaseClient.getInstance();
  private conversationRepo = new ConversationRepository();
  private emailRepo = new EmailRepository();
  private externalSourceRepo = new ExternalSourceRepository();

  async sendSlackReply(params: {
    conversationId: string;
    body: string;
    userId: string;
    attachmentIds?: string[];
  }): Promise<{ emailId: string; slackTs: string }> {
    const { conversationId, body, userId, attachmentIds = [] } = params;

    // 1. Fetch conversation and thread info
    const conversation = await this.conversationRepo.findById(conversationId);
    if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);

    const externalSource = await this.externalSourceRepo.findChannelSource(conversation.channelId, {
      sourceTypes: ['slack-desk'],
    });
    if (!externalSource) throw new Error(`No external source for channel ${conversation.channelId}`);

    const emails = await this.emailRepo.findByConversationId(conversationId);
    if (emails.length === 0) throw new Error(`No emails in conversation ${conversationId}`);

    // Initial email has the thread_ts (externalThreadId)
    const initialEmail = emails[emails.length - 1];
    const threadTs = initialEmail.externalThreadId;
    if (!threadTs) throw new Error(`No thread_ts found for conversation ${conversationId}`);

    // 2. Get Slack channel ID and bot token from credentials
    const decryptedCreds = decrypt(externalSource.credentials);
    const creds = JSON.parse(decryptedCreds) as { botOauthToken?: string; signingSecret?: string };
    if (!creds.botOauthToken) {
      throw new Error('No botOauthToken in ExternalSource credentials');
    }

    // Determine Slack channel ID from source name (slack-desk-C09RF2JQTE1 → C09RF2JQTE1)
    const slackChannelId = extractSlackChannelId(externalSource.name);
    if (!slackChannelId) {
      throw new Error(`Cannot extract Slack channel ID from source name: ${externalSource.name}`);
    }

    // 2b. Check for per-user Slack token (send-as-user)
    let authToken = creds.botOauthToken;
    let senderName = 'Xyne Bot';

    const userExternalToken = await this.prisma.userExternalToken.findUnique({
      where: { userId_provider: { userId, provider: 'slack' } },
    });
    if (userExternalToken) {
      authToken = decrypt(userExternalToken.encryptedToken);
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true },
      });
      senderName = user?.email ? `${user.name} <${user.email}>` : user?.name ?? senderName;
    }

    const mrkdwnBody = htmlToSlackMrkdwn(body);
    const hasText = mrkdwnBody.trim().length > 0;
    if (!hasText && attachmentIds.length === 0) {
      throw new Error('Reply must have text or at least one attachment');
    }
    let messageTs: string;

    if (hasText) {
      const postMessage = async (token: string) => {
        const slackResponse = await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            channel: slackChannelId,
            thread_ts: threadTs,
            text: mrkdwnBody,
          }),
        });

        return (await slackResponse.json()) as {
          ok: boolean;
          error?: string;
          ts?: string;
          message?: { ts: string };
        };
      };

      let slackData = await postMessage(authToken);

      // Self-heal: if user token is revoked, delete it and retry with bot token
      if (
        !slackData.ok &&
        userExternalToken &&
        /token_revoked|invalid_auth|not_authed|account_inactive/.test(slackData.error || '')
      ) {
        logger.warn(`${TAG} User token revoked, falling back to bot token`, {
          userId,
          slackError: slackData.error,
        });
        await this.prisma.userExternalToken.delete({
          where: { id: userExternalToken.id },
        });
        authToken = creds.botOauthToken;
        senderName = 'Xyne Bot';
        slackData = await postMessage(authToken);
      }

      if (!slackData.ok) {
        logger.error(`${TAG} Slack chat.postMessage failed`, {
          error: slackData.error,
          channel: slackChannelId,
          threadTs,
        });
        throw new Error(`Slack API error: ${slackData.error}`);
      }

      const ts = slackData.ts || slackData.message?.ts;
      if (!ts) {
        throw new Error('Slack API returned ok but no message timestamp');
      }
      messageTs = ts;
    } else {
      messageTs = `att-${randomUUID()}`;
    }

    // 3b. Upload reply attachments into the same Slack thread (best-effort). Collect
    //     the staged rows so we can rebind them to the reply email below.
    let stagedAttachmentRowIds: string[] = [];
    if (attachmentIds.length > 0) {
      try {
        const { attachments, stagedRowIds } = await new ExternalAttachmentService().prepareOutboundAttachments({ attachmentIds });
        stagedAttachmentRowIds = stagedRowIds;
        await this.uploadAttachmentsToSlack(creds.botOauthToken, slackChannelId, threadTs, attachments);
      } catch (err) {
        logger.error(`${TAG} Failed to upload attachments to Slack`, { err });
      }
    }

    // 4. Create Email + ExternalMessage dedup atomically.
    //    If the inbound webhook already processed this messageTs, the unique
    //    constraint on ExternalMessage fails and the transaction rolls back
    //    both records — no duplicate Email.
    let email: { id: string; createdAt: Date };
    try {
      email = await this.prisma.$transaction(async (tx) => {
        const created = await tx.email.create({
          data: {
            type: EmailType.REPLY,
            subject: initialEmail.subject,
            body: hasText ? body : '',
            to: [],
            from: senderName,
            cc: [],
            bcc: [],
            conversationId,
            channelId: conversation.channelId,
            workspaceId: conversation.workspaceId,
            externalThreadId: threadTs,
            externalMessageId: messageTs,
            sentByUserId: userId,
          } as Prisma.EmailUncheckedCreateInput,
        });

        await tx.externalMessage.create({
          data: {
            externalSourceId: externalSource.id,
            externalId: messageTs,
            externalThreadId: threadTs,
            messageId: created.id,
            entityId: created.id,
            workspaceId: conversation.workspaceId,
            direction: MessageDirection.OUTGOING,
            entityType: ExternalEntityType.EMAIL,
          },
        });

        return created;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Webhook already processed this message — look up the existing record
        const existing = await this.prisma.externalMessage.findUnique({
          where: {
            externalSourceId_externalId: {
              externalSourceId: externalSource.id,
              externalId: messageTs,
            },
          },
          select: { entityId: true },
        });
        if (existing?.entityId) {
          logger.info(`${TAG} Webhook already processed this message`, { messageTs });
          return { emailId: existing.entityId, slackTs: messageTs };
        }
      }
      throw err;
    }

    if (stagedAttachmentRowIds.length > 0) {
      await this.prisma.messageAttachment.updateMany({
        where: { id: { in: stagedAttachmentRowIds } },
        data: { entityType: AttachmentEntityType.EMAIL, entityId: email.id, conversationId },
      }).catch(err => logger.error(`${TAG} Failed to rebind attachments to reply email`, { err }));
    }

    await syncTicketEmailCount(this.prisma, conversationId);
    void dispatchEmailEventForEmailId(email.id);

    // 6. Record SLA first-response time
    try {
      await this.prisma.ticket.updateMany({
        where: { conversationId, firstRespondedAt: null },
        data: { firstRespondedAt: email.createdAt },
      });
    } catch (err) {
      logger.error(`${TAG} Failed to record first response time`, { conversationId, err });
    }

    // 7. Audit trail + desk metrics: manual agent reply
    try {
      const tickets = await this.prisma.ticket.findMany({
        where: { conversationId },
        select: { id: true, channelId: true },
      });
      await this.prisma.ticketActivity.createMany({
        data: tickets.map(ticket => ({
          ticketId: ticket.id,
          updatedBy: userId,
          workspaceId: conversation.workspaceId,
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

    logger.info(`${TAG} Reply sent to Slack`, {
      conversationId,
      slackChannelId,
      messageTs,
      emailId: email.id,
    });

    return { emailId: email.id, slackTs: messageTs };
  }

  private async uploadAttachmentsToSlack(
    botToken: string,
    slackChannelId: string,
    threadTs: string,
    attachments: Array<{ name: string; contentType: string; content: Buffer | string }>,
  ): Promise<void> {
    for (const att of attachments) {
      const buffer = typeof att.content === 'string' ? Buffer.from(att.content) : att.content;

      const getResp = await fetch('https://slack.com/api/files.getUploadURLExternal', {
        method: 'POST',
        headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ filename: att.name, length: String(buffer.length) }),
      });
      const getData = (await getResp.json()) as { ok: boolean; error?: string; upload_url?: string; file_id?: string };
      if (!getData.ok || !getData.upload_url || !getData.file_id) {
        throw new Error(`files.getUploadURLExternal failed: ${getData.error ?? 'unknown'}`);
      }

      const form = new FormData();
      form.append('file', new Blob([buffer], { type: att.contentType || 'application/octet-stream' }), att.name);
      const uploadResp = await fetch(getData.upload_url, { method: 'POST', body: form });
      if (!uploadResp.ok) {
        throw new Error(`Slack upload_url POST failed: ${uploadResp.status}`);
      }

      const completeResp = await fetch('https://slack.com/api/files.completeUploadExternal', {
        method: 'POST',
        headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: [{ id: getData.file_id, title: att.name }],
          channel_id: slackChannelId,
          thread_ts: threadTs,
        }),
      });
      const completeData = (await completeResp.json()) as { ok: boolean; error?: string };
      if (!completeData.ok) {
        throw new Error(`files.completeUploadExternal failed: ${completeData.error ?? 'unknown'}`);
      }
      logger.info(`${TAG} Uploaded attachment to Slack thread`, { name: att.name, threadTs });
    }
  }
}

export const slackDeskService = new SlackDeskService();
