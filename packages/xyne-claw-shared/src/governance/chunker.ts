import { sha256Hex } from "./canonical.js";
import type { Chunk, ChunkOptions } from "./types.js";

// Cut ranks, best first: email, blank line, HTML block end, list item, sentence end, newline, whitespace.
// Bounded quantifiers only: these run at every candidate cut, and an unbounded class before a literal is quadratic on a miss.
const NONE = 7;
const EMAIL_LINE = /From:|Subject:|-----Original Message-----/y;
const WROTE_LINE = /On .{3,80} wrote:[ \t]{0,8}$/my;
const HEADER_LINE = /-----Original Message-----|[A-Za-z][A-Za-z-]{0,60}:/y;
const LIST_ITEM = /[ \t]{0,16}(?:[-*+]|\d{1,9}[.)])\s/y;
const HTML_END = /(?<=<\/(?:p|div|li|tr|h[1-6])>|<(?:br|hr)\s{0,8}\/?>)/iy;
const SENTENCE_END = /(?<=[.!?]\s{1,3})/y;

function matchAt(re: RegExp, t: string, i: number): boolean {
  re.lastIndex = i;
  return re.test(t);
}

const isSpace = (c: number): boolean => c === 32 || (c >= 9 && c <= 13);

// Quarter-tokens, so ranges add up: a surrogate pair costs 4 on its first unit and 0 on its second.
function cost(t: string, i: number, floor: number): number {
  const c = t.charCodeAt(i);
  if (c <= 0x2e7f) return 1;
  return (c & 0xfc00) === 0xdc00 && i > floor && (t.charCodeAt(i - 1) & 0xfc00) === 0xd800 ? 0 : 4;
}

/** About 4 ASCII-ish characters per token; every code point above U+2E7F (CJK, emoji) is one token. */
export function estimateTokens(text: string): number {
  let units = 0;
  for (let i = 0; i < text.length; i++) units += cost(text, i, 0);
  return Math.ceil(units / 4);
}

// A header line opens a message only if it does not continue a header block, so From/Subject never split.
function emailStart(t: string, e: number): boolean {
  if (!matchAt(EMAIL_LINE, t, e) && !matchAt(WROTE_LINE, t, e)) return false;
  return !matchAt(HEADER_LINE, t, e > 1 ? t.lastIndexOf("\n", e - 2) + 1 : 0);
}

function blankBefore(t: string, e: number): boolean {
  let j = e - 2;
  while (j >= 0 && t.charCodeAt(j) !== 10 && isSpace(t.charCodeAt(j))) j--;
  return j < 0 || t.charCodeAt(j) === 10;
}

function boundary(t: string, e: number): number {
  const c = t.charCodeAt(e - 1);
  if (c === 62) return matchAt(HTML_END, t, e) ? 2 : NONE;
  if (!isSpace(c)) return NONE;
  if (c === 10) {
    if (emailStart(t, e)) return 0;
    if (blankBefore(t, e)) return 1;
    if (matchAt(LIST_ITEM, t, e)) return 3;
  }
  return matchAt(SENTENCE_END, t, e) ? 4 : c === 10 ? 5 : 6;
}

export function chunkText(text: string, opts: ChunkOptions = {}): Chunk[] {
  const target = Math.max(1, Math.floor(opts.targetTokens ?? 600));
  const min = Math.min(target, Math.max(1, Math.floor(opts.minTokens ?? Math.round((target * 2) / 3))));
  const max = Math.max(target, Math.floor(opts.maxTokens ?? Math.round((target * 4) / 3)));
  const minU = (min - 1) * 4 + 1;
  const maxU = max * 4;
  const targetU = target * 4;
  // Capped so every chunk advances well past its overlap.
  const back = Math.min(Math.round(Math.max(0, opts.overlap ?? 0.125) * targetU), Math.floor(minU / 2));
  const slack = Math.ceil(back / 5);
  const limit = Math.max(0, Math.floor(opts.maxChunks ?? Infinity));
  const n = text.length;

  // Best rank in the [min, max] window, nearest the target on ties; no boundary means a hard cut at max.
  const cut = (from: number): number => {
    let units = 0;
    let bestAt = -1;
    let bestRank = NONE;
    let bestGap = Infinity;
    let i = from;
    for (; i < n; i++) {
      const c = cost(text, i, from);
      if (units + c > maxU) break;
      units += c;
      if (units < minU) continue;
      const rank = boundary(text, i + 1);
      const gap = Math.abs(units - targetU);
      if (rank < bestRank || (rank === bestRank && rank < NONE && gap < bestGap)) {
        bestAt = i + 1;
        bestRank = rank;
        bestGap = gap;
      }
    }
    return i >= n ? n : bestAt > 0 ? bestAt : i;
  };

  // The next chunk starts `back` units before the cut, moved further back to the nearest boundary within `slack`.
  const rewind = (from: number, end: number): number => {
    let s = end;
    for (let u = 0; s > from && u < back; ) u += cost(text, --s, from);
    let k = s;
    for (let u = 0; k > from && u <= slack; u += cost(text, --k, from)) {
      if (boundary(text, k) < NONE) return k;
    }
    return s > from ? s : end;
  };

  const out: Chunk[] = [];
  for (let start = 0; start < n && out.length < limit; ) {
    const end = cut(start);
    const slice = text.slice(start, end);
    out.push({
      index: out.length,
      text: slice,
      span: { start, end },
      sha256: sha256Hex(slice),
      tokens: estimateTokens(slice),
    });
    if (end >= n) break;
    start = rewind(start, end);
  }
  return out;
}
