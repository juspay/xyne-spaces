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
- Never renumber, never invent labels, never reorder labels.
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

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

export function validateAgentResponse(
  entries: ParsedEntry[],
  handleMap: HandleMap,
  originalBlockCount: number
): ValidationResult {
  if (entries.length === 0) {
    return { ok: false, reason: 'Agent returned an empty document' };
  }

  const recognised = entries.filter(e => e.handle && handleMap.has(e.handle));
  if (originalBlockCount > 0 && recognised.length === 0) {
    return {
      ok: false,
      reason: 'Agent returned no recognisable block labels — refusing to treat this as a full rewrite',
    };
  }

  if (originalBlockCount >= 4 && entries.length < originalBlockCount / 2) {
    return {
      ok: false,
      reason: `Agent returned ${entries.length} of ${originalBlockCount} paragraphs — response looks truncated`,
    };
  }

  if (originalBlockCount >= 4 && recognised.length < originalBlockCount * 0.3) {
    return {
      ok: false,
      reason:
        `Only ${recognised.length} of ${originalBlockCount} existing paragraphs came back with their labels — ` +
        'refusing a wholesale replacement',
    };
  }

  return { ok: true };
}
