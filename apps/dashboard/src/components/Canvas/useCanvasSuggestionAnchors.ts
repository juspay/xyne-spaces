import { useCallback, useEffect, type RefObject } from 'react';

/**
 * Connects the suggestions panel to the document.
 *
 * Every suggestion change carries a real block id (its own block for edits
 * and deletes, the landing neighbour for inserts), and BlockNote renders each
 * block with data-id="<uuid>". That join gives three behaviours:
 *
 *   - a coloured rail on every block with a pending change
 *   - card click → scroll to the block, flash it, hold a selection highlight
 *   - block click → tell the panel, so it can expand and focus the card
 *     (the same two-way pattern comment badges use)
 */

const STYLE_ID = 'canvas-suggestion-anchor-style';
const RAIL_ATTR = 'data-canvas-suggestion';

const ensureStyles = (): void => {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    [${RAIL_ATTR}] {
      border-radius: 2px;
      transition: background-color 200ms ease, box-shadow 200ms ease;
      cursor: pointer;
    }
    [${RAIL_ATTR}="pending"]  { box-shadow: -3px 0 0 0 rgba(217, 119, 6, 0.75); }
    [${RAIL_ATTR}="conflict"] { box-shadow: -3px 0 0 0 rgba(220, 38, 38, 0.75); }
    [${RAIL_ATTR}]:hover      { background-color: rgba(251, 191, 36, 0.10); }

    /* persistent selection — held while the card is selected, not a blink */
    [${RAIL_ATTR}][data-canvas-suggestion-active="true"] {
      background-color: rgba(251, 191, 36, 0.22);
      box-shadow: -3px 0 0 0 rgba(217, 119, 6, 1);
    }

    @keyframes canvas-suggestion-flash {
      0%   { background-color: rgba(251, 191, 36, 0.5); }
      100% { background-color: rgba(251, 191, 36, 0.22); }
    }
    [${RAIL_ATTR}][data-canvas-suggestion-flash="true"] {
      animation: canvas-suggestion-flash 700ms ease-out;
    }
    @media (prefers-reduced-motion: reduce) {
      [${RAIL_ATTR}][data-canvas-suggestion-flash="true"] { animation: none; }
    }
  `;
  document.head.appendChild(style);
};

const blockSelector = (blockId: string): string => {
  const escaped =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(blockId)
      : blockId.replace(/["\\]/g, '\\$&');
  return `[data-id="${escaped}"]`;
};

export interface SuggestionAnchor {
  blockId: string | null;
  status: string;
}

export const useCanvasSuggestionAnchors = (
  containerRef: RefObject<HTMLElement | null>,
  anchors: SuggestionAnchor[],
  activeBlockId: string | null,
  /** Fired when the user clicks a railed block in the document. */
  onBlockClick?: (blockId: string) => void,
): { scrollToBlock: (blockId: string | null) => void } => {
  // Paint rails + persistent selection on anchored blocks.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    ensureStyles();

    const applied: HTMLElement[] = [];
    for (const anchor of anchors) {
      if (!anchor.blockId) continue;
      const el = container.querySelector<HTMLElement>(blockSelector(anchor.blockId));
      if (!el) continue;
      el.setAttribute(RAIL_ATTR, anchor.status === 'CONFLICT' ? 'conflict' : 'pending');
      if (anchor.blockId === activeBlockId) {
        el.setAttribute('data-canvas-suggestion-active', 'true');
      } else {
        el.removeAttribute('data-canvas-suggestion-active');
      }
      applied.push(el);
    }

    return () => {
      for (const el of applied) {
        el.removeAttribute(RAIL_ATTR);
        el.removeAttribute('data-canvas-suggestion-active');
      }
    };
  }, [containerRef, anchors, activeBlockId]);

  // Block click → surface the card. Delegated on the container so it costs
  // one listener regardless of how many blocks are railed, and survives
  // BlockNote re-rendering block elements.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onBlockClick) return;

    const handleClick = (event: MouseEvent): void => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(`[${RAIL_ATTR}]`);
      if (!target || !container.contains(target)) return;
      const blockId = target.getAttribute('data-id');
      if (blockId) onBlockClick(blockId);
    };

    container.addEventListener('click', handleClick);
    return () => container.removeEventListener('click', handleClick);
  }, [containerRef, onBlockClick]);

  const scrollToBlock = useCallback(
    (blockId: string | null) => {
      const container = containerRef.current;
      if (!container || !blockId) return;
      const el = container.querySelector<HTMLElement>(blockSelector(blockId));
      if (!el) return;

      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.removeAttribute('data-canvas-suggestion-flash');
      void el.offsetWidth;
      el.setAttribute('data-canvas-suggestion-flash', 'true');
      window.setTimeout(() => el.removeAttribute('data-canvas-suggestion-flash'), 800);
    },
    [containerRef],
  );

  return { scrollToBlock };
};
