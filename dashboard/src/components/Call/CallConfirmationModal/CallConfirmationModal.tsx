import React from 'react';
import { Dialog } from '../../ui/Dialog/Dialog';
import HuddleIcon from '../../icons/HuddleIcon';
import { Button } from '../../ui/Button/Button';

interface CallConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  subtitle?: string;
  description?: string | undefined;
}

/**
 * CallConfirmationModal Component
 *
 * A confirmation modal that appears before starting a call in a channel
 * to prevent accidental calls.
 */
export const CallConfirmationModal: React.FC<CallConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title = 'Start a call in this channel?',
  subtitle = 'Every person in the channel will be able to join your call.',
  description,
}) => {
  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <div className='p-6 flex flex-col max-w-[460px]' data-testid='confirm-call-modal'>
        {/* Icon */}
        <div className='w-10 h-10 rounded-xl bg-indigo-100/60 border border-indigo-200/80 flex items-center justify-center mb-5'>
          <div className='scale-[1.25]'>
            <HuddleIcon color='#6276BE' />
          </div>
        </div>

        {/* Title */}
        <h2 className='text-[15px] font-semibold text-gray-900 mb-1'>{title}</h2>

        {/* Subtitle */}
        <p className='text-[13px] text-gray-600 leading-relaxed mb-5 break-words'>{subtitle}</p>

        {/* Optional Description */}
        {description && <p className='text-xs text-gray-500 mb-4 break-words'>{description}</p>}

        {/* Custom Buttons */}
        <div className='flex items-center justify-between'>
          <Button onClick={onClose} variant='outline' size='sm'>
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            size='sm'
            className='bg-[#6276BE] hover:bg-[#5264a8] text-white'
            data-testid='confirm-call-button'
          >
            Okay
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
