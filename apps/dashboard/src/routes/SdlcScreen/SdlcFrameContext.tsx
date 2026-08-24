import {
  createContext,
  ReactElement,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

// Carries the SDLC frame's viewport from the route to the shell-owned host. The
// route contributes geometry only — owning the frame, or its portal target, would
// detach the iframe on unmount and destroy its browsing context.

export interface SdlcFrameViewport {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface SdlcFrameContextValue {
  /** Null while no SDLC route is mounted, which hides the frame. */
  viewport: SdlcFrameViewport | null;
  setViewport: (viewport: SdlcFrameViewport | null) => void;
}

const SdlcFrameContext = createContext<SdlcFrameContextValue | null>(null);

export const SdlcFrameProvider = ({ children }: { children: ReactNode }): ReactElement => {
  const [viewport, setViewportState] = useState<SdlcFrameViewport | null>(null);

  const setViewport = useCallback((next: SdlcFrameViewport | null): void => {
    setViewportState(previous => {
      if (previous === next) return previous;
      if (!previous || !next) return next;
      // Rect updates fire on every observation; skip no-op renders.
      const unchanged =
        previous.top === next.top &&
        previous.left === next.left &&
        previous.width === next.width &&
        previous.height === next.height;
      return unchanged ? previous : next;
    });
  }, []);

  const value = useMemo(() => ({ viewport, setViewport }), [viewport, setViewport]);

  return <SdlcFrameContext.Provider value={value}>{children}</SdlcFrameContext.Provider>;
};

export function useSdlcFrame(): SdlcFrameContextValue {
  const context = useContext(SdlcFrameContext);
  if (!context) {
    throw new Error('useSdlcFrame must be used inside SdlcFrameProvider');
  }
  return context;
}
