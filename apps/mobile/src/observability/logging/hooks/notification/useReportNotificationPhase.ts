import { useEffect, useSyncExternalStore } from 'react';

import { useTabPageIsFocused } from '@/src/hooks/useTabPageFocus';

import {
  getNotificationOpenJourneyId,
  markNotificationPhase,
  subscribeNotificationOpenJourney,
} from '../../notification/notificationOpen';
import { ReactNativeStartupClock } from '../../startup/reactNativeColdStart';

const clock = new ReactNativeStartupClock();

export function useReportNotificationPhase(phase: 'dms_visible' | 'chat_visible'): void {
  const isFocused = useTabPageIsFocused();
  const journeyId = useSyncExternalStore(
    subscribeNotificationOpenJourney,
    getNotificationOpenJourneyId,
    getNotificationOpenJourneyId,
  );

  useEffect(() => {
    if (!isFocused) {
      return;
    }

    void clock.nowUptimeMs().then(now => {
      if (now === null) {
        return;
      }

      markNotificationPhase(phase, now);
    });
  }, [isFocused, journeyId, phase]);
}
