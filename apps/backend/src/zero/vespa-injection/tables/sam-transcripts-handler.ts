/**
 * SAM Transcript Vespa Handler
 *
 * Handles Vespa document insertion for SAM transcripts received from Pragati.
 * This handler transforms SAM transcript data and queues it for Vespa indexing
 * via the Bull queue (instead of direct writes).
 */

import { logger } from '@/utils/logger';
import { vespaQueue } from '@/queues/vespaQueue';
import { samTranscriptSchema, SamTranscriptInput } from '@/vespa/src/types';
import { transformSamTranscriptToVespa } from '@/services/vespaSamTranscriptTransformer';

/**
 * Result of SAM transcript Vespa insertion
 */
export interface SamTranscriptInsertResult {
  success: boolean;
  docId: string;
  error?: string;
}

/**
 * Inserts a SAM transcript into Vespa for search indexing.
 * Transforms data and queues a job for async Vespa ingestion.
 *
 * @param docId - The generated document ID for Vespa
 * @param data - The SAM transcript input data from Pragati
 * @returns Promise resolving to insertion result (after queuing, not after Vespa write)
 */
export async function insertSamTranscriptToVespa(
  docId: string,
  data: SamTranscriptInput
): Promise<SamTranscriptInsertResult> {

  try {
    logger.info('[SamTranscriptsHandler] Starting Vespa job queue', {
      docId,
      meetCode: data.meetCode,
    });

    const vespaDocument = transformSamTranscriptToVespa(data, docId);

    logger.debug('[SamTranscriptsHandler] Transformed document', {
      docId,
      docType: vespaDocument.docType,
    });

    await vespaQueue.addJob({
      schema: samTranscriptSchema,
      jobType: 'feed',
      docId,
      data: vespaDocument,
    });

    logger.info('[SamTranscriptsHandler] Successfully queued SAM transcript for Vespa ingestion', {
      docId,
      meetCode: data.meetCode,
    });

    return {
      success: true,
      docId,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error('[SamTranscriptsHandler] Failed to queue SAM transcript for Vespa ingestion', {
      docId,
      meetCode: data.meetCode,
      error: errorMessage,
    });

    return {
      success: false,
      docId,
      error: errorMessage,
    };
  }
}
