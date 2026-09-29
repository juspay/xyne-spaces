import { describe, expect, it, vi } from 'vitest';
import { BlockNoteEditor } from '@blocknote/core';

vi.mock('../services/clients/fileFetchService', () => ({ createPreviewUrl: vi.fn() }));
vi.mock('../services/clients/apiClient', () => ({ BASE_URL: '' }));
vi.mock('./logger', () => ({ logger: { error: vi.fn() }, Event: {} }));

import { removeUnknownBlocks } from './canvasUtils';

const URL_TEXT = 'https://github.com/juspay/{adapter}.git';

// Shape of the stored canvas that crashed "My Canvas" (XYNE-65102): a URL
// inside a fenced code block was saved as a link inline node.
const codeBlockWithLink = (): Record<string, unknown>[] => [
  {
    type: 'codeBlock',
    props: { language: 'bash' },
    content: [
      { type: 'text', text: 'git clone ', styles: {} },
      { type: 'link', href: URL_TEXT, content: [{ type: 'text', text: URL_TEXT, styles: {} }] },
    ],
  },
];

const knownTypes = (editor: BlockNoteEditor): Set<string> =>
  new Set(Object.keys(editor.schema.blockSchema));

describe('removeUnknownBlocks', () => {
  it('raw content with a link inside a codeBlock breaks editor creation', () => {
    expect(() => BlockNoteEditor.create({ initialContent: codeBlockWithLink() as never })).toThrow(
      /initialContent/,
    );
  });

  it('flattens links and styles inside a codeBlock so the editor can be created', () => {
    const known = knownTypes(BlockNoteEditor.create());
    const cleaned = removeUnknownBlocks(codeBlockWithLink(), known);

    expect(cleaned[0].content).toEqual([
      { type: 'text', text: `git clone ${URL_TEXT}`, styles: {} },
    ]);

    const editor = BlockNoteEditor.create({ initialContent: cleaned as never });
    expect(editor.document[0].type).toBe('codeBlock');
  });

  it('strips styled text inside nested codeBlocks and leaves other blocks untouched', () => {
    const known = knownTypes(BlockNoteEditor.create());
    const paragraph = {
      type: 'paragraph',
      content: [
        { type: 'link', href: URL_TEXT, content: [{ type: 'text', text: 'repo', styles: {} }] },
      ],
      children: [
        {
          type: 'codeBlock',
          content: [{ type: 'text', text: 'npm i', styles: { bold: true } }],
        },
      ],
    };

    const [cleaned] = removeUnknownBlocks([paragraph], known);

    expect(cleaned.content).toBe(paragraph.content);
    expect((cleaned.children as { content: unknown }[])[0].content).toEqual([
      { type: 'text', text: 'npm i', styles: {} },
    ]);
  });

  it('still drops blocks with no spec in the schema', () => {
    const cleaned = removeUnknownBlocks(
      [{ type: 'paragraph' }, { type: 'mysteryBlock' }],
      new Set(['paragraph']),
    );
    expect(cleaned.map(b => b.type)).toEqual(['paragraph']);
  });
});
