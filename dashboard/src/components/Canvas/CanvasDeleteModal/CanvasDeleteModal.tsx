import React from 'react';
import { Button } from '../../ui/Button';

export interface CanvasDeleteModalProps {
  onClose: () => void;
  onConfirm: () => void;
  canvasTitle?: string | undefined;
}

export const CanvasDeleteModal: React.FC<CanvasDeleteModalProps> = ({
  onClose,
  onConfirm,
  canvasTitle,
}) => {
  return (
    <div className='p-6'>
      <h2 className='text-lg font-semibold text-gray-900 mb-2'>Delete Canvas</h2>
      <p className='text-gray-600 mb-6'>
        Are you sure you want to delete{canvasTitle ? ` "${canvasTitle}"` : ' this canvas'}? This
        action cannot be undone.
      </p>
      <div className='flex justify-end gap-3'>
        <Button variant='secondary' onClick={onClose}>
          Cancel
        </Button>
        <Button variant='destructive' onClick={onConfirm}>
          Delete
        </Button>
      </div>
    </div>
  );
};
