import React from 'react';
import { ActionModal } from '../ActionModal';
import { DeleteTranscriptToggle } from './DeleteTranscriptToggle';

interface EndCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  onEndForSelf: () => void;
  onEndForAll: () => void;
  isHost: boolean;
  /** Show the delete-transcript toggle (host is ending while transcription is OFF). */
  showTranscriptOption?: boolean;
  deleteTranscript?: boolean;
  onDeleteTranscriptChange?: (deleteTranscript: boolean) => void;
  submitting?: boolean;
  error?: string | null;
}

/**
 * EndCallModal - host-only "end for everyone / just leave" dialog. When the host ends
 * while transcription is OFF (and isn't alone), it also carries the opt-in delete-
 * transcript choice. Discard is awaited before the call ends (see CustomLiveKitRoom).
 */
export function EndCallModal({
  isOpen,
  onClose,
  onEndForSelf,
  onEndForAll,
  isHost,
  showTranscriptOption = false,
  deleteTranscript = false,
  onDeleteTranscriptChange,
  submitting = false,
  error = null,
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
      content={
        showTranscriptOption ? (
          <DeleteTranscriptToggle
            deleteTranscript={deleteTranscript}
            onChange={onDeleteTranscriptChange ?? (() => undefined)}
            disabled={submitting}
            error={error}
          />
        ) : undefined
      }
      buttons={[
        {
          label: 'End for everyone',
          onClick: onEndForAll,
          variant: 'outline',
          disabled: submitting,
          trackName: 'END_CALL_FOR_EVERYONE',
        },
        {
          label: submitting ? 'Ending…' : 'Just leave the call',
          onClick: onEndForSelf,
          className: 'bg-action-primary hover:bg-action-primary/90 text-action-primary-foreground',
          disabled: submitting,
          trackName: 'END_CALL_LEAVE_SELF',
        },
      ]}
    />
  );
}
