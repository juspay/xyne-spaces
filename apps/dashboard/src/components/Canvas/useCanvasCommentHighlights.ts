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
const COMMENT_THREAD_BADGE_SELECTOR = '[data-canvas-comment-thread-badge="true"]';

const ensureHighlightStyles = (): void => {
  const styleId = 'canvas-comment-anchor-style';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    [data-canvas-comment-thread-id][data-canvas-comment-open="true"] {
      background-color: rgba(250, 204, 21, 0.42);
      border-radius: 2px;
      box-shadow: inset 0 -2px 0 rgba(217, 119, 6, 0.65);
      cursor: pointer;
    }
    [data-canvas-comment-thread-id][data-canvas-comment-active="true"] {
      background-color: rgba(245, 158, 11, 0.48);
      box-shadow:
        inset 0 -2px 0 rgba(180, 83, 9, 0.75),
        0 0 0 2px rgba(245, 158, 11, 0.18);
    }
    [data-canvas-comment-thread-badge="true"] {
      position: absolute;
      z-index: 20;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 26px;
      min-width: 44px;
      padding: 0 10px;
      border: 1px solid hsl(var(--border));
      border-radius: 10px;
      background: hsl(var(--background));
      color: hsl(var(--muted-foreground));
      box-shadow: 0 1px 4px hsl(var(--foreground) / 0.12);
      font-size: 13px;
      font-weight: 600;
      line-height: 1;
      cursor: pointer;
      transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
    }
    [data-canvas-comment-thread-badge="true"]:hover {
      background: hsl(var(--accent));
      color: hsl(var(--foreground));
      border-color: hsl(var(--border));
    }
    [data-canvas-comment-thread-badge="true"] svg {
      width: 15px;
      height: 15px;
      flex-shrink: 0;
    }
  `;
  document.head.appendChild(style);
};

const getBlockSelector = (blockId: string): string => {
  const escapedBlockId =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(blockId)
      : blockId.replace(/["\\]/g, '\\$&');

  return `[data-id="${escapedBlockId}"]`;
};

const getThreadSelector = (threadId: string): string => {
  const escapedThreadId =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(threadId)
      : threadId.replace(/["\\]/g, '\\$&');

  return `[data-canvas-comment-thread-id="${escapedThreadId}"]`;
};

const getScrollContainer = (container: HTMLElement): HTMLElement =>
  container.querySelector<HTMLElement>('.thin-scrollbar') ?? container;

const getElementStartRect = (element: HTMLElement): DOMRect => {
  const firstRect = element.getClientRects()[0];
  if (!firstRect) return element.getBoundingClientRect();
  return new DOMRect(firstRect.left, firstRect.top, 0, firstRect.height);
};

const getNextBadgeTop = (top: number, usedTops: number[]): number => {
  let nextTop = top;
  while (usedTops.some(usedTop => Math.abs(usedTop - nextTop) < 30)) {
    nextTop += 30;
  }
  usedTops.push(nextTop);
  return nextTop;
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
  const threadBadgeData = useMemo(
    () =>
      openThreads.map(thread => ({
        thread,
        count: Math.max(thread.commentCount ?? 1, 1),
      })),
    [openThreads],
  );

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
    if (!enabled || !canvasId || typeof window === 'undefined') return;

    ensureHighlightStyles();
    const container = containerRef.current;
    if (!container) return;

    const scrollContainer = getScrollContainer(container);

    const removeBadges = (): void => {
      scrollContainer
        .querySelectorAll<HTMLElement>(COMMENT_THREAD_BADGE_SELECTOR)
        .forEach(badge => badge.remove());
    };

    const renderBadges = (): void => {
      removeBadges();
      const usedTops: number[] = [];
      threadBadgeData.forEach(({ count, thread }) => {
        const anchorElement = scrollContainer.querySelector<HTMLElement>(
          getThreadSelector(thread.id),
        );
        const blockElement = scrollContainer.querySelector<HTMLElement>(
          getBlockSelector(thread.blockId),
        );
        const targetElement = anchorElement ?? blockElement;
        if (!targetElement) return;

        const scrollRect = scrollContainer.getBoundingClientRect();
        const targetRect = targetElement.getBoundingClientRect();
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset['canvasCommentThreadBadge'] = 'true';
        button.dataset['canvasCommentBadgeThreadId'] = thread.id;
        button.dataset['canvasCommentBlockId'] = thread.blockId;
        button.setAttribute('aria-label', `${count} comments in this thread`);
        button.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path>
          </svg>
          <span>${count > 99 ? '99+' : count}</span>
        `;
        const top =
          targetRect.top -
          scrollRect.top +
          scrollContainer.scrollTop +
          Math.max(0, targetRect.height / 2 - 13);
        button.style.top = `${getNextBadgeTop(top, usedTops)}px`;
        button.style.right = '12px';
        button.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          onAnchorClick?.(thread, targetElement.getBoundingClientRect());
        });
        scrollContainer.appendChild(button);
      });
    };

    let pendingAnimationFrame: number | null = null;
    const scheduleRenderBadges = (): void => {
      if (pendingAnimationFrame !== null) return;
      pendingAnimationFrame = window.requestAnimationFrame(() => {
        pendingAnimationFrame = null;
        renderBadges();
      });
    };

    scheduleRenderBadges();
    const retryTimeouts = [100, 300, 800].map(delay =>
      window.setTimeout(scheduleRenderBadges, delay),
    );
    scrollContainer.addEventListener('scroll', scheduleRenderBadges, { passive: true });
    window.addEventListener('resize', scheduleRenderBadges);

    const observedEditor = scrollContainer.querySelector<HTMLElement>('.bn-editor');
    const observer =
      observedEditor && typeof MutationObserver !== 'undefined'
        ? new MutationObserver(scheduleRenderBadges)
        : null;
    if (observer && observedEditor) {
      observer.observe(observedEditor, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['data-id', 'data-canvas-comment-thread-id'],
      });
    }

    return () => {
      if (pendingAnimationFrame !== null) {
        window.cancelAnimationFrame(pendingAnimationFrame);
      }
      retryTimeouts.forEach(timeout => window.clearTimeout(timeout));
      scrollContainer.removeEventListener('scroll', scheduleRenderBadges);
      window.removeEventListener('resize', scheduleRenderBadges);
      observer?.disconnect();
      removeBadges();
    };
  }, [canvasId, containerRef, enabled, onAnchorClick, refreshKey, threadBadgeData]);

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
