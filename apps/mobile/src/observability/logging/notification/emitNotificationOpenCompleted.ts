import { appMetrics } from '../../metrics/appMetrics';
import { flushRemoteLogs, logger as structuredLogger } from '../appLogger';
import type { CompletedNotificationOpen } from './notificationOpen';

export function emitNotificationOpenCompleted(completed: CompletedNotificationOpen | null): void {
  if (completed === null) {
    return;
  }

  /**
   * This histogram specifically measures successful tap-to-highlight latency.
   * Timeout, abandoned, and missing-message journeys remain available in logs
   * but must not affect the latency percentiles.
   */
  if (completed.outcome === 'highlighted' && completed.messageHighlighted) {
    appMetrics.recordHistogram('notificationMessageHighlightDuration', completed.durationMs, {
      app_state: completed.appState,
      surface: completed.surface,
      native_anchor: completed.nativeAnchor,
    });
  }

  structuredLogger.info('notification_open_completed', completed);
  void flushRemoteLogs();
}
