import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';

/** Vertical breathing room between two cards that would otherwise overlap. */
const CARD_GAP = 8;
/** Used until a card has been measured, so the first paint is roughly right. */
const ESTIMATED_CARD_HEIGHT = 132;
/** Below this width the panel covers the document, so aligning to it is meaningless. */
const ALIGNED_VIEWPORT_QUERY = '(min-width: 768px)';
/** Space kept under the last card so it never sits flush against the panel edge. */
const RAIL_BOTTOM_SPACE = 24;

export interface CanvasCommentRailThread {
  id: string;
  blockId: string;
}

interface UseCanvasCommentRailOptions {
  /** The canvas editor container; the rail measures anchors inside its scroller. */
  anchorContainerRef?: RefObject<HTMLElement | null> | undefined;
  /** The panel's own scroll container, kept in step with the document. */
  railScrollRef: RefObject<HTMLElement | null>;
  /**
   * The track the cards are absolutely positioned in. Its origin is compared against the
   * document's so the panel's own chrome — header, filter strip, padding — cannot shift every
   * card down by a constant amount.
   */
  railTrackRef: RefObject<HTMLElement | null>;
  threads: CanvasCommentRailThread[];
  enabled: boolean;
}

export interface CanvasCommentRail {
  /** False when anchors cannot be measured — the caller falls back to a plain list. */
  isAligned: boolean;
  /** Height of the rail track: tall enough for the document and for every card. */
  trackHeight: number;
  /** Final top offset per thread, after resolving overlaps. */
  cardTops: Record<string, number>;
  registerCard: (threadId: string, element: HTMLElement | null) => void;
}

const escapeSelectorValue = (value: string): string =>
  typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(value)
    : value.replace(/["\\]/g, '\\$&');

const areOffsetsEqual = (a: Record<string, number>, b: Record<string, number>): boolean => {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  // Sub-pixel jitter from layout should not trigger a re-render.
  return aKeys.every(key => key in b && Math.abs((a[key] ?? 0) - (b[key] ?? 0)) < 0.5);
};

/**
 * Positions comment cards beside the text they annotate, the way Google Docs does: each card
 * starts at its anchor's vertical offset, and cards that would overlap are pushed down. The
 * rail spans the document's scroll range, and the two columns scroll together — dragging
 * either one moves the other.
 */
export const useCanvasCommentRail = ({
  anchorContainerRef,
  railScrollRef,
  railTrackRef,
  threads,
  enabled,
}: UseCanvasCommentRailOptions): CanvasCommentRail => {
  const [anchorTops, setAnchorTops] = useState<Record<string, number>>({});
  const [cardHeights, setCardHeights] = useState<Record<string, number>>({});
  /** Track height needed for the rail to travel as far as the document can scroll. */
  const [documentTrackHeight, setDocumentTrackHeight] = useState(0);
  const [isWideViewport, setIsWideViewport] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(ALIGNED_VIEWPORT_QUERY).matches,
  );

  const cardElementsRef = useRef<Map<string, HTMLElement>>(new Map());
  const cardObserverRef = useRef<ResizeObserver | null>(null);

  // Threads arrive as a fresh array on every query update; key on content so the measuring
  // effect only restarts when the set of anchors actually changes.
  const threadsKey = threads.map(thread => `${thread.id}:${thread.blockId}`).join('|');
  const threadsRef = useRef(threads);
  threadsRef.current = threads;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const query = window.matchMedia(ALIGNED_VIEWPORT_QUERY);
    const handleChange = (): void => setIsWideViewport(query.matches);
    handleChange();
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  const isAlignmentActive = enabled && isWideViewport;

  useEffect(() => {
    if (!isAlignmentActive || typeof window === 'undefined') return;

    const container = anchorContainerRef?.current;
    if (!container) return;

    const scrollContainer = container.querySelector<HTMLElement>('.thin-scrollbar') ?? container;

    const measure = (): void => {
      const trackElement = railTrackRef.current;
      const railElement = railScrollRef.current;
      if (!trackElement || !railElement) return;

      const scrollRect = scrollContainer.getBoundingClientRect();
      const trackRect = trackElement.getBoundingClientRect();

      // Anchor offsets are in the document's coordinate space, but the cards live in the track,
      // which starts lower — below the panel's header and filter strip, and without the editor's
      // top padding. Without this correction every card is off by that constant.
      //
      // Both terms are taken at scroll 0 so the delta cannot drift as either column scrolls:
      // a scroll container's own box does not move (only its content does), while the track is
      // content, so its rect has already been displaced by -scrollTop and has to add it back.
      const documentContainerTop = scrollRect.top;
      const trackOriginTop = trackRect.top + railElement.scrollTop;
      const originDelta = documentContainerTop - trackOriginTop;

      const nextAnchorTops: Record<string, number> = {};

      threadsRef.current.forEach(thread => {
        const anchorElement =
          scrollContainer.querySelector<HTMLElement>(
            `[data-canvas-comment-thread-id="${escapeSelectorValue(thread.id)}"]`,
          ) ??
          scrollContainer.querySelector<HTMLElement>(
            `[data-id="${escapeSelectorValue(thread.blockId)}"]`,
          );
        if (!anchorElement) return;

        // getClientRects()[0] is the first line of a wrapped anchor; getBoundingClientRect
        // returns the union box, which drags the card down to the middle of a multi-line run.
        const anchorRect =
          anchorElement.getClientRects()[0] ?? anchorElement.getBoundingClientRect();
        const documentOffset = anchorRect.top - scrollRect.top + scrollContainer.scrollTop;
        nextAnchorTops[thread.id] = Math.max(0, documentOffset + originDelta);
      });

      setAnchorTops(current =>
        areOffsetsEqual(current, nextAnchorTops) ? current : nextAnchorTops,
      );

      // How much scroll travel the rail needs to keep step with the document. The cards alone
      // cannot supply it: a filter that leaves one card standing collapses the track, and the
      // rail then clamps at scrollTop 0 while the canvas scrolls out from under that card.
      const railRect = railElement.getBoundingClientRect();
      const trackOffsetWithinRail = trackRect.top + railElement.scrollTop - railRect.top;
      const documentScrollRange = Math.max(
        0,
        scrollContainer.scrollHeight - scrollContainer.clientHeight,
      );
      const nextDocumentTrackHeight = Math.max(
        0,
        documentScrollRange + railElement.clientHeight - trackOffsetWithinRail,
      );
      setDocumentTrackHeight(current =>
        Math.abs(current - nextDocumentTrackHeight) < 1 ? current : nextDocumentTrackHeight,
      );
    };

    let pendingAnimationFrame: number | null = null;
    const scheduleMeasure = (): void => {
      if (pendingAnimationFrame !== null) return;
      pendingAnimationFrame = window.requestAnimationFrame(() => {
        pendingAnimationFrame = null;
        measure();
      });
    };

    scheduleMeasure();
    // The editor paints its content in stages; re-measure until it settles.
    const retryTimeouts = [100, 300, 800].map(delay => window.setTimeout(scheduleMeasure, delay));

    scrollContainer.addEventListener('scroll', scheduleMeasure, { passive: true });
    // The panel scrolls on its own, so its scroll moves the track and the origins must be
    // re-read — the offsets themselves are scroll-invariant, this only keeps them accurate.
    const railScrollElement = railScrollRef.current;
    railScrollElement?.addEventListener('scroll', scheduleMeasure, { passive: true });
    window.addEventListener('resize', scheduleMeasure);

    const observedEditor = scrollContainer.querySelector<HTMLElement>('.bn-editor');
    const mutationObserver =
      observedEditor && typeof MutationObserver !== 'undefined'
        ? new MutationObserver(scheduleMeasure)
        : null;
    if (mutationObserver && observedEditor) {
      mutationObserver.observe(observedEditor, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['data-id', 'data-canvas-comment-thread-id'],
      });
    }

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleMeasure) : null;
    resizeObserver?.observe(scrollContainer);

    return () => {
      if (pendingAnimationFrame !== null) window.cancelAnimationFrame(pendingAnimationFrame);
      retryTimeouts.forEach(timeout => window.clearTimeout(timeout));
      scrollContainer.removeEventListener('scroll', scheduleMeasure);
      railScrollElement?.removeEventListener('scroll', scheduleMeasure);
      window.removeEventListener('resize', scheduleMeasure);
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
    };
  }, [anchorContainerRef, isAlignmentActive, railScrollRef, railTrackRef, threadsKey]);

  /**
   * Scrolling the canvas carries the panel with it, so cards stay beside their paragraphs.
   * The link is deliberately one-way: the panel remains its own scroll container, so comments
   * can be browsed without dragging the document along. The next canvas scroll re-levels them.
   */
  useEffect(() => {
    if (!isAlignmentActive || typeof window === 'undefined') return;

    const container = anchorContainerRef?.current;
    const railElement = railScrollRef.current;
    if (!container || !railElement) return;

    const documentElement = container.querySelector<HTMLElement>('.thin-scrollbar') ?? container;

    const handleDocumentScroll = (): void => {
      const target = documentElement.scrollTop;
      if (Math.abs(railElement.scrollTop - target) < 1) return;
      railElement.scrollTop = target;
    };

    documentElement.addEventListener('scroll', handleDocumentScroll, { passive: true });
    return () => documentElement.removeEventListener('scroll', handleDocumentScroll);
  }, [anchorContainerRef, isAlignmentActive, railScrollRef]);

  const getCardObserver = useCallback((): ResizeObserver | null => {
    if (typeof ResizeObserver === 'undefined') return null;
    if (!cardObserverRef.current) {
      cardObserverRef.current = new ResizeObserver(entries => {
        setCardHeights(current => {
          let next = current;
          entries.forEach(entry => {
            const threadId = (entry.target as HTMLElement).dataset['canvasCommentCardThreadId'];
            if (!threadId) return;
            const height = entry.contentRect.height;
            if (Math.abs((current[threadId] ?? 0) - height) < 0.5) return;
            if (next === current) next = { ...current };
            next[threadId] = height;
          });
          return next;
        });
      });
    }
    return cardObserverRef.current;
  }, []);

  const registerCard = useCallback(
    (threadId: string, element: HTMLElement | null): void => {
      const observer = getCardObserver();
      const elements = cardElementsRef.current;
      const previous = elements.get(threadId);

      if (previous && previous !== element) {
        observer?.unobserve(previous);
        elements.delete(threadId);
      }

      if (element) {
        element.dataset['canvasCommentCardThreadId'] = threadId;
        elements.set(threadId, element);
        observer?.observe(element);
      }
    },
    [getCardObserver],
  );

  useEffect(
    () => () => {
      cardObserverRef.current?.disconnect();
      cardObserverRef.current = null;
      cardElementsRef.current.clear();
    },
    [],
  );

  const { cardTops, contentBottom } = useMemo(() => {
    const ordered = [...threads]
      .filter(thread => anchorTops[thread.id] !== undefined)
      .sort((a, b) => (anchorTops[a.id] ?? 0) - (anchorTops[b.id] ?? 0));

    const tops: Record<string, number> = {};
    let previousBottom = Number.NEGATIVE_INFINITY;
    let lowestBottom = 0;

    ordered.forEach(thread => {
      const top = Math.max(anchorTops[thread.id] ?? 0, previousBottom + CARD_GAP);
      tops[thread.id] = top;
      previousBottom = top + (cardHeights[thread.id] ?? ESTIMATED_CARD_HEIGHT);
      lowestBottom = previousBottom;
    });

    return { cardTops: tops, contentBottom: lowestBottom };
  }, [anchorTops, cardHeights, threads]);

  return {
    isAligned: isAlignmentActive && Object.keys(cardTops).length > 0,
    // Sized to the cards, but floored at the document's scroll range so both columns always
    // have the same travel — otherwise a filter showing a single card leaves the panel with no
    // scroll range, pinning that card while the canvas scrolls away beneath its anchor. Never
    // capped by the document height either, so a stack pushed past the document's end still
    // scrolls fully into view.
    trackHeight: Math.max(contentBottom + RAIL_BOTTOM_SPACE, documentTrackHeight),
    cardTops,
    registerCard,
  };
};
