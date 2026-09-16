import { useSyncExternalStore } from 'react';
import { runController } from '../../services/diagnostics/run';
import type { RunState } from '../../services/diagnostics/run';

/**
 * The controller hands back a stable state object that only changes when it
 * notifies, which is what `useSyncExternalStore` needs to avoid re-rendering
 * forever.
 */
export function useRun(): RunState {
  return useSyncExternalStore(runController.subscribe, runController.getSnapshot);
}
