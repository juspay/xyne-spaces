import { useEffect, useMemo, useRef, type RefObject } from 'react';
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
  /**
   * Thread ids whose anchor mark is still in the document, or null while that is unknown.
   * A thread outside the set had its commented text deleted, so it gets no highlight and no
   * badge until an undo brings the anchor back.
   */
  anchoredThreadIds?: Set<string> | null | undefined;
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
      background-color: rgba(244, 200, 90, 0.28);
      box-shadow: inset 0 -1.5px 0 #e5a93d;
      border-radius: 1px;
      cursor: pointer;
      transition: background-color 150ms ease, box-shadow 150ms ease;
    }
    [data-canvas-comment-thread-id][data-canvas-comment-open="true"]:hover {
      background-color: rgba(242, 180, 60, 0.36);
    }
    [data-canvas-comment-thread-id][data-canvas-comment-active="true"] {
      background-color: rgba(242, 180, 60, 0.42);
    }
    [data-theme="midnight"] [data-canvas-comment-thread-id][data-canvas-comment-open="true"] {
      background-color: rgba(229, 169, 61, 0.2);
      box-shadow: inset 0 -1.5px 0 rgba(229, 169, 61, 0.8);
    }
    [data-theme="midnight"] [data-canvas-comment-thread-id][data-canvas-comment-open="true"]:hover {
      background-color: rgba(229, 169, 61, 0.28);
    }
    [data-theme="midnight"] [data-canvas-comment-thread-id][data-canvas-comment-active="true"] {
      background-color: rgba(229, 169, 61, 0.34);
    }
    [data-canvas-comment-thread-badge="true"] {
      position: absolute;
      z-index: 20;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 26px;
      padding: 0 8px;
      font-variant-numeric: tabular-nums;
      border: 1px solid hsl(var(--border));
      border-radius: 8px;
      background: hsl(var(--background));
      color: hsl(var(--muted-foreground));
      box-shadow: 0 1px 2px hsl(var(--foreground) / 0.05);
      font-size: 11.5px;
      font-weight: 600;
      line-height: 1;
      cursor: pointer;
      animation: canvas-comment-badge-in 220ms cubic-bezier(0.4, 0, 0.2, 1) both;
      transition:
        top 180ms ease,
        opacity 150ms ease,
        transform 180ms cubic-bezier(0.4, 0, 0.2, 1),
        background-color 150ms ease,
        border-color 150ms ease,
        color 150ms ease;
    }
    /* The pill is 26px tall by design; extend the hit area without changing the visual.
       Kept within the 34px stacking gap so neighbouring badges never overlap. */
    [data-canvas-comment-thread-badge="true"]::before {
      content: "";
      position: absolute;
      inset: -4px -8px;
    }
    [data-canvas-comment-thread-badge="true"]:hover {
      background: hsl(var(--accent));
      color: hsl(var(--foreground));
      transform: translateX(-2px);
    }
    [data-canvas-comment-thread-badge="true"]:active {
      transform: translateX(-2px) scale(0.96);
    }
    [data-canvas-comment-thread-badge="true"][data-canvas-comment-badge-active="true"] {
      opacity: 0;
      transform: translateX(8px);
      pointer-events: none;
    }
    [data-canvas-comment-thread-badge="true"] svg {
      width: 14px;
      height: 14px;
      flex-shrink: 0;
    }
    @keyframes canvas-comment-badge-in {
      from { opacity: 0; transform: translateX(8px); }
      to { opacity: 1; transform: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      [data-canvas-comment-thread-badge="true"] {
        animation: none;
        transition: top 180ms ease, opacity 150ms ease;
      }
      [data-canvas-comment-thread-badge="true"]:hover { transform: none; }
      [data-canvas-comment-thread-badge="true"][data-canvas-comment-badge-active="true"] {
        transform: none;
      }
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
  while (usedTops.some(usedTop => Math.abs(usedTop - nextTop) < 34)) {
    nextTop += 34;
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
  anchoredThreadIds,
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
  const anchoredThreads = useMemo(
    () =>
      anchoredThreadIds ? threads.filter(thread => anchoredThreadIds.has(thread.id)) : threads,
    [anchoredThreadIds, threads],
  );
  const openThreads = useMemo(
    () => anchoredThreads.filter(thread => thread.status === CanvasCommentThreadStatus.OPEN),
    [anchoredThreads],
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

  const activeThreadIdRef = useRef<string | null | undefined>(activeThreadId);
  activeThreadIdRef.current = activeThreadId;
  const badgeDataRef = useRef(threadBadgeData);
  badgeDataRef.current = threadBadgeData;
  const onAnchorClickRef = useRef(onAnchorClick);
  onAnchorClickRef.current = onAnchorClick;
  const scheduleRenderBadgesRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || !container) return;

    container.querySelectorAll<HTMLElement>(COMMENT_THREAD_BADGE_SELECTOR).forEach(badge => {
      if (badge.dataset['canvasCommentBadgeThreadId'] === activeThreadId) {
        badge.dataset['canvasCommentBadgeActive'] = 'true';
      } else {
        delete badge.dataset['canvasCommentBadgeActive'];
      }
    });
  }, [activeThreadId, containerRef, enabled, threadBadgeData]);

  useEffect(() => {
    if (!enabled || !canvasId) {
      onOpenCountChange?.(0);
      onThreadsChange?.([]);
      return;
    }

    onOpenCountChange?.(openThreads.length);
    onThreadsChange?.(anchoredThreads);
  }, [anchoredThreads, canvasId, enabled, onOpenCountChange, onThreadsChange, openThreads.length]);

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

    const findAnchorElement = (thread: CanvasCommentHighlightThread): HTMLElement | null =>
      scrollContainer.querySelector<HTMLElement>(getThreadSelector(thread.id)) ??
      scrollContainer.querySelector<HTMLElement>(getBlockSelector(thread.blockId));

    /**
     * Reconciles badges against the current threads, reusing the existing node for a
     * thread instead of recreating it. Rebuilding would restart the enter animation on
     * every scroll frame and every time a comment lands, which reads as a flicker.
     */
    const renderBadges = (): void => {
      const staleBadges = new Map<string, HTMLButtonElement>();
      scrollContainer
        .querySelectorAll<HTMLButtonElement>(COMMENT_THREAD_BADGE_SELECTOR)
        .forEach(badge => {
          const badgeThreadId = badge.dataset['canvasCommentBadgeThreadId'];
          if (badgeThreadId) staleBadges.set(badgeThreadId, badge);
          else badge.remove();
        });

      const usedTops: number[] = [];
      const scrollRect = scrollContainer.getBoundingClientRect();

      badgeDataRef.current.forEach(({ count, thread }) => {
        const targetElement = findAnchorElement(thread);
        if (!targetElement) return;

        let button = staleBadges.get(thread.id);
        if (button) {
          staleBadges.delete(thread.id);
        } else {
          button = document.createElement('button');
          button.type = 'button';
          button.dataset['canvasCommentThreadBadge'] = 'true';
          button.dataset['canvasCommentBadgeThreadId'] = thread.id;
          button.style.right = '24px';
          button.innerHTML = `
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">
              <path d="M4.4 3.4h11.2a1.7 1.7 0 0 1 1.7 1.7v6.4a1.7 1.7 0 0 1-1.7 1.7H8.2l-3.3 2.8v-2.8h-.5a1.7 1.7 0 0 1-1.7-1.7V5.1a1.7 1.7 0 0 1 1.7-1.7Z"></path>
            </svg>
            <span></span>
          `;
          // Resolve the thread at click time — this node outlives the render that made it.
          button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            const clicked = badgeDataRef.current.find(item => item.thread.id === thread.id);
            if (!clicked) return;
            const clickedElement = findAnchorElement(clicked.thread);
            if (!clickedElement) return;
            onAnchorClickRef.current?.(clicked.thread, clickedElement.getBoundingClientRect());
          });
          scrollContainer.appendChild(button);
        }

        const targetRect = targetElement.getBoundingClientRect();
        const top = getNextBadgeTop(
          targetRect.top -
            scrollRect.top +
            scrollContainer.scrollTop +
            Math.max(0, targetRect.height / 2 - 13),
          usedTops,
        );

        const label = count > 99 ? '99+' : String(count);
        const countElement = button.querySelector('span');
        if (countElement && countElement.textContent !== label) countElement.textContent = label;

        button.dataset['canvasCommentBlockId'] = thread.blockId;
        button.setAttribute('aria-label', `${count} comments in this thread`);
        if (thread.id === activeThreadIdRef.current) {
          button.dataset['canvasCommentBadgeActive'] = 'true';
        } else {
          delete button.dataset['canvasCommentBadgeActive'];
        }
        if (button.style.top !== `${top}px`) button.style.top = `${top}px`;
      });

      staleBadges.forEach(badge => badge.remove());
    };

    let pendingAnimationFrame: number | null = null;
    const scheduleRenderBadges = (): void => {
      if (pendingAnimationFrame !== null) return;
      pendingAnimationFrame = window.requestAnimationFrame(() => {
        pendingAnimationFrame = null;
        renderBadges();
      });
    };

    scheduleRenderBadgesRef.current = scheduleRenderBadges;
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
      scheduleRenderBadgesRef.current = null;
      retryTimeouts.forEach(timeout => window.clearTimeout(timeout));
      scrollContainer.removeEventListener('scroll', scheduleRenderBadges);
      window.removeEventListener('resize', scheduleRenderBadges);
      observer?.disconnect();
      removeBadges();
    };
  }, [canvasId, containerRef, enabled]);

  useEffect(() => {
    scheduleRenderBadgesRef.current?.();
  }, [refreshKey, threadBadgeData]);

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
