/**
 * Google Gmail refetch.
 * Fetch message ids (history since cursor, or latest 10 fallback),
 * ingest each through the existing sync pipeline, persist the new cursor.
 */

import { ExternalSource } from '@prisma/client';
import { GoogleService } from '@/services/googleService';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { externalSourceCore } from '../../core/core';
import { adapterRegistry } from '../../core/adapterRegistry';
import { BaseRefetch, RefetchResult } from '../../core/baseRefetch';
import { ExternalSourcePlatform } from '../../core/types';
import { GoogleTransformer } from './transformer';
import { logger } from '@/utils/logger';

const TAG = '[GoogleRefetch]';
const FALLBACK_LIMIT = 10;
const transformer = new GoogleTransformer();

export class GoogleRefetch extends BaseRefetch {
  async refetch(source: ExternalSource): Promise<RefetchResult> {
    const google = GoogleService.fromEncryptedCredentials(source.credentials, source.id);

    // Step 1: decide message ids + next cursor
    let messageIds: string[] = [];
    let nextCursor: string | null = source.lastSyncCursor ?? null;

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
      messageIds = await google.listRecentMessages(FALLBACK_LIMIT);
      nextCursor = (await google.getCurrentHistoryId()) ?? nextCursor;
    }

    // Step 2: ingest each — fetch full message, transform, sync
    let processed = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const id of messageIds) {
      try {
        const messageData = await google.getMessageById(id);
        if (!messageData) continue;

        const parsed = await transformer.transform({ parsedEmail: google.parseEmailData(messageData) });
        if (!parsed.success || !parsed.data) throw new Error(parsed.error);

        const result = await externalSourceCore.sync(
          adapterRegistry.getAdapter(ExternalSourcePlatform.GOOGLE),
          source.name,
          parsed.data,
        );
        if (result.action === 'duplicate') skipped++;
        else processed++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(`${TAG} ingest failed for ${id}`, { error: msg });
        errors.push(msg);
      }
    }

    // Step 3: persist cursor
    if (nextCursor && nextCursor !== source.lastSyncCursor) {
      await new ExternalSourceRepository().update(source.id, { lastSyncCursor: nextCursor });
    }

    logger.info(`${TAG} ${source.name}: processed=${processed} skipped=${skipped} errors=${errors.length}`);
    return { processed, skipped, errors };
  }
}
