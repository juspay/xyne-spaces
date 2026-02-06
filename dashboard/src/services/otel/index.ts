export { httpRequestDuration, httpRequestTotal, httpRequestErrors } from './apiMetrics';

export {
  zeroSocketConnectionAttemptDuration,
  zeroSocketConnectionTotalDuration,
  zeroSocketConnectionRetriesPerRequest,
  zeroSocketSessionDuration,
  zeroSocketEventsTotal,
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

export { trackAskAIOpened } from './xyneAIMetrics';

export function safeRecordMetric(fn: () => void): void {
  try {
    fn();
  } catch (error) {
    console.error('[OTel] Error recording metric:', error);
  }
}
