import React, { useEffect, useState } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import type {
  BlockNoteEditor,
  BlockSchema,
  InlineContentSchema,
  StyleSchema,
} from '@blocknote/core';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import { useTheme } from '../../../hooks/useTheme';

interface SummaryCanvasPreviewProps {
  markdown: string;
}

export const SummaryCanvasPreview: React.FC<SummaryCanvasPreviewProps> = ({ markdown }) => {
  const { theme } = useTheme();
  const editor = useCreateBlockNote();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve(editor.tryParseMarkdownToBlocks(markdown)).then(blocks => {
      if (cancelled) return;
      editor.replaceBlocks(editor.document, blocks);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [markdown, editor]);

  if (!ready) {
    return <p className='text-[13px] text-muted-foreground'>Loading preview…</p>;
  }

  return (
    <BlockNoteView
      editor={editor as unknown as BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>}
      editable={false}
      theme={theme === 'midnight' ? 'dark' : 'light'}
    />
  );
};
