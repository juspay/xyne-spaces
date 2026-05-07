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

export function safeRecordMetric(fn: () => void): void {
  if (!ENABLE_OTEL_METRICS) {
    return;
  }

  try {
    fn();
  } catch (error) {
    console.error('[OTel] Error recording metric:', error);
  }
}
