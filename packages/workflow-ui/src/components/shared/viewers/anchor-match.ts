/**
 * Finding a cited passage inside rendered text — the format-agnostic half of
 * citation anchoring.
 *
 * A citation's `quote` is what the **agent read**, which is rarely byte-identical
 * to what the **viewer renders**: OCR drops or doubles spaces, smart quotes and
 * ligatures differ between the extractor and the renderer, and a passage can be
 * split across elements. An exact `indexOf` therefore fails on precisely the
 * documents citations exist for, and fails *silently* — the reader just sees an
 * unhighlighted page and assumes the citation is wrong.
 *
 * So matching is normalized and laddered: compare on a canonical form, and when
 * the whole phrase misses, fall back to progressively shorter prefixes. The
 * *start* of a quote is reliable even when its middle drifted.
 *
 * Used by every DOM-rendered viewer (text, markdown, json, docx, csv, xlsx) via
 * `useDomAnchor`, and by `PdfView` for its own pdf.js find controller.
 */

/** Characters that differ between text extractors and renderers but read the same. */
const CHAR_FOLD: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'", // ‘ ’ ‚ ‛
  '“': '"', '”': '"', '„': '"', '‟': '"', // “ ” „ ‟
  '–': '-', '—': '-', '−': '-',                 // – — −
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ',  // nbsp & friends
  'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl',              // ﬀ ﬁ ﬂ
  'ﬃ': 'ffi', 'ﬄ': 'ffl',
};

/** Fold one character to its canonical form (may expand, e.g. a ligature). */
function foldChar(ch: string): string {
  return CHAR_FOLD[ch] ?? ch.toLowerCase();
}

/**
 * Canonical form for comparison: folded characters, whitespace runs collapsed to
 * a single space, trimmed. Used on both haystack and needle so they meet in the
 * middle.
 */
export function normalizeForMatch(s: string): string {
  let out = '';
  let pendingSpace = false;
  for (const ch of s) {
    if (/\s/.test(ch)) {
      pendingSpace = out.length > 0;
      continue;
    }
    if (pendingSpace) {
      out += ' ';
      pendingSpace = false;
    }
    out += foldChar(ch);
  }
  return out;
}

/**
 * Progressively shorter prefixes of a phrase, longest first.
 *
 * The fallback when a whole quote won't match — because it spans a page break,
 * or its middle drifted in OCR. The start of the value is on the cited page by
 * definition, so a shorter head still lands the reader in the right place.
 *
 * Guards against matching noise: never fewer than 2 words or 4 characters, since
 * a 1-word ladder rung would highlight the first "the" on the page.
 */
export function buildQueryLadder(value: string): string[] {
  const words = value.trim().split(/\s+/);
  const ladder: string[] = [];
  for (const n of [words.length, 6, 4, 3, 2]) {
    if (n < 2 || n > words.length) continue;
    const q = words.slice(0, n).join(' ');
    if (q.length >= 4 && !ladder.includes(q)) ladder.push(q);
  }
  return ladder.length ? ladder : [value.trim()];
}

/** Where one normalized character came from, so a match maps back to a Range. */
interface CharSource {
  node: Text;
  offset: number;
}

/**
 * Flatten a subtree's text into its normalized form plus, for each normalized
 * character, the text node and offset it came from.
 *
 * The index map is what lets a match on the *normalized* string become a real
 * `Range` over the *original* DOM — without it we could detect a hit but not
 * highlight it.
 */
function flatten(root: HTMLElement): { text: string; map: CharSource[] } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let text = '';
  const map: CharSource[] = [];
  let pendingSpace = false;

  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const node = n as Text;
    const raw = node.data;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i]!;
      if (/\s/.test(ch)) {
        pendingSpace = text.length > 0;
        continue;
      }
      if (pendingSpace) {
        // The space belongs to this character's position, so a match starting
        // here still points at a real node offset.
        text += ' ';
        map.push({ node, offset: i });
        pendingSpace = false;
      }
      const folded = foldChar(ch);
      // A ligature folds to several characters; each maps back to the same source.
      for (const f of folded) {
        text += f;
        map.push({ node, offset: i });
      }
    }
  }
  return { text, map };
}

/**
 * Find `quote` inside `root`'s rendered text and return a `Range` over it.
 *
 * Tries the whole phrase first, then the prefix ladder. Returns `null` when
 * nothing matches — callers should degrade to "opened, not highlighted" rather
 * than pretending.
 */
export function findRange(root: HTMLElement, quote: string): Range | null {
  const needleRaw = quote.trim();
  if (!needleRaw) return null;

  const { text, map } = flatten(root);
  if (!text) return null;

  for (const candidate of buildQueryLadder(needleRaw)) {
    const needle = normalizeForMatch(candidate);
    if (needle.length < 2) continue;

    const at = text.indexOf(needle);
    if (at === -1) continue;

    const start = map[at];
    const end = map[at + needle.length - 1];
    if (!start || !end) continue;

    const range = document.createRange();
    range.setStart(start.node, start.offset);
    // `end` is the last matched character — the range must close after it.
    range.setEnd(end.node, Math.min(end.offset + 1, end.node.data.length));
    return range;
  }
  return null;
}
