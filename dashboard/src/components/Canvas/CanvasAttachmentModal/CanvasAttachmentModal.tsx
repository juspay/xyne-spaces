import React, { useState, useCallback } from 'react';
import { Plus, X } from 'lucide-react';
import { CanvasList } from '../CanvasList';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import type { Canvas } from '../Canvas.types';
import { useAuth } from '../../../hooks/useAuth';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { DocType } from '@xyne/shared';

type FilterTab = 'all' | 'created_by_me' | 'quarto_docs';

export interface CanvasAttachmentModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal is closed */
  onClose: () => void;
  /** Callback when a canvas is selected for insertion */
  onSelectCanvas: (canvas: Canvas) => void;
  /** Callback when user wants to create a new canvas */
  onCreateNewCanvas: () => void | Promise<void>;
}

/**
 * CanvasAttachmentModal
 *
 * A modal for selecting an existing canvas or creating a new one
 * to attach to a message. Reuses the CanvasList component.
 */
export const CanvasAttachmentModal: React.FC<CanvasAttachmentModalProps> = ({
  isOpen,
  onClose,
  onSelectCanvas,
  onCreateNewCanvas,
}) => {
  const { user } = useAuth();
  const [selectedCanvas, setSelectedCanvas] = useState<Canvas | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');

  // Fetch canvases - reuse same queries as CanvasPanel
  const [allCanvases] = useCachedQuery(queries.userCanvases());
  const [allQuartoDocs] = useCachedQuery(queries.userQuartoDocs());

  const canvases = (allCanvases as unknown as Canvas[]) || [];
  const quartoDocs = (allQuartoDocs as unknown as Canvas[]) || [];

  const handleSelectCanvas = useCallback((_e: React.MouseEvent | KeyboardEvent, canvas: Canvas) => {
    // Only allow selecting non-Quarto canvases for attachment
    if (canvas.docType === DocType.Quarto) {
      return;
    }
    setSelectedCanvas(canvas);
  }, []);

  const handleInsert = useCallback(() => {
    if (selectedCanvas) {
      onSelectCanvas(selectedCanvas);
      setSelectedCanvas(null);
    }
  }, [selectedCanvas, onSelectCanvas]);

  const handleCreateNew = useCallback(() => {
    setSelectedCanvas(null);
    void onCreateNewCanvas();
  }, [onCreateNewCanvas]);

  const handleClose = useCallback(() => {
    setSelectedCanvas(null);
    onClose();
  }, [onClose]);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => {
        if (!open) handleClose();
      }}
      title='Attach Canvas'
      className='max-w-2xl w-full max-h-[80vh] bg-white m-4 p-0 overflow-hidden'
    >
      <div className='flex flex-col h-full max-h-[80vh]'>
        {/* Header */}
        <div className='flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0'>
          <h2 className='text-lg font-semibold text-gray-900'>Attach Canvas</h2>
          <button
            onClick={handleClose}
            className='text-gray-400 hover:text-gray-600 transition-colors'
            aria-label='Close'
            data-testid='canvas-attachment-close'
            data-track-category='CANVAS'
            data-track-name='Close_Attachment_Modal'
          >
            <X className='w-5 h-5' />
          </button>
        </div>

        {/* Canvas List - Reuse existing component */}
        <div className='flex-1 overflow-y-auto min-h-0'>
          <CanvasList
            canvases={canvases}
            onSelect={handleSelectCanvas}
            loading={!allCanvases}
            {...(user?.id && { currentUserId: user.id })}
            quartoDocs={quartoDocs}
            showQuartoDocsFilter={true}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            {...(selectedCanvas ? { selectedCanvasId: selectedCanvas.id } : {})}
          />
        </div>

        {/* Footer */}
        <div className='flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg flex-shrink-0'>
          <Button
            variant='outline'
            onClick={handleCreateNew}
            data-testid='canvas-attachment-create-new'
            data-track-category='CANVAS'
            data-track-name='Create_New_Canvas_From_Attachment'
          >
            <Plus className='w-4 h-4 mr-2' />
            Create New Canvas
          </Button>

          <div className='flex items-center gap-3'>
            <Button variant='secondary' onClick={handleClose}>
              Cancel
            </Button>
            <Button
              variant='default'
              onClick={handleInsert}
              disabled={!selectedCanvas}
              data-testid='canvas-attachment-insert'
              data-track-category='CANVAS'
              data-track-name='Insert_Canvas_Link'
              data-track-metadata={JSON.stringify({
                canvasId: selectedCanvas?.id,
                title: selectedCanvas?.title,
              })}
            >
              Insert
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
};

CanvasAttachmentModal.displayName = 'CanvasAttachmentModal';
