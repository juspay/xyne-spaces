import { logger } from '@/utils/logger';

/**
 * One log line for "this recording's detailed summary did not get produced",
 * keyed by the call's externalId so the failing recording is identifiable.
 * Every give-up point in both summary pipelines (headless note-taker calls and
 * channel calls) calls this, and only give-up points do, so the line counts one
 * failure per recording — alerting can key on detailed_summary_generation_failed.
 */
export function logDetailedSummaryFailed(
  callId: string,
  reason: string,
  error?: unknown,
): void {
  logger.error(`[${callId}] detailed_summary_generation_failed`, {
    reason,
    error,
    stack: error instanceof Error ? error.stack : undefined,
  });
}
