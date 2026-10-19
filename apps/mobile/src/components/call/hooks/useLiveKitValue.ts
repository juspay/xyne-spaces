import { useCallback, useSyncExternalStore } from 'react';

/** Room, Participant and TrackPublication all expose this. Typed loosely: their event maps differ. */
interface LiveKitEmitter {
  on(event: string, listener: () => void): unknown;
  off(event: string, listener: () => void): unknown;
}

/**
 * A value read straight off a LiveKit object, re-read whenever it emits one of `events`.
 * LiveKit mutates its objects in place, so subscribing like this — rather than diffing props —
 * is what keeps the UI in step. `events` and `read` must be stable (module-level constants).
 */
export function useLiveKitValue<Source extends object, T>(
  source: Source | null | undefined,
  events: readonly string[],
  read: (source: Source) => T,
  fallback: T,
): T {
  const subscribe = useCallback(
    (onChange: () => void): (() => void) => {
      if (!source) return (): void => {};
      const emitter = source as unknown as LiveKitEmitter;
      events.forEach(event => emitter.on(event, onChange));
      return (): void => {
        events.forEach(event => emitter.off(event, onChange));
      };
    },
    [source, events],
  );
  const getSnapshot = useCallback(
    (): T => (source ? read(source) : fallback),
    [source, read, fallback],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
