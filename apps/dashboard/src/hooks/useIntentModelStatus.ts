import { useCallback, useEffect, useState } from 'react';

import { intentClassifier, type ModelStatus } from '../services/onDeviceIntent';

/**
 * Model-download state for Settings.
 *
 * Not `useSyncExternalStore`: the classifier hands the listener a fresh object on
 * every progress tick, so `getSnapshot` would return a new reference each render
 * and React would loop. A plain subscription with local state is the correct shape
 * for a push source that does not memoise its snapshots.
 *
 * `start()` kicks the download off explicitly. That matters because the model is
 * otherwise fetched lazily on the first classified message — enabling the toggle
 * and seeing nothing happen for a day, then a mysterious 23MB later, is worse than
 * downloading it while the user is looking at the switch they just flipped.
 */
export function useIntentModelStatus(): {
  status: ModelStatus;
  start: () => void;
  retry: () => void;
} {
  const [status, setStatus] = useState<ModelStatus>(() => intentClassifier.getModelStatus());

  useEffect(() => {
    // Re-read on mount: the download may have started (or finished, or failed)
    // before Settings was ever opened.
    setStatus(intentClassifier.getModelStatus());
    return intentClassifier.subscribeModelStatus(setStatus);
  }, []);

  const start = useCallback(() => intentClassifier.warmup(), []);
  const retry = useCallback(() => intentClassifier.retryModelLoad(), []);

  return { status, start, retry };
}
