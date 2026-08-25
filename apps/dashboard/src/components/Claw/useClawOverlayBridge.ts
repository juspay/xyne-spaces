import { useCallback, useMemo, useRef } from 'react';

type ClawOverlayAPI = NonNullable<Window['electronAPI']>['clawOverlay'];

function getClawOverlayAPI(): ClawOverlayAPI {
  return window.electronAPI?.clawOverlay;
}

export type ClawMode = 'pill' | 'spotlight';

export interface ClawOverlayBridge {
  setIgnoreMouse: (ignore: boolean) => void;
  setExpanded: (expanded: boolean) => void;
  dismissSpotlight: () => void;
  setSpotlightHeight: (height: number) => void;
  dragStart: () => void;
  dragEnd: () => void;
  onMode: (cb: (mode: ClawMode) => void) => () => void;
  focus: () => void;
  blur: () => void;
  openInMain: (pathname: string) => void;
  onVisibility: (cb: (visible: boolean) => void) => () => void;
  setPanelHeight: (height: number) => void;
  onPanelHeight: (cb: (height: number) => void) => () => void;
  reconcile: (rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => Promise<boolean | null>;
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

  const dismissSpotlight = useCallback(() => {
    getClawOverlayAPI()?.dismissSpotlight();
  }, []);

  const setSpotlightHeight = useCallback((height: number) => {
    getClawOverlayAPI()?.setSpotlightHeight(height);
  }, []);

  const dragStart = useCallback(() => {
    getClawOverlayAPI()?.dragStart();
  }, []);

  const dragEnd = useCallback(() => {
    getClawOverlayAPI()?.dragEnd();
  }, []);

  const onMode = useCallback((cb: (mode: ClawMode) => void) => {
    const overlay = getClawOverlayAPI();
    if (!overlay) return () => {};
    return overlay.onMode(cb);
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

  const setPanelHeight = useCallback((height: number) => {
    getClawOverlayAPI()?.setPanelHeight(height);
  }, []);

  const onPanelHeight = useCallback((cb: (height: number) => void) => {
    const overlay = getClawOverlayAPI();
    if (!overlay) return () => {};
    return overlay.onPanelHeight(cb);
  }, []);

  const reconcile = useCallback(
    (rect: { x: number; y: number; width: number; height: number }): Promise<boolean | null> => {
      const overlay = getClawOverlayAPI();
      if (!overlay) return Promise.resolve(null);
      return overlay.reconcile(rect);
    },
    [],
  );

  return useMemo(
    () => ({
      setIgnoreMouse,
      setExpanded,
      dismissSpotlight,
      setSpotlightHeight,
      dragStart,
      dragEnd,
      onMode,
      focus,
      blur,
      openInMain,
      onVisibility,
      setPanelHeight,
      onPanelHeight,
      reconcile,
    }),
    [
      setIgnoreMouse,
      setExpanded,
      dismissSpotlight,
      setSpotlightHeight,
      dragStart,
      dragEnd,
      onMode,
      focus,
      blur,
      openInMain,
      onVisibility,
      setPanelHeight,
      onPanelHeight,
      reconcile,
    ],
  );
}
