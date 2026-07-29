/**
 * Microsoft postprocess: after a successful webhook ingest, advance
 * ExternalSource.lastSyncCursor to the receivedDateTime the transformer
 * stashed on normalizedData.metadata.syncCursor.
 */

import { BasePostprocessor } from '../../core/basePostprocessor';
import { PostprocessContext } from '../../core/types';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { logger } from '@/utils/logger';

export class MicrosoftPostprocessor extends BasePostprocessor {
  private readonly externalSourceRepo = new ExternalSourceRepository();

  async process(context: PostprocessContext): Promise<void> {
    const candidate = context.normalizedData.metadata?.syncCursor;
    if (typeof candidate !== 'string' || candidate.length === 0) return;

    const source = await this.externalSourceRepo.findById(context.sourceId);
    if (!source || !isReceivedDateTimeNewer(candidate, source.lastSyncCursor)) return;

    try {
      await this.externalSourceRepo.update(source.id, { lastSyncCursor: candidate });
    } catch (error) {
      logger.warn(`Failed to advance lastSyncCursor for ${source.name}`, { error });
    }
  }
}

/** receivedDateTime is ISO 8601 — lex compare sorts correctly. */
function isReceivedDateTimeNewer(candidate: string, current: string | null): boolean {
  if (!current) return true;
  return candidate > current;
}
