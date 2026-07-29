import { useCallback, useEffect, useState } from 'react';

export function useClawOverlaySettings(): {
  enabled: boolean;
  isSupported: boolean;
  setEnabled: (enabled: boolean) => void;
} {
  const api = window.electronAPI?.clawOverlay;
  const isSupported = !!api;
  const [enabled, setEnabledState] = useState(false);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void api.getEnabled().then(value => {
      if (!cancelled) setEnabledState(value);
    });

    const unsubscribe = api.onEnabledChanged(setEnabledState);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [api]);

  const setEnabled = useCallback(
    (next: boolean) => {
      if (!api) return;

      setEnabledState(next);
      api.setEnabled(next);
    },
    [api],
  );

  return { enabled, isSupported, setEnabled };
}
