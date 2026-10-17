import { useEffect, useState } from 'react';

import {
  ensureActivitySyncAppStateListener,
  getActivitySyncState,
  subscribeToActivitySync,
  type ActivitySyncState,
} from './activitySyncCoordinator';

export function useActivitySyncState(windowMs = 5_000): ActivitySyncState & { isRecent: boolean } {
  const [syncState, setSyncState] = useState<ActivitySyncState>(() => getActivitySyncState());

  useEffect(() => {
    ensureActivitySyncAppStateListener();
    return subscribeToActivitySync(() => {
      setSyncState(getActivitySyncState());
    });
  }, []);

  const isRecent = Date.now() - syncState.lastTriggeredAt < windowMs;

  useEffect(() => {
    if (!isRecent || syncState.lastTriggeredAt === 0) {
      return;
    }

    const remainingMs = Math.max(0, windowMs - (Date.now() - syncState.lastTriggeredAt));
    const timer = setTimeout(() => {
      setSyncState(getActivitySyncState());
    }, remainingMs);

    return (): void => {
      clearTimeout(timer);
    };
  }, [isRecent, syncState.lastTriggeredAt, windowMs]);

  return {
    ...syncState,
    isRecent,
  };
}
