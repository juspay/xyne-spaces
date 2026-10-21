import { useEffect } from 'react';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

const CALL_KEEP_AWAKE_TAG = 'lotus-call';

/**
 * Stops the display from auto-locking while video is on screen (a dimming/locking screen
 * would freeze the very thing the user is looking at). Best effort: a failure here must never
 * affect the call.
 */
export function useKeepScreenAwake(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    void activateKeepAwakeAsync(CALL_KEEP_AWAKE_TAG).catch(() => undefined);
    return (): void => {
      void deactivateKeepAwake(CALL_KEEP_AWAKE_TAG).catch(() => undefined);
    };
  }, [active]);
}
