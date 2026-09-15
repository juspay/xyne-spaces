import { useSyncExternalStore } from 'react';
import { diagnosticsStore } from '../../services/diagnostics';
import type { DiagnosticsSnapshot } from '../../services/diagnostics';

/**
 * The store hands back a cached snapshot object that only changes when it
 * notifies, which is what `useSyncExternalStore` requires to avoid an infinite
 * render loop.
 */
export function useDiagnostics(): DiagnosticsSnapshot {
  return useSyncExternalStore(diagnosticsStore.subscribe, diagnosticsStore.getSnapshot);
}
