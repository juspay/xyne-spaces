import React from 'react';
import { ActionModal } from '../ActionModal/ActionModal';

interface AFKWarningModalProps {
  isOpen: boolean;
  secondsRemaining: number;
  onStay: () => void;
  onLeave: () => void;
}

export function AFKWarningModal({
  isOpen,
  secondsRemaining,
  onStay,
  onLeave,
}: AFKWarningModalProps): React.ReactElement {
  return (
    <ActionModal
      isOpen={isOpen}
      onClose={onStay}
      title="You're alone in this call"
      subtitle={`The call will automatically end in ${secondsRemaining} second${secondsRemaining !== 1 ? 's' : ''}.`}
      testId='afk-warning-modal'
      buttons={[
        {
          label: 'Stay',
          onClick: onStay,
          variant: 'outline',
          trackName: 'AFK_WARNING_STAY',
        },
        {
          label: 'Leave',
          onClick: onLeave,
          trackName: 'AFK_WARNING_LEAVE',
          className: 'bg-[#6276BE] hover:bg-[#5264a8] text-white',
        },
      ]}
    />
  );
}
