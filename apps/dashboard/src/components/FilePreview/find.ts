/**
 * Find in a preview: the frame owns the find bar, its shortcuts and its count; a
 * previewer that has text to search lends it a FindProvider through
 * usePreviewFind, and searches in its own terms — lines, cells, a page's text.
 * A previewer with nothing to search (an image, a video) lends none, and the frame
 * offers no find.
 */
export interface FindProvider {
  /** Looks for the query, case aside; says how many places it is found. */
  search: (query: string) => number | Promise<number>;
  /** Shows the match at this place in the order, and marks it the current one. */
  reveal: (index: number) => void;
  /** Takes every mark down: the bar was closed, or the query emptied. */
  clear: () => void;
}

/** The highlight names the app's own find styles paint (global.css). */
const MATCHES = 'xyne-find';
const CURRENT = 'xyne-find-active';
/** Past this many, the rest are not marked: a page of one letter is still one page. */
const MATCH_LIMIT = 5000;

const supportsHighlights = (): boolean => typeof CSS !== 'undefined' && 'highlights' in CSS;

/**
 * A finder over a drawn page's text — rendered Markdown — marking matches with the
 * CSS Custom Highlight API, so the page's own markup is never touched. A match
 * spanning two elements (half in bold) is not found; one inside either is.
 */
export function createDomFinder(root: () => HTMLElement | null): FindProvider {
  let ranges: Range[] = [];
  const clear = (): void => {
    ranges = [];
    if (!supportsHighlights()) return;
    CSS.highlights.delete(MATCHES);
    CSS.highlights.delete(CURRENT);
  };
  return {
    search(query) {
      clear();
      const element = root();
      const needle = query.toLowerCase();
      if (!element || !needle) return 0;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (
        let node = walker.nextNode();
        node && ranges.length < MATCH_LIMIT;
        node = walker.nextNode()
      ) {
        const text = (node.textContent ?? '').toLowerCase();
        for (
          let at = text.indexOf(needle);
          at !== -1;
          at = text.indexOf(needle, at + needle.length)
        ) {
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + needle.length);
          ranges.push(range);
        }
      }
      if (supportsHighlights() && ranges.length > 0) {
        CSS.highlights.set(MATCHES, new Highlight(...ranges));
      }
      return ranges.length;
    },
    reveal(index) {
      const range = ranges[index];
      if (!range) return;
      if (supportsHighlights()) {
        const current = new Highlight(range);
        current.priority = 1;
        CSS.highlights.set(CURRENT, current);
      }
      range.startContainer.parentElement?.scrollIntoView({ block: 'center' });
    },
    clear,
  };
}
