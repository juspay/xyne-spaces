import { ButtonType, Modal } from '@juspay/blend-design-system';
import React from 'react';
import { useEditContext } from '../../../providers/EditProvider';
import { globalClickTracker } from '../../../services/Analytics/globalClickTracker';

export const EditWarningModal = (): React.ReactElement => {
  const { pendingAction, stopEditing, clearPendingAction } = useEditContext();

  const handleKeepEditing = (): void => {
    globalClickTracker.trackManualEvent('MESSAGE', 'EDIT_WARNING_KEEP_EDITING');
    clearPendingAction(); // just dismiss modal
  };

  const handleContinue = (): void => {
    globalClickTracker.trackManualEvent('MESSAGE', 'EDIT_WARNING_CONTINUE');
    const next = pendingAction;
    stopEditing(); // clear current editingMessageId ONLY
    next?.(); // run the new action
    clearPendingAction();
  };

  return (
    <Modal
      isOpen={!!pendingAction}
      onClose={handleKeepEditing}
      title='You have unsaved edits'
      subtitle='If you continue, your current message changes will be lost.'
      showCloseButton={true}
      closeOnBackdropClick={true}
      showDivider={true}
      primaryAction={{
        text: 'Continue',
        onClick: handleContinue,
        buttonType: ButtonType.SECONDARY,
      }}
      secondaryAction={{
        text: 'Keep Editing',
        onClick: handleKeepEditing,
        buttonType: ButtonType.PRIMARY,
      }}
    >
      Are you sure you want to discard your current edits?
    </Modal>
  );
};
