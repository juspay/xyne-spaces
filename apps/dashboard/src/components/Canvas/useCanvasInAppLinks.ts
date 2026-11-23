import { useEffect, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { inAppPath } from './canvasInAppLink';

/** The in-app path of the link a plain left-button event lands on inside `root`, else null. */
const inAppLinkTarget = (event: MouseEvent, root: HTMLElement): string | null => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return null;
  }
  const anchor = (event.target as HTMLElement | null)?.closest?.('a[href]');
  if (!anchor || !root.contains(anchor)) return null;
  return inAppPath(anchor.getAttribute('href'));
};

/**
 * Links that point inside this app (another canvas, a channel, …) open in place instead of a new
 * browser tab — on a plain click, whether the canvas is editable or read-only.
 *
 * While editing, BlockNote opens links with `window.open(href, '_blank')` from ProseMirror's
 * mouseup handling, which runs before the `click` event. So the mousedown of an in-app link is
 * kept from reaching the editor (no click handling starts there), and the click navigates. When
 * read-only, the browser would follow `target="_blank"`, which the click handler prevents.
 * External links and modifier clicks (Cmd/Ctrl/Shift, middle button) keep their new-tab behaviour.
 */
export function useCanvasInAppLinks(containerRef: RefObject<HTMLElement | null>): void {
  const navigate = useNavigate();

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return undefined;

    const onMouseDown = (event: MouseEvent): void => {
      if (inAppLinkTarget(event, root)) event.stopPropagation();
    };
    const onClick = (event: MouseEvent): void => {
      if (event.defaultPrevented) return;
      const path = inAppLinkTarget(event, root);
      if (!path) return;
      event.preventDefault();
      event.stopPropagation();
      void navigate(path);
    };

    root.addEventListener('mousedown', onMouseDown, true);
    root.addEventListener('click', onClick, true);
    return () => {
      root.removeEventListener('mousedown', onMouseDown, true);
      root.removeEventListener('click', onClick, true);
    };
  }, [containerRef, navigate]);
}
