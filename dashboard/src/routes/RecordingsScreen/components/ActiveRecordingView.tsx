/**
 * ActiveRecordingView - Live recording panel with streaming transcripts
 * Shown inside RecordingsScreen when a recording is in progress.
 * Mirrors the native recording view: header with time + status, scrollable transcript area.
 */

import { ReactElement, useEffect, useRef } from 'react';
import { Mic, Plus, Loader2 } from 'lucide-react';
import { TranscriptEntry } from '../../../stores/recordingStore';
import { formatTime12Hour, formatElapsedTime } from '../../../utils/recordingUtils';

interface ActiveRecordingViewProps {
  transcripts: TranscriptEntry[];
  startTime: number | null;
  isPaused: boolean;
  /** Whether a notes canvas already exists for this recording. Hides the create button. */
  hasCanvas?: boolean;
  /** Spinner state while the canvas is being created. */
  isCreatingCanvas?: boolean;
  /** Triggered by the "Create Canvas" button. Omit (with hasCanvas) to hide the button. */
  onCreateCanvas?: () => void;
}

// Re-export utility functions for local use
const formatTime = formatTime12Hour;

export function ActiveRecordingView({
  transcripts,
  startTime,
  isPaused,
  hasCanvas = false,
  isCreatingCanvas = false,
  onCreateCanvas,
}: ActiveRecordingViewProps): ReactElement {
  const showCreateCanvas = !hasCanvas && !!onCreateCanvas;
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
      <div className='px-6 py-4 border-b border-input dark:border-gray-700'>
        <div className='flex items-center justify-between gap-3'>
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

          {/* Create Canvas — only shown until a notes canvas exists */}
          {showCreateCanvas && (
            <button
              onClick={onCreateCanvas}
              disabled={isCreatingCanvas}
              className='flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-background dark:bg-gray-800 border border-border dark:border-gray-700 rounded-lg hover:bg-muted dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0'
              data-track-category='RecordingsScreen'
              data-track-name='create_notes_canvas'
            >
              {isCreatingCanvas ? (
                <Loader2 className='w-3.5 h-3.5 animate-spin' />
              ) : (
                <Plus className='w-3.5 h-3.5' />
              )}
              Create Canvas
            </button>
          )}
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
