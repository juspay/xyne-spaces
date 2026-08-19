import { useCallback, useEffect, useState } from 'react';

export const useTraySettings = (): {
  trayVisible: boolean;
  isSupported: boolean;
  setTrayVisible: (visible: boolean) => void;
} => {
  const api = window.electronAPI?.tray;
  const isSupported = !!api;
  const [trayVisible, setTrayVisible] = useState(true);

  useEffect(() => {
    if (!api) return;

    let cancelled = false;
    void api
      .getVisible()
      .then(visible => {
        if (!cancelled) setTrayVisible(visible);
      })
      .catch(() => undefined);

    const unsubscribe = api.onVisibleChanged(setTrayVisible);
    return (): void => {
      cancelled = true;
      unsubscribe();
    };
  }, [api]);

  const updateTrayVisible = useCallback(
    (visible: boolean): void => {
      if (!api) return;
      setTrayVisible(visible);
      api.setVisible(visible);
    },
    [api],
  );

  return { trayVisible, isSupported, setTrayVisible: updateTrayVisible };
};
