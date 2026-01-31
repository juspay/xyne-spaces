/**
 * Slack Flow - Dynamic source routing based on channel ID
 */

import { ExternalSource } from '@prisma/client';
import { BaseFlow } from '../../core/baseFlow';
import { TestPayloadResult } from '../../core/types';
import { decrypt } from '../../../services/encryptionService';
import { resolveSlackMentions } from './utils/slackUserResolver';

export class SlackFlow extends BaseFlow {
  /**
   * Dynamically determine source name for database lookup based on Slack channel ID
   * Converts Slack channel ID to source name: C09RF2JQTE1 → slack-C09RF2JQTE1
   */
  getSourceNameFromDB(payload: any): string | undefined {
    const channelId = payload?.event?.channel;
    return channelId ? `slack-${channelId}` : undefined;
  }

  /**
   * Preprocess Slack payload to resolve user mentions
   */
  async preprocess(payload: any, source?: ExternalSource): Promise<any> {
    try {
      if (!source) {
        return payload;
      }

      const decryptedCreds = decrypt(source.credentials);
      const creds = JSON.parse(decryptedCreds);

      if (!creds.botOauthToken) {
        return payload;
      }

      // Determine the target object: for message_changed events, use nested message object
      const targetMessage =
        payload.event?.subtype === 'message_changed' && payload.event?.message
          ? payload.event.message
          : payload.event;

      if (!targetMessage) {
        return payload;
      }

      // Resolve mentions in text
      if (targetMessage.text) {
        targetMessage.text = await resolveSlackMentions(targetMessage.text, creds.botOauthToken);
      }

      // Resolve mentions in attachments
      if (targetMessage.attachments) {
        const attachmentsJson = JSON.stringify(targetMessage.attachments);
        const resolvedJson = await resolveSlackMentions(attachmentsJson, creds.botOauthToken, true);
        targetMessage.attachments = JSON.parse(resolvedJson);
      }

      return payload;
    } catch (error) {
      return payload;
    }
  }

  /**
   * Check if the payload is a test payload from Slack
   * Handles url_verification (challenge token) for Slack URL verification
   */
  isTestPayload(payload: any): TestPayloadResult {
    if (payload?.type === 'url_verification' && payload?.challenge) {
      return {
        isTest: true,
        response: {
          status: 200,
          body: {
            challenge: payload.challenge,
          },
        },
      };
    }

    return { isTest: false };
  }
}
