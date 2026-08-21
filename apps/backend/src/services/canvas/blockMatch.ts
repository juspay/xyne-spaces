/**
 * Turn an agent's returned document into a list of per-block changes.
 *
 * Three passes, in decreasing confidence:
 *   1. EXACT — label kept;  2. NEW — marked [new];  3. FUZZY — no label,
 * match by similarity or treat as new. The third pass is a safety net; if it
 * runs often the agent has stopped preserving labels.
 */

import type { BlockNoteBlock } from '@/types/blockNoteTypes';
import type { HandleMap, ParsedEntry } from './blockLabels';
import { hashBlock } from './blockHash';

export type MatchMethod = 'EXACT' | 'FUZZY' | 'NEW';

export interface MatchedChange {
  op: 'replace' | 'insert_after' | 'delete';
  blockId: string | null;
  afterBlockId: string | null;
  basePos: number | null;
  beforeContent: BlockNoteBlock | null;
  afterMarkdown: string | null;
  blockHash: string | null;
  matchMethod: MatchMethod;
  matchScore: number | null;
  orderIndex: number;
}

/** Below this, an unlabelled paragraph is treated as new rather than as an
 *  edit of its best match. Calibrate from observed score distributions. */
export const FUZZY_THRESHOLD = 0.5;

/**
 * Minimum similarity before we believe a label match. A label is a claim, not
 * a fact: models restructuring a document reuse labels positionally, and
 * believing that would transplant a block's id (and its comment threads) onto
 * unrelated text. Measured on a real incident: mismatches scored 0.03–0.38,
 * genuine edits 0.71–0.90 — 0.5 sits in the gap.
 */
export const RELABEL_FLOOR = 0.5;

export interface MatchResult {
  changes: MatchedChange[];
  /** Label matches rejected as implausible — a renumbering signal. */
  relabelled: number;
  /** Label matches accepted. */
  labelMatched: number;
}

/** Dice coefficient over character bigrams. Cheap, dependency-free, and
 *  well behaved for prose: near-identical text scores high, unrelated near 0. */
export function similarity(a: string, b: string): number {
  const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const x = norm(a);
  const y = norm(b);
  if (!x.length && !y.length) return 1;
  if (!x.length || !y.length) return 0;
  if (x === y) return 1;

  const bigrams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };

  const ax = bigrams(x);
  const by = bigrams(y);
  let shared = 0;
  for (const [g, count] of ax) shared += Math.min(count, by.get(g) ?? 0);
  const total = Math.max(1, x.length - 1) + Math.max(1, y.length - 1);
  return (2 * shared) / total;
}

/**
 * Overlap coefficient: shared bigrams over the SHORTER text. Dice penalises
 * expansion (60 chars grown to 500 caps near 0.2 even with the original
 * contained verbatim); overlap scores containment high regardless of growth.
 * Only trusted when the shorter text is non-trivial — tiny fragments appear
 * inside almost anything.
 */
export function overlapCoefficient(a: string, b: string): number {
  const norm = (t: string): string => t.toLowerCase().replace(/\s+/g, ' ').trim();
  const x = norm(a);
  const y = norm(b);
  if (!x.length || !y.length) return x === y ? 1 : 0;
  const bigrams = (t: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < t.length - 1; i++) {
      const g = t.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ax = bigrams(x);
  const by = bigrams(y);
  let shared = 0;
  for (const [g, count] of ax) shared += Math.min(count, by.get(g) ?? 0);
  return shared / Math.max(1, Math.min(x.length, y.length) - 1);
}

const OVERLAP_MIN_LENGTH = 20;

/**
 * "Is this plausibly an edit of that paragraph?" Dice catches unrelated text;
 * overlap recognises expansions. Take the more charitable of the two —
 * unrelated text scores low on both.
 */
export function editSimilarity(a: string, b: string): number {
  const dice = similarity(a, b);
  const shorter = Math.min(a.trim().length, b.trim().length);
  if (shorter < OVERLAP_MIN_LENGTH) return dice;
  return Math.max(dice, overlapCoefficient(a, b));
}

export interface MatchInput {
  current: BlockNoteBlock[];
  entries: ParsedEntry[];
  handleMap: HandleMap;
  /** Renders an existing block to markdown, for comparison. */
  render: (block: BlockNoteBlock) => string;
  /**
   * Block ids the agent actually SAW (from the read receipt). Absence from
   * the reply means "delete" only for blocks the agent knew about. When
   * omitted, NO deletions are emitted: failing to delete is recoverable,
   * deleting someone's paragraph is not.
   */
  seenBlockIds?: Set<string>;
}

export function matchBlocks({ current, entries, handleMap, render, seenBlockIds }: MatchInput): MatchResult {
  const byId = new Map<string, BlockNoteBlock>();
  for (const block of current) {
    const id = (block as { id?: string }).id;
    if (id) byId.set(id, block);
  }

  const claimed = new Set<string>();
  const changes: MatchedChange[] = [];
  let relabelled = 0;
  let labelMatched = 0;
  // basePos numbering MUST match suggestionStore's baseBlockIds, which keeps
  // only id-bearing blocks — a raw array index would skew every position
  // after an id-less block and mis-anchor inserts.
  const posOf = new Map<string, number>();
  let posCounter = 0;
  for (const b of current) {
    const id = (b as { id?: string }).id;
    if (id) posOf.set(id, posCounter++);
  }

  /** Anchor for the next insertion: the last real block we passed. */
  let lastKnownId: string | null = null;
  let order = 0;

  const push = (c: Omit<MatchedChange, 'orderIndex'>): void => {
    changes.push({ ...c, orderIndex: order++ });
  };

  for (const entry of entries) {
    // ── 1. EXACT ──────────────────────────────────────────────────────
    const id = entry.handle ? handleMap.get(entry.handle) : undefined;
    if (id && byId.has(id)) {
      const block = byId.get(id) as BlockNoteBlock;
      const before = render(block).trim();
      claimed.add(id);
      lastKnownId = id;

      if (before === entry.markdown.trim()) {
        labelMatched += 1;
        continue; // untouched
      }

      // A kept label on unrelated content is a renumbering, not an edit —
      // record delete+insert so the block's identity is not transplanted.
      const score = editSimilarity(before, entry.markdown);
      if (score < RELABEL_FLOOR) {
        relabelled += 1;
        push({
          op: 'delete', blockId: id, afterBlockId: null, basePos: null,
          beforeContent: block, afterMarkdown: null,
          blockHash: hashBlock(block), matchMethod: 'EXACT', matchScore: score,
        });
        push({
          op: 'insert_after', blockId: null, afterBlockId: id,
          basePos: posOf.get(id) ?? -1,
          beforeContent: null, afterMarkdown: entry.markdown,
          blockHash: null, matchMethod: 'NEW', matchScore: score,
        });
        continue;
      }

      labelMatched += 1;
      push({
        op: 'replace', blockId: id, afterBlockId: null, basePos: null,
        beforeContent: block, afterMarkdown: entry.markdown,
        blockHash: hashBlock(block), matchMethod: 'EXACT', matchScore: null,
      });
      continue;
    }

    // ── 2. NEW ────────────────────────────────────────────────────────
    if (entry.isNew) {
      push({
        op: 'insert_after', blockId: null, afterBlockId: lastKnownId,
        basePos: lastKnownId ? (posOf.get(lastKnownId) ?? -1) : -1,
        beforeContent: null, afterMarkdown: entry.markdown,
        blockHash: null, matchMethod: 'NEW', matchScore: null,
      });
      continue;
    }

    // ── 3. FUZZY ──────────────────────────────────────────────────────
    let best: { id: string; block: BlockNoteBlock; score: number } | null = null;
    for (const [candidateId, block] of byId) {
      if (claimed.has(candidateId)) continue;
      const score = editSimilarity(render(block), entry.markdown);
      if (!best || score > best.score) best = { id: candidateId, block, score };
    }

    if (best && best.score >= FUZZY_THRESHOLD) {
      claimed.add(best.id);
      lastKnownId = best.id;
      if (render(best.block).trim() !== entry.markdown.trim()) {
        push({
          op: 'replace', blockId: best.id, afterBlockId: null, basePos: null,
          beforeContent: best.block, afterMarkdown: entry.markdown,
          blockHash: hashBlock(best.block), matchMethod: 'FUZZY', matchScore: best.score,
        });
      }
    } else {
      // Nothing resembles it — a confident insertion, not a shaky match.
      push({
        op: 'insert_after', blockId: null, afterBlockId: lastKnownId,
        basePos: lastKnownId ? (posOf.get(lastKnownId) ?? -1) : -1,
        beforeContent: null, afterMarkdown: entry.markdown,
        blockHash: null, matchMethod: 'NEW', matchScore: best?.score ?? null,
      });
    }
  }

  // ── deletions: only blocks the agent saw and did not return ─────────
  for (const [id, block] of byId) {
    if (claimed.has(id)) continue;
    // Never seen by the agent → added by a human after the read. Leave it.
    if (!seenBlockIds || !seenBlockIds.has(id)) continue;
    push({
      op: 'delete', blockId: id, afterBlockId: null, basePos: null,
      beforeContent: block, afterMarkdown: null,
      blockHash: hashBlock(block), matchMethod: 'EXACT', matchScore: null,
    });
  }

  return { changes, relabelled, labelMatched };
}
