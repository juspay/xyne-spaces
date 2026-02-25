import React, { useState, memo, useCallback } from 'react';
import { Trash2, Loader2, X } from 'lucide-react';
import Dialog from '../../ui/Dialog';
import { cn } from '../../../utils/classNames';
import Button from '../../ui/Button';

type DeleteButtonVariant = 'default' | 'overlay';

interface DeleteButtonProps {
  fileName: string;
  variant?: DeleteButtonVariant;
  onDelete: () => void | Promise<void>;
  onDeleteStart?: () => void;
  onDeleteComplete?: () => void;
  onDeleteError?: (error: Error) => void;
  showLabel?: boolean;
  className?: string;
}

const VARIANT_STYLES: Record<DeleteButtonVariant, string> = {
  default: 'flex-shrink-0 text-gray-600 dark:text-gray-400 hover:text-red-600 text-red-500',
  overlay: 'hover:bg-white/20 text-white hover:text-red-400',
} as const;

const ICON_SIZES: Record<DeleteButtonVariant, number> = {
  default: 15,
  overlay: 18,
} as const;

export const DeleteButton = memo<DeleteButtonProps>(
  ({
    fileName,
    variant = 'default',
    onDelete,
    onDeleteStart,
    onDeleteComplete,
    onDeleteError,
    showLabel = false,
    className,
  }) => {
    const [isDeleting, setIsDeleting] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    const handleDelete = useCallback((e: React.MouseEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      setShowDeleteConfirm(true);
    }, []);

    const handleConfirmDelete = useCallback(async (): Promise<void> => {
      setIsDeleting(true);
      onDeleteStart?.();

      try {
        await onDelete();
        setShowDeleteConfirm(false);
        onDeleteComplete?.();
      } catch (error) {
        const err = error instanceof Error ? error : new Error('Delete failed');
        onDeleteError?.(err);
      } finally {
        setIsDeleting(false);
      }
    }, [onDelete, onDeleteStart, onDeleteComplete, onDeleteError]);

    const buttonLabel = isDeleting ? 'Deleting...' : `Delete ${fileName}`;

    return (
      <>
        <button
          type='button'
          onClick={handleDelete}
          disabled={isDeleting}
          className={cn(
            'p-2 rounded-md transition-colors duration-200 disabled:opacity-50 flex items-center gap-2',
            VARIANT_STYLES[variant],
          )}
          title={buttonLabel}
          aria-label={buttonLabel}
          aria-busy={isDeleting}
          data-track-category='MESSAGE_ATTACHMENT'
          data-track-name='DeleteAttachment'
          data-track-metadata={JSON.stringify({ fileName })}
        >
          {isDeleting ? (
            <Loader2 size={ICON_SIZES[variant]} className='animate-spin' aria-hidden='true' />
          ) : (
            <Trash2 size={ICON_SIZES[variant]} aria-hidden='true' />
          )}
          {showLabel && (
            <span className={cn('ml-2 text-sm', className)}>
              {isDeleting ? 'Deleting...' : 'Delete'}
            </span>
          )}
        </button>

        <Dialog
          open={showDeleteConfirm}
          onOpenChange={setShowDeleteConfirm}
          title='Delete Attachment'
          description='Are you sure you want to delete this attachment? This action cannot be undone.'
        >
          <div className='p-6'>
            <div className='flex items-start justify-between mb-4'>
              <div className='flex-1'>
                <h2 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
                  Delete Attachment
                </h2>
                <p className='text-sm text-gray-600 dark:text-gray-400 mt-1'>
                  Are you sure you want to delete this attachment?
                </p>
              </div>
              <Button
                type='button'
                onClick={() => setShowDeleteConfirm(false)}
                variant='secondary'
                aria-label='Close dialog'
              >
                <X size={20} />
              </Button>
            </div>

            <div className='border-t border-gray-200 dark:border-gray-700 mb-4' />

            <div className='space-y-3 mb-6'>
              <p className='text-sm text-gray-600 dark:text-gray-400'>
                This action cannot be undone.
              </p>
              <div className='bg-gray-50 dark:bg-gray-900 rounded-md p-3 border border-gray-200 dark:border-gray-700'>
                <p className='text-sm font-medium text-gray-900 dark:text-gray-100 truncate'>
                  {fileName}
                </p>
              </div>
            </div>

            <div className='flex gap-3 justify-end'>
              <Button
                type='button'
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
                variant='secondary'
              >
                Cancel
              </Button>
              <Button
                type='button'
                onClick={() => void handleConfirmDelete()}
                disabled={isDeleting}
                variant='destructive'
              >
                {isDeleting && <Loader2 size={16} className='animate-spin' />}
                {isDeleting ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>
        </Dialog>
      </>
    );
  },
);

DeleteButton.displayName = 'DeleteButton';
