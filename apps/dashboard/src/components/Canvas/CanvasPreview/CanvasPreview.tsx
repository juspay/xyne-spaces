import React, { useEffect, useMemo } from 'react';
import { FileText, X } from 'lucide-react';
import { useParams, useLocation } from 'react-router-dom';
import { useShareableOrigin } from '../../../hooks/useShareableOrigin';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import { BlockNoteEditor, BlockSchema, InlineContentSchema, StyleSchema } from '@blocknote/core';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';

import { canvasSchema, knownCanvasBlockTypes } from '../canvasSchema';
import { resolveFileUrl, removeUnknownBlocks } from '../../../utils/canvasUtils';
import { queries } from '../../../zero/queries';
import { Canvas } from '../Canvas.types';
import { useRouteContext } from '../../../hooks/useRouteContext';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { usePlatform } from '../../../hooks/usePlatform';
import { useTheme } from '../../../hooks/useTheme';
import { useNavigate } from '../../../hooks/useWorkspaceNavigate';

interface CanvasPreviewProps {
  canvasId?: string;
  onClose?: () => void;
  expanded?: boolean;
}

export const CanvasPreview: React.FC<CanvasPreviewProps> = ({
  canvasId: propCanvasId,
  onClose,
  expanded = false,
}) => {
  const navigate = useNavigate();
  const shareableOrigin = useShareableOrigin();
  const location = useLocation();
  const { baseRoute } = useRouteContext();
  const { isMobile } = usePlatform();
  const { theme } = useTheme();
  const blockNoteTheme = theme === 'midnight' ? 'dark' : 'light';
  const { canvasId: paramsCanvasId, channelId } = useParams<{
    canvasId: string;
    channelId: string;
  }>();
  const canvasId = propCanvasId || paramsCanvasId;

  const [zeroCanvas, zeroCanvasDetails] = useCachedQuery(
    queries.getCanvas({ canvasId: canvasId || '' }),
    {
      enabled: !!canvasId,
    },
  );
  const canvas = zeroCanvas as unknown as Canvas;

  // Ensure we have valid content for BlockNote (blocks unknown to the schema stripped)
  const validContent = useMemo(
    () =>
      canvas?.content && Array.isArray(canvas.content) && canvas.content.length > 0
        ? removeUnknownBlocks(canvas.content, knownCanvasBlockTypes)
        : undefined,
    [canvas?.content],
  );

  // Create a read-only editor instance with URL resolver
  const editor = useCreateBlockNote({
    schema: canvasSchema,
    resolveFileUrl,
    ...(validContent ? { initialContent: validContent } : {}),
  });

  useEffect(() => {
    if (validContent && editor) {
      editor.replaceBlocks(editor.document, validContent);
    }
  }, [validContent, editor]);

  const handleClose = (event: React.MouseEvent): void => {
    event.stopPropagation();
    if (onClose) {
      onClose();
    }
  };

  const handleNavigate = (event?: React.MouseEvent): void => {
    // Check for Cmd/Ctrl+Click to open in new tab (desktop only)
    const isCmdClick = event?.metaKey || event?.ctrlKey;
    if (!isMobile && isCmdClick && canvasId) {
      const canvasUrl = `${shareableOrigin}/chat/canvas/${canvasId}`;
      window.open(canvasUrl, '_blank');
      return;
    }

    // Hash-based overlay is only handled by ChatView (under /chat/*). Outside of
    // /chat/* (e.g. /support/*) the hash listener doesn't exist, so fall through
    // to a full-page navigation to /chat/canvas/{id}.
    const isChatRoute = location.pathname.startsWith('/chat/');
    if (channelId && canvasId && isChatRoute) {
      void navigate(`${location.pathname}#canvas=${canvasId}`);
    } else if (canvasId) {
      void navigate(`/chat/canvas/${canvasId}`);
    } else {
      void navigate(`${baseRoute}/canvas/`);
    }
  };

  if (!canvas) {
    const isLoading = zeroCanvasDetails?.type !== 'complete';

    if (isLoading) {
      return (
        <div className='relative flex flex-col bg-card rounded-2xl border border-border w-full max-w-[460px] overflow-hidden animate-pulse'>
          <div className='flex items-start gap-3 p-3 pr-8 border-b border-border'>
            <div className='flex-shrink-0 p-2 bg-muted rounded-lg'>
              <FileText size={18} className='text-muted-foreground/30' />
            </div>
            <div className='flex-1 min-w-0 space-y-2 py-1'>
              <div className='h-4 bg-muted rounded w-3/4' />
              <div className='h-3 bg-muted rounded w-1/4' />
            </div>
          </div>
          <div className='w-full bg-card p-4'>
            <div className='h-[220px] bg-muted rounded' />
          </div>
        </div>
      );
    }

    return (
      <div className='relative flex items-center gap-3 p-3 bg-card rounded-2xl border border-border w-full max-w-[460px]'>
        {onClose && (
          <button
            type='button'
            className='absolute top-2 right-2 z-10 p-1 rounded-full bg-muted/80 hover:bg-muted transition-colors duration-150 focus:outline-none'
            onClick={handleClose}
            aria-label='Close preview'
            data-track-category='CANVAS'
            data-track-name='Close_Canvas_Preview'
            data-track-metadata={JSON.stringify({ canvasId })}
          >
            <X size={12} className='text-muted-foreground' />
          </button>
        )}
        <div className='flex-shrink-0 p-2 bg-muted rounded-md text-muted-foreground'>
          <FileText size={20} />
        </div>
        <div className='flex-1 min-w-0 mr-4'>
          <h4 className='text-sm font-medium text-muted-foreground italic'>
            Canvas not found or access denied
          </h4>
        </div>
      </div>
    );
  }

  // Collaborative canvases show a placeholder since content lives in Y-Sweet
  if (!canvas.content || canvas.isCollaborative) {
    return (
      <div
        className='relative flex items-center gap-3 p-3 bg-card rounded-2xl border border-border w-full max-w-[460px] hover:shadow-sm transition-shadow cursor-pointer'
        onClick={handleNavigate}
        role='button'
        tabIndex={0}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            handleNavigate();
          }
        }}
        data-track-category='CANVAS'
        data-track-name='Navigate_To_Canvas'
        data-track-metadata={JSON.stringify({ canvasId: canvas.id, title: canvas.title })}
      >
        {onClose && (
          <button
            type='button'
            className='absolute top-2 right-2 z-10 p-1 rounded-full bg-muted/80 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-border'
            onClick={handleClose}
            aria-label='Close preview'
            data-track-category='CANVAS'
            data-track-name='Close_Canvas_Preview'
            data-track-metadata={JSON.stringify({ canvasId })}
          >
            <X size={14} className='text-muted-foreground' />
          </button>
        )}
        <div className='flex-shrink-0 p-2 bg-status-success rounded-lg text-white'>
          <FileText size={18} />
        </div>
        <div className='flex-1 min-w-0'>
          <h4 className='text-[13px] font-semibold text-foreground truncate'>{canvas.title}</h4>
          <div className='text-xs text-muted-foreground mt-0.5'>Click to open canvas</div>
        </div>
      </div>
    );
  }

  if (expanded) {
    return (
      <div className='w-full canvas-surface'>
        <BlockNoteView
          editor={
            editor as unknown as BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>
          }
          editable={false}
          theme={blockNoteTheme}
          sideMenu={false}
          formattingToolbar={false}
        />
      </div>
    );
  }

  return (
    <div
      className='relative flex flex-col bg-card rounded-2xl border border-border w-full max-w-[460px] hover:shadow-sm transition-shadow cursor-pointer overflow-hidden'
      onClick={handleNavigate}
      data-track-category='CANVAS'
      data-track-name='Navigate_To_Canvas'
      data-track-metadata={JSON.stringify({ canvasId: canvas.id, title: canvas.title })}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          handleNavigate();
        }
      }}
      role='button'
      tabIndex={0}
    >
      {onClose && (
        <button
          type='button'
          className='absolute top-2 right-2 z-10 p-1 rounded-full bg-muted/80 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-border'
          onClick={handleClose}
          aria-label='Close preview'
          data-track-category='CANVAS'
          data-track-name='Close_Canvas_Preview'
          data-track-metadata={JSON.stringify({ canvasId })}
        >
          <X size={14} className='text-muted-foreground' />
        </button>
      )}

      {/* Header Section */}
      <div className='flex items-start gap-3 p-3 pr-8 border-b border-border'>
        <div className='flex-shrink-0 p-2 bg-status-success rounded-lg text-white'>
          <FileText size={18} />
        </div>
        <div className='flex-1 min-w-0'>
          <h4 className='text-[13px] font-semibold text-foreground truncate'>{canvas.title}</h4>
          <div className='text-xs text-muted-foreground mt-0.5'>Canvas</div>
        </div>
      </div>

      {/* Rich Preview Section */}
      <div className='w-full relative bg-card'>
        <div className='max-h-[220px] overflow-hidden relative pointer-events-none select-none'>
          {/* canvas-surface is what makes this render like the real canvas — see global.css */}
          <div className='canvas-surface canvas-surface-preview'>
            <BlockNoteView
              editor={
                editor as unknown as BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>
              }
              editable={false} // Read-only mode
              theme={blockNoteTheme}
              sideMenu={false} // Hide side menu
              formattingToolbar={false} // Hide formatting toolbar
            />
          </div>
          {/* Subtle gradient overlay at the very bottom */}
          <div className='absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-card to-transparent pointer-events-none' />
        </div>
      </div>
    </div>
  );
};
