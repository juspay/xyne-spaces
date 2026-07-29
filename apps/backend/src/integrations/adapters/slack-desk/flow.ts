import { ExternalSource } from '@prisma/client';
import { BaseFlow } from '../../core/baseFlow';
import { TestPayloadResult } from '../../core/types';
import { decrypt } from '../../../services/encryptionService';
import { resolveSlackMentions, fetchSlackUserInfo } from '../slack-webhook-tickets/utils/slackUserResolver';
import { ChannelRepository } from '../../../database/repositories/channelRepository';
import { UserRepository } from '../../../database/repositories/users';
import { logger } from '../../../utils/logger';
import { buildSlackDeskSourceName } from '../../core/deskSources';

export class SlackDeskFlow extends BaseFlow {
  getSourceNameFromDB(payload: any): string | undefined {
    const channelId = payload?.event?.channel;
    return channelId ? buildSlackDeskSourceName(channelId) : undefined;
  }

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

      const channelRepo = new ChannelRepository();
      const workspaceId = source.channelId
        ? (await channelRepo.findById(source.channelId))?.workspaceId
        : undefined;

      const targetMessage =
        payload.event?.subtype === 'message_changed' && payload.event?.message
          ? payload.event.message
          : payload.event;

      if (!targetMessage) {
        return payload;
      }

      // Resolve @mentions in text
      if (targetMessage.text) {
        targetMessage.text = await resolveSlackMentions(
          targetMessage.text,
          creds.botOauthToken,
          false,
          workspaceId
        );
      }

      // Resolve @mentions in attachments
      if (targetMessage.attachments) {
        const attachmentsJson = JSON.stringify(targetMessage.attachments);
        const resolvedJson = await resolveSlackMentions(
          attachmentsJson,
          creds.botOauthToken,
          true,
          workspaceId
        );
        targetMessage.attachments = JSON.parse(resolvedJson);
      }

      // Resolve message author: check our users table first, then Slack API, else raw ID
      const authorSlackId = targetMessage.user || targetMessage.bot_id;
      if (authorSlackId) {
        try {
          const userRepo = new UserRepository();
          const dbUser = await userRepo.findByMetadataField('slackId', authorSlackId);
          if (dbUser) {
            payload._resolvedAuthor = {
              name: dbUser.name,
              email: dbUser.email,
            };
          } else if (creds.botOauthToken) {
            const slackUser = await fetchSlackUserInfo(authorSlackId, creds.botOauthToken);
            if (slackUser) {
              payload._resolvedAuthor = {
                name: slackUser.profile?.real_name || slackUser.profile?.display_name || authorSlackId,
                email: slackUser.profile?.email,
              };
            }
          }
        } catch (err) {
          logger.warn('[SlackDeskFlow] Failed to resolve author', { authorSlackId, error: err });
        }
      }

      return payload;
    } catch {
      return payload;
    }
  }

  /**
   * Handle Slack url_verification challenge for webhook setup.
   */
  isTestPayload(payload: any): TestPayloadResult {
    if (payload?.type === 'url_verification' && payload?.challenge) {
      return {
        isTest: true,
        response: {
          status: 200,
          body: { challenge: payload.challenge },
        },
      };
    }
    return { isTest: false };
  }
}
