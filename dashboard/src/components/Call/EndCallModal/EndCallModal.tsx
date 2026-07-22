import React from 'react';
import { ActionModal } from '../ActionModal';

interface EndCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  onEndForSelf: () => void;
  onEndForAll: () => void;
  isHost: boolean;
}

/**
 * EndCallModal - Shows options for ending a call
 * - Hosts can choose to end for everyone or just leave
 * - Regular participants just leave (no modal shown)
 */
export function EndCallModal({
  isOpen,
  onClose,
  onEndForSelf,
  onEndForAll,
  isHost,
}: EndCallModalProps): React.ReactElement | null {
  // Don't show modal for non-hosts, just disconnect them directly
  if (!isHost) {
    return null;
  }

  return (
    <ActionModal
      isOpen={isOpen}
      onClose={onClose}
      title='End the call or just leave?'
      subtitle="You can just leave the call if you don't want to end it for everyone else"
      testId='end-call-modal'
      buttons={[
        {
          label: 'End for everyone',
          onClick: onEndForAll,
          variant: 'outline',
        },
        {
          label: 'Just leave the call',
          onClick: onEndForSelf,
          className: 'bg-action-primary hover:bg-action-primary/90 text-action-primary-foreground',
        },
      ]}
    />
  );
}
