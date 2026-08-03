/**
 * Google Gmail Flow
 * Fetches full email data from Gmail API using Pub/Sub historyId.
 */

import { ExternalSource } from '@prisma/client';
import { BaseFlow } from '../../core/baseFlow';
import { logger } from '../../../utils/logger';
import { GoogleService } from '@/services/googleService';
import { ExternalMessageRepository } from '@/database/repositories/externalMessageRepository';
import { preDownloadGmailAttachments } from './attachments';
import { GooglePubSubMessage, GooglePubSubData } from './types';
import { config } from '@/config/env';

const TAG = '[GoogleFlow]';
const externalMessageRepo = new ExternalMessageRepository();

export class GoogleFlow extends BaseFlow {
  async preprocess(rawPayload: any, source?: ExternalSource): Promise<any> {
    const channelId = source?.channelId;
    const isBetaChannel = !!channelId && config.desk.betaChannels.includes(channelId);
    if (!isBetaChannel) {
      try {
        const pubsubData = this.decodePubSub(rawPayload);
        if (!pubsubData) return { authenticated: false };

        if (!source?.credentials) {
          logger.error(`${TAG} No source credentials available`);
          return { authenticated: false };
        }

        const googleService = GoogleService.fromEncryptedCredentials(source.credentials, source.id);

        const messageId = await this.resolveMessageId(googleService, pubsubData.historyId);
        if (!messageId) return { authenticated: false };

        const existing = await externalMessageRepo.findByExternalIds(source.id, [messageId]);
        if (existing.length > 0) {
          // Only skip if this message was already ingested as INCOMING.
          // An OUTGOING record means WE sent this reply — other desks sharing
          // the same source may still need to receive it via resolveDlChannels.
          if (existing.some(e => e.direction === 'INCOMING')) {
            logger.info(`${TAG} skipping already-ingested message ${messageId}`);
            return { __skipIngestion: true, __skipReason: `duplicate-webhook:${messageId}` };
          }
        }

        const messageData = await googleService.getMessageById(messageId);
        if (!messageData) {
          // Message vanished between Gmail's Pub/Sub publish and our fetch (404).
          // Skip-ack so Pub/Sub drops it instead of retrying for 7 days.
          logger.warn(`${TAG} skipping vanished message ${messageId}`);
          return { __skipIngestion: true, __skipReason: `message-not-found:${messageId}` };
        }
        if ((messageData.labelIds ?? []).includes('DRAFT')) {
          logger.info(`${TAG} skipping Gmail draft message ${messageId}`, {
            labelIds: messageData.labelIds,
          });
          return { __skipIngestion: true, __skipReason: `gmail-draft:${messageId}` };
        }

        const parsedEmail = googleService.parseEmailData(messageData);

        const preDownloadedAttachments = await preDownloadGmailAttachments({
          googleService,
          messageId,
          messageData,
          sourceName: source.name,
        });

        const parsedEmailNoAttachments = { ...parsedEmail, attachments: [] };

        return {
          pubsubData,
          parsedEmail: parsedEmailNoAttachments,
          ...(preDownloadedAttachments.length > 0 && { preDownloadedAttachments }),
        };
      } catch (error: any) {
        logger.error(`${TAG} Error fetching Gmail data`, { error: error?.message });
        return { authenticated: false };
      }
    }

    try {
      const pubsubData = this.decodePubSub(rawPayload);
      if (!pubsubData) return { authenticated: false };

      if (!source?.credentials) {
        logger.error(`${TAG} No source credentials available`);
        return { authenticated: false };
      }

      const googleService = GoogleService.fromEncryptedCredentials(source.credentials, source.id);

      // Resume from the persisted cursor, not the push's own historyId — self-heals anything an earlier push missed.
      const { messageIds, cursor } = await this.resolveMessages(
        googleService,
        source.lastSyncCursor ?? pubsubData.historyId,
      );
      if (messageIds.length === 0) return { authenticated: false };

      const targetHistoryId = cursor ?? pubsubData.historyId;
      logger.info(`${TAG} [BATCH_RESOLVED] channelId=${source.channelId}`, {
        sourceName: source.name,
        historyId: targetHistoryId,
        messageIds,
        resolvedAt: new Date().toISOString(),
      });

      const existing = await externalMessageRepo.findByExternalIds(source.id, messageIds);

      const payloads: any[] = [];
      let lastRealIndex = -1;
      for (const messageId of messageIds) {
        if (existing.some(e => e.externalId === messageId && e.direction === 'INCOMING')) {
          logger.info(`${TAG} skipping already-ingested message ${messageId}`);
          payloads.push({ __skipIngestion: true, __skipReason: `duplicate-webhook:${messageId}` });
          continue;
        }

        const messageData = await googleService.getMessageById(messageId);
        if (!messageData) {
          // Vanished between publish and fetch — skip-ack so Pub/Sub doesn't retry for 7 days.
          logger.warn(`${TAG} skipping vanished message ${messageId}`);
          payloads.push({ __skipIngestion: true, __skipReason: `message-not-found:${messageId}` });
          continue;
        }
        if ((messageData.labelIds ?? []).includes('DRAFT')) {
          logger.info(`${TAG} skipping Gmail draft message ${messageId}`, {
            labelIds: messageData.labelIds,
          });
          payloads.push({ __skipIngestion: true, __skipReason: `gmail-draft:${messageId}` });
          continue;
        }

        const parsedEmail = googleService.parseEmailData(messageData);

        const preDownloadedAttachments = await preDownloadGmailAttachments({
          googleService,
          messageId,
          messageData,
          sourceName: source.name,
        });

        const parsedEmailNoAttachments = { ...parsedEmail, attachments: [] };

        payloads.push({
          pubsubData: { ...pubsubData, historyId: undefined },
          parsedEmail: parsedEmailNoAttachments,
          ...(preDownloadedAttachments.length > 0 && { preDownloadedAttachments }),
        });
        lastRealIndex = payloads.length - 1;
      }

      // Cursor only advances once every message in the batch has synced.
      if (lastRealIndex >= 0) payloads[lastRealIndex].pubsubData.historyId = targetHistoryId;

      return payloads;
    } catch (error: any) {
      logger.error(`${TAG} Error fetching Gmail data`, { error: error?.message });
      return { authenticated: false };
    }
  }

  getSourceNameFromDB(payload: any): string | undefined {
    try {
      const pubsubData = this.decodePubSub(payload);
      if (!pubsubData?.emailAddress) return undefined;

      // Must use the same normalizer as GoogleService.getSourceName so the
      // resolved name always matches the ExternalSource.name stored at setup.
      // Otherwise emails with '+' or other chars route to a nonexistent row.
      return GoogleService.getSourceName(pubsubData.emailAddress);
    } catch (error) {
      logger.error(`${TAG} Error determining source name`, error);
      return undefined;
    }
  }

  /** Decode base64 Pub/Sub message data into GooglePubSubData */
  private decodePubSub(payload: any): GooglePubSubData | null {
    const message = (payload as GooglePubSubMessage)?.message;
    if (!message?.data) return null;

    try {
      const decoded = Buffer.from(message.data, 'base64').toString('utf-8');
      return JSON.parse(decoded) as GooglePubSubData;
    } catch {
      logger.error(`${TAG} Failed to decode Pub/Sub data`);
      return null;
    }
  }

  /** Try history first, fall back to most recent message */
  private async resolveMessages(
    googleService: GoogleService,
    startHistoryId: string,
  ): Promise<{ messageIds: string[]; cursor: string | null }> {
    try {
      const { messageIds, historyId } = await googleService.listMessagesFromHistoryWithCursor(startHistoryId);
      return { messageIds, cursor: historyId };
    } catch {
      logger.warn(`${TAG} History fetch failed, trying recent messages`);
    }

    try {
      const recent = await googleService.listRecentMessages(1);
      return { messageIds: recent, cursor: null };
    } catch {
      logger.error(`${TAG} Failed to fetch recent messages`);
      return { messageIds: [], cursor: null };
    }
  }

  /** Try history first, fall back to most recent message */
  private async resolveMessageId(
    googleService: GoogleService,
    historyId: string
  ): Promise<string | null> {
    try {
      const fromHistory = await googleService.listMessagesFromHistory(historyId);
      if (fromHistory.length > 0) return fromHistory[0];
    } catch {
      logger.warn(`${TAG} History fetch failed, trying recent messages`);
    }

    try {
      const recent = await googleService.listRecentMessages(1);
      return recent[0] ?? null;
    } catch {
      logger.error(`${TAG} Failed to fetch recent messages`);
      return null;
    }
  }
}
