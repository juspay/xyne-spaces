/**
 * MinimizedTranscriptView - Compact bar shown when the transcript workspace is minimized.
 * Displays recording status, live transcript preview (4-5 lines with top fade),
 * and a maximize button. Transcripts are center-staged with auto-scroll.
 * Sits between the recordings list and the RecordingControlBar.
 */

import { ReactElement, useEffect, useState, useRef } from 'react';
import { Maximize } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import type { RecordingStatus, TranscriptEntry } from '../../../stores/recordingStore';
import { formatElapsedTime } from '../../../utils/recordingUtils';

interface MinimizedTranscriptViewProps {
  status: RecordingStatus;
  startTime: number | null;
  transcripts: TranscriptEntry[];
  onMaximize: () => void;
}

export function MinimizedTranscriptView({
  status,
  startTime,
  transcripts,
  onMaximize,
}: MinimizedTranscriptViewProps): ReactElement {
  const isRecording = status === 'recording';
  const isPaused = status === 'paused';
  const isStarting = status === 'starting';

  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if ((isRecording || isPaused) && startTime) {
      setElapsed(Date.now() - startTime);
      if (!isPaused) {
        intervalRef.current = setInterval(() => {
          setElapsed(Date.now() - startTime);
        }, 1000);
      }
    }

    return (): void => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isRecording, isPaused, startTime]);

  // Auto-scroll to bottom when new transcripts arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcripts]);

  return (
    <div className='bg-background border-t border-border h-64 absolute bottom-0 left-0 right-0 z-20 flex flex-col justify-between rec-overlay-transcript-mask'>
      {/* Top row: status + maximize */}
      <div className='flex items-center justify-between gap-3 px-4 py-2'>
        <div className='flex items-center gap-2.5 absolute left-4 bottom-2'>
          <div className='relative flex-shrink-0'>
            {isRecording && (
              <span className='flex h-2.5 w-2.5'>
                <span className='animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75' />
                <span className='relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500' />
              </span>
            )}
            {isPaused && (
              <span className='relative inline-flex rounded-full h-2.5 w-2.5 bg-yellow-500' />
            )}
            {isStarting && (
              <span className='animate-pulse relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500' />
            )}
          </div>

          <span className='font-medium text-xs text-foreground flex-shrink-0'>
            {isStarting ? 'Starting...' : isPaused ? 'Paused' : 'Recording'}
          </span>

          <span className='text-[11px] text-muted-foreground tabular-nums flex-shrink-0'>
            {isStarting ? 'Connecting...' : formatElapsedTime(elapsed)}
          </span>
        </div>

        <Button
          variant='outline'
          size='sm'
          onClick={onMaximize}
          className='h-8 gap-1.5 px-3 text-sm absolute bottom-2 right-2 font-medium z-10'
          title='Maximize transcript'
          data-track-category='MinimizedTranscriptView'
          data-track-name='maximize_transcript'
        >
          <Maximize className='size-3' strokeWidth={2.5} />
          Go to Transcript
        </Button>
      </div>

      {/* Transcript preview — center staged, auto-scroll, top fade matches RecordingOverlay */}
      <div className='px-6 py-2'>
        <div
          ref={scrollRef}
          className='no-scrollbar overflow-y-auto h-[96px] text-center flex flex-col justify-end rec-overlay-transcript-mask'
        >
          {transcripts.length > 0 ? (
            <div className='space-y-1 mx-auto flex-shrink-0'>
              {transcripts.map(entry => (
                <p
                  key={entry.id}
                  className='text-sm leading-snug text-foreground text-center break-words'
                >
                  {entry.text}
                </p>
              ))}
            </div>
          ) : (
            <div className='flex items-center justify-center h-[60px]'>
              <p className='text-xs text-muted-foreground '>Listening...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
