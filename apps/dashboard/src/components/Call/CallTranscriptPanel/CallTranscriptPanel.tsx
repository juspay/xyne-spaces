import { Captions, X } from 'lucide-react';
import { useCallMarkedMoments, useCallTranscripts } from '../../../stores/callTranscriptStore';
import { LiveTranscriptList } from '../../Notetaker/LiveTranscriptList';

interface CallTranscriptPanelProps {
  callId: string;
  /** Host transcription kill-switch (roomMachine). When off, no lines are published. */
  isTranscriptionEnabled: boolean;
  onClose: () => void;
}

/** Live transcript side panel for a normal call. */
export function CallTranscriptPanel({
  callId,
  isTranscriptionEnabled,
  onClose,
}: CallTranscriptPanelProps): React.ReactElement {
  const transcripts = useCallTranscripts();
  const markedMoments = useCallMarkedMoments();

  // Capture has stopped, but lines already captured stay on screen and scrollable.
  const transcriptionOffNotice =
    'Transcriptions are off — no new lines will be added until the host turns them back on.';

  // Empty: a single centered state. Otherwise the scrollable list, with a footer once capture stops.
  const body =
    transcripts.length === 0 ? (
      <div className='flex h-full flex-col items-center justify-center gap-2 px-6 text-center'>
        <p className='text-sm text-muted-foreground'>
          {isTranscriptionEnabled ? 'Waiting for speech…' : transcriptionOffNotice}
        </p>
      </div>
    ) : (
      <div className='flex h-full min-h-0 flex-col'>
        <LiveTranscriptList
          variant='panel'
          transcripts={transcripts}
          markedMoments={markedMoments}
          isPaused={!isTranscriptionEnabled}
          trackCategory='CALLS'
          showSpeaker
        />
        {!isTranscriptionEnabled && (
          <p className='shrink-0 border-t border-border px-4 py-2.5 text-center text-xs text-muted-foreground'>
            {transcriptionOffNotice}
          </p>
        )}
      </div>
    );

  return (
    <div className='flex flex-col h-full bg-background text-foreground'>
      <div className='flex items-center justify-between px-4 py-3 border-b border-border'>
        <div className='flex items-center gap-2 min-w-0'>
          <Captions size={20} className='text-muted-foreground flex-shrink-0' />
          <h2 className='text-lg font-semibold'>Transcript</h2>
        </div>
        <button
          onClick={onClose}
          className='p-1 hover:bg-muted rounded-full transition-colors'
          title='Close'
          aria-label='Close transcript'
          data-track-category='CALLS'
          data-track-name='CLOSE_CALL_TRANSCRIPT'
          data-track-metadata={JSON.stringify({ callId })}
        >
          <X size={20} className='text-muted-foreground' />
        </button>
      </div>

      <div className='flex-1 min-h-0 overflow-hidden'>{body}</div>
    </div>
  );
}
