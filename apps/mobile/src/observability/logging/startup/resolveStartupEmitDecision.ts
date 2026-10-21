import type { CompletedColdStart } from './coldStart';

/** Cold starts above this are treated as measurement errors and dropped from
 *  telemetry. One background-contaminated sample (common on iOS where
 *  systemUptime keeps ticking while the app is suspended) would otherwise
 *  emit `app_startup_completed` with an implausible durationMs. The raw
 *  value is preserved in `app_startup_dropped` for investigation. */
export const MAX_VALID_STARTUP_MS = 60_000;

export type StartupEmitDecision =
  | Readonly<{ kind: 'skip' }>
  | Readonly<{ kind: 'completed'; payload: CompletedColdStart }>
  | Readonly<{
      kind: 'dropped';
      payload: CompletedColdStart & {
        reason: 'exceeds_max_valid_duration';
        maxValidMs: number;
      };
    }>;

function isPlausibleStartupDuration(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= MAX_VALID_STARTUP_MS;
}

export function resolveStartupEmitDecision(
  completed: CompletedColdStart | null,
): StartupEmitDecision {
  if (completed === null) {
    return { kind: 'skip' };
  }

  if (!isPlausibleStartupDuration(completed.durationMs)) {
    return {
      kind: 'dropped',
      payload: {
        ...completed,
        reason: 'exceeds_max_valid_duration',
        maxValidMs: MAX_VALID_STARTUP_MS,
      },
    };
  }

  return { kind: 'completed', payload: completed };
}
