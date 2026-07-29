import { useCallback, useEffect, type RefObject } from 'react';
import type { PanelImperativeHandle } from '../components/ui/Resizable/Resizable';

/**
 * Wires a sidebar Panel to the app-wide `[` / `]` resize shortcut, which
 * useGlobalShortcuts dispatches as `chat-resize-left-panel` whenever the
 * top-level panel isn't present.
 */
export function useSidebarResizeShortcut({
  panelRef,
  minWidth,
  maxWidth,
}: {
  panelRef: RefObject<PanelImperativeHandle | null>;
  minWidth: number;
  maxWidth: number;
}): void {
  const handleResize = useCallback(
    (event: Event): void => {
      const panel = panelRef.current;
      if (!panel) return;
      const { pixelDelta } = (event as CustomEvent<{ pixelDelta: number }>).detail;
      const { inPixels } = panel.getSize();
      const nextWidth = Math.min(maxWidth, Math.max(minWidth, inPixels + pixelDelta));
      panel.resize(`${nextWidth}px`);
    },
    [panelRef, minWidth, maxWidth],
  );

  useEffect(() => {
    window.addEventListener('chat-resize-left-panel', handleResize);
    return (): void => window.removeEventListener('chat-resize-left-panel', handleResize);
  }, [handleResize]);
}
