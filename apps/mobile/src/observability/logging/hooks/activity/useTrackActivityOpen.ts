import { useEffect } from 'react';

import { appLifecycle } from '../../appLogger';
import { emitActivityOpenCompleted } from '../../activity/emitActivityOpenCompleted';
import { abandonActivityOpen, subscribeActivityOpenCompleted } from '../../activity/activityOpen';

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function useTrackActivityOpen(): void {
  useEffect(() => {
    const unsubscribeCompleted = subscribeActivityOpenCompleted(emitActivityOpenCompleted);

    const lifecycleSubscription = appLifecycle.subscribe(state => {
      if (state !== 'background') return;
      abandonActivityOpen(nowMs());
    });

    return () => {
      unsubscribeCompleted();
      lifecycleSubscription.remove();
    };
  }, []);
}
