import { useEffect, useSyncExternalStore } from 'react';

import {
  getStartupGeneration,
  noteStartupDestinationReady,
  subscribeStartupGeneration,
  type StartupDestination,
} from '../../startup/coldStart';
import { emitStartupCompleted } from '../../startup/emitStartupCompleted';

export function useReportStartupReady(
  destination: StartupDestination,
  isContentReady: boolean,
): void {
  const startupGeneration = useSyncExternalStore(
    subscribeStartupGeneration,
    getStartupGeneration,
    getStartupGeneration,
  );

  useEffect(() => {
    if (!isContentReady) {
      return;
    }

    void noteStartupDestinationReady(destination).then(completed => {
      emitStartupCompleted(completed);
    });
  }, [destination, isContentReady, startupGeneration]);
}
