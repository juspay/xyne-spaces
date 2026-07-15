/**
 * MinimizedTranscriptView - Compact bar shown when the transcript workspace is minimized.
 * Displays recording status, live transcript preview (last 3 lines with timestamps and opacity ramp),
 */

import { ReactElement, useEffect, useState, useRef, useMemo } from 'react';
import { ChevronUp } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '../../../components/ui/Button';
import type { RecordingStatus, TranscriptEntry } from '../../../stores/recordingStore';
import { formatElapsedTime } from '../../../utils/recordingUtils';

interface MinimizedTranscriptViewProps {
  status: RecordingStatus;
  startTime: number | null;
  transcripts: TranscriptEntry[];
  onMaximize: () => void;
  /** Whether to show the scrim/blur effect (default: true). Disable when embedded in a workspace. */
  showScrim?: boolean;
}

// Opacity ramp for the 3 visible lines (oldest to newest)
const OPACITY_RAMP = [0.34, 0.62, 1.0];

export function MinimizedTranscriptView({
  status,
  startTime,
  transcripts,
  onMaximize,
  showScrim = true,
}: MinimizedTranscriptViewProps): ReactElement {
  const isRecording = status === 'recording';
  const isPaused = status === 'paused';
  const isStarting = status === 'starting';

  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const lastLineRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to show the last transcript line from its start
  useEffect(() => {
    if (lastLineRef.current) {
      lastLineRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, [transcripts]);

  // Get last 3 transcripts with computed styles
  const visibleLines = useMemo(() => {
    const lastThree = transcripts.slice(-3);
    const count = lastThree.length;

    return lastThree.map((entry, index) => {
      const isLast = index === count - 1;
      // Map index to opacity ramp based on position from end
      const rampIndex = 3 - count + index;
      const opacity = OPACITY_RAMP[rampIndex] ?? OPACITY_RAMP[0];

      // Calculate elapsed time for this entry
      const entryElapsed = startTime ? Math.max(0, entry.timestamp - startTime) : 0;

      return {
        ...entry,
        time: formatElapsedTime(entryElapsed),
        opacity,
        isLast,
      };
    });
  }, [transcripts, startTime]);

  return (
    <div className='absolute bottom-0 left-0 right-0 z-20 pointer-events-none'>
      {/* Scrim: fades recording list into transcript zone */}
      {showScrim && (
        <div
          className='h-[100px]'
          style={{
            background:
              'linear-gradient(to bottom, transparent 0%, hsl(var(--background) / 0.95) 100%)',
          }}
          aria-hidden='true'
        />
      )}

      {/* Transcript band */}
      <div
        className={`relative px-6 pt-2 pb-4 pointer-events-auto ${
          showScrim
            ? 'bg-gradient-to-b from-background/95 to-card/95 backdrop-blur-md'
            : 'bg-card/95 backdrop-blur-sm border-t border-border/60'
        }`}
      >
        {/* REC + elapsed — bottom left */}
        <div className='absolute left-3 bottom-3 flex items-center gap-2.5 z-10'>
          {isRecording && (
            <span className='inline-flex items-center gap-1.5 bg-destructive/10 text-destructive font-bold text-[10px] tracking-wider px-2 py-0.5 rounded-md'>
              <span className='size-1.5 rounded-full bg-destructive animate-[rec-blink_1.1s_step-end_infinite]' />
              REC
            </span>
          )}
          {isPaused && (
            <span className='inline-flex items-center gap-1.5 bg-muted text-yellow-600 font-bold text-[10px] tracking-wider px-2 py-0.5 rounded-md'>
              <span className='size-1.5 rounded-full bg-yellow-500' />
              PAUSED
            </span>
          )}
          {isStarting && (
            <span className='inline-flex items-center gap-1.5 bg-muted text-blue-500 font-bold text-[10px] tracking-wider px-2 py-0.5 rounded-md'>
              <span className='size-1.5 rounded-full bg-blue-500 animate-pulse' />
              STARTING
            </span>
          )}

          <span className='font-bold font-mono text-xs text-muted-foreground tracking-wide tabular-nums'>
            {isStarting ? 'Connecting...' : formatElapsedTime(elapsed)}
          </span>
        </div>

        {/* Expand Transcript — bottom right */}
        <Button
          variant='ghost'
          size='sm'
          onClick={onMaximize}
          className='absolute right-4 bottom-2.5 h-8 gap-1 px-8 text-sm font-semibold text-muted-foreground rounded-lg bg-accent hover:bg-muted hover:text-foreground border border-input z-10'
          title='Expand transcript'
          data-track-category='MinimizedTranscriptView'
          data-track-name='maximize_transcript'
        >
          <ChevronUp className='size-4' strokeWidth={2.5} />
          <span>Expand</span>
        </Button>

        {/* Transcript content - centered, extends to bottom row */}
        <div className='max-w-3xl mx-auto h-24 overflow-y-auto flex flex-col [&::-webkit-scrollbar]:hidden [scrollbar-width:none]'>
          <AnimatePresence mode='popLayout'>
            {visibleLines.length > 0 ? (
              <motion.div
                key='transcript-lines'
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                className='flex flex-col gap-1.5 mt-auto'
              >
                {visibleLines.map(line => (
                  <motion.div
                    key={line.id}
                    ref={line.isLast ? lastLineRef : undefined}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                    className='flex gap-4 items-baseline'
                  >
                    {/* Timestamp */}
                    <span
                      className='flex-none w-10 text-right font-mono text-[11px] leading-[1.5] font-medium tabular-nums'
                      style={{
                        color: `hsl(var(--muted-foreground) / ${line.opacity})`,
                      }}
                    >
                      {line.time}
                    </span>
                    {/* Transcript text */}
                    <div
                      className='flex-1 min-w-0 leading-[1.5]'
                      style={{
                        fontSize: line.isLast ? '14px' : '13px',
                        fontWeight: line.isLast ? 600 : 400,
                        color: line.isLast
                          ? 'hsl(var(--foreground))'
                          : `hsl(var(--foreground) / ${line.opacity})`,
                      }}
                    >
                      {line.text}
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            ) : (
              <motion.div
                key='listening'
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className='flex items-center justify-center py-2'
              >
                <p className='text-sm text-muted-foreground'>Listening...</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
