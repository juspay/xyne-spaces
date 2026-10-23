import { appMetrics } from '../../metrics/appMetrics';
import { flushRemoteLogs, logger as structuredLogger } from '../appLogger';
import type { CompletedChatOpenSkeleton } from './chatOpenSkeleton';

export function emitChatOpenSkeletonCompleted(completed: CompletedChatOpenSkeleton | null): void {
  if (completed === null) {
    return;
  }

  if (completed.outcome === 'revealed') {
    appMetrics.recordHistogram('chatOpenSkeletonDuration', completed.durationMs, {
      surface: completed.surface,
      entry: completed.entry,
    });
  }

  structuredLogger.info('chat_open_skeleton_completed', completed);
  void flushRemoteLogs();
}
