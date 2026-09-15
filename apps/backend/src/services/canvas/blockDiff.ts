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

/** LCS as matched index pairs — value-based, so duplicate texts stay unambiguous. */
function lcsPairs(a: string[], b: string[]): Array<[number, number]> {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] = a[i - 1] === b[j - 1] ? dp[i - 1]![j - 1]! + 1 : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      pairs.push([i - 1, j - 1]);
      i--;
      j--;
    } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) i--;
    else j--;
  }
  return pairs.reverse();
}

export function deriveDiffOps(
  current: BlockNoteBlock[],
  next: BlockNoteBlock[],
  render: (block: BlockNoteBlock) => string
): DerivedOp[] {
  const oldTexts = current.map(b => render(b).trim());
  const newTexts = next.map(b => render(b).trim());
  const pairs = lcsPairs(oldTexts, newTexts);
  const matchedOld = new Set(pairs.map(p => p[0]));
  const matchedNew = new Set(pairs.map(p => p[1]));

  const ops: DerivedOp[] = [];
  for (let i = 0; i < current.length; i++) {
    if (matchedOld.has(i)) continue;
    const id = (current[i] as { id?: string }).id;
    if (!id) continue;
    ops.push({ op: 'delete', key: `del-${i}`, blockId: id, beforeContent: current[i]!, orderIndex: i });
  }
  for (let j = 0; j < next.length; j++) {
    if (matchedNew.has(j)) continue;
    const md = newTexts[j];
    if (!md) continue; // blank block — nothing reviewable
    // Anchor: the last surviving (matched) old block before this position.
    let anchor: string | null = null;
    for (const [i, jj] of pairs) {
      if (jj >= j) break;
      anchor = (current[i] as { id?: string }).id ?? anchor;
    }
    ops.push({ op: 'insert', key: `ins-${j}`, anchor, afterMarkdown: md, orderIndex: j });
  }
  return ops;
}
