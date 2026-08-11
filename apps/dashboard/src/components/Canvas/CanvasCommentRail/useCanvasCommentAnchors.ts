import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import type { CanvasCommentHighlightThread } from '../useCanvasCommentHighlights';

/**
 * Position of one thread's anchor span, in the scroll container's *content*
 * coordinate space (i.e. already includes scrollTop, so it stays correct while
 * the document scrolls without needing to re-measure on every frame).
 *
 * `viewportTop` / `viewportBottom` / `viewportLeft` are kept alongside because
 * the narrow-mode floating card is positioned with `position: fixed` and needs
 * viewport coordinates instead.
 */
export interface CanvasCommentAnchorPosition {
  threadId: string;
  top: number;
  bottom: number;
  viewportTop: number;
  viewportBottom: number;
  viewportLeft: number;
}

interface UseCanvasCommentAnchorsOptions {
  containerRef: RefObject<HTMLElement | null>;
  threads: CanvasCommentHighlightThread[];
  enabled?: boolean;
  refreshKey?: unknown;
  /** Width the rail needs before it can sit beside the document instead of over it. */
  railWidth?: number;
}

interface UseCanvasCommentAnchorsResult {
  scrollContainer: HTMLElement | null;
  positions: Record<string, CanvasCommentAnchorPosition>;
  /** True when the document column is wide enough that the rail would overlap it. */
  isNarrow: boolean;
  remeasure: () => void;
}

const THREAD_ATTR = 'data-canvas-comment-thread-id';

const escapeSelectorValue = (value: string): string =>
  typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(value)
    : value.replace(/["\\]/g, '\\$&');

export const getCanvasScrollContainer = (container: HTMLElement): HTMLElement =>
  container.querySelector<HTMLElement>('.thin-scrollbar') ?? container;

/**
 * Measures where each open thread's highlighted text sits so comment cards can
 * be parked next to it. Re-measures on scroll, resize, and document mutation —
 * all coalesced into a single animation frame.
 */
export const useCanvasCommentAnchors = ({
  containerRef,
  threads,
  enabled = true,
  refreshKey,
  railWidth = 360,
}: UseCanvasCommentAnchorsOptions): UseCanvasCommentAnchorsResult => {
  const [scrollContainer, setScrollContainer] = useState<HTMLElement | null>(null);
  const [positions, setPositions] = useState<Record<string, CanvasCommentAnchorPosition>>({});
  const [isNarrow, setIsNarrow] = useState(false);
  const frameRef = useRef<number | null>(null);
  const signatureRef = useRef('');

  // Thread ids only — measuring must not re-run just because a thread's
  // commentCount changed, or every reply would trigger a full re-measure.
  const threadIds = threads.map(thread => thread.id).join(',');

  const measure = useCallback((): void => {
    const container = containerRef.current;
    if (!container) return;
    const scroller = getCanvasScrollContainer(container);
    const scrollRect = scroller.getBoundingClientRect();

    const next: Record<string, CanvasCommentAnchorPosition> = {};

    threadIds
      .split(',')
      .filter(Boolean)
      .forEach(threadId => {
        const spans = scroller.querySelectorAll<HTMLElement>(
          `[${THREAD_ATTR}="${escapeSelectorValue(threadId)}"]`,
        );
        if (!spans.length) return;

        let viewportTop = Number.POSITIVE_INFINITY;
        let viewportBottom = Number.NEGATIVE_INFINITY;
        let viewportLeft = Number.POSITIVE_INFINITY;

        spans.forEach(span => {
          const rect = span.getBoundingClientRect();
          if (!rect.width && !rect.height) return;
          viewportTop = Math.min(viewportTop, rect.top);
          viewportBottom = Math.max(viewportBottom, rect.bottom);
          viewportLeft = Math.min(viewportLeft, rect.left);
        });

        if (!Number.isFinite(viewportTop)) return;

        next[threadId] = {
          threadId,
          top: Math.round(viewportTop - scrollRect.top + scroller.scrollTop),
          bottom: Math.round(viewportBottom - scrollRect.top + scroller.scrollTop),
          viewportTop: Math.round(viewportTop),
          viewportBottom: Math.round(viewportBottom),
          viewportLeft: Math.round(viewportLeft),
        };
      });

    // Measure the document column, not the highlighted spans — a short anchor
    // in a wide paragraph would otherwise look like there is room to spare and
    // the rail would be parked on top of the text.
    const content = scroller.querySelector<HTMLElement>('.bn-editor') ?? scroller;
    const contentRight = content.getBoundingClientRect().right;
    const narrow = scrollRect.right - contentRight < railWidth;

    const signature = JSON.stringify(next) + (narrow ? '|n' : '');
    if (signature !== signatureRef.current) {
      signatureRef.current = signature;
      setPositions(next);
      setIsNarrow(narrow);
    }
    setScrollContainer(current => (current === scroller ? current : scroller));
  }, [containerRef, railWidth, threadIds]);

  const schedule = useCallback((): void => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      measure();
    });
  }, [measure]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const container = containerRef.current;
    if (!container) return;
    const scroller = getCanvasScrollContainer(container);

    schedule();
    // BlockNote paints asynchronously; retry so anchors that mount late are caught.
    const retries = [80, 240, 600].map(delay => window.setTimeout(schedule, delay));

    scroller.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);

    const observer =
      typeof MutationObserver !== 'undefined' ? new MutationObserver(schedule) : null;
    observer?.observe(scroller, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-id', THREAD_ATTR],
    });

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    resizeObserver?.observe(scroller);

    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      retries.forEach(timeout => window.clearTimeout(timeout));
      scroller.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
      resizeObserver?.disconnect();
    };
  }, [containerRef, enabled, refreshKey, schedule]);

  return { scrollContainer, positions, isNarrow, remeasure: schedule };
};
