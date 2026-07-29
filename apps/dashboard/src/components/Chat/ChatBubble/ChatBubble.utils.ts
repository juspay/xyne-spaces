import { BlockNoteEditor, PartialBlock } from '@blocknote/core';

export const convertHtmlToBlocks = (html: string): PartialBlock[] => {
  try {
    const editor = BlockNoteEditor.create();
    const blocks = editor.tryParseHTMLToBlocks(html);
    return blocks;
  } catch {
    // Fallback to empty paragraph if conversion fails
    return [{ type: 'paragraph', content: [] }];
  }
};
