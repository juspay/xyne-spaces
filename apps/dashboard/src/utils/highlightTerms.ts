export interface HighlightSegment {
  text: string;
  matched: boolean;
}

export const normalizeHighlightTerms = (terms: readonly string[]): string[] =>
  terms.map(term => term.trim().toLowerCase()).filter(term => term.length > 1);

/** The fragments Vespa wrapped in `<hi>` — the matched form of each term, as it appears
 * in the document, so a stemmed match ("report" for "reports") can be highlighted. */
export const extractVespaHighlights = (html: string | undefined): string[] =>
  html ? Array.from(html.matchAll(/<hi>(.*?)<\/hi>/gi), match => match[1] ?? '') : [];

/**
 * Splits `text` into matched / unmatched runs against already-normalized `needles`, taking
 * the earliest occurrence each step and the longest needle on a tie. Returns an empty array
 * when nothing matched, so callers can leave the original text untouched.
 */
export const splitOnHighlightTerms = (text: string, needles: string[]): HighlightSegment[] => {
  if (!text || needles.length === 0) return [];

  const lower = text.toLowerCase();
  const segments: HighlightSegment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    let at = -1;
    let length = 0;
    for (const needle of needles) {
      const found = lower.indexOf(needle, cursor);
      if (found !== -1 && (at === -1 || found < at || (found === at && needle.length > length))) {
        at = found;
        length = needle.length;
      }
    }
    if (at === -1) break;
    if (at > cursor) segments.push({ text: text.slice(cursor, at), matched: false });
    segments.push({ text: text.slice(at, at + length), matched: true });
    cursor = at + length;
  }

  if (cursor === 0) return [];
  if (cursor < text.length) segments.push({ text: text.slice(cursor), matched: false });
  return segments;
};
