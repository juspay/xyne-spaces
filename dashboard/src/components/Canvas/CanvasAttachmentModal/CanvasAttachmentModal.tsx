import React, { useState, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { CanvasList } from '../CanvasList';
import { Button } from '../../ui/Button';
import type { Canvas } from '../Canvas.types';
import { useAuth } from '../../../hooks/useAuth';
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

  if (!isOpen) {
    return null;
  }

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center'>
      {/* Backdrop */}
      <button
        type='button'
        className='absolute inset-0 bg-black/50 backdrop-blur-sm cursor-default'
        onClick={handleClose}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            handleClose();
          }
        }}
        aria-label='Close modal'
        data-testid='canvas-attachment-backdrop'
        data-track-category='CANVAS'
        data-track-name='Close_Attachment_Modal_Backdrop'
      />

      {/* Modal */}
      <div className='relative z-10 w-full max-w-2xl max-h-[80vh] bg-white rounded-lg shadow-lg flex flex-col m-4'>
        {/* Header */}
        <div className='flex items-center justify-between px-6 py-4 border-b border-gray-200'>
          <h2 className='text-lg font-semibold text-gray-900'>Attach a canvas</h2>
          <button
            onClick={handleClose}
            className='text-gray-400 hover:text-gray-600 transition-colors'
            aria-label='Close'
            data-testid='canvas-attachment-close'
            data-track-category='CANVAS'
            data-track-name='Close_Attachment_Modal'
          >
            <svg
              xmlns='http://www.w3.org/2000/svg'
              width='20'
              height='20'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
              strokeLinecap='round'
              strokeLinejoin='round'
            >
              <line x1='18' y1='6' x2='6' y2='18'></line>
              <line x1='6' y1='6' x2='18' y2='18'></line>
            </svg>
          </button>
        </div>

        {/* Canvas List - Reuse existing component */}
        <div className='flex-1 overflow-y-auto min-h-0'>
          <CanvasList
            onSelect={handleSelectCanvas}
            currentUserId={user?.id}
            showQuartoDocsFilter={true}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            {...(selectedCanvas ? { selectedCanvasId: selectedCanvas.id } : {})}
          />
        </div>

        {/* Footer */}
        <div className='flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg'>
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
    </div>
  );
};

CanvasAttachmentModal.displayName = 'CanvasAttachmentModal';
