import { EmailType, Prisma, MessageDirection, ExternalEntityType } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { ConversationRepository } from '@/database/repositories/conversationRepository';
import { EmailRepository } from '@/database/repositories/emailRepository';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { decrypt } from '@/services/encryptionService';
import { syncTicketEmailCount } from '@/database/syncTicketEmailCount';
import { dispatchEmailEventForEmailId } from '@/apps/core/emailUtils';
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
  }): Promise<{ emailId: string; slackTs: string }> {
    const { conversationId, body, userId } = params;

    // 1. Fetch conversation and thread info
    const conversation = await this.conversationRepo.findById(conversationId);
    if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);

    const externalSource = await this.externalSourceRepo.findByChannelId(conversation.channelId);
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
    const slackChannelId = externalSource.name.replace('slack-desk-', '');
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

    const messageTs = slackData.ts || slackData.message?.ts;
    if (!messageTs) {
      throw new Error('Slack API returned ok but no message timestamp');
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
            body,
            to: [],
            from: senderName,
            cc: [],
            bcc: [],
            conversationId,
            channelId: conversation.channelId,
            externalThreadId: threadTs,
            externalMessageId: messageTs,
          } as Prisma.EmailUncheckedCreateInput,
        });

        await tx.externalMessage.create({
          data: {
            externalSourceId: externalSource.id,
            externalId: messageTs,
            externalThreadId: threadTs,
            messageId: created.id,
            entityId: created.id,
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

    logger.info(`${TAG} Reply sent to Slack`, {
      conversationId,
      slackChannelId,
      messageTs,
      emailId: email.id,
    });

    return { emailId: email.id, slackTs: messageTs };
  }
}

export const slackDeskService = new SlackDeskService();
