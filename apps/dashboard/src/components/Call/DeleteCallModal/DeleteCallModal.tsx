import React from 'react';
import { Trash2, X } from 'lucide-react';
import { Dialog } from '../../ui/Dialog/Dialog';
import { Button } from '../../ui/Button/Button';
import { Checkbox } from '../../ui/Checkbox/Checkbox';

interface DeleteCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (cancelEntireSeries: boolean) => void;
  callLabel: string;
  isRecurring?: boolean;
}

export const DeleteCallModal: React.FC<DeleteCallModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  callLabel,
  isRecurring = false,
}) => {
  const [cancelEntireSeries, setCancelEntireSeries] = React.useState(false);

  React.useEffect(() => {
    if (isOpen) setCancelEntireSeries(false);
  }, [isOpen]);

  const handleConfirm = (): void => {
    onConfirm(cancelEntireSeries);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <div className='flex flex-col w-[472px] max-w-full'>
        {/* ── Header row ── */}
        <div className='flex items-center justify-between px-5 py-3'>
          <div className='flex items-center gap-1.5'>
            <div className='w-7 h-7 rounded-full bg-destructive/10 flex items-center justify-center shrink-0'>
              <Trash2 className='size-4 text-destructive' />
            </div>
            <h2 className='text-[15px] font-semibold text-foreground'>Delete Call?</h2>
          </div>
          <button
            onClick={onClose}
            data-track-category='CALLS'
            data-track-name='close-delete-modal'
            className='w-7 h-7 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors'
          >
            <X className='size-3.5 text-primary' />
          </button>
        </div>

        <div className='h-px bg-border' />

        {/* ── Body ── */}
        <div className='px-5 pt-6 pb-5 flex flex-col gap-4'>
          <div className='flex flex-col gap-1'>
            {/* Call label */}
            <p className='text-[15px] font-semibold text-foreground'>{callLabel}</p>

            {/* Description */}
            <p className='text-[13px] text-muted-foreground leading-relaxed'>
              If you delete the call will be gone forever. Are you sure you want to proceed?
            </p>
          </div>

          {/* Recurring series toggle — no box, just checkbox + label */}
          {isRecurring && (
            <Checkbox
              checked={cancelEntireSeries}
              onChange={setCancelEntireSeries}
              label='Cancel the entire recurring series'
            />
          )}

          {/* Buttons */}
          <div className='flex items-center justify-between pt-1'>
            <Button
              variant='outline'
              className='h-9 rounded-[8px] px-5 py-2.5 gap-2'
              onClick={onClose}
              data-track-category='CALLS'
              data-track-name='CANCEL_DELETE_CALL'
            >
              Cancel
            </Button>
            <Button
              className='h-9 rounded-[8px] px-5 py-2.5 gap-2 bg-destructive hover:bg-destructive/90 text-destructive-foreground border-0'
              onClick={handleConfirm}
              data-track-category='CALLS'
              data-track-name='CONFIRM_DELETE_CALL'
            >
              Delete
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
};
