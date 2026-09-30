/**
 * Fades a scrolling box out at an edge while there is more past that edge, so
 * content running under it reads as "more this way" rather than cut off. Where
 * there is nothing more, the edge stays crisp.
 *
 * Put `ref`, `onScroll` and `style` on the scrolling element. `ref` is a callback,
 * so a box that mounts later — a layout switched to — is picked up when it does. Its
 * size and its children's are watched, including children added later, so rows
 * arriving re-measure the edges; `node` is the element, for anything else that
 * needs it.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';

export function useScrollFade<T extends HTMLElement>(
  axis: 'x' | 'y',
  /** How far the fade reaches in from the edge, in px. */
  fade = 24,
): {
  ref: (element: T | null) => void;
  node: RefObject<T | null>;
  onScroll: () => void;
  style: CSSProperties | undefined;
} {
  const node = useRef<T | null>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const measure = useCallback((): void => {
    const el = node.current;
    if (!el) return;
    const position = axis === 'y' ? el.scrollTop : el.scrollLeft;
    const visible = axis === 'y' ? el.clientHeight : el.clientWidth;
    const total = axis === 'y' ? el.scrollHeight : el.scrollWidth;
    const start = position > 1;
    const end = position + visible < total - 1;
    setEdges(current =>
      current.start === start && current.end === end ? current : { start, end },
    );
  }, [axis]);

  const watchers = useRef<{ resize: ResizeObserver; children: MutationObserver } | null>(null);
  const stopWatching = useCallback((): void => {
    watchers.current?.resize.disconnect();
    watchers.current?.children.disconnect();
    watchers.current = null;
  }, []);
  const ref = useCallback(
    (element: T | null): void => {
      stopWatching();
      node.current = element;
      if (!element) return;
      const resize = new ResizeObserver(measure);
      resize.observe(element);
      for (const child of Array.from(element.children)) resize.observe(child);
      const children = new MutationObserver(records => {
        for (const record of records) {
          record.addedNodes.forEach(added => {
            if (added instanceof Element) resize.observe(added);
          });
        }
        measure();
      });
      children.observe(element, { childList: true });
      watchers.current = { resize, children };
      measure();
    },
    [measure, stopWatching],
  );
  useEffect(() => stopWatching, [stopWatching]);

  if (!edges.start && !edges.end) return { ref, node, onScroll: measure, style: undefined };
  const mask = `linear-gradient(${axis === 'y' ? 'to bottom' : 'to right'}, ${
    edges.start ? 'transparent' : 'black'
  }, black ${edges.start ? fade : 0}px, black calc(100% - ${edges.end ? fade : 0}px), ${
    edges.end ? 'transparent' : 'black'
  })`;
  return { ref, node, onScroll: measure, style: { maskImage: mask, WebkitMaskImage: mask } };
}
