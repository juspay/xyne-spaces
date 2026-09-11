/**
 * Google Gmail Flow
 * Fetches full email data from Gmail API using Pub/Sub historyId.
 */

import { ExternalSource } from '@prisma/client';
import { BaseFlow } from '../../core/baseFlow';
import { logger } from '../../../utils/logger';
import { GoogleService, getHttpStatus } from '@/services/googleService';
import { ExternalMessageRepository } from '@/database/repositories/externalMessageRepository';
import { preDownloadGmailAttachments } from './attachments';
import { GooglePubSubMessage, GooglePubSubData } from './types';
import { config } from '@/config/env';
import { MessageDirection } from '@xyne/shared';
import { advanceSyncCursor, seedSyncCursor } from '@/services/syncCursorRecovery';
import { enqueueCursorCatchup } from '@/queues/emailFetchQueue';

const TAG = '[GoogleFlow]';
const externalMessageRepo = new ExternalMessageRepository();

export class GoogleFlow extends BaseFlow {
  async preprocess(rawPayload: any, source?: ExternalSource): Promise<any> {
    try {
      const pubsubData = this.decodePubSub(rawPayload);
      if (!pubsubData) {
        logger.error(`${TAG} Undecodable Pub/Sub payload`);
        return [{ __skipIngestion: true, __skipReason: 'undecodable-payload' }];
      }

      if (!source?.credentials) {
        logger.error(`${TAG} No credentials on source — skipping notification`, {
          sourceName: source?.name ?? 'unknown',
          sourceId: source?.id,
        });
        return [{ __skipIngestion: true, __skipReason: 'no-credentials' }];
      }

      const googleService = GoogleService.fromEncryptedCredentials(source.credentials, source.id);

      // Resume from the persisted cursor, not the push's own historyId — self-heals anything an earlier push missed.
      const startHistoryId = source.lastSyncCursor ?? pubsubData.historyId;
      let messageIds: string[];
      let cursor: string | null;
      try {
        const resolved = await googleService.listMessagesFromHistoryWithCursor(startHistoryId);
        messageIds = resolved.messageIds;
        cursor = resolved.historyId;
      } catch (error: any) {
        if (getHttpStatus(error) !== 404) throw error;
        logger.warn(`${TAG} [CURSOR_EXPIRED] sync cursor is past Gmail's history window`, {
          sourceName: source.name,
          sourceId: source.id,
          startHistoryId,
        });
        await seedSyncCursor({
          source,
          seedHistoryId: pubsubData.historyId,
          reason: 'cursor-expired',
        });
        return [{ __skipIngestion: true, __skipReason: 'cursor-expired' }];
      }

      if (messageIds.length === 0) {
        logger.info(`${TAG} no new messages in history range`, {
          sourceName: source.name,
          startHistoryId,
        });
        if (cursor) await advanceSyncCursor(source.id, cursor);
        return [{ __skipIngestion: true, __skipReason: 'no-new-messages' }];
      }

      const startedAt = Date.now();
      const existing = await externalMessageRepo.findByExternalIds(source.id, messageIds);
      const pending = messageIds.filter(
        id => !existing.some(e => e.externalId === id && e.direction === MessageDirection.INCOMING),
      );
      const batch = pending.slice(0, config.emailFetch.gmailWebhookMaxBatch);
      const deferred = pending.length - batch.length;

      logger.info(`${TAG} [BATCH_RESOLVED] channelId=${source.channelId}`, {
        sourceName: source.name,
        historyId: cursor,
        resolved: messageIds.length,
        pending: pending.length,
        processing: batch.length,
        deferred,
        messageIds: batch,
        resolvedAt: new Date().toISOString(),
      });

      const payloads: any[] = [];
      const failed: string[] = [];
      let lastRealIndex = -1;
      for (const messageId of batch) {
        try {
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
        } catch (error: any) {
          logger.error(`${TAG} [MESSAGE_FAILED] ${messageId}`, {
            sourceName: source.name,
            sourceId: source.id,
            error: error?.message,
          });
          failed.push(messageId);
        }
      }

      logger.info(`${TAG} [BATCH_DONE]`, {
        sourceName: source.name,
        processed: batch.length,
        deferred,
        failed: failed.length,
        durationMs: Date.now() - startedAt,
      });

      if (failed.length > 0 || deferred > 0) {
        logger.warn(`${TAG} [CURSOR_HELD] not advancing`, {
          sourceName: source.name,
          startHistoryId,
          deferred,
          failed,
        });
        if (deferred > 0) {
          await enqueueCursorCatchup({
            sourceId: source.id,
            watchHistoryId: pubsubData.historyId,
          });
        }
      } else if (!cursor) {
        logger.warn(`${TAG} [CURSOR_HELD] history returned no historyId — not advancing`, {
          sourceName: source.name,
          startHistoryId,
        });
      } else if (lastRealIndex >= 0) {
        payloads[lastRealIndex].pubsubData.historyId = cursor;
      } else {
        await advanceSyncCursor(source.id, cursor);
      }

      return payloads;
    } catch (error: any) {
      logger.error(`${TAG} Error fetching Gmail data`, { error: error?.message });
      throw error;
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

}
