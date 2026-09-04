import type { Call } from '@prisma/client';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';

/**
 * Lifecycle of a detailed summary, published on Call.metadata.detailedSummaryStatus.
 * Both pipelines (note-taker recordings, channel calls) write it, so each detail
 * screen renders one state machine off a replicated value instead of inferring
 * state from whether a canvas pointer exists yet.
 */
export type DetailedSummaryStatus = 'pending' | 'ready' | 'failed';

/**
 * Call.metadata as a mergeable object. Prisma has no partial JSON update, so every
 * writer read-merge-writes the whole column; this normalises the non-object cases
 * (null, JSON array) to an empty base.
 */
export function toMetadataRecord(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
}

/**
 * Merge just the status onto Call.metadata. Leaves detailedSummaryCanvasId and
 * detailedSummaryReady alone — the success paths own those, and rows predating
 * this field still read from them.
 *
 * Best-effort: a status write must never fail the generation it describes, so
 * errors are swallowed. Re-reads first because the LLM round trip is long enough
 * for another writer to have touched the same column.
 */
export async function markDetailedSummaryStatus(
  call: Pick<Call, 'id' | 'externalId'>,
  status: DetailedSummaryStatus,
): Promise<void> {
  try {
    const current = await repositories.calls.findByExternalId(call.externalId);
    await repositories.calls.update(call.id, {
      metadata: { ...toMetadataRecord(current?.metadata), detailedSummaryStatus: status },
    });
  } catch (error) {
    logger.error(`[${call.externalId}] detailed_summary_status_update_failed`, {
      error: error instanceof Error ? error.message : String(error),
      status,
    });
  }
}
