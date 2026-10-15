import { appMetrics } from '../../metrics/appMetrics';
import { flushRemoteLogs, logger as structuredLogger } from '../appLogger';
import type { CompletedNotificationHeaderResolve } from './notificationHeaderResolve';

export function emitNotificationHeaderResolved(
  completed: CompletedNotificationHeaderResolve | null,
): void {
  if (completed === null) {
    return;
  }

  if (completed.outcome === 'resolved') {
    appMetrics.recordHistogram('notificationHeaderResolveDuration', completed.durationMs, {
      surface: completed.surface,
      native_anchor: completed.nativeAnchor,
    });
  }

  structuredLogger.info('notification_header_resolved', completed);
  void flushRemoteLogs();
}
