/**
 * Short handles on blocks, so an agent can hand back a whole document and we
 * still know which paragraph is which. Full UUIDs are ~10 tokens of noise
 * models mistype; a short handle is cheap and trivially validated — anything
 * not in the map is either new or a mistake.
 */

import type { BlockNoteBlock } from '@/types/blockNoteTypes';

export const HANDLE_PATTERN = /^\[(b[0-9a-f]{4,12})\]\s?/;
export const NEW_PATTERN = /^\[new\]\s?/i;

/** handle ("b3") → real block id */
export type HandleMap = Map<string, string>;

export interface LabelledDocument {
  markdown: string;
  handleMap: HandleMap;
}

export interface ParsedEntry {
  handle: string | null;
  isNew: boolean;
  markdown: string;
}

/**
 * Handles are DERIVED from the block id (b + first hex chars), never
 * positional: read and write are separate HTTP requests, and a positional
 * b1/b2 would silently point at the wrong paragraph after any edit in
 * between. A derived handle resolves to the same block or not at all.
 * Length grows until every handle in the document is unique.
 */
export function buildHandleMap(blocks: BlockNoteBlock[]): HandleMap {
  const ids = blocks
    .map(b => (b as { id?: string }).id)
    .filter((id): id is string => Boolean(id));

  for (let length = 6; length <= 12; length += 2) {
    const map: HandleMap = new Map();
    let collision = false;
    for (const id of ids) {
      const handle = 'b' + id.replace(/[^0-9a-f]/gi, '').toLowerCase().slice(0, length);
      if (map.has(handle)) { collision = true; break; }
      map.set(handle, id);
    }
    if (!collision) return map;
  }
  // Astronomically unlikely; fall back to the full cleaned id.
  return new Map(ids.map(id => ['b' + id.replace(/[^0-9a-f]/gi, '').toLowerCase(), id]));
}

/** Render blocks as labelled markdown. `render` is injected so this module
 *  stays synchronous and testable without booting BlockNote. */
export function labelBlocks(
  blocks: BlockNoteBlock[],
  render: (block: BlockNoteBlock) => string
): LabelledDocument {
  const handleMap = buildHandleMap(blocks);
  const idToHandle = new Map([...handleMap].map(([h, id]) => [id, h]));
  const lines: string[] = [];

  for (const block of blocks) {
    const id = (block as { id?: string }).id;
    const handle = id ? idToHandle.get(id) : undefined;
    lines.push(handle ? `[${handle}] ${render(block).trim()}` : render(block).trim());
  }

  return { markdown: lines.join('\n\n'), handleMap };
}

export const LABEL_INSTRUCTION = `Every paragraph is prefixed with a label like [b2].

A label identifies ONE SPECIFIC PARAGRAPH. It is not a position or a slot
number. Never move a label onto different content.

RULES:
- Reworded, corrected or expanded a paragraph? Keep its label unchanged.
- Replacing a paragraph with unrelated content? OMIT the labelled paragraph
  entirely and add the new text with [new]. Do NOT reuse its label.
- Adding a paragraph? Prefix it with [new].
- Deleting a paragraph? Omit it.
- Rewriting a whole section? That is a deletion plus additions: omit every
  labelled paragraph you are removing, and mark every new paragraph [new].
- Moving a paragraph? Move its labelled line to the new position — keep the
  label unchanged.
- Never renumber and never invent labels.
- Return only the document, with no commentary before or after it.`;

/** Split an agent's reply back into labelled paragraphs. */
export function parseLabelledMarkdown(text: string): ParsedEntry[] {
  return text
    .split(/\n{2,}/)
    .map(chunk => chunk.trim())
    .filter(Boolean)
    .map(chunk => {
      const handleMatch = chunk.match(HANDLE_PATTERN);
      if (handleMatch) {
        return {
          handle: handleMatch[1] as string,
          isNew: false,
          markdown: chunk.replace(HANDLE_PATTERN, '').trim(),
        };
      }
      if (NEW_PATTERN.test(chunk)) {
        return { handle: null, isNew: true, markdown: chunk.replace(NEW_PATTERN, '').trim() };
      }
      // Bare: label dropped — recoverable later by similarity matching.
      return { handle: null, isNew: false, markdown: chunk };
    });
}

export interface DerivedOp {
  op: 'insert' | 'replace' | 'delete' | 'move';
  /** Stable key within one reply. */
  key: string;
  blockId?: string;
  anchor?: string | null;
  beforeContent?: BlockNoteBlock;
  afterMarkdown?: string;
  orderIndex: number;
}

/** Longest common subsequence of two id sequences — the blocks that did NOT move. */
export function lcsStationary(a: string[], b: string[]): Set<string> {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] = a[i - 1] === b[j - 1] ? dp[i - 1]![j - 1]! + 1 : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }
  const keep = new Set<string>();
  let i = a.length;
  let j = b.length;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      keep.add(a[i - 1] as string);
      i--;
      j--;
    } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) i--;
    else j--;
  }
  return keep;
}

/**
 * Turn the agent's parsed reply into operation descriptions.
 * Known label + same text = nothing; changed text = replace (same block id);
 * label out of order = move; [new]/unknown/duplicate label = insert;
 * label missing from the reply = delete, only for blocks the agent saw.
 */
export function deriveOps({
  current,
  entries,
  handleMap,
  render,
  seenBlockIds,
}: {
  current: BlockNoteBlock[];
  entries: ParsedEntry[];
  handleMap: HandleMap;
  render: (block: BlockNoteBlock) => string;
  seenBlockIds?: Set<string>;
}): DerivedOp[] {
  const byId = new Map<string, BlockNoteBlock>();
  for (const b of current) {
    const id = (b as { id?: string }).id;
    if (id) byId.set(id, b);
  }

  // Resolve entries to block ids; first claim wins, a duplicate label becomes an insert.
  const claimed = new Set<string>();
  const resolved = entries.map(entry => {
    const id = entry.handle ? handleMap.get(entry.handle) : undefined;
    if (id && byId.has(id) && !claimed.has(id)) {
      claimed.add(id);
      return { entry, id };
    }
    return { entry, id: null as string | null };
  });

  const docKept = current
    .map(b => (b as { id?: string }).id)
    .filter((id): id is string => Boolean(id) && claimed.has(id as string));
  const replyKept = resolved.filter(r => r.id).map(r => r.id as string);
  const stationary = lcsStationary(docKept, replyKept);

  const ops: DerivedOp[] = [];
  let order = 0;
  let lastStationary: string | null = null; // last block the agent left in place; null = top
  for (const { entry, id } of resolved) {
    if (id) {
      const block = byId.get(id) as BlockNoteBlock;
      if (render(block).trim() !== entry.markdown.trim()) {
        ops.push({
          op: 'replace', key: `op${order}`, blockId: id,
          beforeContent: block, afterMarkdown: entry.markdown, orderIndex: order++,
        });
      }
      if (stationary.has(id)) {
        lastStationary = id;
      } else {
        ops.push({ op: 'move', key: `op${order}`, blockId: id, anchor: lastStationary, orderIndex: order++ });
      }
    } else {
      ops.push({
        op: 'insert', key: `op${order}`, anchor: lastStationary,
        afterMarkdown: entry.markdown, orderIndex: order++,
      });
    }
  }

  // Deletions: blocks the agent saw but did not return.
  for (const b of current) {
    const id = (b as { id?: string }).id;
    if (!id || claimed.has(id)) continue;
    if (!seenBlockIds || !seenBlockIds.has(id)) continue;
    ops.push({ op: 'delete', key: `op${order}`, blockId: id, beforeContent: b, orderIndex: order++ });
  }
  return ops;
}
