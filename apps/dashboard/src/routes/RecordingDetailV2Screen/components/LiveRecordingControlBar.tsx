/**
 * Live Recording Control Bar
 *
 * Displays active-recording controls for the V2 recording detail screen:
 *   • Stop button
 *   • Elapsed timer
 *   • Read-only timeline with flagged moments and current position
 *   • LIVE badge
 *   • Audio-level visualizer
 */

import { useCallback, useEffect, useState, type CSSProperties, type ReactElement } from 'react';
import { toast } from 'sonner';
import { StopSmall, Spinner } from '@xyne/icons';
import { Button } from '../../../components/ui/Button/Button';
import {
  calculateRecordingElapsedMs,
  formatElapsedTime,
  logRecordingError,
} from '../../../utils/recordingUtils';
import {
  recordingService,
  type RecordingDetail,
} from '../../../services/Recording/recordingService';

const TIMELINE_WINDOW_MS = 60 * 60 * 1000; // 1 hour fixed window for the live timeline

interface LiveRecordingControlBarProps {
  recording: RecordingDetail;
  onStopped?: () => void;
}

export const LiveRecordingControlBar = ({
  recording,
  onStopped,
}: LiveRecordingControlBarProps): ReactElement => {
  const startTime = new Date(recording.startedAt).getTime();
  const [elapsedMs, setElapsedMs] = useState(() => calculateRecordingElapsedMs(startTime, null, 0));
  const [isStopping, setIsStopping] = useState(false);

  useEffect(() => {
    setElapsedMs(calculateRecordingElapsedMs(startTime, null, 0));

    const interval = window.setInterval(() => {
      setElapsedMs(calculateRecordingElapsedMs(startTime, null, 0));
    }, 1000);

    return (): void => window.clearInterval(interval);
  }, [startTime]);

  const handleStop = useCallback(async (): Promise<void> => {
    if (isStopping) return;

    setIsStopping(true);
    try {
      await recordingService.stopCallRecording(recording.externalId);
      onStopped?.();
      toast.success('Recording stopped');
    } catch (err) {
      logRecordingError('LiveRecordingControlBar.stopRecording', err);
      toast.error('Failed to stop recording');
    } finally {
      setIsStopping(false);
    }
  }, [isStopping, onStopped, recording.externalId]);

  return (
    <div className='mb-6 flex items-center gap-4 rounded-2xl border border-border bg-card p-5'>
      <Button
        type='button'
        variant='destructive'
        size='icon'
        onClick={() => void handleStop()}
        disabled={isStopping}
        className='size-11 shrink-0 rounded-full transition-transform active:scale-95 motion-reduce:transform-none disabled:opacity-50'
        aria-label='Stop recording'
        title='Stop recording'
        data-track-category='RecordingDetailV2'
        data-track-name='stop_live_recording'
      >
        {isStopping ? (
          <Spinner size={24} className='animate-spin' />
        ) : (
          <div className='flex items-center justify-center'>
            <StopSmall className='size-10' variant='Solid' />
          </div>
        )}
      </Button>

      <span className='shrink-0 font-mono text-xs text-muted-foreground pl-2'>
        {formatElapsedTime(elapsedMs)}
      </span>

      <LiveRecordingTimeline elapsedMs={elapsedMs} className='flex-1' />

      <div className='flex items-center gap-1.5 pr-2'>
        <span className='text-xs font-medium uppercase tracking-wide text-destructive'>Live</span>
      </div>

      <RecordingVisualizer />
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Timeline                                                                   */
/* -------------------------------------------------------------------------- */

interface LiveRecordingTimelineProps {
  elapsedMs: number;
  /** Flagged moments in milliseconds from the start of the recording. */
  moments?: number[];
  className?: string;
}

const LiveRecordingTimeline = ({
  elapsedMs,
  moments = [],
  className = '',
}: LiveRecordingTimelineProps): ReactElement => {
  const progressPercent = Math.min((elapsedMs / TIMELINE_WINDOW_MS) * 100, 100);

  return (
    <div className={className}>
      <div className='relative h-1.5 w-full rounded-full bg-muted'>
        <div
          className='absolute inset-y-0 left-0 rounded-full bg-foreground'
          style={{ width: `${progressPercent}%` }}
        />

        {moments.map((momentMs, index) => {
          const percent = Math.min((momentMs / TIMELINE_WINDOW_MS) * 100, 100);
          return (
            <div
              key={index}
              className='absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-destructive'
              style={{ left: `${percent}%` }}
            />
          );
        })}

        <div
          className='absolute top-1/2 -translate-x-1/2 -translate-y-1/2'
          style={{ left: `${progressPercent}%` }}
        >
          <span className='absolute inline-flex size-4 animate-ping rounded-full bg-destructive opacity-75' />
          <span className='relative inline-flex size-3 rounded-full border-2 border-background bg-destructive shadow-sm' />
        </div>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Audio visualizer                                                           */
/* -------------------------------------------------------------------------- */

const RecordingVisualizer = (): ReactElement => (
  <div className='inline-flex h-7 w-14 items-center justify-center gap-[3px] rounded-lg border border-border px-1.5'>
    {Array.from({ length: 4 }, (_, i) => {
      const style: CSSProperties = {
        animation: `recWaveBar 0.55s ease-in-out ${i * 0.08}s infinite alternate`,
      };
      return (
        <div key={i} className='flex h-4 items-center'>
          <div
            className='rec-overlay-waveform-bar w-[3px] rounded-full bg-destructive'
            style={style}
          />
        </div>
      );
    })}
  </div>
);
