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
import { canvasSchema, knownCanvasBlockTypes } from '../../Canvas/canvasSchema';
import { CanvasRenderBoundary } from '../../Canvas/CanvasRenderBoundary';
import { removeUnknownBlocks } from '../../../utils/canvasUtils';
import { logger, Event } from '../../../utils/logger';
import { useTheme } from '../../../hooks/useTheme';

interface SummaryCanvasPreviewProps {
  markdown: string;
}

const SummaryCanvasPreviewContent: React.FC<SummaryCanvasPreviewProps> = ({ markdown }) => {
  const { theme } = useTheme();
  const editor = useCreateBlockNote({ schema: canvasSchema });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve(editor.tryParseMarkdownToBlocks(markdown)).then(blocks => {
      if (cancelled) return;
      try {
        // Markdown from a summary template can put a link inside a fenced
        // block; repair it the same way stored canvases are (XYNE-65102).
        editor.replaceBlocks(
          editor.document,
          removeUnknownBlocks(blocks, knownCanvasBlockTypes),
        );
      } catch (error) {
        // Thrown inside a promise, so the render boundary cannot see it.
        logger.error(Event.CANVAS_RENDER_FAILED, {
          surface: 'summary-canvas-preview',
          message: error instanceof Error ? error.message : String(error),
        });
      }
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
    // canvas-surface is what makes this render like the real canvas — see global.css.
    // The 24px gutter matches the hosting panel's px-6 empty state.
    <div className='canvas-surface canvas-surface-preview [--canvas-gutter:24px]'>
      <BlockNoteView
        editor={editor as unknown as BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>}
        editable={false}
        theme={theme === 'midnight' ? 'dark' : 'light'}
      />
    </div>
  );
};

/** Summary template preview, contained so a bad template cannot crash call settings. */
export const SummaryCanvasPreview: React.FC<SummaryCanvasPreviewProps> = (props): React.ReactElement => (
  <CanvasRenderBoundary surface='summary-canvas-preview' compact>
    <SummaryCanvasPreviewContent {...props} />
  </CanvasRenderBoundary>
);
