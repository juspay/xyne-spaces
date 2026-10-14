import { useState } from 'react';
import { Captions, X } from 'lucide-react';
import { useCallMarkedMoments, useCallTranscripts } from '../../../stores/callTranscriptStore';
import { LiveTranscriptList } from '../../Notetaker/LiveTranscriptList';

interface CallTranscriptPanelProps {
  callId: string;
  /** Host transcription kill-switch (roomMachine). When off, no lines are published. */
  isTranscriptionEnabled: boolean;
  /** Only the host can turn transcription on, so the off-state hint differs by role. */
  isHost: boolean;
  onClose: () => void;
}

/**
 * Live transcript side panel for a normal call. Built as a tab-ready shell: today it renders
 * only the transcript, but `PanelTab` is the seam for a future in-call "Ask AI" tab that will
 * consume the same `callTranscriptStore` via `buildCallTranscriptContext`.
 */
type PanelTab = 'transcript';

export function CallTranscriptPanel({
  callId,
  isTranscriptionEnabled,
  isHost,
  onClose,
}: CallTranscriptPanelProps): React.ReactElement {
  const transcripts = useCallTranscripts();
  const markedMoments = useCallMarkedMoments();
  // Only one tab for now; the setter is intentionally omitted until Ask AI lands.
  const [activeTab] = useState<PanelTab>('transcript');

  // Capture has stopped, but lines already captured stay on screen. Host sees an actionable hint.
  const transcriptionOffNotice = 'Transcriptions are off — no new lines will be added until the host turns them back on.';

  const renderBody = (): React.ReactNode => {
    if (activeTab !== 'transcript') return null;

    // Nothing captured yet — a single centered state.
    if (transcripts.length === 0) {
      return (
        <div className='flex h-full flex-col items-center justify-center gap-2 px-6 text-center'>
          <p className='text-sm text-muted-foreground'>
            {isTranscriptionEnabled ? 'Waiting for speech…' : transcriptionOffNotice}
          </p>
        </div>
      );
    }

    // Keep captured lines visible and scrollable even after transcription is turned off;
    // a footer notes that no further lines will arrive.
    return (
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
  };

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

      <div className='flex-1 min-h-0 overflow-hidden'>{renderBody()}</div>
    </div>
  );
}
