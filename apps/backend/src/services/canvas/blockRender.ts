/**
 * Render individual blocks to markdown.
 * Per-block rather than whole-document on purpose: markdown is lossy, so we
 * confine that loss to one paragraph at a time instead of laundering the
 * entire document through it. Block ids and comment marks never pass through
 * here at all.
 */

import { ServerBlockNoteEditor } from '@blocknote/server-util';
import type { BlockNoteBlock } from '@/types/blockNoteTypes';

export interface BlockRenderer {
  render: (block: BlockNoteBlock) => string;
  toBlocks: (markdown: string) => Promise<BlockNoteBlock[]>;
}

export async function createBlockRenderer(
  blocks: BlockNoteBlock[]
): Promise<BlockRenderer> {
  const editor = ServerBlockNoteEditor.create();
  const cache = new Map<string, string>();

  for (const block of blocks) {
    const id = (block as { id?: string }).id;
    if (!id) continue;
    try {
      cache.set(id, (await editor.blocksToMarkdownLossy([block] as never)).trim());
    } catch {
      cache.set(id, plainText(block));
    }
  }

  return {
    render: block => {
      const id = (block as { id?: string }).id;
      return (id && cache.get(id)) ?? plainText(block);
    },
    toBlocks: async markdown =>
      (await editor.tryParseMarkdownToBlocks(markdown)) as unknown as BlockNoteBlock[],
  };
}

function plainText(block: BlockNoteBlock): string {
  const content = (block as { content?: unknown }).content;
  if (!Array.isArray(content)) return '';
  return content
    .map(c => (c as { text?: string }).text ?? '')
    .join('')
    .trim();
}
