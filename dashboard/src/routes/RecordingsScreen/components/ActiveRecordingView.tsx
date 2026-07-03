/**
 * ActiveRecordingView - Live recording panel with streaming transcripts
 * Shown inside RecordingsScreen when a recording is in progress.
 * Mirrors the native recording view: header with time + status, scrollable transcript area.
 */

import { ReactElement, useEffect, useRef } from 'react';
import { Mic, Plus, FileText, Minimize } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { TranscriptEntry } from '../../../stores/recordingStore';
import { formatTime12Hour, formatElapsedTime } from '../../../utils/recordingUtils';

interface ActiveRecordingViewProps {
  transcripts: TranscriptEntry[];
  startTime: number | null;
  isPaused: boolean;
  /** Whether a notes canvas already exists for this recording. */
  hasCanvas?: boolean;
  /** Whether the notes pane is currently visible. */
  isCanvasPaneOpen?: boolean;
  /** Spinner state while the canvas is being created. */
  isCreatingCanvas?: boolean;
  /** Triggered by the "Create Notes" button. */
  onCreateCanvas?: () => void;
  /** Triggered by the "Open Notes" button once a notes canvas exists. */
  onOpenCanvas?: () => void;
  /** Triggered by the minimize button to collapse the transcript view. */
  onMinimize?: () => void;
}

// Re-export utility functions for local use
const formatTime = formatTime12Hour;

export function ActiveRecordingView({
  transcripts,
  startTime,
  isPaused,
  hasCanvas = false,
  isCanvasPaneOpen = false,
  isCreatingCanvas = false,
  onCreateCanvas,
  onOpenCanvas,
  onMinimize,
}: ActiveRecordingViewProps): ReactElement {
  const showCanvasAction = hasCanvas ? !isCanvasPaneOpen && !!onOpenCanvas : !!onCreateCanvas;
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new transcripts arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcripts]);

  return (
    <div className='flex flex-col h-full'>
      {/* Recording Header */}
      <div className='h-[72px] px-6 border-b border-input dark:border-gray-700 flex items-center'>
        <div className='flex w-full items-center justify-between gap-3'>
          <div className='flex items-center gap-3 min-w-0'>
            <div className='w-10 h-10 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center flex-shrink-0'>
              <Mic className='w-5 h-5 text-red-500' />
            </div>
            <div className='min-w-0'>
              <h2 className='text-lg font-semibold text-foreground dark:text-gray-100 truncate'>
                Note Taker Recording
              </h2>
              <div className='flex items-center gap-2 text-sm text-muted-foreground dark:text-muted-foreground'>
                {startTime && <span>{formatTime(startTime)}</span>}
                <span className='w-1 h-1 rounded-full bg-gray-400' />
                <span className='flex items-center gap-1.5'>
                  {isPaused ? (
                    <>
                      <span className='w-2 h-2 rounded-full bg-yellow-500' />
                      Paused
                    </>
                  ) : (
                    <>
                      <span className='w-2 h-2 rounded-full bg-red-500 animate-pulse' />
                      Recording...
                    </>
                  )}
                </span>
              </div>
            </div>
          </div>

          {/* Right-side controls — canvas action + minimize */}
          <div className='flex items-center gap-2 flex-shrink-0'>
            {showCanvasAction && (
              <Button
                variant='outline'
                size='sm'
                onClick={hasCanvas ? onOpenCanvas : onCreateCanvas}
                disabled={!hasCanvas && isCreatingCanvas}
                loading={!hasCanvas && isCreatingCanvas}
                className='h-8 gap-1.5 px-3 text-sm font-medium flex items-center justify-normal'
                data-track-category='RecordingsScreen'
                data-track-name={hasCanvas ? 'open_notes_canvas' : 'create_notes_canvas'}
              >
                {hasCanvas ? (
                  <FileText className='size-3.5' />
                ) : (
                  <Plus className='size-3' strokeWidth={2.5} />
                )}
                {hasCanvas ? 'Open Notes' : 'Create Notes'}
              </Button>
            )}

            {onMinimize && (
              <Button
                variant='outline'
                size='iconSm'
                onClick={onMinimize}
                title='Minimize transcript'
                aria-label='Minimize transcript'
                data-track-category='RecordingsScreen'
                data-track-name='minimize_transcript'
              >
                <Minimize className='size-4' strokeWidth={2.5} />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Transcript Area */}
      <div ref={scrollRef} className='flex-1 overflow-auto px-6 py-6'>
        {transcripts.length > 0 ? (
          <div className='space-y-2'>
            {transcripts.map(entry => (
              <div key={entry.id} className='flex gap-1'>
                <span className='shrink-0 text-[15px] tabular-nums whitespace-nowrap text-foreground dark:text-gray-200 leading-snug'>
                  {startTime !== null &&
                    `[${formatElapsedTime(Math.max(0, entry.timestamp - startTime))}]:`}
                </span>
                <div className='flex-1 min-w-0 text-[15px] text-foreground dark:text-gray-200 leading-snug'>
                  {entry.text}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className='flex items-center justify-center h-full'>
            <div className='text-center'>
              <div className='flex items-center justify-center gap-1 mb-3'>
                {[0, 1, 2, 3, 4].map(i => (
                  <div
                    key={i}
                    className='w-1 rounded-full bg-muted-foreground/50 dark:bg-gray-600'
                    style={{
                      animation: `listeningPulse 1s ease-in-out ${i * 0.15}s infinite alternate`,
                      height: '16px',
                    }}
                  />
                ))}
              </div>
              <p className='text-sm text-muted-foreground dark:text-muted-foreground'>
                Listening... Start speaking and your words will appear here.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Listening pulse keyframes */}
      <style>{`
        @keyframes listeningPulse {
          from { height: 8px; opacity: 0.4; }
          to { height: 24px; opacity: 1; }
        }
      `}</style>
    </div>
  );
}
