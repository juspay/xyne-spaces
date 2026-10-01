import { describe, expect, it } from 'vitest';
import {
  CHUNK_CATCH_UP_MS,
  CHUNK_GAP_MS,
  chunkEnds,
  chunkGapMs,
  chunkText,
  LINE_CHARS,
  nextRevealEnd,
  nextRevealState,
} from './instructionsChunks';

const INSTRUCTIONS = [
  'You are PR Review Helper, a read-only assistant that helps reviewers keep track of pull requests waiting on them.',
  '',
  'How you work',
  '1. When asked, check GitHub for pull requests assigned to the user for review.',
  '2. For each PR, gather the title, author, link, and how long it has been waiting.',
  '3. List the PRs in a clear, scannable format, longest-waiting first.',
  '4. If there are no PRs awaiting review, say so plainly.',
  '',
  'Tools',
  '- GitHub: fetch PR lists and details.',
].join('\n');

describe('chunkText', () => {
  it('keeps every character, in order', () => {
    expect(chunkText(INSTRUCTIONS).join('')).toBe(INSTRUCTIONS);
  });

  it('lands a paragraph at a time, with a heading and its first lines together', () => {
    const chunks = chunkText(INSTRUCTIONS);
    expect(chunks[0]).toMatch(/^You are PR Review Helper/);
    expect(chunks[0]).toMatch(/\n\n$/);
    expect(chunks[1]).toMatch(/^How you work\n1\. .*\n2\. /);
    expect(chunks[2]).toMatch(/^3\. .*\n4\. /);
    expect(chunks.at(-1)).toBe('Tools\n- GitHub: fetch PR lists and details.');
  });

  it('cuts a long paragraph at sentence ends, about three lines at a time', () => {
    const sentence = 'This sentence is here to make a long paragraph that wraps a lot. ';
    const paragraph = sentence.repeat(10).trim();
    const chunks = chunkText(paragraph);
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.length).toBeLessThanOrEqual(3 * LINE_CHARS);
      expect(chunk).toMatch(/\. $/);
    }
    expect(chunks.join('')).toBe(paragraph);
  });

  it('cuts at a word when there is no sentence end', () => {
    const words = 'word '.repeat(80).trim();
    for (const chunk of chunkText(words).slice(0, -1)) expect(chunk).toMatch(/ $/);
  });

  it('keeps extra blank lines with the paragraph before them', () => {
    expect(chunkText('One.\n\n\nTwo.')).toEqual(['One.\n\n\n', 'Two.']);
  });
});

describe('chunkEnds while streaming', () => {
  it('never moves a finished chunk as more text arrives', () => {
    const full = chunkEnds(INSTRUCTIONS);
    for (let length = 1; length <= INSTRUCTIONS.length; length += 7) {
      const prefix = INSTRUCTIONS.slice(0, length);
      const finished = chunkEnds(prefix).filter(end => end < prefix.length);
      for (const end of finished) expect(full).toContain(end);
    }
  });
});

describe('nextRevealEnd', () => {
  it('waits for a chunk to finish until the stream is done', () => {
    const partial = 'First paragraph.\n\nSecond paragraph, still stream';
    expect(nextRevealEnd(partial, 0, false)).toBe('First paragraph.\n\n'.length);
    expect(nextRevealEnd(partial, 'First paragraph.\n\n'.length, false)).toBeNull();
    expect(nextRevealEnd(partial, 'First paragraph.\n\n'.length, true)).toBe(partial.length);
  });

  it('is done once everything is shown', () => {
    expect(nextRevealEnd(INSTRUCTIONS, INSTRUCTIONS.length, true)).toBeNull();
  });
});

describe('chunkGapMs', () => {
  it('speeds up while a backlog drains', () => {
    expect(chunkGapMs(INSTRUCTIONS, 0)).toBe(CHUNK_CATCH_UP_MS);
    const nearEnd = chunkEnds(INSTRUCTIONS).at(-2)!;
    expect(chunkGapMs(INSTRUCTIONS, nearEnd)).toBe(CHUNK_GAP_MS);
  });
});

describe('nextRevealState', () => {
  it('shows text that was there on mount without animating it', () => {
    const state = nextRevealState(null, 'Existing prompt.');
    expect(state.parts).toEqual([{ key: 0, text: 'Existing prompt.', animate: false, delay: 0 }]);
  });

  it('adds appended text as one new part and keeps the old ones', () => {
    const first = nextRevealState(nextRevealState(null, ''), 'One.\n\n');
    const second = nextRevealState(first, 'One.\n\nTwo.');
    expect(second.parts.map(part => part.text)).toEqual(['One.\n\n', 'Two.']);
    expect(second.parts[0]).toBe(first.parts[0]);
    expect(second.parts[1]!.animate).toBe(true);
  });

  it('is unchanged for the same text', () => {
    const state = nextRevealState(nextRevealState(null, ''), 'One.');
    expect(nextRevealState(state, 'One.')).toBe(state);
  });

  it('re-chunks only what a rewrite changed, staggered', () => {
    let state = nextRevealState(null, '');
    state = nextRevealState(state, 'Keep this.\n\n');
    state = nextRevealState(state, 'Keep this.\n\nOld ending.');
    const rewritten = nextRevealState(state, 'Keep this.\n\nNew ending.\n\nAnd more.');
    expect(rewritten.parts[0]).toBe(state.parts[0]);
    expect(rewritten.parts.slice(1).map(part => part.text)).toEqual(['New ending.\n\n', 'And more.']);
    expect(rewritten.parts.slice(1).map(part => part.delay)).toEqual([0, expect.any(Number)]);
    expect(rewritten.parts[2]!.delay).toBeGreaterThan(0);
  });
});
