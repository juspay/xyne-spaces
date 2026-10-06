import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnnotateTransport, CommentMark, TransportEvents } from './transport';
import type { CommentAnchor } from '../itemComments';

const MARK_ATTR = 'data-xyne-comment-mark';
const ANCHOR_ATTR = 'data-xyne-comment-anchor';
const STYLE_ID = 'xyne-annotate-style';

const STYLE = `[${ANCHOR_ATTR}]{background-color:rgba(245,196,76,0.16);box-shadow:inset 3px 0 0 rgba(245,196,76,0.9)}
[${MARK_ATTR}]{position:absolute;z-index:40;width:20px;height:20px;border-radius:999px;background:#f5c44c;color:#1a1a1a;font:600 11px/20px -apple-system,system-ui,sans-serif;text-align:center;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,0.35)}`;

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);
}

function pickable(target: EventTarget | null, root: HTMLElement): HTMLElement | null {
  let node = target as HTMLElement | null;
  for (let depth = 0; depth < 4 && node && node !== root; depth += 1) {
    const rect = node.getBoundingClientRect();
    const text = (node.innerText || '').trim();
    if (rect.width > 40 && rect.height > 12 && text.length > 1) return node;
    node = node.parentElement;
  }
  return node && node !== root ? node : null;
}

function selectorFor(el: HTMLElement, root: HTMLElement): string {
  const parts: string[] = [];
  let node: HTMLElement | null = el;
  while (node && node !== root && parts.length < 5) {
    let part = node.tagName.toLowerCase();
    if (node.id) {
      parts.unshift(`${part}#${node.id}`);
      break;
    }
    const parent: HTMLElement | null = node.parentElement;
    if (parent) {
      const same = [...parent.children].filter(child => child.tagName === node?.tagName);
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    node = parent;
  }
  return parts.join(' > ');
}

function findIn(
  root: HTMLElement,
  mark: { selector?: string; quote?: string },
): HTMLElement | null {
  if (mark.selector) {
    try {
      const bySelector = root.querySelector<HTMLElement>(mark.selector);
      if (bySelector) return bySelector;
    } catch {
      /* a selector from another document shape; fall back to the quote */
    }
  }
  const needle = (mark.quote ?? '').trim().slice(0, 80);
  if (!needle) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if ((node.textContent ?? '').includes(needle)) return node.parentElement;
  }
  return null;
}

/**
 * The content is rendered by this app in its own DOM — a markdown page, a pdf
 * viewer, an image. Picking and marking happen directly on the nodes, so no
 * script has to reach into anything.
 */
export function useDomTransport(
  root: HTMLElement | null,
  events: TransportEvents,
): AnnotateTransport {
  const [picking, setPicking] = useState(false);
  const handlers = useRef(events);
  handlers.current = events;
  const outline = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (root) ensureStyle();
  }, [root]);

  useEffect(() => {
    if (!root || !picking) return;

    const highlight = (el: HTMLElement | null): void => {
      if (outline.current) outline.current.style.outline = '';
      outline.current = el;
      if (el) el.style.outline = '2px solid #4c8bf5';
    };

    const onMove = (event: MouseEvent): void => highlight(pickable(event.target, root));
    const onClick = (event: MouseEvent): void => {
      const el = pickable(event.target, root);
      if (!el) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = el.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      const selection = window.getSelection()?.toString() ?? '';
      highlight(null);
      handlers.current.onPick({
        selector: selectorFor(el, root),
        text: (selection.trim() || el.innerText || '').trim().slice(0, 4000),
        rect: {
          top: rect.top - rootRect.top,
          left: rect.left - rootRect.left,
          width: rect.width,
          height: rect.height,
        },
      });
    };

    root.addEventListener('mousemove', onMove, true);
    root.addEventListener('click', onClick, true);
    return () => {
      highlight(null);
      root.removeEventListener('mousemove', onMove, true);
      root.removeEventListener('click', onClick, true);
    };
  }, [root, picking]);

  const paintMarks = useCallback(
    (marks: readonly CommentMark[]): void => {
      if (!root) return;
      root.querySelectorAll(`[${MARK_ATTR}]`).forEach(node => node.remove());
      root.querySelectorAll(`[${ANCHOR_ATTR}]`).forEach(node => node.removeAttribute(ANCHOR_ATTR));
      if (getComputedStyle(root).position === 'static') root.style.position = 'relative';

      const counts = new Map<HTMLElement, HTMLElement>();
      for (const mark of marks) {
        const el = findIn(root, mark);
        if (!el) continue;
        el.setAttribute(ANCHOR_ATTR, '1');
        const existing = counts.get(el);
        if (existing) {
          existing.textContent = String(Number(existing.textContent ?? '1') + 1);
          continue;
        }
        const rect = el.getBoundingClientRect();
        const rootRect = root.getBoundingClientRect();
        const badge = document.createElement('div');
        badge.setAttribute(MARK_ATTR, '1');
        badge.textContent = '1';
        badge.title = mark.body || 'Comment';
        badge.style.top = `${rect.top - rootRect.top + root.scrollTop + 2}px`;
        badge.style.left = `${Math.max(2, rect.left - rootRect.left - 26)}px`;
        badge.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          handlers.current.onMarkClick(mark.id);
        });
        root.appendChild(badge);
        counts.set(el, badge);
      }
    },
    [root],
  );

  const reveal = useCallback(
    (anchor: CommentAnchor): void => {
      if (!root) return;
      const el = findIn(root, anchor);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const previous = el.style.cssText;
      el.style.backgroundColor = 'rgba(76,139,245,0.22)';
      el.style.boxShadow = '0 0 0 3px rgba(76,139,245,0.45)';
      setTimeout(() => {
        el.style.cssText = previous;
      }, 2000);
    },
    [root],
  );

  return {
    ready: Boolean(root),
    setPicking,
    paintMarks,
    reveal,
  };
}
