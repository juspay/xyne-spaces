import { useEffect, type RefObject } from 'react';
import { CanvasCommentThreadStatus } from '@xyne/shared';

import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';

type CanvasCommentHighlightThread = {
  id: string;
  blockId: string;
  status: CanvasCommentThreadStatus;
};

interface UseCanvasCommentHighlightsOptions {
  canvasId?: string | undefined;
  containerRef: RefObject<HTMLElement | null>;
  enabled?: boolean;
  refreshKey?: unknown;
  onAnchorClick?: ((thread: CanvasCommentHighlightThread) => void) | undefined;
}

const COMMENT_THREAD_SELECTOR = '[data-canvas-comment-thread-id]';
const COMMENT_THREAD_ID_ATTR = 'canvasCommentThreadId';
const COMMENT_THREAD_OPEN_ATTR = 'canvasCommentOpen';

const ensureHighlightStyles = (): void => {
  const styleId = 'canvas-comment-anchor-style';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    [data-canvas-comment-thread-id][data-canvas-comment-open="true"] {
      background-color: rgba(250, 204, 21, 0.42);
      border-radius: 2px;
      cursor: pointer;
    }
  `;
  document.head.appendChild(style);
};

export const useCanvasCommentHighlights = ({
  canvasId,
  containerRef,
  enabled = true,
  refreshKey,
  onAnchorClick,
}: UseCanvasCommentHighlightsOptions): void => {
  const [threads = []] = useCachedQuery(
    queries.canvasCommentThreads({ canvasId: canvasId || '' }),
    {
      enabled: enabled && Boolean(canvasId),
    },
  );

  useEffect(() => {
    if (!enabled || !canvasId || typeof window === 'undefined') return;

    ensureHighlightStyles();
    const openThreadIds = new Set(
      threads
        .filter(thread => thread.status === CanvasCommentThreadStatus.OPEN)
        .map(thread => thread.id),
    );

    const syncAnchors = (): void => {
      const container = containerRef.current;
      if (!container) return;

      container.querySelectorAll<HTMLElement>(COMMENT_THREAD_SELECTOR).forEach(element => {
        const threadId = element.dataset[COMMENT_THREAD_ID_ATTR];
        if (threadId && openThreadIds.has(threadId)) {
          element.dataset[COMMENT_THREAD_OPEN_ATTR] = 'true';
        } else {
          delete element.dataset[COMMENT_THREAD_OPEN_ATTR];
        }
      });
    };

    let pendingAnimationFrame: number | null = null;
    const scheduleSyncAnchors = (): void => {
      if (pendingAnimationFrame !== null) return;
      pendingAnimationFrame = window.requestAnimationFrame(() => {
        pendingAnimationFrame = null;
        syncAnchors();
      });
    };

    scheduleSyncAnchors();
    const retryTimeouts = [100, 300, 800].map(delay =>
      window.setTimeout(scheduleSyncAnchors, delay),
    );

    const observedContainer = containerRef.current;
    const observer =
      observedContainer && typeof MutationObserver !== 'undefined'
        ? new MutationObserver(scheduleSyncAnchors)
        : null;
    if (observer && observedContainer) {
      observer.observe(observedContainer, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['data-canvas-comment-thread-id'],
      });
    }

    return () => {
      if (pendingAnimationFrame !== null) {
        window.cancelAnimationFrame(pendingAnimationFrame);
      }
      retryTimeouts.forEach(timeout => window.clearTimeout(timeout));
      observer?.disconnect();
    };
  }, [canvasId, containerRef, enabled, refreshKey, threads]);

  useEffect(() => {
    if (!enabled || !onAnchorClick) return;

    const container = containerRef.current;
    if (!container) return;

    const threadsById = new Map(
      threads
        .filter(thread => thread.status === CanvasCommentThreadStatus.OPEN)
        .map(thread => [thread.id, thread]),
    );

    const handleClick = (event: MouseEvent): void => {
      const target = event.target as Element | null;
      const anchorElement = target?.closest<HTMLElement>(COMMENT_THREAD_SELECTOR);
      if (!anchorElement || !container.contains(anchorElement)) return;

      const threadId = anchorElement.dataset[COMMENT_THREAD_ID_ATTR];
      if (!threadId) return;

      const thread = threadsById.get(threadId);
      if (!thread) return;

      onAnchorClick(thread);
    };

    container.addEventListener('click', handleClick);
    return () => {
      container.removeEventListener('click', handleClick);
    };
  }, [containerRef, enabled, onAnchorClick, threads]);
};
