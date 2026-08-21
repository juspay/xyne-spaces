/**
 * Stable fingerprints for canvas content.
 *
 * Two levels, both used by the approval gate:
 *   - hashBlocks()  → whole-document, stored as CanvasSuggestion.baseContentHash
 *   - hashBlock()   → single block, stored as CanvasSuggestionChange.blockHash
 *
 * The per-block hash is what lets one colliding change be held back without
 * invalidating a whole batch of suggestions.
 */

import { createHash } from 'node:crypto';
import type { BlockNoteBlock } from '@/types/blockNoteTypes';

/**
 * Deterministic JSON: object keys sorted, undefined dropped. Without this the
 * same block can hash differently purely because BlockNote emitted its props
 * in a different order.
 */
export function stableStringify(value: unknown): string {
  const normalize = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(normalize);
    if (v && typeof v === 'object') {
      const record = v as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record)
          .sort()
          .filter(k => record[k] !== undefined)
          .map(k => [k, normalize(record[k])])
      );
    }
    return v;
  };
  return JSON.stringify(normalize(value));
}

const sha256 = (input: string): string => createHash('sha256').update(input).digest('hex');

/** Fingerprint of one block, including its children. */
export function hashBlock(block: BlockNoteBlock): string {
  return sha256(stableStringify(block));
}

/** Fingerprint of a whole document. */
export function hashBlocks(blocks: BlockNoteBlock[]): string {
  return sha256(stableStringify(blocks));
}

/** Look up a block by id anywhere in the tree, including nested children. */
export function findBlockById(
  blocks: BlockNoteBlock[],
  id: string
): BlockNoteBlock | undefined {
  for (const block of blocks) {
    if ((block as { id?: string }).id === id) return block;
    const children = (block as { children?: BlockNoteBlock[] }).children;
    if (children?.length) {
      const hit = findBlockById(children, id);
      if (hit) return hit;
    }
  }
  return undefined;
}
