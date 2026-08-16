import { useCallback, useEffect, useState } from 'react';

export const useRecordingPillSettings = (): {
  pillEnabled: boolean;
  isSupported: boolean;
  setPillEnabled: (enabled: boolean) => void;
} => {
  const api = window.electronAPI?.recordingPillSettings;
  const isSupported = !!api;
  const [pillEnabled, setPillEnabled] = useState(true);

  useEffect(() => {
    if (!api) return;

    let cancelled = false;
    void api
      .getEnabled()
      .then(enabled => {
        if (!cancelled) setPillEnabled(enabled);
      })
      .catch(() => undefined);

    const unsubscribe = api.onEnabledChanged(setPillEnabled);
    return (): void => {
      cancelled = true;
      unsubscribe();
    };
  }, [api]);

  const updatePillEnabled = useCallback(
    (enabled: boolean): void => {
      if (!api) return;
      setPillEnabled(enabled);
      api.setEnabled(enabled);
    },
    [api],
  );

  return { pillEnabled, isSupported, setPillEnabled: updatePillEnabled };
};
