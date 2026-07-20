import { useEffect, useState } from 'react';
import { useFileSearchContext } from './FileSearchContext';
import { getVisibleRect } from './scrollUtils';
import { buildMatcher, findMatchesInText } from './searchEngine';
import { MAX_MATCHES, MIN_QUERY_LENGTH } from './types';

// CSS Custom Highlight API registry names (styled in global.css via
// ::highlight(...)). Used for the full-DOM viewers (DOCX) where the content is
// third-party markup we must not mutate — highlights paint over the live DOM
// without inserting <mark> nodes.
const ALL_HIGHLIGHT = 'xyne-find';
const ACTIVE_HIGHLIGHT = 'xyne-find-active';

const highlightApiAvailable = (): boolean =>
  typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';

const clearHighlights = (): void => {
  if (!highlightApiAvailable()) return;
  CSS.highlights.delete(ALL_HIGHLIGHT);
  CSS.highlights.delete(ACTIVE_HIGHLIGHT);
};

interface TextIndex {
  nodes: Text[];
  /** starts[i] = character offset of nodes[i] within the concatenated text. */
  starts: number[];
  text: string;
}

const collectTextNodes = (root: HTMLElement): TextIndex => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style') return NodeFilter.FILTER_REJECT;
      if (!(node as Text).nodeValue) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = '';
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const textNode = node as Text;
    starts.push(text.length);
    nodes.push(textNode);
    text += textNode.nodeValue;
  }
  return { nodes, starts, text };
};

/** Last index whose start offset is <= pos (binary search over `starts`). */
const nodeIndexForOffset = (starts: number[], pos: number): number => {
  let lo = 0;
  let hi = starts.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((starts[mid] ?? 0) <= pos) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
};

/** A DOM Range spanning [start, end) in the concatenated text, across nodes. */
const rangeForMatch = (index: TextIndex, start: number, end: number): Range | null => {
  const startIdx = nodeIndexForOffset(index.starts, start);
  const endIdx = nodeIndexForOffset(index.starts, end - 1);
  const startNode = index.nodes[startIdx];
  const endNode = index.nodes[endIdx];
  if (!startNode || !endNode) return null;
  try {
    const range = document.createRange();
    range.setStart(startNode, start - (index.starts[startIdx] ?? 0));
    range.setEnd(endNode, end - (index.starts[endIdx] ?? 0));
    return range;
  } catch {
    return null;
  }
};

const findScrollableAncestor = (start: HTMLElement | null): HTMLElement | null => {
  let node: HTMLElement | null = start;
  while (node && node !== document.body) {
    const overflowY = window.getComputedStyle(node).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
};

/** Centre a range in its scrollable ancestor's visible band. Instant, not smooth. */
const scrollRangeIntoView = (range: Range): void => {
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;
  const el =
    range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : (range.startContainer as HTMLElement);
  const scroller = findScrollableAncestor(el);
  if (!scroller) return;
  const view = getVisibleRect(scroller);
  const viewHeight = view.bottom - view.top;
  if (viewHeight <= 0) return;
  if (rect.top < view.top || rect.bottom > view.bottom) {
    scroller.scrollTop += rect.top - view.top - (viewHeight - rect.height) / 2;
  }
};

/**
 * Search over a full-DOM (non-virtualized) viewer via the CSS Custom Highlight
 * API. For DOCX: docx-preview renders the whole document into the DOM, so text
 * extraction + DOM Ranges find every match, and highlights paint over the
 * third-party markup without mutating it.
 *
 * `contentReady` should flip true once the viewer has finished rendering (and
 * change if it re-renders) so ranges are rebuilt against the final DOM.
 */
export const useDomSearch = (
  containerRef: React.RefObject<HTMLElement | null>,
  contentReady: boolean,
): void => {
  const search = useFileSearchContext();
  const registerTarget = search?.registerTarget;
  const reportTotal = search?.reportTotal;

  const [ranges, setRanges] = useState<Range[]>([]);

  useEffect(() => {
    if (!contentReady || !registerTarget) return;
    return registerTarget();
  }, [contentReady, registerTarget]);

  const query = search?.query ?? '';
  const options = search?.options;
  const activeIndex = search?.activeIndex ?? 0;
  const isSearchActive = Boolean(
    contentReady && search && query.length >= MIN_QUERY_LENGTH && options,
  );

  // Build ranges + paint the "all matches" highlight whenever the query, options
  // or rendered content change.
  useEffect(() => {
    if (!highlightApiAvailable()) return;
    const container = containerRef.current;
    if (!isSearchActive || !container || !options) {
      setRanges([]);
      clearHighlights();
      reportTotal?.(0);
      return;
    }

    const index = collectTextNodes(container);
    const matcher = buildMatcher(query, options);
    const found: Range[] = [];
    if (matcher) {
      findMatchesInText(index.text, matcher, (start, end) => {
        const range = rangeForMatch(index, start, end);
        if (range) found.push(range);
        return found.length < MAX_MATCHES;
      });
    }

    setRanges(found);
    CSS.highlights.set(ALL_HIGHLIGHT, new Highlight(...found));
    reportTotal?.(found.length);
  }, [isSearchActive, query, options, contentReady, containerRef, reportTotal]);

  // Paint the active match separately (on top) and scroll it into view.
  useEffect(() => {
    if (!highlightApiAvailable()) return;
    const active = ranges[activeIndex];
    if (!active) {
      CSS.highlights.delete(ACTIVE_HIGHLIGHT);
      return;
    }
    CSS.highlights.set(ACTIVE_HIGHLIGHT, new Highlight(active));
    scrollRangeIntoView(active);
  }, [ranges, activeIndex]);

  // Clear the global registry when this viewer goes away.
  useEffect(() => clearHighlights, []);
};
