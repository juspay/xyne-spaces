import React from 'react';
import { ActionModal } from '../ActionModal';
import { DeleteTranscriptToggle } from './DeleteTranscriptToggle';

interface TranscriptDispositionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  deleteTranscript: boolean;
  onDeleteTranscriptChange: (deleteTranscript: boolean) => void;
  submitting?: boolean;
  error?: string | null;
}

/**
 * Shown at end-of-call ONLY when the host is the sole participant and transcription
 * is off — a focused prompt (no "end for everyone / just leave" choice is needed when
 * alone) to keep or delete the transcript captured before the pause. Every other case
 * uses the EndCallModal with the same delete toggle folded in.
 */
export function TranscriptDispositionModal({
  isOpen,
  onClose,
  onConfirm,
  deleteTranscript,
  onDeleteTranscriptChange,
  submitting = false,
  error = null,
}: TranscriptDispositionModalProps): React.ReactElement {
  return (
    <ActionModal
      isOpen={isOpen}
      onClose={onClose}
      title='End call?'
      testId='transcript-disposition-modal'
      content={
        <DeleteTranscriptToggle
          deleteTranscript={deleteTranscript}
          onChange={onDeleteTranscriptChange}
          disabled={submitting}
          error={error}
        />
      }
      buttons={[
        {
          label: 'Cancel',
          onClick: onClose,
          variant: 'outline',
          disabled: submitting,
          trackName: 'CANCEL_TRANSCRIPT_DISPOSITION',
        },
        {
          label: submitting ? 'Ending…' : 'End call',
          onClick: onConfirm,
          disabled: submitting,
          trackName: 'END_CALL_CONFIRM_SOLO',
          className: 'bg-action-primary hover:bg-action-primary/90 text-action-primary-foreground',
        },
      ]}
    />
  );
}
