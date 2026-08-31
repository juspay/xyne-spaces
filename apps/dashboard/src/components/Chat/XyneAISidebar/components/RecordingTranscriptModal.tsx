import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Dialog } from '../../../ui/Dialog';
import { TranscriptSidePanel } from '../../TranscriptCitationModal/TranscriptSidePanel';
import { fetchTranscriptCached } from '../../TranscriptCitationModal/transcriptCache';

export interface RecordingTranscriptModalProps {
  /** Recording's externalId — the call the transcript belongs to. `null` keeps the modal closed. */
  callId: string | null;
  onClose: () => void;
}

/**
 * The transcript behind an attached recording pill, shown centred over the
 * composer so the half-written question stays put. Reuses the citation panel's
 * body (copy / download / search) rather than a second transcript reader.
 */
export const RecordingTranscriptModal = ({
  callId,
  onClose,
}: RecordingTranscriptModalProps): ReactElement => {
  // Radix focuses the first tabbable child on open, which is the panel's Copy
  // button — and a focused tooltip trigger keeps its tooltip up. Park focus on
  // the container instead so the dialog still traps it without that side effect.
  const containerRef = useRef<HTMLDivElement>(null);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!callId) return;

    let cancelled = false;
    setTranscript('');
    setError(null);
    setIsLoading(true);

    fetchTranscriptCached(callId)
      .then(data => {
        if (!cancelled) setTranscript(data ?? '');
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the transcript for this recording.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return (): void => {
      cancelled = true;
    };
  }, [callId]);

  return (
    <Dialog
      open={callId !== null}
      onOpenChange={open => {
        if (!open) onClose();
      }}
      title='Transcript'
      description='Transcript of the attached recording'
      className='h-[80vh] max-w-2xl overflow-hidden rounded-2xl p-0'
      mobileVariant='dialog'
      testId='recording-transcript-modal'
      focusRef={containerRef}
    >
      <div ref={containerRef} tabIndex={-1} className='h-full outline-none'>
        <TranscriptSidePanel
          transcript={transcript}
          isLoading={isLoading}
          error={error}
          onClose={onClose}
          className='border-l-0 shadow-none'
        />
      </div>
    </Dialog>
  );
};
