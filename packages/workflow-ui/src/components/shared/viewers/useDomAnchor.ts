/**
 * Scroll to a cited passage and highlight it — for any viewer that renders its
 * content into the DOM (text, markdown, json, docx, csv, xlsx).
 *
 * One hook serves all of them because, once rendered, those formats are just
 * text in a subtree. Only PDF (canvas + its own text layer) and images need
 * bespoke handling. So "support a new format" means *render it and stamp a few
 * data attributes* — not write new anchoring logic.
 *
 * The resolution ladder is deliberately the same everywhere:
 *   locator (structural, exact) → quote (fuzzy text search) → nothing
 * and "nothing" is a real outcome: the document still opens, just unhighlighted.
 * Guessing a location would be worse than admitting we couldn't find it.
 */
import { useEffect, useState, type RefObject } from 'react';
import type { Locator } from '@xyne/workflow-sdk/common';
import { findRange } from './anchor-match.js';

// `Locator` is the SDK's — the agent asserts it (copied from a `[source: …]`
// label), so producer, prompt and renderer must all agree on one definition.
export type { Locator } from '@xyne/workflow-sdk/common';

export interface Anchor {
  /** The cited text. The portable anchor — works in any text-bearing renderer. */
  quote?: string | undefined;
  /** Exact structural address, when the source exposed one. */
  locator?: Locator | undefined;
}

const LAYER_ATTR = 'data-wui-anchor-layer';

/** The element a structural locator addresses, via attributes viewers stamp. */
function findByLocator(root: HTMLElement, locator: Locator): HTMLElement | null {
  switch (locator.at) {
    case 'cell':
      return root.querySelector<HTMLElement>(
        `[data-row="${String(locator.row)}"][data-col="${String(locator.col)}"]`,
      );
    case 'line':
      return root.querySelector<HTMLElement>(`[data-line="${String(locator.from)}"]`);
    case 'page':
      // Paged rendering is pdf.js's own concern; DOM viewers have no pages.
      return null;
  }
}

function clearOverlay(container: HTMLElement): void {
  container.querySelectorAll(`[${LAYER_ATTR}]`).forEach((n) => { n.remove(); });
}

/**
 * Paint highlight rectangles over a range.
 *
 * An overlay rather than wrapping the match in `<mark>`: several viewers render
 * content they own (docx-preview rebuilds its subtree, tables re-render), and
 * mutating that DOM corrupts it and gets wiped on the next paint. Rectangles
 * layered on top are non-destructive and behave identically everywhere.
 */
function paintOverlay(container: HTMLElement, rects: DOMRect[]): void {
  if (rects.length === 0) return;
  // The layer is positioned against the container's padding box, so the
  // container must establish a containing block.
  if (getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }
  const base = container.getBoundingClientRect();

  const layer = document.createElement('div');
  layer.setAttribute(LAYER_ATTR, 'true');
  layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:5;';

  for (const r of rects) {
    if (r.width === 0 || r.height === 0) continue;
    const mark = document.createElement('div');
    mark.style.cssText = [
      'position:absolute',
      `left:${String(r.left - base.left + container.scrollLeft)}px`,
      `top:${String(r.top - base.top + container.scrollTop)}px`,
      `width:${String(r.width)}px`,
      `height:${String(r.height)}px`,
      'background:color-mix(in srgb, var(--wui-primary) 26%, transparent)',
      'border-radius:2px',
      'mix-blend-mode:multiply',
    ].join(';');
    layer.appendChild(mark);
  }
  container.appendChild(layer);
}

export interface UseDomAnchorResult {
  /** Whether the anchor was located. `false` ⇒ the doc opened unhighlighted. */
  hit: boolean;
}

/**
 * The container must render its content as React children or be written
 * imperatively (as docx-preview does). A container using
 * `dangerouslySetInnerHTML` re-applies that HTML on re-render and would discard
 * the overlay — a property of that API, not of this hook.
 *
 * @param containerRef the element wrapping the viewer's rendered content
 * @param anchor       what to locate; `undefined` ⇒ do nothing at all
 * @param ready        re-runs the search when this changes — pass whatever
 *                     signals the content has painted (parsed rows, loaded text).
 *                     Searching before paint finds nothing.
 */
export function useDomAnchor(
  containerRef: RefObject<HTMLElement | null>,
  anchor: Anchor | undefined,
  ready?: unknown,
): UseDomAnchorResult {
  const [hit, setHit] = useState(false);

  const quote = anchor?.quote;
  const locator = anchor?.locator;
  // Locators are small and flat; a stable string keeps the effect from re-running
  // on every render just because the object identity changed.
  const locatorKey = locator ? JSON.stringify(locator) : '';

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    clearOverlay(container);
    if (!quote && !locator) {
      setHit(false);
      return;
    }

    let target: { scrollTo: Element; rects: DOMRect[] } | null = null;

    if (locator) {
      const el = findByLocator(container, locator);
      if (el) target = { scrollTo: el, rects: [el.getBoundingClientRect()] };
    }
    if (!target && quote) {
      const range = findRange(container, quote);
      if (range) {
        const rects = Array.from(range.getClientRects());
        const first = range.startContainer.parentElement;
        if (first) target = { scrollTo: first, rects };
      }
    }

    if (!target) {
      setHit(false);
      return;
    }

    paintOverlay(container, target.rects);
    target.scrollTo.scrollIntoView({ block: 'center', inline: 'nearest' });
    setHit(true);

    return () => { clearOverlay(container); };
  }, [containerRef, quote, locatorKey, ready]);

  return { hit };
}
