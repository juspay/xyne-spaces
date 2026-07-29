import type { HighlightRange } from './types';

export const MATCH_CLASS = 'xyne-find-match';
export const ACTIVE_MATCH_CLASS = 'xyne-find-match xyne-find-match--active';
export const ACTIVE_MATCH_ATTR = 'data-xyne-find-active';
/**
 * Set on the grid cell that holds the active match. Grid cells clip their
 * content (`overflow-hidden text-ellipsis`), so a match past the ellipsis has a
 * layout position far outside the visible cell — centring on the <mark> would
 * scroll to empty space. Grids reveal the cell instead, and outline it so the
 * user can see which cell matched even when the text itself is clipped.
 */
export const ACTIVE_CELL_ATTR = 'data-xyne-find-active-cell';

/**
 * Anchored so `exec` only matches an entity that starts exactly at lastIndex.
 * The sticky flag lets us test in place instead of allocating a slice per char.
 */
const ENTITY_AT = /&(?:#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/y;

const openTag = (range: HighlightRange): string =>
  range.isActive
    ? `<mark class="${ACTIVE_MATCH_CLASS}" ${ACTIVE_MATCH_ATTR}="true">`
    : `<mark class="${MATCH_CLASS}">`;

/**
 * Wraps `ranges` in <mark> inside a highlight.js-produced HTML line.
 *
 * CodeViewer stores each line as HTML (hljs <span> tokens, entity-escaped), so
 * match offsets — which come from the plain-text shadow copy — do not line up
 * with string offsets in the HTML. This walks the HTML while tracking the
 * plain-text offset, treating any tag as zero-width and any entity (`&amp;`)
 * as exactly one character.
 *
 * A match can start inside one hljs span and end inside another. Rather than
 * emit invalid nesting (`<span><mark>x</span></mark>`), the mark is closed
 * before every tag boundary and reopened after it — visually identical,
 * structurally valid.
 *
 * Only <mark> tags are inserted; the query is never interpolated into the HTML.
 */
export const injectMarks = (html: string, ranges: HighlightRange[]): string => {
  if (!ranges.length || !html) return html;

  const sorted = ranges.filter(range => range.end > range.start).sort((a, b) => a.start - b.start);
  if (!sorted.length) return html;

  let out = '';
  let htmlPos = 0;
  let textOffset = 0;
  let nextRange = 0;
  let current: HighlightRange | null = null;
  let isMarkOpen = false;

  const closeMark = (): void => {
    if (!isMarkOpen) return;
    out += '</mark>';
    isMarkOpen = false;
  };

  while (htmlPos < html.length) {
    if (current && textOffset >= current.end) {
      closeMark();
      current = null;
    }

    // Drop ranges that overlap one already emitted so marks never nest.
    while (nextRange < sorted.length && sorted[nextRange]!.start < textOffset) {
      nextRange += 1;
    }

    if (!current && nextRange < sorted.length && sorted[nextRange]!.start === textOffset) {
      current = sorted[nextRange]!;
      nextRange += 1;
    }

    const char = html[htmlPos];

    if (char === '<') {
      const gt = html.indexOf('>', htmlPos);
      const tagEnd = gt === -1 ? html.length : gt + 1;
      closeMark();
      out += html.slice(htmlPos, tagEnd);
      htmlPos = tagEnd;
      continue;
    }

    let charLength = 1;
    if (char === '&') {
      ENTITY_AT.lastIndex = htmlPos;
      const entity = ENTITY_AT.exec(html);
      if (entity) charLength = entity[0].length;
    }

    // Opened lazily, immediately before real text: a match that ends exactly on
    // a tag boundary would otherwise reopen a mark that closes with nothing in
    // it, littering the output with empty <mark></mark> pairs.
    if (current && !isMarkOpen) {
      out += openTag(current);
      isMarkOpen = true;
    }

    out += html.slice(htmlPos, htmlPos + charLength);
    htmlPos += charLength;
    textOffset += 1;
  }

  closeMark();

  return out;
};

/**
 * Splits a plain-text line into React-renderable segments. Used by viewers that
 * render text directly (TxtViewer) instead of HTML.
 */
export interface TextSegment {
  text: string;
  isMatch: boolean;
  isActive: boolean;
}

export const splitTextByRanges = (text: string, ranges: HighlightRange[]): TextSegment[] => {
  if (!ranges.length) return [{ text, isMatch: false, isActive: false }];

  const sorted = ranges.filter(range => range.end > range.start).sort((a, b) => a.start - b.start);
  const segments: TextSegment[] = [];
  let cursor = 0;

  for (const range of sorted) {
    if (range.start < cursor) continue; // overlapping match already emitted
    if (range.start > cursor) {
      segments.push({ text: text.slice(cursor, range.start), isMatch: false, isActive: false });
    }
    segments.push({
      text: text.slice(range.start, range.end),
      isMatch: true,
      isActive: range.isActive,
    });
    cursor = range.end;
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), isMatch: false, isActive: false });
  }

  return segments;
};
