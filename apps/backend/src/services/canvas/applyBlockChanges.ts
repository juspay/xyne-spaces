/**
 * Apply accepted suggestion changes to a canvas's blocks.
 *
 * This is a REBUILD, not a patch. We walk the current blocks in document order
 * and emit a new array: skipping deletes, swapping replaces, and emitting
 * inserts after their anchor block.
 *
 * Nothing stores a numeric position, so accepting one change can never shift
 * another out of place — an insert anchored to block X still lands after X
 * even if three blocks before it were deleted in the same batch.
 *
 * Verified against real canvases: block ids, comment-thread marks, tables,
 * code blocks, nested list children and images all survive this path, because
 * the document never leaves its block representation.
 */

import type { BlockNoteBlock } from '@/types/blockNoteTypes';

export type ChangeOp = 'replace' | 'insert_after' | 'delete';

export interface BlockChange {
  op: ChangeOp;
  blockId?: string | null;
  afterBlockId?: string | null;
  afterContent?: BlockNoteBlock | null;
  orderIndex?: number;
}

export interface ApplyResult {
  blocks: BlockNoteBlock[];
  skipped: BlockChange[];
}

const idOf = (block: BlockNoteBlock): string | undefined =>
  (block as { id?: string }).id;

/**
 * @param current  the canvas as it stands right now
 * @param changes  ONLY the changes a human accepted — callers filter first
 */
export function applyChanges(
  current: BlockNoteBlock[],
  changes: BlockChange[]
): ApplyResult {
  const deletes = new Set<string>();
  const replacements = new Map<string, BlockNoteBlock>();
  const insertsAfter = new Map<string, BlockChange[]>();
  const prepends: BlockChange[] = [];
  const skipped: BlockChange[] = [];

  const byOrder = (a: BlockChange, b: BlockChange): number =>
    (a.orderIndex ?? 0) - (b.orderIndex ?? 0);

  for (const change of changes) {
    switch (change.op) {
      case 'delete':
        if (change.blockId) deletes.add(change.blockId);
        break;

      case 'replace':
        if (change.blockId && change.afterContent) {
          replacements.set(change.blockId, change.afterContent);
        } else {
          skipped.push(change);
        }
        break;

      case 'insert_after':
        if (!change.afterContent) {
          skipped.push(change);
          break;
        }
        if (change.afterBlockId) {
          const list = insertsAfter.get(change.afterBlockId) ?? [];
          list.push(change);
          insertsAfter.set(change.afterBlockId, list);
        } else {
          prepends.push(change);
        }
        break;
    }
  }

  const seen = new Set<string>();
  const out: BlockNoteBlock[] = [];

  for (const change of prepends.sort(byOrder)) {
    out.push(change.afterContent as BlockNoteBlock);
  }

  for (const block of current) {
    const id = idOf(block);
    if (id) seen.add(id);

    if (id && deletes.has(id)) {
      // Dropped — but any insert anchored to it still needs a home, so it
      // falls through to the anchor handling below.
    } else if (id && replacements.has(id)) {
      // Keep the original id even if the proposed block carries a different
      // one; identity belongs to the document, not to the proposal.
      out.push({ ...(replacements.get(id) as BlockNoteBlock), id } as BlockNoteBlock);
    } else {
      out.push(block);
    }

    if (id) {
      for (const change of (insertsAfter.get(id) ?? []).sort(byOrder)) {
        out.push(change.afterContent as BlockNoteBlock);
      }
    }
  }

  // Anything targeting a block that no longer exists could not be applied.
  for (const change of changes) {
    const target =
      change.op === 'insert_after' ? change.afterBlockId : change.blockId;
    if (target && !seen.has(target) && !skipped.includes(change)) {
      skipped.push(change);
    }
  }

  return { blocks: out, skipped };
}
