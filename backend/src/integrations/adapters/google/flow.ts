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

const TAG = '[GoogleFlow]';
const externalMessageRepo = new ExternalMessageRepository();

export class GoogleFlow extends BaseFlow {
  async preprocess(rawPayload: any, source?: ExternalSource): Promise<any> {
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
        logger.info(`${TAG} skipping already-ingested message ${messageId}`);
        return { __skipIngestion: true, __skipReason: `duplicate-webhook:${messageId}` };
      }

      const messageData = await googleService.getMessageById(messageId);
      if (!messageData) {
        // Message vanished between Gmail's Pub/Sub publish and our fetch (404).
        // Skip-ack so Pub/Sub drops it instead of retrying for 7 days.
        logger.warn(`${TAG} skipping vanished message ${messageId}`);
        return { __skipIngestion: true, __skipReason: `message-not-found:${messageId}` };
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
