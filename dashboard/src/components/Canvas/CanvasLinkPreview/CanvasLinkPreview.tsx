import React from 'react';
import { FileText, X } from 'lucide-react';
import type { Canvas } from '../Canvas.types';
import { CanvasRole } from '@xyne/shared';

export interface CanvasLinkPreviewProps {
  /** The canvas to display */
  canvas: Canvas;
  /** Callback when the remove button is clicked */
  onRemove: () => void;
}

/**
 * CanvasLinkPreview
 *
 * A compact preview card for an attached canvas in the message composer.
 * Shows canvas icon, title, and edit permission status.
 */
export const CanvasLinkPreview: React.FC<CanvasLinkPreviewProps> = ({ canvas, onRemove }) => {
  const canEdit =
    canvas.accessLevel === CanvasRole.EDITOR || canvas.accessLevel === CanvasRole.OWNER;

  return (
    <div
      className='flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-lg shadow-sm w-fit max-w-md'
      data-testid='canvas-link-preview'
    >
      {/* Canvas Icon */}
      <div className='flex-shrink-0 w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center'>
        <FileText className='w-5 h-5 text-blue-500' />
      </div>

      {/* Canvas Info */}
      <div className='flex-1 min-w-0'>
        <p className='font-medium text-gray-900 truncate' title={canvas.title}>
          {canvas.title || 'Untitled Canvas'}
        </p>
        <p className='text-sm text-blue-600'>{canEdit ? 'Can edit' : 'Can view'}</p>
      </div>

      {/* Remove Button */}
      <button
        onClick={onRemove}
        className='flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 transition-colors rounded hover:bg-gray-100'
        aria-label='Remove canvas attachment'
        data-testid='canvas-link-preview-remove'
        data-track-category='CANVAS'
        data-track-name='Remove_Attached_Canvas'
      >
        <X className='w-4 h-4' />
      </button>
    </div>
  );
};

CanvasLinkPreview.displayName = 'CanvasLinkPreview';
