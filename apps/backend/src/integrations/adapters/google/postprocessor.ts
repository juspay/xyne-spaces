/**
 * Google postprocess: after a successful webhook ingest, advance
 * ExternalSource.lastSyncCursor to the Gmail historyId the transformer
 * stashed on normalizedData.metadata.syncCursor.
 */

import { BasePostprocessor } from '../../core/basePostprocessor';
import { PostprocessContext } from '../../core/types';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { logger } from '@/utils/logger';

export class GooglePostprocessor extends BasePostprocessor {
  private readonly externalSourceRepo = new ExternalSourceRepository();

  async process(context: PostprocessContext): Promise<void> {
    const candidate = context.normalizedData.metadata?.syncCursor;
    if (typeof candidate !== 'string' || candidate.length === 0) return;

    const source = await this.externalSourceRepo.findById(context.sourceId);
    if (!source || !isHistoryIdNewer(candidate, source.lastSyncCursor)) return;

    try {
      await this.externalSourceRepo.update(source.id, { lastSyncCursor: candidate });
    } catch (error) {
      logger.warn(`Failed to advance lastSyncCursor for ${source.name}`, { error });
    }
  }
}

/** Gmail historyIds are numeric strings — BigInt compare handles the large values. */
function isHistoryIdNewer(candidate: string, current: string | null): boolean {
  if (!current) return true;
  try {
    return BigInt(candidate) > BigInt(current);
  } catch {
    return candidate > current;
  }
}
