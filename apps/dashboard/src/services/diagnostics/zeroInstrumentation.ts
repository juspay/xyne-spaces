import { diagnosticsStore } from './store';

/**
 * Adapter between the app's existing Zero instrumentation and the on-device
 * diagnostics store.
 *
 * Reads the *log* stream rather than the metrics recorder, even though both
 * carry the same numbers. `useQuery`/`useZero` gate every `recordLatency` call
 * behind `wasInterrupted()`, which reports skew whenever its `connectionConnected`
 * flag is false — and that flag is only set by `useZeroConnectionInfo` on a
 * connection *transition*. The dashboard mounts that hook inside `ChatInput`,
 * which normally mounts when Zero is already connected, so no transition ever
 * happens and the metrics path stays silent. The log path has no such gate.
 */

const UNKNOWN = 'unknown';

const ZERO_QUERY_CALLED = 'zero_query_called';
const ZERO_QUERY_COMPLETE = 'zero_query_complete';
const ZERO_QUERY_FAILED = 'zero_query_failed';
const ZERO_RUN_COMPLETE = 'zero_run_complete';
const ZERO_RUN_ERROR = 'zero_run_error';
const ZERO_MUTATION_COMPLETE = 'zero_mutation_complete';
const ZERO_MUTATION_ERROR = 'zero_mutation_error';

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function asDuration(payload: Record<string, unknown> | undefined): number | null {
  // Queries report `latency`; mutations and one-shot runs report `duration`.
  const value = payload?.['latency'] ?? payload?.['duration'];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Mirrors Zero's query/mutation log events into the diagnostics store. */
export function recordZeroLogForDiagnostics(
  event: string,
  payload?: Record<string, unknown>,
): void {
  try {
    switch (event) {
      case ZERO_QUERY_CALLED: {
        // Start of a wait. Without this the store only ever learns about
        // queries that finished, and a request that never returns — the thing
        // a user is staring at a spinner over — leaves no trace at all.
        diagnosticsStore.noteZeroQueryStarted(asString(payload?.['query'], UNKNOWN));
        break;
      }
      case ZERO_QUERY_COMPLETE:
      case ZERO_RUN_COMPLETE: {
        const duration = asDuration(payload);
        if (duration !== null) {
          diagnosticsStore.recordZeroQuery(asString(payload?.['query'], UNKNOWN), duration);
        }
        break;
      }
      case ZERO_MUTATION_COMPLETE: {
        const duration = asDuration(payload);
        if (duration !== null) {
          diagnosticsStore.recordZeroMutation(asString(payload?.['mutation'], UNKNOWN), duration);
        }
        break;
      }
      case ZERO_QUERY_FAILED:
      case ZERO_RUN_ERROR:
        diagnosticsStore.recordZeroQueryError(asString(payload?.['query'], UNKNOWN));
        break;
      case ZERO_MUTATION_ERROR:
        diagnosticsStore.recordZeroMutationError(asString(payload?.['mutation'], UNKNOWN));
        break;
      default:
        break;
    }
  } catch {
    // Diagnostics must never break logging.
  }
}
