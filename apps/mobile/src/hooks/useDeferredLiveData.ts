import { useEffect, useState } from 'react';
import { InteractionManager } from 'react-native';

import { useStartupPhase } from '@/src/providers/StartupPhaseProvider';
import {
  isCriticalWindowActive,
  useIsCriticalWindowActive,
} from '@/src/utils/interactionCriticalWindow';
import { startupTimings } from '@/src/utils/startupTimings';

type UseDeferredLiveDataOptions = {
  name: string;
  screen: string;
  screenReady?: boolean;
  hasInitialData?: boolean;
  delayMs?: number;
  noInitialDataDelayMs?: number;
  timeoutMs?: number;
  enabled?: boolean;
  preferImmediate?: boolean;
};

const DEFAULT_DELAY_MS = 250;
const DEFAULT_NO_INITIAL_DATA_DELAY_MS = 0;
const DEFAULT_TIMEOUT_MS = 1500;

export function useDeferredLiveData({
  name,
  screenReady = true,
  hasInitialData = false,
  delayMs = DEFAULT_DELAY_MS,
  noInitialDataDelayMs = DEFAULT_NO_INITIAL_DATA_DELAY_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  enabled = true,
  preferImmediate = false,
}: UseDeferredLiveDataOptions): boolean {
  const { hasSplashHidden } = useStartupPhase();
  const [isLiveEnabled, setIsLiveEnabled] = useState(false);
  const criticalWindowActive = useIsCriticalWindowActive();

  useEffect(() => {
    if (!enabled) {
      setIsLiveEnabled(false);
      return;
    }

    if (isLiveEnabled || !hasSplashHidden || !screenReady) {
      return;
    }

    if (criticalWindowActive) {
      return;
    }

    let cancelled = false;
    let delayTimer: ReturnType<typeof setTimeout> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    let task: { cancel: () => void } | null = null;
    let didEnable = false;
    const startDelayMs = hasInitialData ? delayMs : noInitialDataDelayMs;

    const enableLiveData = (): void => {
      if (cancelled || didEnable || isCriticalWindowActive()) {
        return;
      }

      didEnable = true;
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      startupTimings.setQueryStatus(`live_query_enabled.${name}`, 'complete');
      setIsLiveEnabled(true);
    };

    const scheduleAfterInteractions = (): void => {
      if (preferImmediate) {
        enableLiveData();
      } else {
        task = InteractionManager.runAfterInteractions(enableLiveData);
      }
      timeoutTimer = setTimeout(enableLiveData, timeoutMs);
    };

    if (startDelayMs > 0) {
      delayTimer = setTimeout(scheduleAfterInteractions, startDelayMs);
    } else {
      scheduleAfterInteractions();
    }

    return (): void => {
      cancelled = true;
      if (delayTimer) {
        clearTimeout(delayTimer);
      }
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      task?.cancel();
    };
  }, [
    criticalWindowActive,
    delayMs,
    enabled,
    hasInitialData,
    hasSplashHidden,
    isLiveEnabled,
    name,
    noInitialDataDelayMs,
    preferImmediate,
    screenReady,
    timeoutMs,
  ]);

  return enabled && isLiveEnabled;
}
