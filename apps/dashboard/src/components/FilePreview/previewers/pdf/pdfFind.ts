import type { PDFDocumentProxy } from 'pdfjs-dist';
import { findPattern, scrollRangeIntoView, type FindProvider } from '../../find';
import { pageText } from './pdfjs';

/**
 * Highlight names of their own: the page's text lies over its drawing, so a match is
 * tinted, not painted over as the app's opaque find colours would (PdfPreview's styles).
 */
export const PDF_MATCHES = 'xyne-pdf-find';
export const PDF_CURRENT = 'xyne-pdf-find-active';

/** Past this many, the rest are not counted: a search for one letter is still one search. */
const MATCH_LIMIT = 5000;
/** Pages read for their text at once: enough to keep the worker busy, few enough to stop. */
const PAGES_AT_ONCE = 16;

const supportsHighlights = (): boolean => typeof CSS !== 'undefined' && 'highlights' in CSS;

/** A match as counted: its page, and which of that page's matches it is. */
interface Match {
  page: number;
  nth: number;
}

interface TextPiece {
  node: Text;
  /** Where its text starts in the page's. */
  at: number;
}

/** The text node holding a place in the page's text: the one it falls in, or the one it
 *  ends when it closes a match. */
function pieceAt(
  pieces: readonly TextPiece[],
  offset: number,
  closing: boolean,
): { node: Text; offset: number } | null {
  let low = 0;
  let high = pieces.length - 1;
  let hit = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const piece = pieces[middle];
    if (piece && (closing ? piece.at < offset : piece.at <= offset)) {
      hit = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  const piece = pieces[hit];
  if (!piece) return null;
  const within = offset - piece.at;
  return within <= piece.node.data.length ? { node: piece.node, offset: within } : null;
}

export interface PdfFinder extends FindProvider {
  /** A page's text layer was drawn, or drawn again: its matches are marked. */
  pageTextDrawn: (pageNumber: number) => void;
}

/**
 * Find in a PDF. Matches are counted over every page's text, so the count is the
 * document's, not the few pages drawn; they are marked — CSS highlights over the
 * text layer, so a match running across pieces of text is still one — on the pages
 * drawn, and on each page as it is drawn. Showing one on a page not drawn yet
 * scrolls to that page, and to the match once the page has drawn.
 */
export function createPdfFinder(options: {
  document: PDFDocumentProxy;
  /** The scrolling element the pages are drawn in. */
  root: () => HTMLElement | null;
  /** Brings a page into view, so it draws. */
  showPage: (pageNumber: number) => void;
}): PdfFinder {
  const { document: pdf } = options;
  const texts = new Map<number, Promise<string>>();
  const textOf = (page: number): Promise<string> => {
    let text = texts.get(page);
    if (!text) {
      text = pageText(pdf, page);
      texts.set(page, text);
    }
    return text;
  };

  let pattern: RegExp | null = null;
  let matches: Match[] = [];
  /** Each drawn page's matches, as ranges over its text layer. */
  const marked = new Map<number, Range[]>();
  let current: number | null = null;
  /** A match shown on a page that hadn't drawn: scrolled to once it has. */
  let pending: number | null = null;
  /** Bumped by each search and clear, so an older one still reading pages stops. */
  let generation = 0;

  const textLayer = (page: number): HTMLElement | null =>
    options.root()?.querySelector<HTMLElement>(`.page[data-page-number="${page}"] .textLayer`) ??
    null;

  const currentRange = (): Range | undefined => {
    const match = current === null ? undefined : matches[current];
    return match && marked.get(match.page)?.[match.nth];
  };

  const paint = (): void => {
    if (!supportsHighlights()) return;
    const ranges = [...marked.values()].flat();
    if (ranges.length > 0) CSS.highlights.set(PDF_MATCHES, new Highlight(...ranges));
    else CSS.highlights.delete(PDF_MATCHES);
    const range = currentRange();
    if (range) {
      const highlight = new Highlight(range);
      highlight.priority = 1;
      CSS.highlights.set(PDF_CURRENT, highlight);
    } else {
      CSS.highlights.delete(PDF_CURRENT);
    }
  };

  /** Marks a drawn page's matches; leaves a page not drawn unmarked. */
  const mark = (page: number): void => {
    const layer = textLayer(page);
    if (!layer || !pattern) {
      marked.delete(page);
      return;
    }
    // The layer's text as the page's: each piece in order, a line break at each <br>.
    const pieces: TextPiece[] = [];
    let text = '';
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node instanceof Text) {
        pieces.push({ node, at: text.length });
        text += node.data;
      } else if (node.nodeName === 'BR') {
        text += '\n';
      }
    }
    const ranges: Range[] = [];
    pattern.lastIndex = 0;
    for (let found = pattern.exec(text); found; found = pattern.exec(text)) {
      const start = pieceAt(pieces, found.index, false);
      const end = pieceAt(pieces, found.index + found[0].length, true);
      if (!start || !end) continue;
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      ranges.push(range);
    }
    marked.set(page, ranges);
  };

  const clear = (): void => {
    generation += 1;
    pattern = null;
    matches = [];
    marked.clear();
    current = null;
    pending = null;
    if (!supportsHighlights()) return;
    CSS.highlights.delete(PDF_MATCHES);
    CSS.highlights.delete(PDF_CURRENT);
  };

  return {
    async search(query) {
      clear();
      if (!query) return 0;
      const searching = generation;
      const searchPattern = findPattern(query);
      const found: Match[] = [];
      for (
        let first = 1;
        first <= pdf.numPages && found.length < MATCH_LIMIT;
        first += PAGES_AT_ONCE
      ) {
        const pages = Array.from(
          { length: Math.min(PAGES_AT_ONCE, pdf.numPages - first + 1) },
          (_, index) => first + index,
        );
        const pageTexts = await Promise.all(pages.map(textOf));
        if (searching !== generation) return 0;
        pageTexts.forEach((text, index) => {
          const page = pages[index] ?? first;
          searchPattern.lastIndex = 0;
          let nth = 0;
          for (
            let match = searchPattern.exec(text);
            match && found.length < MATCH_LIMIT;
            match = searchPattern.exec(text)
          ) {
            found.push({ page, nth });
            nth += 1;
          }
        });
      }
      pattern = searchPattern;
      matches = found;
      // The pages drawn now; the rest are marked as they draw.
      for (const pageElement of options
        .root()
        ?.querySelectorAll<HTMLElement>('.page[data-page-number]') ?? []) {
        mark(Number(pageElement.dataset['pageNumber']));
      }
      paint();
      return matches.length;
    },
    reveal(index) {
      const match = matches[index];
      if (!match) return;
      current = index;
      if (!marked.has(match.page)) mark(match.page);
      const range = currentRange();
      paint();
      if (range) {
        pending = null;
        scrollRangeIntoView(range);
      } else {
        pending = index;
        options.showPage(match.page);
      }
    },
    clear,
    pageTextDrawn(page) {
      if (!pattern) return;
      mark(page);
      paint();
      const waiting = pending === null ? undefined : matches[pending];
      if (waiting?.page !== page) return;
      pending = null;
      const range = currentRange();
      if (range) scrollRangeIntoView(range);
    },
  };
}
