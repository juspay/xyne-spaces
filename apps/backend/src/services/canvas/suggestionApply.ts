/**
 * Pure application of suggestion rows to a block array. No I/O, no logging —
 * the database/Y-Sweet orchestration lives in suggestions.ts. Kept separate
 * so this core stays unit-testable without any environment.
 *
 * Phases: 1) replaces in place (position-blind, block id kept)
 *         2) deletes
 *         3) placement — moves + inserts together, in (createdAt, orderIndex)
 *            order, anchors resolved proposed-first; unresolvable = STALE,
 *            never guessed. Content is applied as accepted — no conflict
 *            detection; the pre-accept version snapshot is the recovery path.
 */

import type { BlockNoteBlock } from '@/types/blockNoteTypes';

export interface SuggestionRowLike {
  id: string;
  batchId: string;
  op: string; // insert | replace | delete | move
  blockId: string | null;
  proposedAnchorId: string | null;
  currentAnchorId: string | null;
  orderIndex: number;
  beforeContent: unknown;
  afterContent: unknown;
  createdAt: Date;
}

export interface ApplyOutcome {
  blocks: BlockNoteBlock[];
  applied: string[];
  stale: string[];
}

const idOf = (b: BlockNoteBlock): string | undefined => (b as { id?: string }).id;

export async function applyOps(
  current: BlockNoteBlock[],
  rows: SuggestionRowLike[],
  toBlocks: (markdown: string) => Promise<BlockNoteBlock[]>
): Promise<ApplyOutcome> {
  const working: BlockNoteBlock[] = [...current];
  const applied: string[] = [];
  const stale: string[] = [];

  const findIdx = (id: string | null): number =>
    id === null ? -1 : working.findIndex(b => idOf(b) === id);

  const markdownOf = (row: SuggestionRowLike): string | null => {
    const c = row.afterContent as { markdown?: string } | null;
    return c?.markdown ?? null;
  };

  // ── phase 1: replaces — in place, by id, block id kept. Applies over
  // whatever the block currently holds: the human's accept is the authority,
  // recovery is the pre-accept version snapshot. ──────────────────────────
  for (const row of rows.filter(r => r.op === 'replace')) {
    const idx = findIdx(row.blockId);
    if (idx < 0) {
      stale.push(row.id);
      continue;
    }
    const md = markdownOf(row);
    const parsed = md ? await toBlocks(md) : [];
    const next = parsed[0];
    if (!next) {
      stale.push(row.id);
      continue;
    }
    working[idx] = { ...(next as object), id: row.blockId } as BlockNoteBlock;
    applied.push(row.id);
  }

  // ── phase 2: deletes ──────────────────────────────────────────────────
  for (const row of rows.filter(r => r.op === 'delete')) {
    const idx = findIdx(row.blockId);
    if (idx < 0) {
      applied.push(row.id); // already gone — what it wanted happened
      continue;
    }
    working.splice(idx, 1);
    applied.push(row.id);
  }

  // ── phase 3: placement — moves + inserts, proposed-first anchors ──────
  const placement = rows
    .filter(r => r.op === 'move' || r.op === 'insert')
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.orderIndex - b.orderIndex);

  const resolveAnchor = (row: SuggestionRowLike): { ok: true; anchorId: string | null } | { ok: false } => {
    if (row.proposedAnchorId === null) return { ok: true, anchorId: null }; // top of document
    if (findIdx(row.proposedAnchorId) >= 0) return { ok: true, anchorId: row.proposedAnchorId };
    if (row.currentAnchorId !== null && findIdx(row.currentAnchorId) >= 0) {
      return { ok: true, anchorId: row.currentAnchorId };
    }
    return { ok: false };
  };

  const placeAfter = (block: BlockNoteBlock, anchorId: string | null): void => {
    const at = anchorId === null ? 0 : findIdx(anchorId) + 1;
    working.splice(at, 0, block);
  };

  for (const row of placement) {
    if (row.op === 'move') {
      const srcIdx = findIdx(row.blockId);
      if (srcIdx < 0) {
        stale.push(row.id);
        continue;
      }
      const anchor = resolveAnchor(row);
      if (!anchor.ok) {
        stale.push(row.id);
        continue;
      }
      const [block] = working.splice(srcIdx, 1); // same object: id + content survive
      placeAfter(block as BlockNoteBlock, anchor.anchorId);
      applied.push(row.id);
    } else {
      const anchor = resolveAnchor(row);
      if (!anchor.ok) {
        stale.push(row.id);
        continue;
      }
      const md = markdownOf(row);
      const parsed = md ? await toBlocks(md) : [];
      const next = parsed[0];
      if (!next) {
        stale.push(row.id);
        continue;
      }
      placeAfter({ ...(next as object), id: row.id } as BlockNoteBlock, anchor.anchorId);
      applied.push(row.id);
    }
  }

  return { blocks: working, applied, stale };
}
