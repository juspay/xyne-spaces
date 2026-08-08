import React from 'react';
import { ActionModal } from '../ActionModal';

interface TranscriptDispositionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onKeep: () => void;
  onDiscard: () => void;
  submitting?: boolean;
  error?: string | null;
}

/**
 * TranscriptDispositionModal - shown to the host at call end ONLY when
 * transcription is currently OFF. Lets them keep the partial transcript
 * (captured before the pause) + generate artifacts, or discard everything for a
 * fully private call. Every other end path defaults to keep + artifacts.
 *
 * The discard path is awaited by the caller (the backend must confirm it before
 * the call ends, otherwise it defaults to keeping the transcript), so this
 * surfaces a submitting label and any error for retry.
 */
export function TranscriptDispositionModal({
  isOpen,
  onClose,
  onKeep,
  onDiscard,
  submitting = false,
  error = null,
}: TranscriptDispositionModalProps): React.ReactElement {
  return (
    <ActionModal
      isOpen={isOpen}
      onClose={onClose}
      title='Keep the transcript for this call?'
      subtitle='Transcription was turned off during this call. Keep what was captured before it was turned off (and generate the usual summary and artifacts), or discard everything for a fully private call.'
      description={error ?? undefined}
      testId='transcript-disposition-modal'
      buttons={[
        {
          label: submitting ? 'Discarding…' : 'Discard everything',
          onClick: onDiscard,
          variant: 'outline',
          testId: 'transcript-discard-button',
        },
        {
          label: 'Keep transcript',
          onClick: onKeep,
          className: 'bg-action-primary hover:bg-action-primary/90 text-action-primary-foreground',
          testId: 'transcript-keep-button',
        },
      ]}
    />
  );
}
