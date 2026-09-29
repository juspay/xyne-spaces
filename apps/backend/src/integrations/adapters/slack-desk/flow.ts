import { ExternalSource } from '@prisma/client';
import { WebClient } from '@slack/web-api';
import { SlackDeskTriggerMode, ExternalEntityType } from '@xyne/shared';
import { BaseFlow } from '../../core/baseFlow';
import { TestPayloadResult } from '../../core/types';
import { decrypt } from '../../../services/encryptionService';
import { resolveSlackMentions, fetchSlackUserInfo } from '../slack-webhook-tickets/utils/slackUserResolver';
import { ChannelRepository } from '../../../database/repositories/channelRepository';
import { UserRepository } from '../../../database/repositories/users';
import { ExternalMessageRepository } from '../../../database/repositories/externalMessageRepository';
import { db } from '@/database/client';
import { logger } from '../../../utils/logger';
import { buildSlackDeskSourceName } from '../../core/deskSources';
import { redisService } from '@/services/redisService';

const BACKFILL_MAX_PAGES = 5;

export class SlackDeskFlow extends BaseFlow {
  private externalMessageRepo = new ExternalMessageRepository();

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
      const creds = JSON.parse(decryptedCreds) as { botOauthToken?: string; whiteListedBots?: string[] };

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

      const triggerMode = source.channelId ? await this.getTriggerMode(source.channelId) : SlackDeskTriggerMode.ALL_MESSAGES;

      if (triggerMode === SlackDeskTriggerMode.MENTION_ONLY) {
        const botUserId = await this.getBotUserId(source.id, creds.botOauthToken);
        const isMention = !!botUserId && !!targetMessage.text?.includes(`<@${botUserId}>`);
        const threadTs: string | undefined = targetMessage.thread_ts;
        const isThreadReply = !!threadTs && threadTs !== targetMessage.ts;
        const threadAlreadyTicketed =
          isThreadReply && (await this.externalMessageRepo.findByThreadId(source.id, threadTs!, ExternalEntityType.EMAIL));

        if (!isMention && !threadAlreadyTicketed) {
          return { __skipIngestion: true, __skipReason: 'mention_required' };
        }
        if (isMention && isThreadReply && !threadAlreadyTicketed) {
          // Slack retries slow webhooks; only the first delivery may backfill this thread.
          if (!(await redisService.set(`slack-desk-backfill:${source.id}:${threadTs}`, '1', 300, true))) {
            return { __skipIngestion: true, __skipReason: 'backfill_in_progress' };
          }
          return await this.backfillThread(payload, creds.botOauthToken, threadTs!, workspaceId, creds.whiteListedBots ?? []);
        }
      }

      await this.enrichMessage(payload, targetMessage, creds.botOauthToken, workspaceId);
      return payload;
    } catch {
      return payload;
    }
  }

  // Not `authorizations[0].user_id`: that can be a user install of this app, not the bot.
  private async getBotUserId(sourceId: string, botOauthToken: string): Promise<string | undefined> {
    const key = `slack-desk-bot-user:${sourceId}`;
    try {
      const cached = await redisService.get(key);
      if (cached) return cached;
      const { user_id } = await new WebClient(botOauthToken, { retryConfig: { retries: 0 } }).auth.test();
      if (user_id) await redisService.set(key, user_id, 86400);
      return user_id;
    } catch (err) {
      logger.warn('[SlackDeskFlow] Failed to resolve bot user id', { sourceId, error: err });
      return undefined;
    }
  }

  private async getTriggerMode(channelId: string): Promise<SlackDeskTriggerMode> {
    const pref = await db.emailChannelPreference.findUnique({
      where: { channelId },
      select: { slackDeskTriggerMode: true },
    });
    return pref?.slackDeskTriggerMode === SlackDeskTriggerMode.MENTION_ONLY
      ? SlackDeskTriggerMode.MENTION_ONLY
      : SlackDeskTriggerMode.ALL_MESSAGES;
  }

  private async enrichMessage(
    payload: any,
    targetMessage: any,
    botOauthToken: string,
    workspaceId: string | undefined,
  ): Promise<void> {
    if (targetMessage.text) {
      targetMessage.text = await resolveSlackMentions(targetMessage.text, botOauthToken, false, workspaceId);
    }

    if (targetMessage.attachments) {
      const attachmentsJson = JSON.stringify(targetMessage.attachments);
      const resolvedJson = await resolveSlackMentions(attachmentsJson, botOauthToken, true, workspaceId);
      targetMessage.attachments = JSON.parse(resolvedJson);
    }

    const authorSlackId = targetMessage.user || targetMessage.bot_id;
    if (!authorSlackId) {
      return;
    }
    try {
      const userRepo = new UserRepository();
      const dbUser = await userRepo.findByMetadataField('slackId', authorSlackId);
      if (dbUser) {
        payload._resolvedAuthor = { name: dbUser.name, email: dbUser.email };
      } else {
        const slackUser = await fetchSlackUserInfo(authorSlackId, botOauthToken);
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

  /** Returns one payload per thread message; core.ts ingests them in order as one ticket. */
  private async backfillThread(
    triggerPayload: any,
    botOauthToken: string,
    threadTs: string,
    workspaceId: string | undefined,
    whiteListedBots: string[],
  ): Promise<any[]> {
    const channel = triggerPayload.event.channel;
    // Runs inside Slack's synchronous webhook, so fail fast instead of the default ~30 min retry.
    const client = new WebClient(botOauthToken, { retryConfig: { retries: 2 }, rejectRateLimitedCalls: true });
    const messages: any[] = [];
    let cursor: string | undefined;
    let pages = 0;

    try {
      do {
        const res = await client.conversations.replies({
          channel,
          ts: threadTs,
          cursor,
          limit: 200,
        });
        if (!res.ok) {
          throw new Error(res.error ?? 'conversations.replies not ok');
        }
        messages.push(...(res.messages ?? []));
        cursor = res.response_metadata?.next_cursor || undefined;
        pages += 1;
      } while (cursor && pages < BACKFILL_MAX_PAGES);
      if (cursor) {
        logger.warn('[SlackDeskFlow] Thread backfill hit page cap', { channel, threadTs, fetched: messages.length });
      }
    } catch (err) {
      logger.warn('[SlackDeskFlow] Thread fetch failed, ingesting mention only', { channel, threadTs, error: err });
    }

    // Never drop the triggering message, even if the fetch above failed/errored.
    const triggerTs = triggerPayload.event.ts;
    if (!messages.some(m => m.ts === triggerTs)) {
      messages.push(triggerPayload.event);
    }

    // Empty-content messages fail transform() downstream and would abort the whole batch;
    // bot messages follow SlackAuthenticator.validateBotSource, as they would live.
    const hasContent = (m: any): boolean =>
      !!m.ts && !!(m.text?.trim() || (m.files && m.files.length > 0)) && !!(m.user || m.bot_id) &&
      (!m.bot_id || whiteListedBots.includes(m.bot_id));

    // parseFloat loses precision on Slack's 16-digit ts; string comparison is exact.
    const ordered = messages.filter(hasContent).sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

    const payloads: any[] = [];
    for (const message of ordered) {
      const raw = { type: 'event_callback', event: { ...message, channel, type: 'message' } };
      await this.enrichMessage(raw, raw.event, botOauthToken, workspaceId);
      payloads.push(raw);
    }
    return payloads;
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
