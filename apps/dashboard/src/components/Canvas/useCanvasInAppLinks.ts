import { useEffect, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { inAppPath } from './canvasInAppLink';

/**
 * Links that point inside this app (another canvas, a channel, …) open in place instead of a new
 * browser tab — on a plain click, whether the canvas is editable or read-only.
 *
 * BlockNote's link click handler would `window.open(href, '_blank')` while editing, and the
 * browser follows `target="_blank"` when read-only, so this listens in the capture phase on the
 * editor container and handles the click before either. External links and modifier clicks
 * (Cmd/Ctrl/Shift, middle button) keep their normal new-tab behaviour.
 */
export function useCanvasInAppLinks(containerRef: RefObject<HTMLElement | null>): void {
  const navigate = useNavigate();

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return undefined;

    const onClick = (event: MouseEvent): void => {
      if (event.button !== 0 || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as HTMLElement | null)?.closest?.('a[href]');
      if (!anchor || !root.contains(anchor)) return;
      const path = inAppPath(anchor.getAttribute('href'));
      if (!path) return;
      event.preventDefault();
      event.stopPropagation();
      void navigate(path);
    };

    root.addEventListener('click', onClick, true);
    return () => root.removeEventListener('click', onClick, true);
  }, [containerRef, navigate]);
}
