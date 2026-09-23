/**
 * Ops from two block arrays by exact-text diff — for agent flows that
 * regenerate a whole document instead of returning labelled blocks (SDLC
 * PRD/Tech Doc updates). Blocks whose rendered markdown matches exactly are
 * untouched; everything else becomes delete + insert suggestions reviewed
 * like any other proposal. No fuzzy matching, per the v2 rules — a changed
 * paragraph is a delete plus an insert.
 */

import type { BlockNoteBlock } from '@/types/blockNoteTypes';
import type { DerivedOp } from './blockLabels';

const MAX_LCS_CELLS = 16_000_000; // 4 bytes a cell: 64MB, the ceiling per write

/** Told when the matrix was skipped, so the caller can log it. */
export type DiffDegradation = (reason: string) => void;

/** The matrix over one bounded window. Flat Int32Array: 4B per cell, one alloc. */
function lcsPairsWindow(
  a: string[],
  b: string[],
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): Array<[number, number]> {
  const n = aEnd - aStart;
  const m = bEnd - bStart;
  const width = m + 1;
  const dp = new Int32Array((n + 1) * width);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i * width + j] =
        a[aStart + i - 1] === b[bStart + j - 1]
          ? (dp[(i - 1) * width + (j - 1)] as number) + 1
          : Math.max(dp[(i - 1) * width + j] as number, dp[i * width + (j - 1)] as number);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[aStart + i - 1] === b[bStart + j - 1]) {
      pairs.push([aStart + i - 1, bStart + j - 1]);
      i--;
      j--;
    } else if ((dp[(i - 1) * width + j] as number) >= (dp[i * width + (j - 1)] as number)) i--;
    else j--;
  }
  return pairs.reverse();
}

function lcsPairs(a: string[], b: string[], onDegraded?: DiffDegradation): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let lowA = 0;
  let lowB = 0;
  let highA = a.length;
  let highB = b.length;

  while (lowA < highA && lowB < highB && a[lowA] === b[lowB]) {
    out.push([lowA, lowB]);
    lowA++;
    lowB++;
  }
  const suffix: Array<[number, number]> = [];
  while (highA > lowA && highB > lowB && a[highA - 1] === b[highB - 1]) {
    highA--;
    highB--;
    suffix.push([highA, highB]);
  }

  const n = highA - lowA;
  const m = highB - lowB;
  if (n > 0 && m > 0) {
    if (n * m <= MAX_LCS_CELLS) {
      for (const pair of lcsPairsWindow(a, b, lowA, highA, lowB, highB)) out.push(pair);
    } else {
      onDegraded?.(`${n}x${m} window past the ${MAX_LCS_CELLS} cell budget; matched by position`);
      for (let at = 0; at < Math.min(n, m); at++) {
        if (a[lowA + at] === b[lowB + at]) out.push([lowA + at, lowB + at]);
      }
    }
  }

  for (let at = suffix.length - 1; at >= 0; at--) out.push(suffix[at] as [number, number]);
  return out;
}

export function deriveDiffOps(
  current: BlockNoteBlock[],
  next: BlockNoteBlock[],
  render: (block: BlockNoteBlock) => string,
  onDegraded?: DiffDegradation
): DerivedOp[] {
  const oldTexts = current.map(b => render(b).trim());
  const newTexts = next.map(b => render(b).trim());
  const pairs = lcsPairs(oldTexts, newTexts, onDegraded);
  const matchedOld = new Set(pairs.map(p => p[0]));
  const matchedNew = new Set(pairs.map(p => p[1]));

  const ops: DerivedOp[] = [];
  for (let i = 0; i < current.length; i++) {
    if (matchedOld.has(i)) continue;
    const id = (current[i] as { id?: string }).id;
    if (!id) continue;
    ops.push({ op: 'delete', key: `del-${i}`, blockId: id, beforeContent: current[i]!, orderIndex: i });
  }
  // Anchor: the last surviving (matched) old block before this position. Pairs
  // ascend in both indices, so one cursor walks them alongside j — rescanning
  // them per insert is the quadratic step that used to hide behind the matrix.
  let pairAt = 0;
  let anchor: string | null = null;
  for (let j = 0; j < next.length; j++) {
    while (pairAt < pairs.length && (pairs[pairAt] as [number, number])[1] < j) {
      const [i] = pairs[pairAt] as [number, number];
      anchor = (current[i] as { id?: string }).id ?? anchor;
      pairAt++;
    }
    if (matchedNew.has(j)) continue;
    const md = newTexts[j];
    if (!md) continue; // blank block — nothing reviewable
    ops.push({ op: 'insert', key: `ins-${j}`, anchor, afterMarkdown: md, orderIndex: j });
  }
  return ops;
}
