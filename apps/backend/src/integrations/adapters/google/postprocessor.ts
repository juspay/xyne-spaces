/**
 * Google postprocess: after a successful webhook ingest, advance
 * ExternalSource.lastSyncCursor to the Gmail historyId the transformer
 * stashed on normalizedData.metadata.syncCursor.
 */

import { BasePostprocessor } from '../../core/basePostprocessor';
import { PostprocessContext } from '../../core/types';
import { advanceSyncCursor } from '@/services/syncCursorRecovery';

export class GooglePostprocessor extends BasePostprocessor {
  async process(context: PostprocessContext): Promise<void> {
    const candidate = context.normalizedData.metadata?.syncCursor;
    if (typeof candidate !== 'string' || candidate.length === 0) return;

    await advanceSyncCursor(context.sourceId, candidate);
  }
}
