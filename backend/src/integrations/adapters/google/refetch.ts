/**
 * Google Gmail fetch.
 * Fetch message ids (history since cursor, or latest 10 fallback),
 * ingest each through the existing sync pipeline, persist the new cursor.
 */

import { ExternalSource } from '@prisma/client';
import { GoogleService } from '@/services/googleService';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { externalSourceCore } from '../../core/core';
import { adapterRegistry } from '../../core/adapterRegistry';
import { BaseRefetch, RefetchOptions, RefetchResult } from '../../core/baseRefetch';
import { ExternalSourcePlatform } from '../../core/types';
import { GoogleTransformer } from './transformer';
import { preDownloadGmailAttachments } from './attachments';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';

const TAG = '[GoogleRefetch]';
const FALLBACK_LIMIT = 10;
const transformer = new GoogleTransformer();

export class GoogleRefetch extends BaseRefetch {
  async refetch(source: ExternalSource, options?: RefetchOptions): Promise<RefetchResult> {
    const google = GoogleService.fromEncryptedCredentials(source.credentials, source.id);

    const isRangeMode = !!(options?.startDate && options?.endDate);

    // Step 1: decide message ids + next cursor
    let messageIds: string[] = [];
    let nextCursor: string | null = source.lastSyncCursor ?? null;

    if (isRangeMode) {
      messageIds = await google.listMessagesByDateRange({
        startDate: options!.startDate!,
        endDate: options!.endDate!,
      });
    } else {
      if (source.lastSyncCursor) {
        try {
          const result = await google.listMessagesFromHistoryWithCursor(source.lastSyncCursor);
          messageIds = result.messageIds;
          nextCursor = result.historyId ?? source.lastSyncCursor;
        } catch (error) {
          logger.warn(`${TAG} history fetch failed, falling back to recent`, { error });
        }
      }
      if (messageIds.length === 0 && !source.lastSyncCursor) {
        messageIds = await google.listRecentMessages(FALLBACK_LIMIT, { mode: 'threads' });
        nextCursor = (await google.getCurrentHistoryId()) ?? nextCursor;
      }
    }

    // Step 2: ingest each — fetch full message, transform, sync
    let processed = 0;
    let newTickets = 0;
    let skipped = 0;
    const errors: string[] = [];

    const ingestOne = async (id: string): Promise<void> => {
      try {
        const messageData = await google.getMessageById(id);
        if (!messageData) return;

        const parsedEmail = google.parseEmailData(messageData);
        const preDownloadedAttachments = await preDownloadGmailAttachments({
          googleService: google,
          messageId: id,
          messageData,
          sourceName: source.name,
        });

        const parsed = await transformer.transform({
          parsedEmail: { ...parsedEmail, attachments: [] },
          ...(preDownloadedAttachments.length > 0 && { preDownloadedAttachments }),
        });
        if (!parsed.success || !parsed.data) throw new Error(parsed.error);

        const result = await externalSourceCore.sync(
          adapterRegistry.getAdapter(ExternalSourcePlatform.GOOGLE),
          source.name,
          parsed.data,
        );
        if (result.action === 'duplicate') {
          skipped++;
        } else {
          processed++;
          if (result.isNew) newTickets++;
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(`${TAG} ingest failed for ${id}`, { error: msg });
        errors.push(msg);
      }
    };

    const { batchSize, batchDelayMs } = config.emailFetch;
    for (let i = 0; i < messageIds.length; i += batchSize) {
      const batch = messageIds.slice(i, i + batchSize);
      await Promise.all(batch.map(ingestOne));

      if (batchDelayMs > 0 && i + batchSize < messageIds.length) {
        await new Promise(resolve => setTimeout(resolve, batchDelayMs));
      }
    }

    // Step 3: persist cursor
    if (!isRangeMode && nextCursor && nextCursor !== source.lastSyncCursor) {
      await new ExternalSourceRepository().update(source.id, { lastSyncCursor: nextCursor });
    }

    logger.info(`${TAG} ${source.name}: processed=${processed} newTickets=${newTickets} skipped=${skipped} errors=${errors.length}`);
    return { processed, newTickets, skipped, errors };
  }
}
