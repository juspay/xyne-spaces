import { appMetrics } from '../../metrics/appMetrics';
import { flushRemoteLogs, logger as structuredLogger } from '../appLogger';
import type { CompletedActivityOpen } from './activityOpen';

export function emitActivityOpenCompleted(completed: CompletedActivityOpen | null): void {
  if (completed === null) return;

  // Percentiles only include successful tap-to-highlight journeys. Timeouts,
  // abandons, and activity rows without a messageId stay in logs but must
  // not skew the latency histogram.
  if (completed.outcome === 'highlighted' && completed.messageHighlighted) {
    appMetrics.recordHistogram('activityMessageHighlightDuration', completed.durationMs, {
      surface: completed.surface,
    });
  }

  structuredLogger.info('activity_open_completed', completed);
  void flushRemoteLogs();
}
