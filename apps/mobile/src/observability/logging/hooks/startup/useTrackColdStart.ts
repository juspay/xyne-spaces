import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import {
  getBookmarkNavIntentSnapshot,
  getNavIntentSnapshot,
  subscribeNavIntent,
} from '@/src/notifications/tapNavigation';

import { appLifecycle } from '../../appLogger';
import {
  applyLaunchSignals,
  beginColdStart,
  COLD_START_LAUNCH_INTENT_SETTLE_MS,
  configureColdStartClock,
  getStartupGeneration,
  markColdStartLaunchIntentSettled,
  markColdStartSplashHidden,
  resolveStartupDestination,
  setColdStartDestination,
  subscribeStartupGeneration,
} from '../../startup/coldStart';
import { emitStartupCompleted } from '../../startup/emitStartupCompleted';
import {
  ReactNativeLaunchSignals,
  ReactNativeStartupClock,
} from '../../startup/reactNativeColdStart';

const startupClock = new ReactNativeStartupClock();
const launchSignalsReader = new ReactNativeLaunchSignals();

async function startColdStartAttempt(): Promise<void> {
  configureColdStartClock(startupClock);

  emitStartupCompleted(await beginColdStart(appLifecycle));

  const collected = await launchSignalsReader.collect();
  emitStartupCompleted(applyLaunchSignals(collected));
}

export function useTrackColdStart(input: {
  hasSplashHidden: boolean;
  isEnrollmentLoading: boolean;
  isAuthLoading: boolean;
  isEnrolled: boolean | null;
  isSignedIn: boolean;
}): void {
  const startupGeneration = useSyncExternalStore(
    subscribeStartupGeneration,
    getStartupGeneration,
    getStartupGeneration,
  );

  useEffect(() => {
    void startColdStartAttempt();

    const applyQueuedNotificationIntent = (): void => {
      const bookmarkIntent = getBookmarkNavIntentSnapshot();
      const chatIntent = getNavIntentSnapshot();
      if (bookmarkIntent === null && chatIntent === null) {
        return;
      }

      emitStartupCompleted(
        applyLaunchSignals({
          initialUrl: null,
          hasInitialNotification: true,
          hasNotificationIntentExtras: false,
          hasInitialShare: false,
          hasColdStartCall: false,
          urlLooksLikeCall: false,
          urlLooksLikeShare: false,
          urlLooksLikeDeepLink: false,
        }),
      );
    };

    applyQueuedNotificationIntent();
    const unsubscribeNavIntent = subscribeNavIntent(applyQueuedNotificationIntent);
    const settleTimer = setTimeout(() => {
      emitStartupCompleted(markColdStartLaunchIntentSettled());
    }, COLD_START_LAUNCH_INTENT_SETTLE_MS);

    const appStateSubscription = AppState.addEventListener('change', (nextState): void => {
      if (nextState === 'active') {
        void startColdStartAttempt();
      }
    });

    return (): void => {
      unsubscribeNavIntent();
      clearTimeout(settleTimer);
      appStateSubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (input.hasSplashHidden) {
      emitStartupCompleted(markColdStartSplashHidden());
    }
  }, [input.hasSplashHidden, startupGeneration]);

  useEffect(() => {
    if (input.isEnrolled === null) {
      return;
    }

    emitStartupCompleted(
      setColdStartDestination(
        resolveStartupDestination({
          isEnrollmentResolved: !input.isEnrollmentLoading,
          isAuthResolved: !input.isAuthLoading,
          isEnrolled: input.isEnrolled,
          isSignedIn: input.isSignedIn,
        }),
      ),
    );
  }, [
    input.isAuthLoading,
    input.isEnrolled,
    input.isEnrollmentLoading,
    input.isSignedIn,
    startupGeneration,
  ]);
}
