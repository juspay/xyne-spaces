import { logger } from '@/utils/logger';
import {
  VespaSamTranscriptDocument,
  SamTranscriptInput,
  AIAnalysis,
  VespaDocType,
} from '@/vespa/src/types';

export type { SamTranscriptInput, AIAnalysis };

/**
 * Transformer function to convert SAM transcript data to Vespa document format.
 * This transformer handles the conversion of decrypted SAM transcript data
 * received from Pragati into the format expected by Vespa search engine.
 *
 * @param data - The SAM transcript input data (already decrypted)
 * @param docId - The generated document ID for Vespa
 * @returns VespaSamTranscriptDocument ready for indexing
 */
export function transformSamTranscriptToVespa(
  data: SamTranscriptInput,
  docId: string
): VespaSamTranscriptDocument {
  logger.info(`[VESPA_TRANSFORMER] Transforming SAM transcript: docId=${docId}, meetCode=${data.meetCode}`);

  const dateTimeTime = toTimestamp(data.dateTime);

  const vespaDoc: VespaSamTranscriptDocument = {
    docId: docId,
    docType: VespaDocType.SAM_TRANSCRIPT,
    meetCode: data.meetCode,
    participants: data.participants,
    platform: data.platform,
    type: data.type,
    duration: data.duration,
    meetingSummary: data.aiAnalysedData.summary, // SAM sends 'summary', Vespa expects 'meetingSummary' (reserved word workaround)
    chapters: data.aiAnalysedData.chapters?.length ? JSON.stringify(data.aiAnalysedData.chapters) : undefined,
    actionItems: data.aiAnalysedData.action_items?.length ? JSON.stringify(data.aiAnalysedData.action_items) : undefined,
    others: data.aiAnalysedData.others ? JSON.stringify(data.aiAnalysedData.others) : undefined,
    qna: data.aiAnalysedData.q_n_a?.length ? JSON.stringify(data.aiAnalysedData.q_n_a) : undefined,
    dateTime: dateTimeTime,
    merchants: data.merchants || [],
  };

  logger.debug(`[VESPA_TRANSFORMER] SAM transcript transformed:`, JSON.stringify(vespaDoc, null, 2));
  return vespaDoc;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Safely converts a date string, Date object, or null/undefined to a timestamp.
 * @param date - The date to convert (Date object, ISO string, undefined, or null)
 * @param defaultValue - Default value to return if date is invalid (default: 0)
 * @returns Unix timestamp in milliseconds
 */
function toTimestamp(date: Date | string | undefined | null, defaultValue: number = 0): number {
  if (!date) return defaultValue;
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) {
    return defaultValue;
  }
  return d.getTime();
}
