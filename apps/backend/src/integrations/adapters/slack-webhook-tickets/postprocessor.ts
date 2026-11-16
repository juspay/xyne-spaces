/**
 * Slack postprocessor - links new top-level messages back to Xyne
 */

import { BasePostprocessor } from '../../core/basePostprocessor';
import { PostprocessContext } from '../../core/types';
import { ConversationRepository } from '../../../database/repositories/conversationRepository';
import { ExternalSourceRepository } from '../../../database/repositories/externalSourceRepository';
import { logger } from '../../../utils/logger';
import { decrypt } from '../../../services/encryptionService';
import { config } from '../../../config/env';

export class SlackPostprocessor extends BasePostprocessor {
  private conversationRepo = new ConversationRepository();
  private externalSourceRepo = new ExternalSourceRepository();

  /**
   * Process Slack message after conversation/message creation
   * Posts a View-in-Xyne link for top-level messages only
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

      // Only link new top-level messages
      if (!isNew || !context.normalizedData.metadata?.isTopLevelMessage) {
        return;
      }

      await this.postSlackMessage(source, context, conversation.channelId);
    } catch (error) {
      logger.error('Slack postprocess: failed to post link', { error });
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

      const xyneLink = `${config.frontendUrl}/chat/${xyneChannelId}/${context.conversationId}`;

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
}
