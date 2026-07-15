import { useCallback, useMemo, useRef } from 'react';

type ClawOverlayAPI = NonNullable<Window['electronAPI']>['clawOverlay'];

function getClawOverlayAPI(): ClawOverlayAPI {
  return window.electronAPI?.clawOverlay;
}

export interface ClawOverlayBridge {
  setIgnoreMouse: (ignore: boolean) => void;
  setExpanded: (expanded: boolean) => void;
  focus: () => void;
  blur: () => void;
  openInMain: (pathname: string) => void;
  onVisibility: (cb: (visible: boolean) => void) => () => void;
}

export function useClawOverlayBridge(): ClawOverlayBridge {
  const lastIgnoreRef = useRef<boolean | null>(null);

  const setIgnoreMouse = useCallback((ignore: boolean) => {
    if (lastIgnoreRef.current === ignore) return;
    lastIgnoreRef.current = ignore;
    getClawOverlayAPI()?.setIgnoreMouse(ignore);
  }, []);

  const setExpanded = useCallback((expanded: boolean) => {
    getClawOverlayAPI()?.setExpanded(expanded);
  }, []);

  const focus = useCallback(() => {
    getClawOverlayAPI()?.focus();
  }, []);

  const blur = useCallback(() => {
    getClawOverlayAPI()?.blur();
  }, []);

  const openInMain = useCallback((pathname: string) => {
    getClawOverlayAPI()?.openInMain(pathname);
  }, []);

  const onVisibility = useCallback((cb: (visible: boolean) => void) => {
    const overlay = getClawOverlayAPI();
    if (!overlay) return () => {};
    return overlay.onVisibility(cb);
  }, []);

  return useMemo(
    () => ({ setIgnoreMouse, setExpanded, focus, blur, openInMain, onVisibility }),
    [setIgnoreMouse, setExpanded, focus, blur, openInMain, onVisibility],
  );
}
