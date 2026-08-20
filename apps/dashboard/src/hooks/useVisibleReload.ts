import { useState } from 'react';

const MIN_RELOAD_SPIN_MS = 500;

// Keeps the reload icon spinning for at least MIN_RELOAD_SPIN_MS — refetch is
// often near-instant, which otherwise reads as if the click did nothing.
export function useVisibleReload(refetch: () => Promise<unknown>): {
  reloading: boolean;
  reload: () => void;
} {
  const [reloading, setReloading] = useState(false);
  const reload = (): void => {
    setReloading(true);
    void Promise.allSettled([
      refetch(),
      new Promise(r => setTimeout(r, MIN_RELOAD_SPIN_MS)),
    ]).finally(() => setReloading(false));
  };
  return { reloading, reload };
}
