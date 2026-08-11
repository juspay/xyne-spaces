import { useEffect, useMemo, type RefObject } from 'react';
import { CanvasCommentThreadStatus } from '@xyne/shared';

import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';

export type CanvasCommentHighlightThread = {
  id: string;
  blockId: string;
  status: CanvasCommentThreadStatus;
  anchorText?: string | null;
  initialCommentId?: string | null;
  commentCount?: number;
  /**
   * Carried by `queries.canvasCommentThreads` via `.related('initialComment')`,
   * so a collapsed comment card can render its preview without its own query.
   */
  initialComment?: {
    id: string;
    body: string;
    createdBy: string;
    createdAt: number;
    deletedAt?: number | null;
  } | null;
};

interface UseCanvasCommentHighlightsOptions {
  canvasId?: string | undefined;
  containerRef: RefObject<HTMLElement | null>;
  enabled?: boolean;
  refreshKey?: unknown;
  activeThreadId?: string | null | undefined;
  onAnchorClick?: ((thread: CanvasCommentHighlightThread, rect?: DOMRect) => void) | undefined;
  onOpenCountChange?: ((count: number) => void) | undefined;
  onThreadsChange?: ((threads: CanvasCommentHighlightThread[]) => void) | undefined;
}

const COMMENT_THREAD_SELECTOR = '[data-canvas-comment-thread-id]';
const COMMENT_THREAD_ID_ATTR = 'canvasCommentThreadId';
const COMMENT_THREAD_OPEN_ATTR = 'canvasCommentOpen';
const COMMENT_THREAD_ACTIVE_ATTR = 'canvasCommentActive';

const ensureHighlightStyles = (): void => {
  const styleId = 'canvas-comment-anchor-style';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    [data-canvas-comment-thread-id][data-canvas-comment-open="true"] {
      background-color: rgba(244, 200, 90, 0.28);
      border-bottom: 2px solid #E5A93D;
      padding-bottom: 1px;
      cursor: pointer;
      transition: background-color 150ms ease;
    }
    [data-canvas-comment-thread-id][data-canvas-comment-open="true"]:hover {
      background-color: rgba(242, 180, 60, 0.36);
    }
    [data-canvas-comment-thread-id][data-canvas-comment-active="true"] {
      background-color: rgba(242, 180, 60, 0.42);
    }
  `;
  document.head.appendChild(style);
};

const getElementStartRect = (element: HTMLElement): DOMRect => {
  const firstRect = element.getClientRects()[0];
  if (!firstRect) return element.getBoundingClientRect();
  return new DOMRect(firstRect.left, firstRect.top, 0, firstRect.height);
};

export const useCanvasCommentHighlights = ({
  canvasId,
  containerRef,
  enabled = true,
  refreshKey,
  activeThreadId,
  onAnchorClick,
  onOpenCountChange,
  onThreadsChange,
}: UseCanvasCommentHighlightsOptions): void => {
  const [threads = []] = useCachedQuery(
    queries.canvasCommentThreads({ canvasId: canvasId || '' }),
    {
      enabled: enabled && Boolean(canvasId),
    },
  ) as unknown as [CanvasCommentHighlightThread[]];
  const openThreads = useMemo(
    () => threads.filter(thread => thread.status === CanvasCommentThreadStatus.OPEN),
    [threads],
  );
  const openThreadIds = useMemo(() => new Set(openThreads.map(thread => thread.id)), [openThreads]);

  useEffect(() => {
    if (!enabled || !canvasId) {
      onOpenCountChange?.(0);
      onThreadsChange?.([]);
      return;
    }

    onOpenCountChange?.(openThreads.length);
    onThreadsChange?.(threads);
  }, [canvasId, enabled, onOpenCountChange, onThreadsChange, openThreads.length, threads]);

  useEffect(() => {
    if (!enabled || !canvasId || typeof window === 'undefined') return;

    ensureHighlightStyles();
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

        if (threadId && threadId === activeThreadId && openThreadIds.has(threadId)) {
          element.dataset[COMMENT_THREAD_ACTIVE_ATTR] = 'true';
        } else {
          delete element.dataset[COMMENT_THREAD_ACTIVE_ATTR];
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
  }, [activeThreadId, canvasId, containerRef, enabled, openThreadIds, refreshKey]);

  useEffect(() => {
    if (!enabled || !onAnchorClick) return;

    const container = containerRef.current;
    if (!container) return;

    const threadsById = new Map(openThreads.map(thread => [thread.id, thread]));

    const handleClick = (event: MouseEvent): void => {
      const target = event.target as Element | null;
      const anchorElement = target?.closest<HTMLElement>(COMMENT_THREAD_SELECTOR);
      if (!anchorElement || !container.contains(anchorElement)) return;

      const threadId = anchorElement.dataset[COMMENT_THREAD_ID_ATTR];
      if (!threadId) return;

      const thread = threadsById.get(threadId);
      if (!thread) return;

      onAnchorClick(thread, getElementStartRect(anchorElement));
    };

    container.addEventListener('click', handleClick);
    return () => {
      container.removeEventListener('click', handleClick);
    };
  }, [containerRef, enabled, onAnchorClick, openThreads]);
};
