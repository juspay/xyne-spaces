import { useEffect, useState } from 'react';
import { useStartupPhase } from '@/src/providers/StartupPhaseProvider';

type UseDeferredStartupMountOptions = {
  forceMount?: boolean;
  delayMs?: number;
  preload?: () => Promise<unknown>;
};

type IdleScheduler = (
  callback: () => void,
  options?: {
    timeout?: number;
  },
) => number;

type GlobalWithIdleCallback = typeof globalThis & {
  requestIdleCallback?: IdleScheduler;
  cancelIdleCallback?: (handle: number) => void;
};

const IDLE_TIMEOUT_MS = 1000;

export function useDeferredStartupMount({
  forceMount = false,
  delayMs = 0,
  preload,
}: UseDeferredStartupMountOptions = {}): boolean {
  const { hasSplashHidden } = useStartupPhase();
  const [shouldMount, setShouldMount] = useState(false);

  useEffect(() => {
    if (!forceMount) return;
    setShouldMount(true);
  }, [forceMount]);

  useEffect(() => {
    if (shouldMount || !hasSplashHidden) return;

    let cancelled = false;
    let delayTimer: ReturnType<typeof setTimeout> | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let idleHandle: number | null = null;

    const mount = (): void => {
      if (!cancelled) {
        setShouldMount(true);
      }
    };

    const preloadAndMount = (): void => {
      if (!preload) {
        mount();
        return;
      }

      void preload()
        .then(mount)
        .catch(() => {
          // Deferred startup warmup is opportunistic. User action can still force mount.
        });
    };

    const scheduleMount = (): void => {
      const idleApi = globalThis as GlobalWithIdleCallback;

      if (idleApi.requestIdleCallback) {
        idleHandle = idleApi.requestIdleCallback(preloadAndMount, { timeout: IDLE_TIMEOUT_MS });
        return;
      }

      fallbackTimer = setTimeout(preloadAndMount, 0);
    };

    if (delayMs > 0) {
      delayTimer = setTimeout(scheduleMount, delayMs);
    } else {
      scheduleMount();
    }

    return () => {
      cancelled = true;
      if (delayTimer) {
        clearTimeout(delayTimer);
      }
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
      }
      if (idleHandle !== null) {
        const idleApi = globalThis as GlobalWithIdleCallback;
        idleApi.cancelIdleCallback?.(idleHandle);
      }
    };
  }, [delayMs, hasSplashHidden, preload, shouldMount]);

  return forceMount || shouldMount;
}
