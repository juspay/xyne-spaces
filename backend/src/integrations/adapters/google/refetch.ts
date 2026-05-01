/**
 * Google Gmail fetch.
 * Fetch message ids (history since cursor, or latest 10 fallback),
 * ingest each through the existing sync pipeline, persist the new cursor.
 */

import { ExternalSource } from '@prisma/client';
import { GoogleService } from '@/services/googleService';
import { externalSourceCore } from '../../core/core';
import { adapterRegistry } from '../../core/adapterRegistry';
import { BaseRefetch, RefetchOptions, RefetchResult } from '../../core/baseRefetch';
import { ExternalSourcePlatform } from '../../core/types';
import { GoogleTransformer } from './transformer';
import { preDownloadGmailAttachments } from './attachments';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';

const TAG = '[GoogleRefetch]';
const transformer = new GoogleTransformer();

export class GoogleRefetch extends BaseRefetch {
  async refetch(source: ExternalSource, options?: RefetchOptions): Promise<RefetchResult> {
    if (!options?.startDate || !options?.endDate) {
      throw new Error(
        '[GoogleRefetch] startDate and endDate are required — manual refetch is range-only',
      );
    }
    const google = GoogleService.fromEncryptedCredentials(source.credentials, source.id);

    // Step 1: list message ids in the requested window
    const messageIds = await google.listMessagesByDateRange({
      startDate: options.startDate,
      endDate: options.endDate,
    });
    logger.info(`${TAG} range listing returned ${messageIds.length} messages`, {
      startDate: options.startDate,
      endDate: options.endDate,
    });

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


    logger.info(`${TAG} ${source.name}: processed=${processed} newTickets=${newTickets} skipped=${skipped} errors=${errors.length}`);
    return { processed, newTickets, skipped, errors };
  }
}
