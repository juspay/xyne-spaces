import { useCallback, useEffect, useState } from 'react';

export function useClawOverlaySettings(): {
  enabled: boolean;
  isSupported: boolean;
  shortcut: string | null;
  setEnabled: (enabled: boolean) => void;
} {
  const api = window.electronAPI?.clawOverlay;
  const isSupported = !!api;
  const [enabled, setEnabledState] = useState(false);
  const [shortcut, setShortcut] = useState<string | null>(null);

  useEffect(() => {
    if (!api?.getShortcut) return;
    let cancelled = false;
    void api.getShortcut().then(value => {
      if (!cancelled) setShortcut(value);
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

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

  return { enabled, isSupported, shortcut, setEnabled };
}
