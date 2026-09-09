import React from 'react';
import { ActionModal } from '../ActionModal';

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
    <ActionModal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      description={description}
      testId='confirm-call-modal'
      buttons={[
        {
          label: 'Cancel',
          onClick: onClose,
          variant: 'outline',
          trackName: 'CANCEL_START_CALL',
        },
        {
          label: 'Okay',
          onClick: onConfirm,
          trackName: 'CONFIRM_START_CALL',
          className: 'bg-action-primary hover:bg-action-primary/90 text-action-primary-foreground',
          testId: 'confirm-call-button',
        },
      ]}
    />
  );
};
