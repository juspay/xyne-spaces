import React from 'react';
import { Button } from '../../ui/Button';

export interface CanvasDeleteModalProps {
  onClose: () => void;
  onConfirm: () => void;
  entityType?: 'canvas' | 'folder';
  itemTitle?: string | undefined;
  canvasTitle?: string | undefined;
}

export const CanvasDeleteModal: React.FC<CanvasDeleteModalProps> = ({
  onClose,
  onConfirm,
  entityType = 'canvas',
  itemTitle,
  canvasTitle,
}) => {
  const resolvedTitle = itemTitle ?? canvasTitle;
  const entityLabel = entityType === 'folder' ? 'Folder' : 'Canvas';
  const entityLower = entityType === 'folder' ? 'folder' : 'canvas';
  const cancelTrackName = entityType === 'folder' ? 'Cancel_Delete_Folder' : 'Cancel_Delete_Canvas';
  const confirmTrackName =
    entityType === 'folder' ? 'Confirm_Delete_Folder' : 'Confirm_Delete_Canvas';

  return (
    <div className='p-6'>
      <h2 className='text-lg font-semibold text-foreground mb-2'>Delete {entityLabel}</h2>
      <p className='text-muted-foreground mb-6'>
        Are you sure you want to delete
        {resolvedTitle ? ` "${resolvedTitle}"` : ` this ${entityLower}`}? This action cannot be
        undone.
      </p>
      <div className='flex justify-end gap-3'>
        <Button
          variant='secondary'
          onClick={onClose}
          data-track-category='CANVAS'
          data-track-name={cancelTrackName}
          data-track-metadata={JSON.stringify({ entityType, itemTitle: resolvedTitle })}
        >
          Cancel
        </Button>
        <Button
          variant='destructive'
          onClick={onConfirm}
          data-track-category='CANVAS'
          data-track-name={confirmTrackName}
          data-track-metadata={JSON.stringify({ entityType, itemTitle: resolvedTitle })}
        >
          Delete
        </Button>
      </div>
    </div>
  );
};
