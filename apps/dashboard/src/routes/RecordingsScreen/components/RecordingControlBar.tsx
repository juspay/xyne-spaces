/**
 * RecordingControlBar - Sticky bottom bar with record/stop/pause button
 * Mirrors the native RecordingControls component: waveform bars + control buttons
 */

import { ReactElement, useEffect, useState, useRef } from 'react';
import { Loader2, Pause, Play } from 'lucide-react';
import { calculateRecordingElapsedMs, formatElapsedTime } from '../../../utils/recordingUtils';
import { Waveform } from '../../../utils/recordingWaveform';
import { ShortcutTooltip } from '../../../components/ui/ShortcutTooltip';

/**
 * Returns true when the dashboard is running inside a mobile browser or
 * Lotus WebView. In that context the MobileNavbar pill (~72 px) sits fixed
 * at the bottom of the viewport, so the RecordingControlBar needs extra
 * padding-bottom to keep the red button visible above the pill.
 */
function useMobileWebPadding(): boolean {
  const [isMobileWeb, setIsMobileWeb] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent || '';
    // React-Native WebView or viewport narrower than a typical tablet.
    const isNativeWebView =
      /ReactNative/i.test(ua) ||
      /lotusWebEngine/i.test(ua) ||
      (window.innerWidth < 700 && !/Electron/i.test(ua));
    setIsMobileWeb(isNativeWebView);
  }, []);

  return isMobileWeb;
}

interface RecordingControlBarProps {
  isRecording: boolean;
  isPaused: boolean;
  isStarting: boolean;
  startTime: number | null;
  pauseStartedAt: number | null;
  accumulatedPausedMs: number;
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
}

export function RecordingControlBar({
  isRecording,
  isPaused,
  isStarting,
  startTime,
  pauseStartedAt,
  accumulatedPausedMs,
  onStart,
  onStop,
  onPause,
  onResume,
}: RecordingControlBarProps): ReactElement {
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isRecording && startTime) {
      setElapsed(calculateRecordingElapsedMs(startTime, pauseStartedAt, accumulatedPausedMs));
      if (!isPaused) {
        intervalRef.current = setInterval(() => {
          setElapsed(calculateRecordingElapsedMs(startTime, pauseStartedAt, accumulatedPausedMs));
        }, 1000);
      }
    }

    return (): void => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isRecording, isPaused, startTime, pauseStartedAt, accumulatedPausedMs]);

  const isMobileWeb = useMobileWebPadding();
  // MOBILE_NAV_H ≈ height of the MobileNavbar pill (44 px items + py-2 + bottom-2)
  const MOBILE_NAV_H = 72;

  return (
    <div
      className='sticky bottom-0 z-10 border-t border-border bg-card px-6 pt-4'
      style={{ paddingBottom: isMobileWeb ? `${MOBILE_NAV_H + 16}px` : '1rem' }}
    >
      <div className='max-w-4xl mx-auto flex items-center justify-center gap-4'>
        {/* Waveform bars (left side, visible when actively recording) */}
        {isRecording && !isPaused && <Waveform variant='bar' durationSec={0.5} staggerSec={0.1} />}

        {/* Elapsed time */}
        {isRecording && (
          <span className='text-sm font-mono text-muted-foreground min-w-[52px] text-center'>
            {formatElapsedTime(elapsed)}
          </span>
        )}

        {/* Pause/Resume and Stop buttons (visible when recording) */}
        {isRecording ? (
          <>
            <button
              onClick={isPaused ? onResume : onPause}
              disabled={isStarting}
              className='flex items-center justify-center w-10 h-10 rounded-full border border-border bg-foreground/15 hover:bg-foreground/25 transition-colors disabled:opacity-50'
              title={isPaused ? 'Resume recording' : 'Pause recording'}
              data-track-category='RecordingControlBar'
              data-track-name={isPaused ? 'resume_recording' : 'pause_recording'}
            >
              {isPaused ? (
                <Play className='w-5 h-5 text-foreground' />
              ) : (
                <Pause className='w-5 h-5 text-foreground' />
              )}
            </button>

            <button
              onClick={onStop}
              className='flex items-center justify-center w-12 h-12 rounded-xl bg-foreground/15 hover:bg-foreground/25 transition-colors'
              title='Stop recording'
              data-track-category='RecordingControlBar'
              data-track-name='stop_recording'
            >
              {/* Square stop icon */}
              <div className='w-5 h-5 rounded-sm bg-destructive' />
            </button>
          </>
        ) : (
          <ShortcutTooltip label='Start recording' shortcut='recording.start' side='top'>
            <button
              onClick={onStart}
              disabled={isStarting}
              className='flex items-center justify-center w-14 h-14 rounded-full bg-destructive hover:bg-destructive/85 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg'
              aria-label='Start recording'
              data-track-category='RecordingControlBar'
              data-track-name='start_recording'
            >
              {isStarting ? (
                <Loader2 className='w-6 h-6 text-white animate-spin' />
              ) : (
                /* Circle record icon */
                <div className='w-6 h-6 rounded-full bg-background' />
              )}
            </button>
          </ShortcutTooltip>
        )}

        {/* Waveform bars (right side, visible when actively recording) */}
        {isRecording && !isPaused && <Waveform variant='bar' durationSec={0.6} staggerSec={0.15} />}
      </div>
    </div>
  );
}
