import { logger, Event as LogEvent } from '../../utils/logger';
import { ENABLE_OTEL_METRICS } from '../../config';

export { httpRequestDuration, httpRequestTotal, httpRequestErrors } from './apiMetrics';

export {
  zeroSocketConnectionAttemptDuration,
  zeroSocketConnectionTotalDuration,
  zeroSocketConnectionRetriesPerRequest,
  zeroSocketSessionDuration,
  zeroSocketEventsTotal,
  zeroMutationLatency,
  zeroMutationOperations,
  zeroQueryLatency,
  zeroQueryOperations,
  zeroRunLatency,
  zeroRunOperations,
} from './zeroMetrics';

export {
  socketConnectionAttemptDuration,
  socketConnectionTotalDuration,
  socketConnectionRetriesPerRequest,
  socketSessionDuration,
  socketEventsTotal,
} from './socketMetrics';

export { authRefreshDuration, authRefreshTotal, clearAuthTokenTotal } from './authMetrics';

export { loadingAnimationDuration, dataLoadDuration } from './loadingMetrics';

export { askAIOpenedTotal } from './xyneAIMetrics';

export {
  trackAskAIOpened,
  trackWebSearchQuery,
  trackCitationsGenerated,
  trackCitationClicked,
  trackDeepResearchQuery,
  trackCanvasModeQuery,
  trackAttachmentsAdded,
} from './xyneAIMetrics';

export { trackNudgeActed, trackNudgeDismissed } from './nudgeMetrics';

export {
  componentRenderDuration,
  componentRenderTotal,
  registerMemoryGauge,
  registerLongTaskObserver,
  registerWebVitals,
  pokeRenderDuration,
  createBatchViewUpdatesWithMetrics,
} from './perfMetrics';

export function safeRecordMetric(fn: () => void): void {
  if (!ENABLE_OTEL_METRICS) {
    return;
  }

  try {
    fn();
  } catch (error) {
    logger.error(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_error',
      message: String('[OTel] Error recording metric:'),
      error: error,
    });
  }
}
