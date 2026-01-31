/**
 * Slack postprocessor - handles ticket and workflow creation for top-level messages
 */

import { BasePostprocessor } from '../../core/basePostprocessor';
import { PostprocessContext } from '../../core/types';
import { ConversationRepository } from '../../../database/repositories/conversationRepository';
import { ExternalSourceRepository } from '../../../database/repositories/externalSourceRepository';
import { logger } from '../../../utils/logger';
import { decrypt } from '../../../services/encryptionService';
import { botProcessor } from '../../../services/bots/botProcessor';

export class SlackPostprocessor extends BasePostprocessor {
  private conversationRepo = new ConversationRepository();
  private externalSourceRepo = new ExternalSourceRepository();

  /**
   * Process Slack message after conversation/message creation
   * Creates tickets for top-level messages only
   */
  async process(context: PostprocessContext): Promise<void> {
    const conversation = await this.conversationRepo.findById(context.conversationId);
    if (!conversation) {
      return;
    }

    try {
      const source = await this.externalSourceRepo.findById(context.sourceId);
      if (!source) {
        return;
      }

      const isNew = conversation.initialMessageId === context.entityId;

      // Only create tickets for new top-level messages
      if (!isNew || !context.normalizedData.metadata?.isTopLevelMessage) {
        return;
      }

      const ticketOwnerId = this.getTicketOwnerId(source);
      const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const contentPreview = context.normalizedData.content.substring(0, 40) || 'Untitled';
      const title = `Alert: ${contentPreview} [${timestamp}]`;
      const description = `Query from Alert:\n\n${context.normalizedData.content}`;

      // Queue ticket-bot job (uses bot flow like manual ticket creation)
      const queued = await botProcessor.queueBotExecution({
        executionId: conversation.initialMessageId,
        conversationId: context.conversationId,
        botName: 'ticket-bot',
        input: {
          title,
          description,
          scope: 'alert-query',
          owner: ticketOwnerId,
          workflowType: 'QUERY_WORKFLOW',
        },
        userId: ticketOwnerId,
      });

      if (!queued) {
        return;
      }

      await this.postSlackMessage(source, context, conversation.channelId);
    } catch (error) {
      if (!(error instanceof Error && error.message.includes('ticketOwnerId'))) {
        logger.error('Slack postprocess: failed to queue ticket-bot job', { error });
      }
    }
  }

  /**
   * Post a message back to Slack thread
   */
  private async postSlackMessage(
    source: any,
    context: PostprocessContext,
    xyneChannelId: string
  ): Promise<void> {
    try {
      const decryptedCreds = decrypt(source.credentials);
      const creds = JSON.parse(decryptedCreds);

      if (!creds.botOauthToken) {
        return;
      }

      const channel = context.normalizedData.metadata.channel;
      const threadTs = context.normalizedData.externalId; // Message timestamp (ts)

      if (!channel || !threadTs) {
        return;
      }

      const xyneLink = `https://spaces.xyne.juspay.net/chat/${xyneChannelId}/${context.conversationId}`;

      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creds.botOauthToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel,
          thread_ts: threadTs,
          text: `🔗 <${xyneLink}|View in Xyne>`,
        }),
      });

      const data = (await response.json()) as { ok: boolean; error?: string };

      if (!data.ok) {
        logger.error('Slack postprocess: failed to post message', {
          error: data.error,
          channel,
          threadTs,
        });
      }
    } catch (error) {
      logger.error('Slack postprocess: error posting message', { error });
    }
  }

  /**
   * Get ticket owner ID from Slack integration credentials
   */
  private getTicketOwnerId(source: any): string {
    const decryptedCreds = decrypt(source.credentials);
    const creds = JSON.parse(decryptedCreds);

    if (!creds.ticketOwnerId) {
      throw new Error('ticketOwnerId not found in Slack credentials');
    }

    return creds.ticketOwnerId;
  }
}
