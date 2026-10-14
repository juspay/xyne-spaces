import { useDeferredLiveData } from '@/src/hooks/useDeferredLiveData';
import { useActivitySyncState } from './useActivitySyncState';

type UseActivityLiveQueryGateOptions = {
  name: string;
  screen: string;
  screenReady?: boolean;
  hasInitialData?: boolean;
  delayMs?: number;
  noInitialDataDelayMs?: number;
  timeoutMs?: number;
  enabled?: boolean;
};

export function useActivityLiveQueryGate(options: UseActivityLiveQueryGateOptions): boolean {
  const syncState = useActivitySyncState();
  const shouldPreferImmediate =
    syncState.isRecent && (syncState.urgency === 'immediate' || syncState.urgency === 'deferred');
  const delayMs = shouldPreferImmediate ? 0 : options.delayMs;
  const noInitialDataDelayMs = shouldPreferImmediate ? 0 : options.noInitialDataDelayMs;

  return useDeferredLiveData({
    name: options.name,
    screen: options.screen,
    preferImmediate: shouldPreferImmediate,
    ...(options.screenReady !== undefined ? { screenReady: options.screenReady } : {}),
    ...(options.hasInitialData !== undefined ? { hasInitialData: options.hasInitialData } : {}),
    ...(delayMs !== undefined ? { delayMs } : {}),
    ...(noInitialDataDelayMs !== undefined ? { noInitialDataDelayMs } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.enabled !== undefined ? { enabled: options.enabled } : {}),
  });
}
