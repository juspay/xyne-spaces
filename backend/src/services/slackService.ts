import { WebClient } from '@slack/web-api';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';

class SlackService {
  private client: WebClient | undefined;

  constructor() {
    const token = process.env.SLACK_BOT_TOKEN;

    if (token) {
      this.client = new WebClient(token);
      logger.info('SlackService initialized with Bot Token.');
    } else {
      logger.warn('SLACK_BOT_TOKEN is not set. Slack notifications will be disabled.');
    }
  }

  async sendMessage(channelId: string, message: string, threadId?: string): Promise<void> {
    if (!this.client) {
      logger.warn('Attempted to send a Slack message, but SlackService is not configured.');
      return;
    }

    try {
      await this.client.chat.postMessage({
        channel: channelId,
        text: message,
        thread_ts: threadId,
      });

      logger.info('Successfully sent message to Slack.');
    } catch (error) {
      logger.error('Failed to send message to Slack:', error);
    }
  }

  async sendDirectMessageByEmail(email: string, text: string): Promise<void> {
    if (!this.client) {
      logger.warn(
        `Slack client is not initialized. Cannot send message to user with email ${email}.`
      );
      return;
    }

    try {
      const user = await this.client.users.lookupByEmail({ email });
      if (user && user.ok && user.user) {
        const userId = user.user.id;
        await this.client.chat.postMessage({
          channel: userId!,
          text: text,
        });
        logger.info(`Sent Slack message to user ${email}`);
      } else {
        logger.warn(`Could not find Slack user with email ${email}.`);
      }
    } catch (error) {
      logger.error(`Failed to send Slack message to user with email ${email}:`, error);
    }
  }

  async sendMentionNotifications(
    emails: string[],
    senderName: string,
    channelName: string,
    channelId: string,
    conversationId: string,
    messageId: string,
    mentionType?: string
  ): Promise<void> {
    if (!this.client || emails.length === 0) return;

    const path = `chat/${channelId}/${conversationId}#origin=${conversationId}&messageId=${messageId}`;
    const url = `${config.slackFrontendUrl}/launch?path=${encodeURIComponent(path)}`;

    const message = mentionType
      ? `${mentionType} in ${channelName} by ${senderName} : <${url}|View in xyne-spaces>`
      : `You were mentioned by ${senderName} in ${channelName}: <${url}|View in xyne-spaces>`;

    await Promise.allSettled(
      emails.map((email) =>
        this.sendDirectMessageByEmail(email, message).catch((error) =>
          logger.error('Failed to send Slack mention notification:', error)
        )
      )
    );
  }

  async sendThreadReplyNotifications(
    emails: string[],
    senderName: string,
    channelName: string,
    channelId: string,
    conversationId: string,
    replyMessageId: string
  ): Promise<void> {
    if (!this.client || emails.length === 0) return;

    const path = `chat/${channelId}/${conversationId}#origin=${conversationId}&messageId=${replyMessageId}`;
    const url = `${config.slackFrontendUrl}/launch?path=${encodeURIComponent(path)}`;

    await Promise.allSettled(
      emails.map((email) =>
        this.sendDirectMessageByEmail(
          email,
          `New reply from ${senderName} in ${channelName}: <${url}|View in xyne-spaces>`
        ).catch((error) => logger.error('Failed to send Slack thread reply notification:', error))
      )
    );
  }

  async sendCanvasMentionNotifications(
    emails: string[],
    senderName: string,
    canvasTitle: string,
    url: string
  ): Promise<void> {
    if (!this.client || emails.length === 0) return;

    const message = `You were mentioned by ${senderName} in canvas "${canvasTitle}": <${url}|View in xyne-spaces>`;

    await Promise.allSettled(
      emails.map((email) =>
        this.sendDirectMessageByEmail(email, message).catch((error) =>
          logger.error('Failed to send Slack canvas mention notification:', error)
        )
      )
    );
  }

  async sendDirectMessageNotifications(
    emails: string[],
    senderName: string,
    cleanContent: string,
    channelId: string
  ): Promise<void> {
    if (!this.client || emails.length === 0) return;

    const path = `chat/${channelId}`;
    const url = `${config.slackFrontendUrl}/launch?path=${encodeURIComponent(path)}`;
    const truncatedContent =
      cleanContent.substring(0, 100) + (cleanContent.length > 100 ? '...' : '');

    await Promise.allSettled(
      emails.map((email) =>
        this.sendDirectMessageByEmail(
          email,
          `*New message from ${senderName}*\n> ${truncatedContent}\nView in <${url}|xyne-spaces>`
        ).catch((error) => logger.error('Failed to send Slack DM notification:', error))
      )
    );
  }
}

export const slackService = new SlackService();
