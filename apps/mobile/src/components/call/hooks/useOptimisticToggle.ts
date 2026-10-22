import { useEffect, useState } from 'react';

/**
 * Instant visual feedback for a toggle whose real value only updates after an async round trip —
 * muting, camera and screen share all go through LiveKit and (on mic/camera) the native bridge
 * before `roomMachine` reflects the new state, which reads as sluggish if the button waits for it.
 *
 * Tapping shows the intended state immediately; the override is dropped the moment the real value
 * catches up, so as soon as `roomMachine` confirms, this hook is back to just mirroring truth. If
 * the toggle is ever denied or fails silently, `timeoutMs` drops the override on its own so the
 * button can never get stuck showing something that didn't happen.
 */
export function useOptimisticToggle(
  realValue: boolean,
  onToggle: () => void,
  timeoutMs = 1200,
): { value: boolean; toggle: () => void } {
  const [override, setOverride] = useState<boolean | null>(null);

  useEffect(() => {
    if (override === null) return undefined;
    if (realValue === override) {
      setOverride(null);
      return undefined;
    }
    const timer = setTimeout(() => setOverride(null), timeoutMs);
    return (): void => clearTimeout(timer);
  }, [override, realValue, timeoutMs]);

  const toggle = (): void => {
    setOverride(current => !(current ?? realValue));
    onToggle();
  };

  return { value: override ?? realValue, toggle };
}
