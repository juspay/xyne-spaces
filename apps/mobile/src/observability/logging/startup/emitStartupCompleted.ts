import { appMetrics } from '../../metrics/appMetrics';
import { flushRemoteLogs, logger as structuredLogger } from '../appLogger';
import type { CompletedColdStart } from './coldStart';
import { resolveStartupEmitDecision } from './resolveStartupEmitDecision';

export { MAX_VALID_STARTUP_MS, resolveStartupEmitDecision } from './resolveStartupEmitDecision';
export type { StartupEmitDecision } from './resolveStartupEmitDecision';

export function emitStartupCompleted(completed: CompletedColdStart | null): void {
  const decision = resolveStartupEmitDecision(completed);

  if (decision.kind === 'skip') {
    return;
  }

  if (decision.kind === 'dropped') {
    structuredLogger.warn('app_startup_dropped', decision.payload);
    void flushRemoteLogs();
    return;
  }

  appMetrics.recordHistogram('appStartupDuration', decision.payload.durationMs, {
    launch_cause: decision.payload.launchCause,
    destination: decision.payload.destination,
    native_anchor: decision.payload.nativeAnchor,
  });

  structuredLogger.info('app_startup_completed', decision.payload);
  void flushRemoteLogs();
}
