/**
 * How drafted instructions arrive on the canvas: a few lines at a time, each
 * group blurring in, instead of characters typed per frame.
 *
 * A chunk is one paragraph, or up to three lines of it. Explicit line breaks
 * count as lines, and a long line counts once per ~LINE_CHARS characters it
 * wraps to. A paragraph longer than three lines is cut at a sentence end once
 * the chunk has a line and a half, else at a word. So a heading and its first
 * two list items arrive together, and the next items follow.
 *
 * The cuts only look at text before them, so the chunks of a streamed prefix
 * are the chunks of the full text: what is already on screen never re-flows.
 */

/** Characters per visual line in the Instructions field (about 640px of 14px text). */
export const LINE_CHARS = 90;
const MAX_LINES = 3;
/** A long paragraph may be cut at a sentence end once a chunk is this many lines. */
const MIN_LINES_BEFORE_SENTENCE_CUT = 1.5;

/** Gap between chunks, and the shorter gap used to catch up on a backlog. */
export const CHUNK_GAP_MS = 750;
export const CHUNK_CATCH_UP_MS = 480;
/** More chunks waiting than this and the reveal speeds up. */
const BACKLOG_CHUNKS = 3;

/** How long one chunk takes to blur in. */
export const CHUNK_IN_S = 0.9;
/** Between chunks that mount together (an edit replacing the text at once). */
export const CHUNK_STAGGER_S = 0.12;

function visualLines(line: string): number {
  return Math.max(1, Math.ceil(line.length / LINE_CHARS));
}

/**
 * End offsets of each chunk in `text`. The last offset is `text.length` when
 * the text ends mid-chunk; `chunkEnds` doesn't know whether more is coming.
 */
export function chunkEnds(text: string): number[] {
  const ends: number[] = [];
  let start = 0;
  let lines = 0;
  let position = 0;
  const close = (end: number): void => {
    if (end > start) ends.push(end);
    start = end;
    lines = 0;
  };

  while (position < text.length) {
    const newline = text.indexOf('\n', position);
    const lineEnd = newline === -1 ? text.length : newline;
    const line = text.slice(position, lineEnd);
    const next = newline === -1 ? text.length : newline + 1;

    if (line.trim() === '') {
      // A blank line ends the paragraph and belongs to the chunk before it;
      // so do any more after it. Before the first chunk it waits for the next.
      if (lines > 0) {
        close(next);
      } else if (ends.length > 0 && ends[ends.length - 1] === start) {
        ends[ends.length - 1] = next;
        start = next;
      }
      position = next;
      continue;
    }

    // A line too long for what is left of this chunk is cut inside.
    let cursor = position;
    while (lines + visualLines(text.slice(cursor, lineEnd)) > MAX_LINES && lines > 0) {
      close(cursor);
    }
    while (visualLines(text.slice(cursor, lineEnd)) > MAX_LINES - lines) {
      const room = (MAX_LINES - lines) * LINE_CHARS;
      const cut = cutPoint(text.slice(cursor, cursor + room), lines);
      close(cursor + cut);
      cursor += cut;
    }
    lines += visualLines(text.slice(cursor, lineEnd));
    position = next;
    if (lines >= MAX_LINES) close(next);
  }
  if (start < text.length) ends.push(text.length);
  return ends;
}

/** Where to cut a run of text that won't fit: a sentence end if there is a late enough one, else a word. */
function cutPoint(window: string, linesBefore: number): number {
  const minChars = Math.max(0, (MIN_LINES_BEFORE_SENTENCE_CUT - linesBefore) * LINE_CHARS);
  let sentence = -1;
  for (const match of window.matchAll(/[.!?]["')\]]?\s+/g)) {
    const end = (match.index ?? 0) + match[0].length;
    if (end >= minChars) sentence = end;
  }
  if (sentence > 0) return sentence;
  const space = window.lastIndexOf(' ');
  return space > 0 ? space + 1 : window.length;
}

/** The chunks themselves, for rendering. */
export function chunkText(text: string): string[] {
  let start = 0;
  return chunkEnds(text).map(end => {
    const chunk = text.slice(start, end);
    start = end;
    return chunk;
  });
}

/**
 * How much of `target` to show after `shown` characters: up to the end of the
 * next whole chunk. A chunk at the end of the text is whole only once the
 * stream is done; before that the reveal waits for more text.
 */
export function nextRevealEnd(target: string, shown: number, done: boolean): number | null {
  for (const end of chunkEnds(target)) {
    if (end <= shown) continue;
    if (end === target.length && !done) return null;
    // Only blank lines: fold them into the next chunk rather than spend a beat on them.
    if (!target.slice(shown, end).trim()) continue;
    return end;
  }
  return null;
}

/** The wait before the next chunk: shorter while a backlog drains. */
export function chunkGapMs(target: string, shown: number): number {
  const waiting = chunkEnds(target).filter(end => end > shown).length;
  return waiting > BACKLOG_CHUNKS ? CHUNK_CATCH_UP_MS : CHUNK_GAP_MS;
}

/** One run of text on screen; `animate` runs once, when it mounts. */
export interface RevealPart {
  key: number;
  text: string;
  animate: boolean;
  /** Seconds, for parts that mount together. */
  delay: number;
}

export interface RevealState {
  text: string;
  parts: RevealPart[];
  nextKey: number;
}

/**
 * The parts to show for `text`, given what was shown before. Text that is
 * already on screen keeps its part, so nothing re-animates: appended text
 * becomes one new part, and a rewrite re-chunks only what changed, staggered.
 * Text present when the view mounts (an edit) shows without animating.
 */
export function nextRevealState(previous: RevealState | null, text: string): RevealState {
  if (!previous) {
    return { text, parts: text ? [{ key: 0, text, animate: false, delay: 0 }] : [], nextKey: 1 };
  }
  if (previous.text === text) return previous;

  let common = 0;
  while (
    common < previous.text.length &&
    common < text.length &&
    previous.text[common] === text[common]
  ) {
    common += 1;
  }
  const kept: RevealPart[] = [];
  let keptEnd = 0;
  for (const part of previous.parts) {
    if (keptEnd + part.text.length > common) break;
    kept.push(part);
    keptEnd += part.text.length;
  }
  const rest = text.slice(keptEnd);
  let nextKey = previous.nextKey;
  const added: RevealPart[] =
    !rest
      ? []
      : keptEnd === previous.text.length
        ? [{ key: nextKey++, text: rest, animate: true, delay: 0 }]
        : chunkText(rest).map((chunk, index) => ({
            key: nextKey++,
            text: chunk,
            animate: true,
            delay: index * CHUNK_STAGGER_S,
          }));
  return { text, parts: [...kept, ...added], nextKey };
}
